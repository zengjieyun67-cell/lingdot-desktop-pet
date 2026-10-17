import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorText, isTauri } from "../api/client";
import type { DesktopFolder, VoiceInfo } from "../api/types";
import { browserVoiceSupported } from "../lib/voice";
import { usePanel } from "./PanelApp";
import { Button, inputClass, selectClass, Toggle } from "./ui";
import type { DesktopStyle } from "../api/types";

const STYLE_OPTIONS: Array<{ id: DesktopStyle; label: string }> = [
  { id: "sonoma", label: "🌌 Sonoma 极光" },
  { id: "poster", label: "📰 杂志海报" },
  { id: "sea", label: "🌊 海" },
  { id: "slogan", label: "✦ 极简标语" },
];
const STYLE_DESC: Record<string, string> = {
  sonoma: "Sonoma：超大细体时钟 + 流动极光，站在玻璃光晕前",
  poster: "杂志海报：大标题排版 + 胶片颗粒，正在听的歌当副标题，人物半身特写",
  sea: "海：从高处看的辽阔深海，一块跳台伸向海面，她就站在跳台边上；细体大时钟，几乎没有字",
  slogan: "极简标语：深色海面纹理 + 一句加粗的黄色标语（可以改成你想说的话）",
};
import s from "./Panel.module.css";
import { FILE_MANAGER, IS_WINDOWS } from "../lib/platform";

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

function Slider(props: { title: string; desc: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onCommit: (v: number) => void; disabled?: boolean }) {
  const [v, setV] = useState(props.value);
  const t = useRef<number | undefined>(undefined);
  useEffect(() => setV(props.value), [props.value]);
  return (
    <div className={s.sizeBox} style={props.disabled ? { opacity: 0.5 } : undefined}>
      <div className={s.sizeTop}>
        <div>
          <div className={s.rowTitle}>{props.title}</div>
          <div className={s.rowDesc}>{props.desc}</div>
        </div>
        <span className={s.sizeValue}>{props.fmt(v)}</span>
      </div>
      <input
        className={s.slider}
        style={{ ["--fill" as string]: `${((v - props.min) / (props.max - props.min || 1)) * 100}%` }}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={v}
        disabled={props.disabled}
        aria-label={props.title}
        onChange={(e) => {
          const n = Number(e.target.value);
          setV(n);
          window.clearTimeout(t.current);
          t.current = window.setTimeout(() => props.onCommit(n), 250);
        }}
      />
    </div>
  );
}

/** 设置 → 语音: macOS 自带语音识别 + 系统语音（免费，不走付费实时语音 API）. */
export function VoiceSettings() {
  const { settings, saveSettings, reportError } = usePanel();
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const off = !settings.voiceEnabled;

  useEffect(() => {
    void api
      .voiceListVoices()
      .then(setVoices)
      .catch(() => setVoices([]));
  }, []);

  const preview = () => {
    const text = `你好，我是${settings.petName}。哼，才不是特意来跟你说话的喵。`;
    if (isTauri()) void api.voiceSpeak(text).catch(reportError);
    else if (browserVoiceSupported().tts) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      u.rate = settings.voiceRate;
      window.speechSynthesis.speak(u);
    }
  };

  return (
    <>
      <div className={s.sectionTitle}>语音对话</div>
      <div className={s.group}>
        <Row title="开启语音" desc={IS_WINDOWS ? `用 Windows 自带的系统语音朗读${settings.petName}的回复（语音识别暂时只支持 macOS）` : `用 macOS 自带的语音识别和系统语音，和${settings.petName}说话，免费`}>
          <Toggle checked={settings.voiceEnabled} onChange={(v) => saveSettings({ voiceEnabled: v })} />
        </Row>
        <div className={`${s.row} ${s.rowStack}`}>
          <div className={s.rowDesc} style={{ lineHeight: 1.6 }}>
            {IS_WINDOWS ? "🔈 Windows 上用「讲述人」同款的系统语音（慧慧 / 瑶瑶等）朗读。" : "🎙️ 第一次使用时 macOS 会询问「麦克风」和「语音识别」权限，请点允许。"}
            <br />
            用法：长按桌宠说话，松手就发送；或在「聊天」里打开「实时对话」，像打电话一样一直聊。
            {!settings.chatEnabled && (
              <>
                <br />
                ⚠️ 需要先在「聊天」里开启并填好 API Key，{settings.petName}才能回答你。
              </>
            )}
          </div>
        </div>
      </div>

      <div className={s.sectionTitle}>声音</div>
      <div className={s.group}>
        <Row title="声音" desc="系统自带的中文声音；「自动」会挑婷婷 / 美嘉">
          <select className={selectClass} value={settings.voiceName} disabled={off} onChange={(e) => saveSettings({ voiceName: e.target.value })}>
            <option value="">自动</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}（{v.locale}）
              </option>
            ))}
          </select>
        </Row>
        <Slider title="语速" desc="1.0× 是系统默认速度" value={settings.voiceRate} min={0.5} max={2} step={0.05} fmt={(v) => `${v.toFixed(2)}×`} disabled={off} onCommit={(v) => saveSettings({ voiceRate: v })} />
        <Row title="试听">
          <Button small disabled={off} onClick={preview}>
            ▶ 听听看
          </Button>
        </Row>
        <Row title="朗读文字回复" desc="在聊天里打字时，也把回复读出来">
          <Toggle checked={settings.voiceReadReplies} disabled={off} onChange={(v) => saveSettings({ voiceReadReplies: v })} />
        </Row>
      </div>

      <div className={s.sectionTitle}>听你说话</div>
      <div className={s.group}>
        <Slider
          title="说完停顿"
          desc="安静多久算你说完了；常被打断就调长一点"
          value={settings.voiceSilenceMs}
          min={600}
          max={4000}
          step={100}
          fmt={(v) => `${(v / 1000).toFixed(1)} 秒`}
          disabled={off}
          onCommit={(v) => saveSettings({ voiceSilenceMs: Math.round(v) })}
        />
        <Row title="可以打断她" desc={`${settings.petName}说话时你开口，她会停下来听`}>
          <Toggle checked={settings.voiceBargeIn} disabled={off} onChange={(v) => saveSettings({ voiceBargeIn: v })} />
        </Row>
        <Row title="优先本机识别" desc="设备支持时在本机识别，不上传声音（需要系统下载过语音包）">
          <Toggle checked={settings.voiceOnDevice} disabled={off} onChange={(v) => saveSettings({ voiceOnDevice: v })} />
        </Row>
      </div>
    </>
  );
}

/** 设置 → 通用: 桌面模式 / 桌宠模式 + 听歌 / 发呆状态. */
export function ModeSettings() {
  const { settings, saveSettings } = usePanel();
  const [slogan, setSlogan] = useState(settings.desktopSlogan);
  const setMode = async (mode: "pet" | "desktop") => {
    if (mode === settings.displayMode) return;
    try {
      await api.setDisplayMode(mode);
    } catch {
      saveSettings({ displayMode: mode });
    }
  };
  return (
    <>
      <div className={s.sectionTitle}>显示模式</div>
      <div className={s.group}>
        <div className={`${s.row} ${s.rowStack}`}>
          <div className={s.rowLabel}>
            <div className={s.rowTitle}>模式</div>
            <div className={s.rowDesc}>
              {settings.displayMode === "desktop"
                ? `桌面模式：${settings.petName}和时钟铺满桌面当壁纸，窗口都在它上面`
                : `桌宠模式：${settings.petName}浮在所有窗口上面，可以拖来拖去`}
            </div>
          </div>
          <div className={s.presets}>
            <Button small className={`${s.preset} ${settings.displayMode === "pet" ? s.presetOn : ""}`} onClick={() => void setMode("pet")}>
              🐱 桌宠模式
            </Button>
            <Button small className={`${s.preset} ${settings.displayMode === "desktop" ? s.presetOn : ""}`} onClick={() => void setMode("desktop")}>
              🏠 桌面模式
            </Button>
          </div>
        </div>
        {settings.displayMode === "desktop" && (
          <Row title="桌面可以点" desc="开启后可以点小喵和卡片；关闭时点击会穿到桌面图标">
            <Toggle checked={settings.desktopInteractive} onChange={(v) => saveSettings({ desktopInteractive: v })} />
          </Row>
        )}
      </div>

      <div className={s.sectionTitle}>桌面风格 · 屏保</div>
      <div className={s.group}>
        <div className={`${s.row} ${s.rowStack}`}>
          <div className={s.rowLabel}>
            <div className={s.rowTitle}>风格</div>
            <div className={s.rowDesc}>
              {STYLE_DESC[settings.desktopStyle] ?? STYLE_DESC.sonoma}
              。颜色会跟着清晨、白天、黄昏、夜晚慢慢变。
            </div>
          </div>
          <div className={s.presetsGrid}>
            {STYLE_OPTIONS.map((o) => (
              <Button
                key={o.id}
                small
                className={`${s.preset} ${settings.desktopStyle === o.id ? s.presetOn : ""}`}
                onClick={() => saveSettings({ desktopStyle: o.id })}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
        {settings.desktopStyle === "slogan" && (
          <div className={`${s.row} ${s.rowStack}`}>
            <div className={s.rowTitle}>标语</div>
            <div className={s.inline}>
              <input
                className={inputClass}
                style={{ flex: 1 }}
                value={slogan}
                maxLength={40}
                onChange={(e) => setSlogan(e.target.value)}
                placeholder="今天也要元气满满."
              />
              <Button small variant="primary" disabled={slogan.trim() === settings.desktopSlogan} onClick={() => saveSettings({ desktopSlogan: slogan.trim() || "今天也要元气满满." })}>
                应用
              </Button>
            </div>
          </div>
        )}
        <Row title="手写星期" desc="在时钟上叠一行花体 Friday（Sonoma / 海）">
          <Toggle checked={settings.desktopScriptWeekday} onChange={(v) => saveSettings({ desktopScriptWeekday: v })} />
        </Row>
        <Row title="自动进入屏保" desc="电脑闲置这么久后自动出现；动一下鼠标或按任意键退出">
          <select
            className={selectClass}
            value={settings.screensaverIdleMins}
            onChange={(e) => saveSettings({ screensaverIdleMins: Number(e.target.value) })}
            aria-label="自动进入屏保"
          >
            {[0, 3, 5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "不自动" : `${m} 分钟`}
              </option>
            ))}
          </select>
        </Row>
        <Row title="屏保显示便签" desc="屏保上很淡地显示最多 2 张置顶便签；默认关闭，保持干净">
          <Toggle checked={settings.screensaverNotes} onChange={(v) => saveSettings({ screensaverNotes: v })} />
        </Row>
        <Row title="桌面天气" desc="用 IP 粗略定位查天气（ipapi.co + open-meteo，免 Key）；关掉就只显示日期">
          <Toggle checked={settings.desktopWeather} onChange={(v) => saveSettings({ desktopWeather: v })} />
        </Row>
        <DesktopFoldersRow />
        <Row title="屏保模式" desc="只看不点、信息更少；托盘菜单里也有「进入屏保」">
          <Button small onClick={() => void api.startScreensaver().catch(() => undefined)}>
            现在进入
          </Button>
        </Row>
      </div>

      <div className={s.sectionTitle}>小喵的状态</div>
      <div className={s.group}>
        <Row title="听歌检测" desc="QQ音乐、Apple 音乐、Spotify 等在放歌时，她会戴上耳机一起听">
          <Toggle checked={settings.musicDetection} onChange={(v) => saveSettings({ musicDetection: v })} />
        </Row>
        <Row title="包括浏览器播放" desc="浏览器里放视频 / 音乐也算听歌">
          <Toggle checked={settings.musicIncludeBrowsers} disabled={!settings.musicDetection} onChange={(v) => saveSettings({ musicIncludeBrowsers: v })} />
        </Row>
        <Row title="发呆和睡觉" desc="你 10 分钟不动电脑她会打盹，回来时伸个懒腰">
          <Toggle checked={settings.idleStates} onChange={(v) => saveSettings({ idleStates: v })} />
        </Row>
      </div>
    </>
  );
}

/** 桌面模式 folder shortcuts: built-ins + up to 8 of the user's own. */
function DesktopFoldersRow() {
  const [list, setList] = useState<DesktopFolder[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void api.listDesktopFolders().then(setList).catch(() => setList([]));
  }, []);
  const custom = (list ?? []).filter((f) => f.kind === "custom");
  return (
    <div className={`${s.row} ${s.rowStack}`}>
      <div className={s.rowTitle}>桌面文件夹</div>
      <div className={s.rowDesc}>{IS_WINDOWS ? "下载 / 文档 / 桌面 / 开始菜单" : "下载 / 文稿 / 桌面 / 应用程序"} 已经在桌面上；再加几个常用的（最多 8 个），点一下用{FILE_MANAGER}打开</div>
      {custom.map((f) => (
        <div key={f.path} className={s.inline} style={{ justifyContent: "space-between" }}>
          <span title={f.path} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            📁 {f.name}
          </span>
          <Button small variant="ghost" onClick={() => void api.removeDesktopFolder(f.path).then(setList).catch((e) => setErr(errorText(e)))}>
            移除
          </Button>
        </div>
      ))}
      <div className={s.inline}>
        <Button small disabled={custom.length >= 8} onClick={() => void api.addDesktopFolder().then(setList).catch((e) => setErr(errorText(e)))}>
          ＋ 添加文件夹
        </Button>
        {err && <span style={{ color: "var(--red)", fontSize: 11 }}>{err}</span>}
      </div>
    </div>
  );
}
