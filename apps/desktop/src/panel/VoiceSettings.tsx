import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, isTauri } from "../api/client";
import type { VoiceInfo } from "../api/types";
import { browserVoiceSupported } from "../lib/voice";
import { usePanel } from "./PanelApp";
import { Button, selectClass, Toggle } from "./ui";
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
        <Row title="开启语音" desc={`用 macOS 自带的语音识别和系统语音，和${settings.petName}说话，免费`}>
          <Toggle checked={settings.voiceEnabled} onChange={(v) => saveSettings({ voiceEnabled: v })} />
        </Row>
        <div className={`${s.row} ${s.rowStack}`}>
          <div className={s.rowDesc} style={{ lineHeight: 1.6 }}>
            🎙️ 第一次使用时 macOS 会询问「麦克风」和「语音识别」权限，请点允许。
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
        <Row title="优先本机识别" desc="设备支持时在本机识别，不上传声音（需要 macOS 下载过语音包）">
          <Toggle checked={settings.voiceOnDevice} disabled={off} onChange={(v) => saveSettings({ voiceOnDevice: v })} />
        </Row>
      </div>
    </>
  );
}

/** 设置 → 通用: 桌面模式 / 桌宠模式 + 听歌 / 发呆状态. */
export function ModeSettings() {
  const { settings, saveSettings } = usePanel();
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
                ? `桌面模式：黄色小房间铺满桌面，${settings.petName}住在里面，窗口都在它上面`
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
