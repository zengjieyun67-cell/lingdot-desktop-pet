//! Free voice chat with 小喵: macOS speech recognition → existing chat pipeline
//! (DeepSeek preset + persona prompt) → macOS system voice.
//!
//! The loop lives here in Rust so it keeps working while the panel is hidden:
//!   push-to-talk : listen while held → reply → speak → idle
//!   实时对话      : listen → silence ends the utterance → reply → speak → listen …
//! Talking over 小喵 stops her voice (best effort, echo-filtered).
//!
//! Events: `voice-state` (VoiceStatus) and `voice-turn` ({ role, content }).

use crate::persona_cmds::{chat_ready, chat_reply};
use crate::stt::{self, SttEvent, SttSession};
use crate::{tts, AppState};
use pet_core::chat::ChatMessage;
use pet_core::model::now_ms;
use pet_core::voice::{is_barge_in, speech_text, trim_history, SystemVoice, UtteranceDetector, VoiceMode, VoicePhase};
use serde::Serialize;
use std::process::Child;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

type CmdResult<T> = Result<T, String>;

const LOCALE: &str = "zh-CN";
const HISTORY_KEEP: usize = 16;
const MAX_SPEECH_CHARS: usize = 360;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub mode: VoiceMode,
    pub phase: VoicePhase,
    /// Live transcript of what the user is saying.
    pub transcript: String,
    /// What 小喵 is currently saying (for the bubble).
    pub speaking: String,
    pub error: Option<String>,
    /// Native speech recognition available (macOS).
    pub stt_supported: bool,
    /// System voice available (macOS).
    pub tts_supported: bool,
    /// authorized | denied | restricted | not_determined | unsupported
    pub permission: &'static str,
}

#[derive(Default)]
struct Inner {
    mode: VoiceMode,
    phase: VoicePhase,
    /// Bumped whenever a recognition session starts/stops; stale callbacks are ignored.
    listen_gen: u64,
    /// Bumped whenever speech starts/stops.
    speak_gen: u64,
    stt: Option<SttSession>,
    /// Recognition session running only to catch barge-in while speaking.
    barge_listening: bool,
    detector: Option<UtteranceDetector>,
    say: Option<Child>,
    transcript: String,
    speaking: String,
    error: Option<String>,
    history: Vec<ChatMessage>,
}

#[derive(Default, Clone)]
pub struct VoiceRuntime {
    inner: Arc<Mutex<Inner>>,
}

fn settings(app: &AppHandle) -> pet_core::model::AppSettings {
    app.state::<AppState>().engine.db().get_settings().unwrap_or_default()
}

impl VoiceRuntime {
    fn status_of(i: &Inner) -> VoiceStatus {
        VoiceStatus {
            mode: i.mode,
            phase: i.phase,
            transcript: i.transcript.clone(),
            speaking: i.speaking.clone(),
            error: i.error.clone(),
            stt_supported: stt::supported(),
            tts_supported: tts::supported(),
            permission: stt::authorization_status(),
        }
    }

    pub fn status(&self) -> VoiceStatus {
        Self::status_of(&self.inner.lock().unwrap())
    }

    fn emit(&self, app: &AppHandle) {
        let st = self.status();
        let _ = app.emit("voice-state", st);
    }

    fn set_error(&self, app: &AppHandle, msg: impl Into<String>) {
        {
            let mut i = self.inner.lock().unwrap();
            i.error = Some(msg.into());
        }
        self.emit(app);
    }

    fn seed_history(&self, history: Option<Vec<ChatMessage>>) {
        if let Some(h) = history {
            let h: Vec<ChatMessage> = h.into_iter().filter(|m| m.role == "user" || m.role == "assistant").collect();
            self.inner.lock().unwrap().history = trim_history(&h, HISTORY_KEEP);
        }
    }

    fn ready(&self, app: &AppHandle) -> CmdResult<()> {
        if !settings(app).voice_enabled {
            return Err("语音还没开启：请到 设置 → 语音 打开".into());
        }
        chat_ready(app)?;
        if !stt::supported() {
            return Err("这台电脑不支持系统语音识别（仅 macOS）".into());
        }
        Ok(())
    }

    // ---------------------------------------------------------------- listening

    /// Start a recognition session. `barge` = only listen for the user talking over 小喵.
    fn start_listening(&self, app: &AppHandle, barge: bool) -> CmdResult<()> {
        let s = settings(app);
        let gen = {
            let mut i = self.inner.lock().unwrap();
            i.stt = None; // drops (cancels) the previous session
            i.listen_gen += 1;
            i.barge_listening = barge;
            let mut d = UtteranceDetector::new(s.voice_silence_ms as i64);
            d.reset(now_ms());
            i.detector = Some(d);
            if !barge {
                i.phase = VoicePhase::Listening;
                i.transcript.clear();
                i.error = None;
            }
            i.listen_gen
        };
        self.emit(app);
        let me = self.clone();
        let h = app.clone();
        let sink: stt::SttSink = Arc::new(move |ev| me.on_stt(&h, gen, ev));
        match stt::start(LOCALE, s.voice_on_device, sink) {
            Ok(session) => {
                let mut i = self.inner.lock().unwrap();
                if i.listen_gen == gen {
                    i.stt = Some(session);
                }
                Ok(())
            }
            Err(e) => {
                if !barge {
                    let mut i = self.inner.lock().unwrap();
                    i.phase = VoicePhase::Idle;
                    i.mode = VoiceMode::Off;
                    i.error = Some(e.clone());
                    drop(i);
                    self.emit(app);
                }
                Err(e)
            }
        }
    }

    fn stop_listening(&self) {
        let mut i = self.inner.lock().unwrap();
        i.listen_gen += 1;
        i.stt = None;
        i.barge_listening = false;
    }

    fn on_stt(&self, app: &AppHandle, gen: u64, ev: SttEvent) {
        let mut finished: Option<String> = None;
        let mut restart = false;
        let mut barge = false;
        {
            let mut i = self.inner.lock().unwrap();
            if i.listen_gen != gen {
                return;
            }
            match ev {
                SttEvent::Transcript { text, is_final } => {
                    if i.barge_listening {
                        let speaking = i.speaking.clone();
                        if i.phase == VoicePhase::Speaking && is_barge_in(&text, &speaking) {
                            barge = true;
                        }
                    } else {
                        let now = now_ms();
                        if let Some(d) = i.detector.as_mut() {
                            d.feed(&text, now);
                        }
                        i.transcript = text;
                        if is_final && i.mode == VoiceMode::Live {
                            finished = i.detector.as_mut().and_then(|d| d.finish(now));
                        }
                    }
                }
                SttEvent::Error(e) => {
                    // "No speech detected" / cancellation are normal in a live loop.
                    if !i.barge_listening && i.mode == VoiceMode::PushToTalk && i.transcript.is_empty() {
                        i.error = Some(format!("没听清：{e}"));
                    }
                }
                SttEvent::Ended => {
                    if !i.barge_listening && i.mode == VoiceMode::Live && i.phase == VoicePhase::Listening {
                        finished = i.detector.as_mut().and_then(|d| d.finish(now_ms()));
                        restart = finished.is_none();
                    }
                }
            }
        }
        if barge {
            self.stop_speaking_inner();
            let me = self.clone();
            let h = app.clone();
            std::thread::spawn(move || {
                let _ = me.start_listening(&h, false);
            });
            return;
        }
        self.emit(app);
        if let Some(text) = finished {
            self.handle_utterance(app, text);
        } else if restart {
            // Recognition sessions end on their own (≈1 min / long silence): keep the loop going.
            let me = self.clone();
            let h = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(400));
                let still = {
                    let i = me.inner.lock().unwrap();
                    i.mode == VoiceMode::Live && i.phase == VoicePhase::Listening && i.listen_gen == gen
                };
                if still {
                    let _ = me.start_listening(&h, false);
                }
            });
        }
    }

    /// 实时对话: end the utterance after `voice_silence_ms` without new words.
    pub fn spawn_silence_watch(&self, app: AppHandle) {
        let me = self.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(150));
            let done = {
                let mut i = me.inner.lock().unwrap();
                if i.mode == VoiceMode::Live && i.phase == VoicePhase::Listening && !i.barge_listening {
                    i.detector.as_mut().and_then(|d| d.poll(now_ms()))
                } else {
                    None
                }
            };
            if let Some(text) = done {
                me.handle_utterance(&app, text);
            }
        });
    }

    // ------------------------------------------------------------- conversation

    fn handle_utterance(&self, app: &AppHandle, text: String) {
        self.stop_listening();
        let history = {
            let mut i = self.inner.lock().unwrap();
            i.phase = VoicePhase::Thinking;
            i.transcript = text.clone();
            i.history.push(ChatMessage { role: "user".into(), content: text.clone() });
            i.history = trim_history(&i.history, HISTORY_KEEP);
            i.history.clone()
        };
        let _ = app.emit("voice-turn", serde_json::json!({ "role": "user", "content": text }));
        self.emit(app);
        let me = self.clone();
        let h = app.clone();
        tauri::async_runtime::spawn(async move {
            let res = chat_reply(&h, history).await;
            match res {
                Ok(reply) => {
                    {
                        let mut i = me.inner.lock().unwrap();
                        i.history.push(ChatMessage { role: "assistant".into(), content: reply.clone() });
                    }
                    let _ = h.emit("voice-turn", serde_json::json!({ "role": "assistant", "content": reply }));
                    me.speak(&h, &reply, true);
                }
                Err(e) => {
                    {
                        let mut i = me.inner.lock().unwrap();
                        i.mode = VoiceMode::Off;
                        i.phase = VoicePhase::Idle;
                        i.error = Some(e);
                    }
                    me.emit(&h);
                }
            }
        });
    }

    // ----------------------------------------------------------------- speaking

    /// Speak `text` with the system voice. `continue_loop` = resume listening afterwards
    /// in 实时对话 (push-to-talk / read-aloud just go idle).
    pub fn speak(&self, app: &AppHandle, text: &str, continue_loop: bool) {
        let s = settings(app);
        let say_text = speech_text(text, MAX_SPEECH_CHARS);
        self.stop_speaking_inner();
        if say_text.is_empty() || !tts::supported() {
            self.after_speech(app, continue_loop);
            return;
        }
        let voice = tts::resolve_voice(&s.voice_name);
        let child = match tts::spawn_say(&say_text, voice.as_deref(), s.voice_rate) {
            Ok(c) => c,
            Err(e) => {
                self.set_error(app, e);
                self.after_speech(app, continue_loop);
                return;
            }
        };
        let gen = {
            let mut i = self.inner.lock().unwrap();
            i.speak_gen += 1;
            i.phase = VoicePhase::Speaking;
            i.speaking = say_text.clone();
            i.say = Some(child);
            i.speak_gen
        };
        self.emit(app);
        let live = self.inner.lock().unwrap().mode == VoiceMode::Live;
        if live && s.voice_barge_in {
            let _ = self.start_listening(app, true);
        }
        // Wait for `say` to finish without holding the lock.
        let me = self.clone();
        let h = app.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(80));
            let finished = {
                let mut i = me.inner.lock().unwrap();
                if i.speak_gen != gen {
                    return; // stopped / replaced
                }
                match i.say.as_mut().map(|c| c.try_wait()) {
                    Some(Ok(None)) => false,
                    _ => {
                        i.say = None;
                        true
                    }
                }
            };
            if finished {
                me.after_speech(&h, continue_loop);
                return;
            }
        });
    }

    fn after_speech(&self, app: &AppHandle, continue_loop: bool) {
        let live = {
            let mut i = self.inner.lock().unwrap();
            i.speaking.clear();
            if i.barge_listening {
                i.stt = None;
                i.listen_gen += 1;
                i.barge_listening = false;
            }
            let live = continue_loop && i.mode == VoiceMode::Live;
            if !live {
                if i.mode == VoiceMode::PushToTalk {
                    i.mode = VoiceMode::Off;
                }
                if i.phase != VoicePhase::Listening {
                    i.phase = VoicePhase::Idle;
                }
            }
            live
        };
        if live {
            let _ = self.start_listening(app, false);
        } else {
            self.emit(app);
        }
    }

    fn stop_speaking_inner(&self) {
        let mut i = self.inner.lock().unwrap();
        i.speak_gen += 1;
        if let Some(mut c) = i.say.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        i.speaking.clear();
        if i.phase == VoicePhase::Speaking {
            i.phase = VoicePhase::Idle;
        }
    }

    pub fn stop_speaking(&self, app: &AppHandle) {
        self.stop_speaking_inner();
        let live = self.inner.lock().unwrap().mode == VoiceMode::Live;
        if live {
            let me = self.clone();
            let h = app.clone();
            std::thread::spawn(move || {
                let _ = me.start_listening(&h, false);
            });
        } else {
            self.emit(app);
        }
    }

    // ------------------------------------------------------------------ public

    pub fn ptt_start(&self, app: &AppHandle, history: Option<Vec<ChatMessage>>) -> CmdResult<VoiceStatus> {
        self.ready(app).inspect_err(|e| self.set_error(app, e.clone()))?;
        self.seed_history(history);
        self.stop_speaking_inner();
        {
            let mut i = self.inner.lock().unwrap();
            if i.mode == VoiceMode::Live {
                // holding the button during 实时对话 simply keeps listening
                drop(i);
                return Ok(self.status());
            }
            i.mode = VoiceMode::PushToTalk;
        }
        self.start_listening(app, false)?;
        Ok(self.status())
    }

    pub fn ptt_stop(&self, app: &AppHandle) -> VoiceStatus {
        let is_ptt = {
            let i = self.inner.lock().unwrap();
            i.mode == VoiceMode::PushToTalk && i.phase == VoicePhase::Listening
        };
        if !is_ptt {
            return self.status();
        }
        if let Some(s) = self.inner.lock().unwrap().stt.as_ref() {
            s.end_audio();
        }
        // Give the recognizer a moment for its last words, then use what we have.
        let me = self.clone();
        let h = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(700));
            let text = {
                let mut i = me.inner.lock().unwrap();
                if i.mode != VoiceMode::PushToTalk || i.phase != VoicePhase::Listening {
                    return;
                }
                i.detector.as_mut().and_then(|d| d.finish(now_ms()))
            };
            match text {
                Some(t) => me.handle_utterance(&h, t),
                None => {
                    me.stop_listening();
                    {
                        let mut i = me.inner.lock().unwrap();
                        i.mode = VoiceMode::Off;
                        i.phase = VoicePhase::Idle;
                        if i.error.is_none() {
                            i.error = Some("没听到声音哦，按住再说一次试试".into());
                        }
                    }
                    me.emit(&h);
                }
            }
        });
        self.status()
    }

    pub fn set_live(&self, app: &AppHandle, enabled: bool, history: Option<Vec<ChatMessage>>) -> CmdResult<VoiceStatus> {
        if enabled {
            self.ready(app).inspect_err(|e| self.set_error(app, e.clone()))?;
            self.seed_history(history);
            self.stop_speaking_inner();
            self.inner.lock().unwrap().mode = VoiceMode::Live;
            self.start_listening(app, false)?;
        } else {
            self.stop_all(app);
        }
        Ok(self.status())
    }

    pub fn stop_all(&self, app: &AppHandle) {
        self.stop_listening();
        self.stop_speaking_inner();
        {
            let mut i = self.inner.lock().unwrap();
            i.mode = VoiceMode::Off;
            i.phase = VoicePhase::Idle;
            i.transcript.clear();
        }
        self.emit(app);
    }
}

// ------------------------------------------------------------------ commands

#[tauri::command]
pub fn voice_status(rt: State<'_, VoiceRuntime>) -> VoiceStatus {
    rt.status()
}

/// Blocking work (permission prompt, microphone start-up) runs off the main thread.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> CmdResult<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn voice_ptt_start(app: AppHandle, history: Option<Vec<ChatMessage>>) -> CmdResult<VoiceStatus> {
    let rt = app.state::<VoiceRuntime>().inner().clone();
    blocking(move || rt.ptt_start(&app, history)).await
}

#[tauri::command]
pub fn voice_ptt_stop(app: AppHandle, rt: State<'_, VoiceRuntime>) -> VoiceStatus {
    rt.ptt_stop(&app)
}

#[tauri::command]
pub async fn voice_set_live(app: AppHandle, enabled: bool, history: Option<Vec<ChatMessage>>) -> CmdResult<VoiceStatus> {
    let rt = app.state::<VoiceRuntime>().inner().clone();
    blocking(move || rt.set_live(&app, enabled, history)).await
}

#[tauri::command]
pub fn voice_stop(app: AppHandle, rt: State<'_, VoiceRuntime>) -> VoiceStatus {
    rt.stop_all(&app);
    rt.status()
}

#[tauri::command]
pub fn voice_stop_speaking(app: AppHandle, rt: State<'_, VoiceRuntime>) -> VoiceStatus {
    rt.stop_speaking(&app);
    rt.status()
}

/// Read a text aloud (「朗读」 / read typed chat replies). Does not start listening.
#[tauri::command]
pub async fn voice_speak(app: AppHandle, text: String) -> CmdResult<()> {
    if !tts::supported() {
        return Err("系统语音仅支持 macOS".into());
    }
    let rt = app.state::<VoiceRuntime>().inner().clone();
    let text: String = text.chars().take(2000).collect();
    blocking(move || {
        rt.speak(&app, &text, false);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn voice_list_voices() -> CmdResult<Vec<SystemVoice>> {
    blocking(|| Ok(tts::list_voices())).await
}
