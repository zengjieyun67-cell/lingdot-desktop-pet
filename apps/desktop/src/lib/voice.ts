/**
 * Voice client (phase 2).
 *
 * In the app, speech recognition (SFSpeechRecognizer) and speech (`say`) run in
 * Rust, so 实时对话 keeps working with the panel hidden; this module only sends
 * commands and listens to `voice-state` / `voice-turn`.
 *
 * In a plain browser preview it falls back to webkitSpeechRecognition +
 * speechSynthesis (zh-CN) and produces the same VoiceStatus shape.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, isTauri, on } from "../api/client";
import { IDLE_VOICE, type ChatMessage, type VoiceStatus, type VoiceTurn } from "../api/types";

type Listener = (s: VoiceStatus) => void;
type TurnListener = (t: VoiceTurn) => void;

/* ------------------------------------------------------------------ */
/* Browser fallback                                                    */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecognition = any;

function recognitionCtor(): (new () => AnyRecognition) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => AnyRecognition) | null;
}

export function browserVoiceSupported(): { stt: boolean; tts: boolean } {
  return { stt: !!recognitionCtor(), tts: typeof window !== "undefined" && "speechSynthesis" in window };
}

/** Strip markdown / emoji / stage directions before speaking (mirrors pet-core voice::speech_text). */
export function speechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[（(][^（）()]{1,8}[）)]/g, "")
    .replace(/[*_`#>~]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

class BrowserVoice {
  status: VoiceStatus;
  private rec: AnyRecognition = null;
  private history: ChatMessage[] = [];
  private listeners = new Set<Listener>();
  private turnListeners = new Set<TurnListener>();

  constructor() {
    const sup = browserVoiceSupported();
    this.status = { ...IDLE_VOICE, sttSupported: sup.stt, ttsSupported: sup.tts, permission: sup.stt ? "not_determined" : "unsupported" };
  }

  onState(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  onTurn(l: TurnListener) {
    this.turnListeners.add(l);
    return () => this.turnListeners.delete(l);
  }

  private set(patch: Partial<VoiceStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l(this.status));
  }
  private turn(t: VoiceTurn) {
    this.history = [...this.history, t].slice(-20);
    this.turnListeners.forEach((l) => l(t));
  }

  start(mode: "push_to_talk" | "live", history: ChatMessage[] = []) {
    this.history = history.slice(-20);
    const Ctor = recognitionCtor();
    if (!Ctor) {
      this.set({ mode: "off", phase: "idle", error: "这个浏览器不支持语音识别，在 macOS 应用里可以用系统语音识别" });
      return;
    }
    this.stopSpeaking();
    this.set({ mode, phase: "listening", transcript: "", error: null });
    this.listen();
  }

  private listen() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    this.rec = rec;
    rec.lang = "zh-CN";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e: AnyRecognition) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.set({ transcript: finalText + interim, permission: "authorized" });
    };
    rec.onerror = (e: AnyRecognition) => {
      if (e.error === "not-allowed") this.set({ mode: "off", phase: "idle", permission: "denied", error: "麦克风权限被拒绝了" });
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      const text = (finalText || this.status.transcript).trim();
      if (this.status.mode === "off") return;
      if (!text) {
        if (this.status.mode === "live") this.listen();
        else this.set({ mode: "off", phase: "idle" });
        return;
      }
      void this.reply(text);
    };
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }

  private async reply(text: string) {
    this.turn({ role: "user", content: text });
    this.set({ phase: "thinking", transcript: text });
    try {
      const answer = await api.chatSend(this.history);
      this.turn({ role: "assistant", content: answer });
      if (this.status.mode === "off") return;
      await this.say(answer);
    } catch (e) {
      this.set({ mode: "off", phase: "idle", error: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (this.status.mode === "live") {
      this.set({ phase: "listening", transcript: "" });
      this.listen();
    } else {
      this.set({ mode: "off", phase: "idle" });
    }
  }

  say(text: string): Promise<void> {
    const clean = speechText(text);
    if (!clean || !("speechSynthesis" in window)) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = "zh-CN";
      u.rate = 1.1;
      u.onend = () => {
        this.set({ speaking: "" });
        resolve();
      };
      u.onerror = u.onend;
      this.set({ phase: this.status.mode === "off" ? this.status.phase : "speaking", speaking: clean });
      window.speechSynthesis.speak(u);
    });
  }

  stopListening() {
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
  }

  stopSpeaking() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    this.set({ speaking: "" });
  }

  stop() {
    const rec = this.rec;
    this.rec = null;
    try {
      rec?.abort();
    } catch {
      /* ignore */
    }
    this.stopSpeaking();
    this.set({ mode: "off", phase: "idle", transcript: "" });
  }
}

let browserVoice: BrowserVoice | null = null;
function bv(): BrowserVoice {
  browserVoice ??= new BrowserVoice();
  return browserVoice;
}

/** In a browser preview, use the real Web Speech fallback unless ?demo=voice asks for the scripted mock. */
function useFallback(): boolean {
  if (isTauri()) return false;
  if (new URLSearchParams(window.location.search).get("demo")?.includes("voice")) return false;
  return browserVoiceSupported().stt;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export const voice = {
  async status(): Promise<VoiceStatus> {
    return useFallback() ? bv().status : api.voiceStatus();
  },
  async pttStart(history?: ChatMessage[]): Promise<VoiceStatus> {
    if (useFallback()) {
      bv().start("push_to_talk", history);
      return bv().status;
    }
    return api.voicePttStart(history);
  },
  async pttStop(): Promise<VoiceStatus> {
    if (useFallback()) {
      bv().stopListening();
      return bv().status;
    }
    return api.voicePttStop();
  },
  async setLive(enabled: boolean, history?: ChatMessage[]): Promise<VoiceStatus> {
    if (useFallback()) {
      if (enabled) bv().start("live", history);
      else bv().stop();
      return bv().status;
    }
    return api.voiceSetLive(enabled, history);
  },
  async stop(): Promise<VoiceStatus> {
    if (useFallback()) {
      bv().stop();
      return bv().status;
    }
    return api.voiceStop();
  },
  async stopSpeaking(): Promise<VoiceStatus> {
    if (useFallback()) {
      bv().stopSpeaking();
      return bv().status;
    }
    return api.voiceStopSpeaking();
  },
  async speak(text: string): Promise<void> {
    if (useFallback()) return bv().say(text);
    await api.voiceSpeak(text);
  },
  async onState(cb: Listener): Promise<() => void> {
    if (useFallback()) {
      const off = bv().onState(cb);
      return () => void off();
    }
    return on<VoiceStatus>("voice-state", cb);
  },
  async onTurn(cb: TurnListener): Promise<() => void> {
    if (useFallback()) {
      const off = bv().onTurn(cb);
      return () => void off();
    }
    return on<VoiceTurn>("voice-turn", cb);
  },
};

/** React hook: live voice status + the turns of the current conversation. */
export function useVoice(onTurn?: TurnListener) {
  const [status, setStatus] = useState<VoiceStatus>(IDLE_VOICE);
  const turnRef = useRef(onTurn);
  turnRef.current = onTurn;

  useEffect(() => {
    let alive = true;
    const offs: Array<() => void> = [];
    void voice.status().then((s) => alive && setStatus(s)).catch(() => undefined);
    void voice.onState((s) => alive && setStatus(s)).then((u) => (alive ? offs.push(u) : u()));
    void voice.onTurn((t) => alive && turnRef.current?.(t)).then((u) => (alive ? offs.push(u) : u()));
    return () => {
      alive = false;
      offs.forEach((u) => u());
    };
  }, []);

  const run = useCallback(async (p: Promise<VoiceStatus>) => {
    try {
      setStatus(await p);
    } catch (e) {
      setStatus((s) => ({ ...s, mode: "off", phase: "idle", error: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  return {
    status,
    pttStart: (history?: ChatMessage[]) => run(voice.pttStart(history)),
    pttStop: () => run(voice.pttStop()),
    setLive: (enabled: boolean, history?: ChatMessage[]) => run(voice.setLive(enabled, history)),
    stop: () => run(voice.stop()),
    stopSpeaking: () => run(voice.stopSpeaking()),
  };
}

/** Short Chinese label for a voice phase (pet badge, chat header). */
export function voicePhaseLabel(s: VoiceStatus): string | null {
  if (s.error) return null;
  switch (s.phase) {
    case "listening":
      return s.mode === "live" ? "实时对话中，在听你说…" : "在听你说…";
    case "thinking":
      return "想一想…";
    case "speaking":
      return "说话中…";
    default:
      return s.speaking ? "说话中…" : null;
  }
}
