import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Task } from "@desktop-pet/shared";
import { api, on } from "../api/client";
import type { ActivitySnapshot, AppSettings, DesktopStyle } from "../api/types";
import { minuteOfDay, PHASE_LABEL, partOfDay, posterHeadline, themeAt, themeVars, type Phase } from "./timeOfDay";
import { previewStyle, useMinuteClock } from "./useSceneClock";
import s from "./DesktopScene.module.css";

/** desktop = 桌面模式 (wallpaper with a few entries); screensaver = 屏保模式 (look only). */
export type SceneMode = "desktop" | "screensaver";

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const WEEKDAYS_EN = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MONTHS_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const open = (tab: string) => void api.showPanel(tab).catch(() => undefined);
const startSaver = () => void api.startScreensaver().catch(() => undefined);

const ICONS: Record<string, ReactNode> = {
  tasks: <path d="M5 6.5h14M5 12h14M5 17.5h9" />,
  chat: <path d="M4.5 5.5h15v10.5H9.5L4.5 20z" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.6M12 17.9v2.6M3.5 12h2.6M17.9 12h2.6M6 6l1.8 1.8M16.2 16.2 18 18M6 18l1.8-1.8M16.2 7.8 18 6" />
    </>
  ),
  saver: (
    <>
      <rect x="3.5" y="5" width="17" height="11.5" rx="2" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),
};

interface Entry {
  id: string;
  label: string;
  run: () => void;
  badge?: number;
}

/** 屏保模式: leave on the first real mouse move, click, scroll or key press. */
function useScreensaverExit(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const started = performance.now();
    let origin: { x: number; y: number } | null = null;
    let gone = false;
    const exit = () => {
      // the window appearing can itself produce a stray event: ignore the first moment
      if (gone || performance.now() - started < 1200) return;
      gone = true;
      void api.exitScreensaver().catch(() => undefined);
    };
    const onMove = (e: MouseEvent) => {
      if (!origin) {
        origin = { x: e.screenX, y: e.screenY };
        return;
      }
      if (Math.hypot(e.screenX - origin.x, e.screenY - origin.y) > 10) exit();
    };
    const opts = { capture: true } as const;
    window.addEventListener("mousemove", onMove, opts);
    window.addEventListener("mousedown", exit, opts);
    window.addEventListener("wheel", exit, opts);
    window.addEventListener("keydown", exit, opts);
    window.addEventListener("touchstart", exit, opts);
    return () => {
      window.removeEventListener("mousemove", onMove, opts);
      window.removeEventListener("mousedown", exit, opts);
      window.removeEventListener("wheel", exit, opts);
      window.removeEventListener("keydown", exit, opts);
      window.removeEventListener("touchstart", exit, opts);
    };
  }, [active]);
}

function dayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 桌面模式 / 屏保模式 scene. Two looks (设置 → 通用 → 桌面风格):
 *  - sonoma: Apple-style thin lock-screen clock over a flowing aurora, 小喵 in front of a glass halo
 *  - poster: magazine poster — giant serif numerals, headline, the song as the deck, half-body close-up, film grain
 * Both are tinted by the 时间系统 (timeOfDay.ts): 清晨 / 白天 / 黄昏 / 夜晚 blended every minute.
 */
export function DesktopScene({ pet, mode = "desktop" }: { pet: ReactNode; mode?: SceneMode }) {
  const now = useMinuteClock();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<ActivitySnapshot | null>(null);
  const [name, setName] = useState("小喵");
  const [style, setStyle] = useState<DesktopStyle>(() => previewStyle() ?? "sonoma");
  const saver = mode === "screensaver";
  useScreensaverExit(saver);

  useEffect(() => {
    let alive = true;
    const offs: Array<() => void> = [];
    const apply = (st: AppSettings) => {
      setName(st.petName || "小喵");
      setStyle(previewStyle() ?? (st.desktopStyle === "poster" ? "poster" : "sonoma"));
    };
    const load = () =>
      void api
        .listTasks({ limit: 60 })
        .then((ts) => alive && setTasks(ts))
        .catch(() => undefined);
    load();
    void api.bootstrap().then((b) => alive && apply(b.settings)).catch(() => undefined);
    void api.getActivity().then((a) => alive && setActivity(a)).catch(() => undefined);
    const sub = <T,>(ev: string, cb: (p: T) => void) =>
      void on<T>(ev, cb).then((u) => (alive ? offs.push(u) : u())).catch(() => undefined);
    sub("tasks-changed", load);
    sub<ActivitySnapshot>("pet-activity", (a) => setActivity(a));
    sub<AppSettings>("settings-changed", apply);
    return () => {
      alive = false;
      offs.forEach((u) => u());
    };
  }, []);

  const theme = useMemo(() => themeAt(minuteOfDay(now)), [now]);
  const vars = useMemo(() => themeVars(theme) as CSSProperties, [theme]);

  const from = dayStart();
  const running = tasks.filter((t) => t.status === "running").length;
  const attention = tasks.filter((t) => t.status === "needs_attention").length;
  const done = tasks.filter((t) => t.status === "completed" && t.updatedAt >= from).length;
  const music = activity?.kind === "listening_music" ? activity.music : null;
  const stateText =
    activity?.kind === "listening_music"
      ? "陪你听歌"
      : activity?.kind === "napping"
        ? "在打盹"
        : activity?.kind === "stretching"
          ? "在伸懒腰"
          : running
            ? "帮你盯着任务"
            : "在发呆";

  const entries: Entry[] = [
    { id: "tasks", label: "任务", run: () => open("tasks"), badge: running + attention },
    { id: "chat", label: "聊天", run: () => open("chat") },
    { id: "settings", label: "设置", run: () => open("settings") },
    { id: "saver", label: "屏保", run: startSaver },
  ];

  const info: SceneInfo = { now, phase: theme.phase, name, stateText, music, done, entries, saver, pet };
  return (
    <div
      className={`${s.scene} ${style === "poster" ? s.poster : s.sonoma} ${saver ? s.saver : ""}`}
      style={vars}
      data-phase={theme.phase}
      data-style={style}
      data-mode={mode}
    >
      {style === "poster" ? <PosterScene {...info} /> : <SonomaScene {...info} />}
      {saver && <div className={s.shield} aria-hidden />}
    </div>
  );
}

interface SceneInfo {
  now: Date;
  phase: Phase;
  name: string;
  stateText: string;
  music: { app: string; title: string | null; artist: string | null } | null;
  done: number;
  entries: Entry[];
  saver: boolean;
  pet: ReactNode;
}

const pad = (n: number) => String(n).padStart(2, "0");

// ------------------------------------------------------------------ A. Sonoma

function SonomaScene({ now, name, stateText, music, entries, saver, pet, phase }: SceneInfo) {
  const time = `${now.getHours()}:${pad(now.getMinutes())}`;
  return (
    <>
      <div className={s.aurora} aria-hidden>
        <i className={`${s.blob} ${s.blob1}`} />
        <i className={`${s.blob} ${s.blob2}`} />
        <i className={`${s.blob} ${s.blob3}`} />
        <i className={`${s.blob} ${s.blob4}`} />
        <i className={`${s.ribbon} ${s.ribbon1}`} />
        <i className={`${s.ribbon} ${s.ribbon2}`} />
        <i className={`${s.ribbon} ${s.ribbon3}`} />
      </div>
      <div className={s.sheen} aria-hidden />

      <header className={s.lock}>
        <div className={s.lockDate}>
          {now.getMonth() + 1}月{now.getDate()}日 {WEEKDAYS[now.getDay()]}
        </div>
        <div className={s.lockTime}>{time}</div>
      </header>

      <div className={s.halo} aria-hidden>
        <span className={s.haloRing} />
      </div>
      <div className={s.petSlot} data-pet-slot>
        {pet}
      </div>

      <div className={s.lockSub}>
        {music ? (
          <>
            <span className={s.eq} aria-hidden>
              <i />
              <i />
              <i />
            </span>
            {music.title ?? "正在播放"}
            {music.artist ? <span className={s.dim}> · {music.artist}</span> : null}
          </>
        ) : (
          <>
            {PHASE_LABEL[phase]} · {name}
            {stateText}
          </>
        )}
      </div>

      {!saver && (
        <nav className={s.dock}>
          {entries.map((e) => (
            <button key={e.id} className={s.dockBtn} onClick={e.run} title={e.label}>
              <svg viewBox="0 0 24 24" className={s.dockIcon} aria-hidden>
                {ICONS[e.id]}
              </svg>
              <span className={s.dockLabel}>{e.label}</span>
              {e.badge ? <span className={s.dockBadge}>{e.badge}</span> : null}
            </button>
          ))}
        </nav>
      )}
    </>
  );
}

// ------------------------------------------------------------------ B. Poster

function PosterScene({ now, name, stateText, music, done, entries, saver, pet }: SceneInfo) {
  const h = now.getHours();
  const [l1, l2] = posterHeadline(h);
  const issue = `${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return (
    <>
      <div className={s.pWash} aria-hidden />

      <header className={s.pTop}>
        <span className={s.pMast}>LINGDOT</span>
        <span className={s.pMeta}>
          VOL.{now.getFullYear() % 100} — NO.{issue}
        </span>
        <span className={s.pMeta}>
          {WEEKDAYS_EN[now.getDay()]} · {MONTHS_EN[now.getMonth()]} {now.getDate()}, {now.getFullYear()}
        </span>
      </header>

      <div className={s.pTime} aria-label="现在时间">
        {pad(h)}
        <span className={s.pColon}>:</span>
        {pad(now.getMinutes())}
      </div>

      <div className={s.pPetSlot} data-pet-slot="poster">
        {pet}
      </div>

      <section className={s.pCopy}>
        <div className={s.pKicker}>
          <span className={s.pDot} />
          {partOfDay(h)}特辑 · {name}的{WEEKDAYS[now.getDay()]}
        </div>
        <h1 className={s.pHead}>
          {l1}
          <br />
          <em>{l2}</em>
        </h1>
        <p className={s.pDeck}>
          {music ? (
            <>
              <span className={s.pDeckLabel}>Now Playing</span>
              《{music.title ?? "正在播放"}》{music.artist ? <> — {music.artist}</> : null}
            </>
          ) : (
            <>
              <span className={s.pDeckLabel}>Today</span>
              {name}
              {stateText}
            </>
          )}
        </p>
        {!saver && (
          <div className={s.pByline}>
            {music ? `via ${music.app}` : `${now.getMonth() + 1}月${now.getDate()}日 · ${WEEKDAYS[now.getDay()]}`}
            <span className={s.pRule} />
            今日完成 {done}
          </div>
        )}
      </section>

      <aside className={s.pSide} aria-hidden>
        ISSUE {issue} · {name.toUpperCase()} · DESKTOP EDITION
      </aside>

      {!saver && (
        <nav className={s.pIndex}>
          <span className={s.pIndexHead}>Contents</span>
          {entries.map((e, i) => (
            <button key={e.id} className={s.pIndexItem} onClick={e.run}>
              <span className={s.pIndexNo}>{pad(i + 1)}</span>
              {e.label}
              {e.badge ? <span className={s.pIndexBadge}>{e.badge}</span> : null}
            </button>
          ))}
        </nav>
      )}

      <div className={s.grain} aria-hidden />
      <div className={s.pVignette} aria-hidden />
    </>
  );
}
