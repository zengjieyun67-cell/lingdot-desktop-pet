import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api/client";
import { useVoice, voice, voicePhaseLabel } from "../lib/voice";
import type { ChatMessage } from "../api/types";
import { usePanel } from "./PanelApp";
import { requestSettingsSection } from "./SettingsView";
import { Button, Empty, inputClass } from "./ui";
import s from "./Panel.module.css";

const STORE = "desktop-pet-chat-v1";
const KEEP = 40;

/** Small optional chat with 小喵 (OpenAI-compatible endpoint configured in settings). */
export function ChatView() {
  const { settings, setTab } = usePanel();
  const [history, setHistory] = useState<ChatMessage[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) ?? "[]") as ChatMessage[];
    } catch {
      return [];
    }
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  // Voice turns (from Rust or the browser fallback) land in the same chat log.
  const { status: vs, pttStart, pttStop, setLive, stopSpeaking } = useVoice((t) => {
    setHistory((h) => [...h, t]);
    if (t.role === "assistant") void api.personaInteraction("chat").catch(() => undefined);
  });
  const holding = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORE, JSON.stringify(history.slice(-KEEP)));
    endRef.current?.scrollIntoView({ block: "end" });
  }, [history, busy]);

  if (!settings.chatEnabled) {
    return (
      <Empty title="聊天还没开启" quip="想和本猫聊天？先去设置里填个 Key 再说。">
        <span>推荐用 DeepSeek，粘贴 API Key 就能用；不开启也没关系，{settings.petName}的离线台词照常出现</span>
        <Button small variant="primary" onClick={() => {
            requestSettingsSection("chat");
            setTab("settings");
          }}>
          去设置
        </Button>
      </Empty>
    );
  }

  const send = async () => {
    const content = text.trim();
    if (!content || busy) return;
    const next: ChatMessage[] = [...history, { role: "user", content }];
    setHistory(next);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const reply = await api.chatSend(next);
      setHistory((h) => [...h, { role: "assistant", content: reply }]);
      if (settings.voiceEnabled && settings.voiceReadReplies) void voice.speak(reply).catch(() => undefined);
      void api.personaInteraction("chat").catch(() => undefined);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.chatWrap}>
      <div className={s.chatLog}>
        {history.length === 0 && <Empty title={`和${settings.petName}说点什么吧`} quip="…本猫只是刚好有空而已。" />}
        {history.map((m, i) => (
          <div key={i} className={m.role === "user" ? s.msgUser : s.msgPet}>
            {m.content}
          </div>
        ))}
        {busy && <div className={s.msgPet}>……</div>}
        <div ref={endRef} />
      </div>
      {error && <div style={{ color: "var(--red)", fontSize: 12, margin: "6px 0" }}>{error}</div>}
      {settings.voiceEnabled ? (
        <div className={`${s.voiceBar} ${vs.mode !== "off" ? s.voiceBarOn : ""}`}>
          <button
            type="button"
            className={`${s.micBtn} ${vs.phase === "listening" ? s.micBtnOn : ""}`}
            title="按住说话，松开发送"
            disabled={busy || vs.mode === "live"}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              holding.current = true;
              void pttStart(historyRef.current.slice(-20));
            }}
            onPointerUp={() => {
              if (!holding.current) return;
              holding.current = false;
              void pttStop();
            }}
            onPointerCancel={() => {
              holding.current = false;
              void pttStop();
            }}
          >
            🎙️
          </button>
          <div className={s.voiceText}>
            {vs.error ? (
              <span style={{ color: "var(--red)" }}>{vs.error}</span>
            ) : vs.phase === "listening" && vs.transcript ? (
              <span>“{vs.transcript}”</span>
            ) : (
              <span>{voicePhaseLabel(vs) ?? "按住麦克风说话，或打开实时对话"}</span>
            )}
          </div>
          {(vs.phase === "speaking" || !!vs.speaking) && (
            <Button small onClick={() => void stopSpeaking()} title="让她别说了">
              ⏹
            </Button>
          )}
          <label className={s.liveToggle} title="一直听着，你说完她就回答">
            <input
              type="checkbox"
              checked={vs.mode === "live"}
              onChange={(e) => void setLive(e.target.checked, historyRef.current.slice(-20))}
            />
            <span>实时对话</span>
          </label>
        </div>
      ) : (
        <div className={s.voiceHint}>
          想用嘴巴说？
          <button
            type="button"
            className={s.linkBtn}
            onClick={() => {
              requestSettingsSection("voice");
              setTab("settings");
            }}
          >
            开启语音
          </button>
        </div>
      )}
      <div className={s.chatBar}>
        <input
          className={inputClass}
          style={{ flex: 1 }}
          value={text}
          maxLength={2000}
          placeholder={`对${settings.petName}说…`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && void send()}
        />
        <Button variant="primary" onClick={() => void send()} disabled={busy || !text.trim()}>
          发送
        </Button>
        <Button onClick={() => setHistory([])} disabled={busy || history.length === 0} title="清空聊天记录">
          清空
        </Button>
      </div>
    </div>
  );
}
