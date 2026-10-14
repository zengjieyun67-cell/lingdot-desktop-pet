import { useCallback, useEffect, useState, type ReactNode } from "react";
import { affinityLabel, familiarityLabel, type PersonaMemory } from "@desktop-pet/shared";
import { api, errorText, on } from "../api/client";
import { usePanel } from "./PanelApp";
import { Button, inputClass, Toggle } from "./ui";
import s from "./Panel.module.css";

const MOOD_ZH: Record<string, string> = { neutral: "平静", happy: "开心", shy: "害羞", angry: "闹别扭", sleepy: "困" };

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

function Meter({ value }: { value: number }) {
  // A level gauge for a 0..100 score (affinity / familiarity) — not task progress.
  return (
    <span style={{ display: "inline-block", width: 70, height: 6, borderRadius: 6, background: "var(--accent-soft)", overflow: "hidden" }}>
      <span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(100, value))}%`, background: "linear-gradient(90deg,#ffa3c0,#9d82ff)" }} />
    </span>
  );
}

/** Settings → 小喵: name, 称呼, bubbles, reminders, memory view/reset, chat config. */
export function PersonaSettings() {
  const { settings, saveSettings, sites, reportError } = usePanel();
  const [mem, setMem] = useState<PersonaMemory | null>(null);
  const [name, setName] = useState(settings.petName);
  const [title, setTitle] = useState(settings.userTitle);
  const [endpoint, setEndpoint] = useState(settings.chatEndpoint);
  const [model, setModel] = useState(settings.chatModel);
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [promptPath, setPromptPath] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMem(await api.getPersonaMemory());
      setHasKey(await api.hasChatApiKey());
      setPromptPath(await api.getPersonaPromptPath());
    } catch (e) {
      reportError(e);
    }
  }, [reportError]);

  useEffect(() => {
    void load();
    let un: (() => void) | undefined;
    void on<PersonaMemory>("persona-memory", setMem).then((u) => (un = u));
    return () => un?.();
  }, [load]);

  const topSites = mem
    ? Object.entries(mem.siteUsage)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id, n]) => `${sites.find((x) => x.id === id)?.name ?? "已删除的网站"} ×${n}`)
    : [];
  const maxHour = mem ? Math.max(1, ...mem.activeHours) : 1;

  return (
    <>
      <div className={s.sectionTitle}>小喵（性格与记忆）</div>
      <div className={s.group}>
        <Row title="名字">
          <input
            className={inputClass}
            style={{ width: 110 }}
            value={name}
            maxLength={12}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== settings.petName && saveSettings({ petName: name.trim() })}
          />
        </Row>
        <Row title="对你的称呼" desc="例如 主人、前辈、你的名字">
          <input
            className={inputClass}
            style={{ width: 110 }}
            value={title}
            maxLength={12}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== settings.userTitle && saveSettings({ userTitle: title.trim() })}
          />
        </Row>
        <Row title="对话气泡" desc="关闭后桌宠不再说话（任务提醒气泡仍显示）">
          <Toggle checked={settings.personaBubbles} onChange={(v) => saveSettings({ personaBubbles: v })} />
        </Row>
        <Row title="深夜休息提醒" desc="23:00–05:00，每小时最多一次">
          <Toggle checked={settings.lateNightReminders} onChange={(v) => saveSettings({ lateNightReminders: v })} />
        </Row>
        <Row title="饭点提醒" desc="早 7:30 / 午 11:45 / 晚 17:45 附近各一次">
          <Toggle checked={settings.mealReminders} onChange={(v) => saveSettings({ mealReminders: v })} />
        </Row>
      </div>

      <div className={s.sectionTitle}>记忆（仅保存在本机）</div>
      <div className={s.group}>
        <Row title="记忆功能" desc="只根据桌宠的使用情况统计，从不读取网页内容">
          <Toggle checked={settings.memoryEnabled} onChange={(v) => saveSettings({ memoryEnabled: v })} />
        </Row>
        {mem && (
          <>
            <Row title="好感度" desc={affinityLabel(mem.affinity)}>
              <Meter value={mem.affinity} /> <span style={{ width: 30, textAlign: "right" }}>{Math.round(mem.affinity)}</span>
            </Row>
            <Row title="熟悉度" desc={`语气：${familiarityLabel(mem.familiarity)}`}>
              <Meter value={mem.familiarity} /> <span style={{ width: 30, textAlign: "right" }}>{Math.round(mem.familiarity)}</span>
            </Row>
            <Row title="今天的心情">
              <span>{MOOD_ZH[mem.todayMood] ?? mem.todayMood}</span>
            </Row>
            <Row title="连续陪伴" desc={mem.lastInteractionAt ? `最近互动 ${new Date(mem.lastInteractionAt).toLocaleString("zh-CN", { hour12: false })}` : "还没有互动"}>
              <span>{mem.streakDays} 天</span>
            </Row>
            <Row title="深夜使用" desc="23:00–05:00 使用过的天数">
              <span>{mem.lateNightCount} 天</span>
            </Row>
            <Row title="常用网站">
              <span style={{ fontSize: 11.5, textAlign: "right" }}>{topSites.length ? topSites.join("、") : "暂无"}</span>
            </Row>
            <div className={s.row} style={{ flexDirection: "column", alignItems: "stretch" }}>
              <div className={s.rowTitle}>活跃时段</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 34, marginTop: 6 }} aria-label="24 小时活跃分布">
                {mem.activeHours.map((n, h) => (
                  <span
                    key={h}
                    title={`${h} 点：${n} 次`}
                    style={{ flex: 1, height: `${Math.max(6, (n / maxHour) * 100)}%`, borderRadius: 2, background: n ? "var(--accent-2)" : "var(--accent-soft)" }}
                  />
                ))}
              </div>
              <div className={s.rowDesc} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>0</span>
                <span>6</span>
                <span>12</span>
                <span>18</span>
                <span>23</span>
              </div>
            </div>
          </>
        )}
        <Row title="重置记忆" desc="清空好感度、熟悉度和使用习惯">
          {confirmReset ? (
            <Button
              small
              variant="danger"
              onClick={async () => {
                try {
                  setMem(await api.resetPersonaMemory());
                } catch (e) {
                  reportError(e);
                }
                setConfirmReset(false);
              }}
            >
              确认重置
            </Button>
          ) : (
            <Button small variant="danger" onClick={() => setConfirmReset(true)}>
              重置
            </Button>
          )}
        </Row>
      </div>

      <div className={s.sectionTitle}>聊天（可选，默认关闭）</div>
      <div className={s.group}>
        <Row title="启用聊天" desc="使用你自己的 OpenAI 兼容接口；不开启时离线台词照常工作">
          <Toggle checked={settings.chatEnabled} onChange={(v) => saveSettings({ chatEnabled: v })} />
        </Row>
        <Row title="接口地址" desc="https，或本机 http://localhost（如 Ollama）">
          <input
            className={inputClass}
            style={{ width: 170, fontSize: 11 }}
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            onBlur={() => endpoint !== settings.chatEndpoint && saveSettings({ chatEndpoint: endpoint.trim() })}
          />
        </Row>
        <Row title="模型">
          <input
            className={inputClass}
            style={{ width: 170, fontSize: 11 }}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => model !== settings.chatModel && saveSettings({ chatModel: model.trim() })}
          />
        </Row>
        <div className={s.row} style={{ flexDirection: "column", alignItems: "stretch" }}>
          <div className={s.rowTitle}>API Key {hasKey ? "（已保存在系统钥匙串）" : "（未设置）"}</div>
          <div className={s.rowDesc}>保存在 macOS 钥匙串中，只由后台在发送请求时读取，不会写入数据库或显示在界面上。</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input
              className={inputClass}
              style={{ flex: 1 }}
              type="password"
              autoComplete="off"
              value={key}
              placeholder={hasKey ? "输入新 Key 以替换" : "sk-..."}
              onChange={(e) => setKey(e.target.value)}
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
            <Button
              small
              variant="danger"
              disabled={!hasKey}
              onClick={async () => {
                try {
                  await api.clearChatApiKey();
                  setHasKey(false);
                  setMsg("已删除");
                } catch (e) {
                  setMsg(errorText(e));
                }
              }}
            >
              删除
            </Button>
          </div>
          {msg && <div className={s.rowDesc} style={{ marginTop: 4 }}>{msg}</div>}
        </div>
        <Row title="人设文件" desc={promptPath || "—"}>
          <span className={s.rowDesc}>可用文本编辑器修改</span>
        </Row>
      </div>
    </>
  );
}
