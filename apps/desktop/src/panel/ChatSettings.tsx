import { useEffect, useState, type ReactNode } from "react";
import { api, errorText } from "../api/client";
import { usePanel } from "./PanelApp";
import { Button, inputClass, More, selectClass, Toggle } from "./ui";
import { applyPreset, CHAT_PRESETS, chatCompletionsUrl, detectProvider, getPreset, keyRequired, type ChatProvider } from "../lib/chatPresets";
import s from "./Panel.module.css";
import { KEYCHAIN } from "../lib/platform";

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

/**
 * Settings → 聊天: any OpenAI-compatible provider. Picking a preset fills Base URL + model
 * (both stay editable); the API key is stored per provider in the OS keychain; 测试连接.
 */
export function ChatSettings() {
  const { settings, saveSettings, reportError } = usePanel();
  const provider = detectProvider(settings);
  const preset = getPreset(provider);
  const [endpoint, setEndpoint] = useState(settings.chatEndpoint);
  const [model, setModel] = useState(settings.chatModel);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const needsKey = keyRequired(provider, endpoint);

  useEffect(() => {
    setEndpoint(settings.chatEndpoint);
    setModel(settings.chatModel);
  }, [settings.chatEndpoint, settings.chatModel]);

  // keys are per provider: re-check whenever the provider changes
  useEffect(() => {
    setMsg(null);
    api.hasChatApiKey(provider).then(setHasKey).catch(reportError);
  }, [provider, reportError]);

  const pickProvider = (p: ChatProvider) => {
    setTest(null);
    void saveSettings(applyPreset(p, { chatEndpoint: endpoint.trim(), chatModel: model.trim() }));
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      // persist what is typed first so chat uses the same values
      if (endpoint.trim() !== settings.chatEndpoint || model.trim() !== settings.chatModel) {
        await saveSettings({ chatEndpoint: endpoint.trim(), chatModel: model.trim() });
      }
      setTest({ ok: true, text: await api.chatTest(endpoint.trim(), model.trim(), provider) });
    } catch (e) {
      setTest({ ok: false, text: errorText(e) });
    } finally {
      setTesting(false);
    }
  };

  const openKeys = (url: string) => void api.openUrl(url).catch(reportError);
  const keysHost = preset.keysUrl ? new URL(preset.keysUrl).host : "";

  return (
    <>
      <div className={s.group}>
        <Row title="启用聊天" desc="不开启时离线台词照常工作">
          <Toggle checked={settings.chatEnabled} onChange={(v) => saveSettings({ chatEnabled: v })} />
        </Row>
        <Row title="服务商" desc={preset.hint ?? "OpenAI 兼容接口"}>
          <select className={selectClass} value={provider} onChange={(e) => pickProvider(e.target.value as ChatProvider)} aria-label="聊天服务商">
            {CHAT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Row>
        <Row title="Base URL" desc="通常以 /v1 结尾；只填域名也行。https，或本机 http://localhost">
          <input
            className={inputClass}
            style={{ width: 200, fontSize: 11.5 }}
            value={endpoint}
            spellCheck={false}
            placeholder={preset.baseUrl || "https://api.example.com/v1"}
            aria-label="Base URL"
            onChange={(e) => setEndpoint(e.target.value)}
            onBlur={() => endpoint.trim() !== settings.chatEndpoint && saveSettings({ chatEndpoint: endpoint.trim() })}
          />
        </Row>
        <Row title="模型名" desc={preset.defaultModel ? `默认 ${preset.defaultModel}` : "服务商提供的模型名"}>
          <input
            className={inputClass}
            style={{ width: 200, fontSize: 11.5 }}
            value={model}
            spellCheck={false}
            list="chat-model-suggestions"
            placeholder={preset.defaultModel || "model-name"}
            aria-label="模型名"
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => model.trim() !== settings.chatModel && saveSettings({ chatModel: model.trim() })}
          />
          <datalist id="chat-model-suggestions">
            {preset.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Row>

        <div className={`${s.row} ${s.rowStack}`}>
          <div className={s.rowTitle}>
            {preset.label} API Key {hasKey ? `✅ 已保存在${KEYCHAIN}` : needsKey ? "（未设置）" : "（可选，本机服务可不填）"}
          </div>
          {preset.keysUrl && (
            <div className={s.rowDesc}>
              还没有 Key？去{" "}
              <a
                href={preset.keysUrl}
                onClick={(e) => {
                  e.preventDefault();
                  openKeys(preset.keysUrl!);
                }}
              >
                {keysHost}
              </a>{" "}
              创建一个，复制后粘贴到下面。每个服务商的 Key 分开保存。
            </div>
          )}
          <div className={s.inline}>
            <input
              className={inputClass}
              style={{ flex: 1 }}
              type="password"
              autoComplete="off"
              value={key}
              aria-label="API Key"
              placeholder={hasKey ? "输入新 Key 以替换" : needsKey ? "sk-..." : "可留空"}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.nextElementSibling as HTMLButtonElement | null)?.click()}
            />
            <Button
              small
              variant="primary"
              disabled={!key.trim()}
              onClick={async () => {
                try {
                  await api.setChatApiKey(key.trim(), provider);
                  setKey("");
                  setHasKey(true);
                  setMsg(`已保存到${KEYCHAIN}`);
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
            <Button small onClick={() => void runTest()} disabled={testing || (needsKey && !hasKey) || !endpoint.trim() || !model.trim()}>
              {testing ? "连接中…" : "🔌 测试连接"}
            </Button>
            {needsKey && !hasKey && <span className={s.rowDesc} style={{ marginTop: 0 }}>先保存 API Key 再测试</span>}
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
            <div className={s.rowDesc}>请求地址：{endpoint.trim() ? chatCompletionsUrl(endpoint) : "—"}</div>
            <div className={s.rowDesc}>Key 只保存在{KEYCHAIN}（每个服务商一条），由后台发送请求时读取，不会写入数据库或显示在界面上。</div>
            <div className={s.inline}>
              <Button
                small
                variant="danger"
                disabled={!hasKey}
                onClick={async () => {
                  try {
                    await api.clearChatApiKey(provider);
                    setHasKey(false);
                    setTest(null);
                    setMsg("已删除");
                  } catch (e) {
                    setMsg(errorText(e));
                  }
                }}
              >
                删除 {preset.label} 的 Key
              </Button>
            </div>
          </More>
        </div>
      </div>
    </>
  );
}
