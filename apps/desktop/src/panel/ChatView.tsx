import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api/client";
import type { ChatMessage } from "../api/types";
import { usePanel } from "./PanelApp";
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

  useEffect(() => {
    localStorage.setItem(STORE, JSON.stringify(history.slice(-KEEP)));
    endRef.current?.scrollIntoView({ block: "end" });
  }, [history, busy]);

  if (!settings.chatEnabled) {
    return (
      <Empty icon="💭" title="聊天未开启">
        <span>聊天需要你自己的 OpenAI 兼容接口和 API Key。不开启也没关系，{settings.petName}的离线台词会照常出现。</span>
        <Button small variant="primary" onClick={() => setTab("settings")}>
          前往设置
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
      void api.personaInteraction("chat").catch(() => undefined);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className={s.chatLog}>
        {history.length === 0 && <div className={s.rowDesc} style={{ textAlign: "center", padding: 16 }}>和{settings.petName}说点什么吧。</div>}
        {history.map((m, i) => (
          <div key={i} className={m.role === "user" ? s.msgUser : s.msgPet}>
            {m.content}
          </div>
        ))}
        {busy && <div className={s.msgPet}>……</div>}
        <div ref={endRef} />
      </div>
      {error && <div style={{ color: "var(--red)", fontSize: 12, margin: "6px 0" }}>{error}</div>}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
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
