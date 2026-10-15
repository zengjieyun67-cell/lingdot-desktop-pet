import { useEffect, useState, type ReactNode } from "react";
import { api, errorText } from "../api/client";
import { usePanel } from "./PanelApp";
import { Button, inputClass, More, selectClass, Toggle } from "./ui";
import {
  applyPreset,
  CHAT_PROVIDERS,
  chatCompletionsUrl,
  DEEPSEEK_KEYS_URL,
  DEEPSEEK_MODELS,
  detectProvider,
  type ChatProvider,
} from "../lib/chatPresets";
import s from "./Panel.module.css";

function Row({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.row}>
      <div className={s.rowLabel}>
        <div className={s.rowTitle}>{title}</div>
        {desc && <div className={s.rowDesc}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/** Settings → 聊天: provider preset (DeepSeek / 自定义), key in the macOS keychain, 测试连接. */
export function ChatSettings() {
  const { settings, saveSettings, reportError } = usePanel();
  const provider = detectProvider(settings);
  const [endpoint, setEndpoint] = useState(settings.chatEndpoint);
  const [model, setModel] = useState(settings.chatModel);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setEndpoint(settings.chatEndpoint);
    setModel(settings.chatModel);
  }, [settings.chatEndpoint, settings.chatModel]);

  useEffect(() => {
    api.hasChatApiKey().then(setHasKey).catch(reportError);
  }, [reportError]);

  const pickProvider = (p: ChatProvider) => {
    setTest(null);
    void saveSettings(applyPreset(p, { chatEndpoint: endpoint, chatModel: model }));
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      // persist what is typed first so chat uses the same values
      if (endpoint.trim() !== settings.chatEndpoint || model.trim() !== settings.chatModel) {
        await saveSettings({ chatEndpoint: endpoint.trim(), chatModel: model.trim() });
      }
      setTest({ ok: true, text: await api.chatTest(endpoint.trim(), model.trim()) });
    } catch (e) {
      setTest({ ok: false, text: errorText(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <div className={s.group}>
        <Row title="启用聊天" desc="不开启时离线台词照常工作">
          <Toggle checked={settings.chatEnabled} onChange={(v) => saveSettings({ chatEnabled: v })} />
        </Row>
        <Row title="服务商">
          <select className={selectClass} value={provider} onChange={(e) => pickProvider(e.target.value as ChatProvider)} aria-label="聊天服务商">
            {CHAT_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Row>

        {provider === "deepseek" ? (
          <Row title="模型" desc="接口地址已填好">
            <select className={selectClass} value={model} onChange={(e) => saveSettings({ chatModel: e.target.value })} aria-label="DeepSeek 模型">
              {DEEPSEEK_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Row>
        ) : (
          <>
            <Row title="接口地址" desc="https，或本机 http://localhost（如 Ollama）">
              <input
                className={inputClass}
                style={{ width: 180, fontSize: 11.5 }}
                value={endpoint}
                placeholder="https://api.example.com/v1"
                onChange={(e) => setEndpoint(e.target.value)}
                onBlur={() => endpoint !== settings.chatEndpoint && saveSettings({ chatEndpoint: endpoint.trim() })}
              />
            </Row>
            <Row title="模型">
              <input
                className={inputClass}
                style={{ width: 180, fontSize: 11.5 }}
                value={model}
                placeholder="服务商提供的模型名"
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => model !== settings.chatModel && saveSettings({ chatModel: model.trim() })}
              />
            </Row>
          </>
        )}

        <div className={`${s.row} ${s.rowStack}`}>
          <div className={s.rowTitle}>API Key {hasKey ? "✅ 已保存在钥匙串" : "（未设置）"}</div>
          {provider === "deepseek" && (
            <div className={s.rowDesc}>
              还没有 Key？去{" "}
              <a
                href={DEEPSEEK_KEYS_URL}
                onClick={(e) => {
                  e.preventDefault();
                  void api.openUrl(DEEPSEEK_KEYS_URL).catch(reportError);
                }}
              >
                platform.deepseek.com/api_keys
              </a>{" "}
              创建一个，复制后粘贴到下面。
            </div>
          )}
          <div className={s.inline}>
            <input
              className={inputClass}
              style={{ flex: 1 }}
              type="password"
              autoComplete="off"
              value={key}
              placeholder={hasKey ? "输入新 Key 以替换" : "sk-..."}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.nextElementSibling as HTMLButtonElement | null)?.click()}
            />
            <Button
              small
              variant="primary"
              disabled={!key.trim()}
              onClick={async () => {
                try {
                  await api.setChatApiKey(key.trim());
                  setKey("");
                  setHasKey(true);
                  setMsg("已保存到钥匙串");
                } catch (e) {
                  setMsg(errorText(e));
                }
              }}
            >
              保存
            </Button>
          </div>
          {msg && <div className={s.rowDesc}>{msg}</div>}
        </div>

        <div className={`${s.row} ${s.rowStack}`}>
          <div className={s.inline} style={{ marginTop: 0 }}>
            <Button small onClick={() => void runTest()} disabled={testing || !hasKey}>
              {testing ? "连接中…" : "🔌 测试连接"}
            </Button>
            {!hasKey && <span className={s.rowDesc} style={{ marginTop: 0 }}>先保存 API Key 再测试</span>}
          </div>
          {test && (
            <div className={s.rowDesc} style={{ color: test.ok ? "var(--green)" : "var(--red)", wordBreak: "break-word" }} role="status">
              {test.ok ? "✅ " : "❌ "}
              {test.text}
            </div>
          )}
        </div>
      </div>

      <div className={s.group}>
        <div className={`${s.row} ${s.rowStack}`}>
          <More label="更多">
            <div className={s.rowDesc}>
              请求地址：{endpoint.trim() ? chatCompletionsUrl(endpoint) : "—"}
              {provider === "deepseek" && "（使用非思考模式，回复更快）"}
            </div>
            <div className={s.rowDesc}>Key 只保存在 macOS 钥匙串，由后台发送请求时读取，不会写入数据库或显示在界面上。</div>
            <div className={s.inline}>
              <Button
                small
                variant="danger"
                disabled={!hasKey}
                onClick={async () => {
                  try {
                    await api.clearChatApiKey();
                    setHasKey(false);
                    setTest(null);
                    setMsg("已删除");
                  } catch (e) {
                    setMsg(errorText(e));
                  }
                }}
              >
                删除 Key
              </Button>
            </div>
          </More>
        </div>
      </div>
    </>
  );
}
