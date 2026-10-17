//! Speech-to-text, free and local.
//!
//! macOS: `SFSpeechRecognizer` (zh-CN, on-device when the Mac supports it) fed by an
//! `AVAudioEngine` microphone tap, via the objc2 bindings. Each session runs on its own
//! thread that owns the Objective-C objects; results arrive on the recognizer's queue
//! (main queue) and are forwarded to `sink`.
//! Other platforms: `supported() == false` (the webview may still offer
//! `webkitSpeechRecognition`, see apps/desktop/src/lib/voice.ts).

use std::sync::Arc;
#[cfg(target_os = "macos")]
use std::time::Duration;

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Debug, Clone)]
pub enum SttEvent {
    /// Cumulative transcript of the current session.
    Transcript { text: String, is_final: bool },
    Error(String),
    /// The recognition task finished (final result, error, or cancelled).
    Ended,
}

pub type SttSink = Arc<dyn Fn(SttEvent) + Send + Sync>;

enum Cmd {
    /// Stop the microphone but let the recognizer deliver its final result.
    EndAudio,
    /// Tear everything down.
    Cancel,
}

pub struct SttSession {
    tx: std::sync::mpsc::Sender<Cmd>,
}

impl SttSession {
    pub fn end_audio(&self) {
        let _ = self.tx.send(Cmd::EndAudio);
    }
}

impl Drop for SttSession {
    fn drop(&mut self) {
        let _ = self.tx.send(Cmd::Cancel);
    }
}

pub fn supported() -> bool {
    cfg!(target_os = "macos")
}

/// authorized | denied | restricted | not_determined | unsupported
pub fn authorization_status() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        imp::status()
    }
    #[cfg(not(target_os = "macos"))]
    {
        "unsupported"
    }
}

pub fn start(locale: &str, on_device: bool, sink: SttSink) -> Result<SttSession, String> {
    #[cfg(target_os = "macos")]
    {
        imp::start(locale, on_device, sink)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (locale, on_device, sink, Cmd::EndAudio, Cmd::Cancel);
        Err("原生语音识别仅支持 macOS".into())
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::AnyThread;
    use objc2_avf_audio::{AVAudioEngine, AVAudioPCMBuffer, AVAudioTime};
    use objc2_foundation::{NSError, NSLocale, NSString};
    use objc2_speech::{
        SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionResult, SFSpeechRecognitionTask, SFSpeechRecognizer,
        SFSpeechRecognizerAuthorizationStatus as Auth,
    };
    use std::ptr::NonNull;
    use std::sync::mpsc;

    fn map(s: Auth) -> &'static str {
        if s == Auth::Authorized {
            "authorized"
        } else if s == Auth::Denied {
            "denied"
        } else if s == Auth::Restricted {
            "restricted"
        } else {
            "not_determined"
        }
    }

    pub fn status() -> &'static str {
        map(unsafe { SFSpeechRecognizer::authorizationStatus() })
    }

    /// Shows the system prompt the first time (needs NSSpeechRecognitionUsageDescription).
    fn request(timeout: Duration) -> &'static str {
        if status() != "not_determined" {
            return status();
        }
        let (tx, rx) = mpsc::channel::<Auth>();
        let block = RcBlock::new(move |s: Auth| {
            let _ = tx.send(s);
        });
        unsafe { SFSpeechRecognizer::requestAuthorization(&block) };
        match rx.recv_timeout(timeout) {
            Ok(s) => map(s),
            Err(_) => status(),
        }
    }

    struct Live {
        engine: Retained<AVAudioEngine>,
        request: Retained<SFSpeechAudioBufferRecognitionRequest>,
        task: Retained<SFSpeechRecognitionTask>,
        _recognizer: Retained<SFSpeechRecognizer>,
        _tap: RcBlock<dyn Fn(NonNull<AVAudioPCMBuffer>, NonNull<AVAudioTime>)>,
        _handler: RcBlock<dyn Fn(*mut SFSpeechRecognitionResult, *mut NSError)>,
        audio_running: bool,
    }

    impl Live {
        unsafe fn end_audio(&mut self) {
            if self.audio_running {
                self.audio_running = false;
                self.engine.stop();
                self.engine.inputNode().removeTapOnBus(0);
                self.request.endAudio();
            }
        }
        unsafe fn cancel(&mut self) {
            self.end_audio();
            self.task.cancel();
        }
    }

    pub fn start(locale: &str, on_device: bool, sink: SttSink) -> Result<SttSession, String> {
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let (tx, rx) = mpsc::channel::<Cmd>();
        let locale = locale.to_string();
        std::thread::Builder::new()
            .name("stt".into())
            .spawn(move || {
                let mut live = match unsafe { open(&locale, on_device, sink) } {
                    Ok(l) => {
                        let _ = ready_tx.send(Ok(()));
                        l
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                // Keep the Objective-C objects alive on this thread until told to stop.
                loop {
                    match rx.recv() {
                        Ok(Cmd::EndAudio) => unsafe { live.end_audio() },
                        Ok(Cmd::Cancel) | Err(_) => {
                            unsafe { live.cancel() };
                            break;
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        match ready_rx.recv_timeout(Duration::from_secs(70)) {
            Ok(Ok(())) => Ok(SttSession { tx }),
            Ok(Err(e)) => Err(e),
            Err(_) => Err("语音识别启动超时".into()),
        }
    }

    unsafe fn open(locale: &str, on_device: bool, sink: SttSink) -> Result<Live, String> {
        match request(Duration::from_secs(60)) {
            "authorized" => {}
            "denied" => {
                return Err("没有语音识别权限：请到 系统设置 → 隐私与安全性 → 语音识别 中允许 lingdot-desktop-pet".into())
            }
            "restricted" => return Err("这台 Mac 限制了语音识别（家长控制或描述文件）".into()),
            _ => return Err("还没有授权语音识别，请在弹出的系统提示中点「好」".into()),
        }
        let loc = NSLocale::initWithLocaleIdentifier(NSLocale::alloc(), &NSString::from_str(locale));
        let recognizer = SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &loc)
            .ok_or_else(|| "这台 Mac 不支持中文（zh-CN）语音识别".to_string())?;
        if !recognizer.isAvailable() {
            return Err("语音识别暂时不可用：请检查网络，或在 系统设置 → 键盘 → 听写 里添加中文".into());
        }
        let request = SFSpeechAudioBufferRecognitionRequest::new();
        request.setShouldReportPartialResults(true);
        if on_device && recognizer.supportsOnDeviceRecognition() {
            request.setRequiresOnDeviceRecognition(true);
        }

        let engine = AVAudioEngine::new();
        let input = engine.inputNode();
        let format = input.outputFormatForBus(0);
        if format.sampleRate() <= 0.0 || format.channelCount() == 0 {
            return Err("没有找到可用的麦克风（或还没有授权麦克风）".into());
        }
        let req = request.clone();
        let tap: RcBlock<dyn Fn(NonNull<AVAudioPCMBuffer>, NonNull<AVAudioTime>)> =
            RcBlock::new(move |buf: NonNull<AVAudioPCMBuffer>, _when: NonNull<AVAudioTime>| {
                req.appendAudioPCMBuffer(buf.as_ref());
            });
        input.installTapOnBus_bufferSize_format_block(0, 1024, Some(&format), RcBlock::as_ptr(&tap));
        engine.prepare();
        if let Err(e) = engine.startAndReturnError() {
            input.removeTapOnBus(0);
            return Err(format!("麦克风启动失败：{}（请在 系统设置 → 隐私与安全性 → 麦克风 中允许）", e.localizedDescription()));
        }

        let handler: RcBlock<dyn Fn(*mut SFSpeechRecognitionResult, *mut NSError)> =
            RcBlock::new(move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
                if let Some(r) = result.as_ref() {
                    let text = r.bestTranscription().formattedString().to_string();
                    let is_final = r.isFinal();
                    sink(SttEvent::Transcript { text, is_final });
                    if is_final {
                        sink(SttEvent::Ended);
                    }
                } else if let Some(e) = error.as_ref() {
                    sink(SttEvent::Error(e.localizedDescription().to_string()));
                    sink(SttEvent::Ended);
                }
            });
        let task = recognizer.recognitionTaskWithRequest_resultHandler(&request, &handler);
        Ok(Live { engine, request, task, _recognizer: recognizer, _tap: tap, _handler: handler, audio_running: true })
    }
}
