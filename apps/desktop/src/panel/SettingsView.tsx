import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorText, requestNotificationPermission } from "../api/client";
import { usePanel } from "./PanelApp";
import { Button, inputClass, More, selectClass, Toggle } from "./ui";
import { fullTime, relTime } from "./format";
import { PersonaSettings } from "./PersonaSettings";
import { ChatSettings } from "./ChatSettings";
import { ModeSettings, VoiceSettings } from "./VoiceSettings";
import { isGuideDismissed, pairingCode, setGuideDismissed } from "./ExtensionGuide";
import { clampPetScale, PET_SCALE_MAX, PET_SCALE_MIN, scalePercent, SIZE_PRESETS } from "../lib/petSize";
import s from "./Panel.module.css";

export type SettingsSection = "role" | "persona" | "chat" | "voice" | "extension" | "general";
const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: "role", label: "🐱 角色" },
  { id: "persona", label: "💕 小喵" },
  { id: "chat", label: "💬 聊天" },
  { id: "voice", label: "🎙️ 语音" },
  { id: "extension", label: "🧩 扩展" },
  { id: "general", label: "⚙️ 通用" },
];

let pendingSection: SettingsSection | null = null;
/** Ask the settings tab to open on a given section (e.g. from 聊天 → 去设置). */
export function requestSettingsSection(section: SettingsSection): void {
  pendingSection = section;
  window.dispatchEvent(new Event("settings-section"));
}

/** 60%–250% slider + 小/中/大 presets. Resizes the pet window live (Rust clamps + persists). */
function PetSizeControl() {
  const { settings, reportError } = usePanel();
  const [value, setValue] = useState(settings.petScale);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setValue(settings.petScale), [settings.petScale]);
  const apply = (v: number, immediate = false) => {
    const c = clampPetScale(v);
    setValue(c);
    window.clearTimeout(timer.current);
    const send = () => void api.setPetScale(c).catch(reportError);
    if (immediate) send();
    else timer.current = window.setTimeout(send, 40);
  };
  return (
    <div className={s.sizeBox}>
      <div className={s.sizeTop}>
        <div>
          <div className={s.rowTitle}>大小</div>
          <div className={s.rowDesc}>也可以把鼠标放在{settings.petName}身上，按住 ⌘ / Ctrl 滚动滚轮</div>
        </div>
        <span className={s.sizeValue}>{scalePercent(value)}</span>
      </div>
      <input
        className={s.slider}
        type="range"
        min={PET_SCALE_MIN}
        max={PET_SCALE_MAX}
        step={0.05}
        value={value}
        aria-label="桌宠大小"
        onChange={(e) => apply(Number(e.target.value))}
      />
      <div className={s.presets}>
        {SIZE_PRESETS.map((p) => (
          <Button key={p.label} small className={`${s.preset} ${Math.abs(value - p.scale) < 0.01 ? s.presetOn : ""}`} onClick={() => apply(p.scale, true)}>
            {p.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

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

function useRendererStatus(): { status: string; error: string | null } | null {
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem("pet-renderer-status") ?? "null");
    } catch {
      return null;
    }
  };
  const [v, setV] = useState(read);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === "pet-renderer-status" && setV(read());
    window.addEventListener("storage", onStorage);
    const t = window.setInterval(() => setV(read()), 3000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(t);
    };
  }, []);
  return v;
}

export function SettingsView() {
  const { settings, saveSettings, connection, setConnection, reportError, setTab } = usePanel();
  const [cleanupDays, setCleanupDays] = useState(7);
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [modelPath, setModelPath] = useState(settings.live2dModelPath);
  const [corePath, setCorePath] = useState(settings.live2dCorePath);
  const [extId, setExtId] = useState(settings.allowedExtensionId);
  const [browserApp, setBrowserApp] = useState(settings.launchBrowserApp);
  const [modelsDir, setModelsDir] = useState("");
  const [perm, setPerm] = useState<string | null>(null);
  const [section, setSection] = useState<SettingsSection>(() => pendingSection ?? "role");
  const [guideHidden, setGuideHidden] = useState(isGuideDismissed);
  const renderer = useRendererStatus();

  useEffect(() => {
    const onReq = () => {
      if (pendingSection) setSection(pendingSection);
      pendingSection = null;
    };
    onReq();
    window.addEventListener("settings-section", onReq);
    return () => window.removeEventListener("settings-section", onReq);
  }, []);

  useEffect(() => {
    api.getLive2DInfo().then((i) => setModelsDir(i.modelsDir)).catch(() => undefined);
  }, []);

  const st = connection?.status;
  const pairing = pairingCode(connection);

  const copyPairing = async () => {
    try {
      await navigator.clipboard.writeText(pairing);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div>
      <nav className={s.subTabs} aria-label="设置分类">
        {SECTIONS.map((x) => (
          <button key={x.id} type="button" className={`${s.subTab} ${section === x.id ? s.subTabActive : ""}`} onClick={() => setSection(x.id)}>
            {x.label}
          </button>
        ))}
      </nav>

      {section === "role" && (
        <>
          <div className={s.group}>
            <Row title="显示桌宠">
              <Toggle checked={settings.petVisible} onChange={(v) => saveSettings({ petVisible: v })} />
            </Row>
            <PetSizeControl />
            <Row title="动画" desc="关闭后保持静止，更省电">
              <Toggle checked={settings.animationsEnabled} onChange={(v) => saveSettings({ animationsEnabled: v })} />
            </Row>
            <Row title="位置" desc="跑到屏幕外时点一下">
              <Button small onClick={() => api.resetPetPosition().catch(reportError)}>重置桌宠</Button>
              <Button small onClick={() => api.resetPanelPosition().catch(reportError)} title="面板拖动后会记住位置；点这里让它回到桌宠旁边">
                面板归位
              </Button>
            </Row>
          </div>

          <div className={s.group}>
            <Row title="形象" desc={renderer ? `当前：${renderer.status}` : undefined}>
              <select
                className={selectClass}
                value={settings.rendererMode}
                onChange={(e) => saveSettings({ rendererMode: e.target.value as typeof settings.rendererMode })}
              >
                <option value="auto">自动</option>
                <option value="svg">内置猫娘</option>
                <option value="live2d">Live2D</option>
              </select>
            </Row>
            {renderer?.error && (
              <div className={s.row}>
                <div className={s.rowDesc} style={{ color: "var(--red)" }}>
                  Live2D 未加载：{renderer.error}
                </div>
              </div>
            )}
            <div className={`${s.row} ${s.rowStack}`}>
              <More label="Live2D 模型设置">
                <div className={s.rowTitle}>模型路径（.model3.json）</div>
                <div className={s.rowDesc}>
                  绝对路径（推荐放在 {modelsDir || "应用数据目录/live2d"} 下）或打包内路径 /live2d/models/…
                </div>
                <div className={s.inline}>
                  <input className={inputClass} style={{ flex: 1 }} value={modelPath} onChange={(e) => setModelPath(e.target.value)} placeholder="/Users/you/Live2D/neko/neko.model3.json" />
                </div>
                <div className={s.rowTitle} style={{ marginTop: 12 }}>Cubism Core 路径（可选）</div>
                <div className={s.rowDesc}>留空则使用打包进应用的 /live2d/live2dcubismcore.min.js（见 setup-live2d.sh）</div>
                <div className={s.inline}>
                  <input className={inputClass} style={{ flex: 1 }} value={corePath} onChange={(e) => setCorePath(e.target.value)} placeholder="/Users/you/Live2D/live2dcubismcore.min.js" />
                  <Button
                    small
                    variant="primary"
                    disabled={modelPath === settings.live2dModelPath && corePath === settings.live2dCorePath}
                    onClick={() => saveSettings({ live2dModelPath: modelPath.trim(), live2dCorePath: corePath.trim() })}
                  >
                    应用
                  </Button>
                </div>
              </More>
            </div>
          </div>
        </>
      )}

      {section === "persona" && <PersonaSettings />}

      {section === "chat" && <ChatSettings />}

      {section === "voice" && <VoiceSettings />}

      {section === "extension" && (
        <div className={s.group}>
          <Row
            title={st?.connected ? "已连接 🎉" : "未连接"}
            desc={
              st?.connected
                ? `扩展 v${st.extensionVersion ?? "?"} · 最近心跳 ${relTime(st.lastHeartbeatAt)}`
                : st?.lastHeartbeatAt
                  ? `上次心跳 ${fullTime(st.lastHeartbeatAt)}`
                  : "网站监控需要 Chrome 扩展，安装步骤见「任务」页"
            }
          >
            <span style={{ width: 10, height: 10, borderRadius: 10, background: st?.connected ? "var(--green)" : "#dcc6cc" }} />
          </Row>
          {connection?.serverError && (
            <div className={s.row}>
              <div className={s.rowDesc} style={{ color: "var(--red)" }}>本地服务：{connection.serverError}</div>
            </div>
          )}
          <div className={`${s.row} ${s.rowStack}`}>
            <div className={s.rowTitle}>配对码</div>
            <div className={s.rowDesc}>在扩展的「设置」页粘贴。令牌相当于密码，请勿分享。</div>
            <div className={s.inline}>
              <Button small variant="primary" onClick={copyPairing}>{copied ? "已复制 ✓" : "📋 复制配对码"}</Button>
              {!st?.connected && guideHidden && (
                <Button
                  small
                  variant="ghost"
                  onClick={() => {
                    setGuideDismissed(false);
                    setGuideHidden(false);
                    setTab("tasks");
                  }}
                >
                  显示安装引导
                </Button>
              )}
            </div>
          </div>
          <div className={`${s.row} ${s.rowStack}`}>
            <More label="高级（令牌、扩展 ID）">
              <div className={s.rowDesc}>仅监听 127.0.0.1:{connection?.port || "—"}</div>
              <div className={s.mono} style={{ marginTop: 8 }}>
                {showToken ? pairing : `{"port":${connection?.port ?? 0},"token":"••••••••••••"}`}
              </div>
              <div className={s.inline}>
                <Button small onClick={() => setShowToken((v) => !v)}>{showToken ? "隐藏" : "显示"}</Button>
                <Button
                  small
                  variant="danger"
                  onClick={async () => {
                    try {
                      setConnection(await api.rotateToken());
                      setShowToken(true);
                    } catch (e) {
                      reportError(e);
                    }
                  }}
                >
                  重新生成
                </Button>
              </div>
              <Row title="每次启动换新令牌" desc="更安全，但每次启动都要重新配对">
                <Toggle checked={settings.rotateTokenOnStartup} onChange={(v) => saveSettings({ rotateTokenOnStartup: v })} />
              </Row>
              <Row title="限定扩展 ID" desc="可选：只接受该 ID 的扩展">
                <input
                  className={inputClass}
                  style={{ width: 140, fontSize: 11 }}
                  value={extId}
                  placeholder="任意扩展"
                  onChange={(e) => setExtId(e.target.value.trim())}
                  onBlur={() => extId !== settings.allowedExtensionId && saveSettings({ allowedExtensionId: extId })}
                />
              </Row>
            </More>
          </div>
        </div>
      )}

      {section === "general" && (
        <>
          <ModeSettings />

          <div className={s.sectionTitle}>任务提醒</div>
          <div className={s.group}>
            <Row title="任务监控" desc="关闭后忽略扩展上报的网页状态">
              <Toggle checked={settings.monitorEnabled} onChange={(v) => saveSettings({ monitorEnabled: v })} />
            </Row>
            <Row title="系统通知">
              <Toggle checked={settings.notificationsEnabled} onChange={(v) => saveSettings({ notificationsEnabled: v })} />
            </Row>
            <Row title="提示音">
              <Toggle checked={settings.soundEnabled} disabled={!settings.notificationsEnabled} onChange={(v) => saveSettings({ soundEnabled: v })} />
            </Row>
            <Row title="通知权限" desc={perm ? `状态：${perm}` : "也可在 系统设置 → 通知 中修改"}>
              <Button
                small
                onClick={async () => {
                  const r = await requestNotificationPermission();
                  setPerm({ granted: "已允许", denied: "已拒绝（请到系统设置开启）", default: "未决定", unsupported: "预览模式不可用" }[r]);
                  if (r === "granted") await api.testNotification().catch(reportError);
                }}
              >
                请求并测试
              </Button>
            </Row>
          </div>

          <div className={s.sectionTitle}>网站</div>
          <div className={s.group}>
            <Row title="网站管理" desc="添加、排序、换图标">
              <Button small onClick={() => setTab("sites")}>前往</Button>
            </Row>
            <Row title="打开方式">
              <select className={selectClass} value={settings.launchMode} onChange={(e) => saveSettings({ launchMode: e.target.value as "default" | "app" })}>
                <option value="default">默认浏览器</option>
                <option value="app">指定浏览器</option>
              </select>
            </Row>
            {settings.launchMode === "app" && (
              <Row title="浏览器应用名" desc="例如 Google Chrome、Safari、Arc">
                <input className={inputClass} style={{ width: 130 }} value={browserApp} onChange={(e) => setBrowserApp(e.target.value)} onBlur={() => browserApp !== settings.launchBrowserApp && saveSettings({ launchBrowserApp: browserApp })} />
              </Row>
            )}
          </div>

          <div className={s.sectionTitle}>其他</div>
          <div className={s.group}>
            <Row title="开机启动">
              <Toggle checked={settings.autostart} onChange={(v) => saveSettings({ autostart: v })} />
            </Row>
            <div className={`${s.row} ${s.rowStack}`}>
              <More label="数据清理">
                <Row title="清理已结束任务" desc={cleanupMsg ?? "删除较早的已完成 / 失败任务及旧通知"}>
                  <select className={selectClass} value={cleanupDays} onChange={(e) => setCleanupDays(Number(e.target.value))}>
                    <option value={1}>1 天前</option>
                    <option value={7}>7 天前</option>
                    <option value={30}>30 天前</option>
                  </select>
                  <Button
                    small
                    onClick={async () => {
                      try {
                        const n = await api.cleanupData(cleanupDays, false);
                        setCleanupMsg(`已清理 ${n} 个任务`);
                      } catch (e) {
                        setCleanupMsg(errorText(e));
                      }
                    }}
                  >
                    清理
                  </Button>
                </Row>
                <Row title="清空全部任务" desc="不可恢复；网站和设置会保留">
                  {confirmWipe ? (
                    <Button
                      small
                      variant="danger"
                      onClick={async () => {
                        try {
                          const n = await api.cleanupData(0, true);
                          setCleanupMsg(`已删除全部 ${n} 个任务`);
                        } catch (e) {
                          reportError(e);
                        }
                        setConfirmWipe(false);
                      }}
                    >
                      确认清空
                    </Button>
                  ) : (
                    <Button small variant="danger" onClick={() => setConfirmWipe(true)}>清空</Button>
                  )}
                </Row>
              </More>
            </div>
            <Row title="退出桌宠">
              <Button small variant="danger" onClick={() => api.quit().catch(reportError)}>退出</Button>
            </Row>
          </div>
        </>
      )}
      <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-3)", padding: "6px 0 4px" }}>桌面智能桌宠 v0.1.0 · 喵～</div>
    </div>
  );
}
