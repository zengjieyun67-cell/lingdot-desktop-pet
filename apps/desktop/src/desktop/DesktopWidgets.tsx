import { useEffect, useState, type ReactNode } from "react";
import { api, on } from "../api/client";
import type { DesktopFolder, DesktopStyle, SystemStats, Weather } from "../api/types";
import { PinnedNotes } from "../notes/PinnedNotes";
import w from "./DesktopWidgets.module.css";

/**
 * 桌面模式 extras around the edges (the character keeps the centre, the sea keeps its negative space):
 * weather + date + mini month (+ battery / CPU), transparent line-art folder shortcuts that open in Finder,
 * and pinned 便签. On the screen saver only the (opt-in, very faint) pinned notes remain.
 */

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

export function weatherKind(code: number): { icon: "sun" | "cloudSun" | "cloud" | "fog" | "rain" | "snow" | "storm"; text: string } {
  if (code === 0) return { icon: "sun", text: "晴" };
  if (code <= 2) return { icon: "cloudSun", text: "晴间多云" };
  if (code === 3) return { icon: "cloud", text: "阴" };
  if (code === 45 || code === 48) return { icon: "fog", text: "雾" };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return { icon: "rain", text: code >= 80 ? "阵雨" : "雨" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: "snow", text: "雪" };
  if (code >= 95) return { icon: "storm", text: "雷雨" };
  return { icon: "cloud", text: "多云" };
}

/** Mini month grid: leading blanks (Monday-first) + day numbers. */
export function monthGrid(d: Date): Array<number | null> {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
}

const WX_ICON: Record<string, ReactNode> = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </>
  ),
  cloudSun: (
    <>
      <path d="M8.5 7.5a3.5 3.5 0 0 1 6.3 1.2" />
      <path d="M11 5V3.5M5.6 6.1l1 1M4 10.5h1.5" />
      <path d="M7.5 18.5h9a3.2 3.2 0 0 0 0-6.4 4.6 4.6 0 0 0-8.8 1.1 2.7 2.7 0 0 0-.2 5.3z" />
    </>
  ),
  cloud: <path d="M7 18.5h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.2A2.9 2.9 0 0 0 7 18.5z" />,
  fog: <path d="M4.5 9h15M3.5 12.5h17M5.5 16h13M8 19.5h8" />,
  rain: (
    <>
      <path d="M7 15h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.2A2.9 2.9 0 0 0 7 15z" />
      <path d="M9 17.5l-1 2.5M13 17.5l-1 2.5M17 17.5l-1 2.5" />
    </>
  ),
  snow: (
    <>
      <path d="M7 14h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.2A2.9 2.9 0 0 0 7 14z" />
      <path d="M9 18h.01M12 20h.01M15 18h.01" />
    </>
  ),
  storm: (
    <>
      <path d="M7 14h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.2A2.9 2.9 0 0 0 7 14z" />
      <path d="M12.5 15.5 10.5 19h3l-2 3" />
    </>
  ),
};

function LineIcon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${w.line} ${className ?? ""}`} aria-hidden>
      {children}
    </svg>
  );
}

function WeatherCalendar({ now }: { now: Date }) {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [stats, setStats] = useState<SystemStats | null>(null);
  useEffect(() => {
    let alive = true;
    const wx = () => void api.getWeather().then((x) => alive && setWeather(x)).catch(() => undefined);
    const st = () => void api.getSystemStats().then((x) => alive && setStats(x)).catch(() => undefined);
    wx();
    st();
    const a = window.setInterval(() => !document.hidden && wx(), 30 * 60_000);
    const b = window.setInterval(() => !document.hidden && st(), 60_000);
    let off: (() => void) | undefined;
    void on("settings-changed", wx).then((u) => (alive ? (off = u) : u()));
    return () => {
      alive = false;
      window.clearInterval(a);
      window.clearInterval(b);
      off?.();
    };
  }, []);
  const kind = weather ? weatherKind(weather.code) : null;
  const grid = monthGrid(now);
  const today = now.getDate();
  return (
    <section className={w.card} aria-label="天气与日历">
      <div className={w.wxRow}>
        {kind ? <LineIcon className={w.wxIcon}>{WX_ICON[kind.icon]}</LineIcon> : <span className={w.wxDay}>{today}</span>}
        <div className={w.wxMain}>
          {weather && kind ? (
            <>
              <div className={w.wxTemp}>
                {Math.round(weather.tempC)}°<span className={w.wxText}>{kind.text}</span>
              </div>
              <div className={w.wxSub}>
                {weather.hiC != null && weather.loC != null ? `${Math.round(weather.loC)}° / ${Math.round(weather.hiC)}° · ` : ""}
                {weather.city || "本地"}
              </div>
            </>
          ) : (
            <>
              <div className={w.wxTemp}>{WEEKDAYS[now.getDay()]}</div>
              <div className={w.wxSub}>{now.getFullYear()} 年</div>
            </>
          )}
        </div>
      </div>
      <div className={w.calHead}>
        <span>
          {now.getMonth() + 1}月{today}日 · {WEEKDAYS[now.getDay()]}
        </span>
        <span className={w.calTag}>CAL · {String(now.getMonth() + 1).padStart(2, "0")}</span>
      </div>
      <div className={w.cal}>
        {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
          <span key={d} className={w.calDow}>
            {d}
          </span>
        ))}
        {grid.map((d, i) => (
          <span key={i} className={`${w.calDay} ${d === today ? w.calToday : ""}`}>
            {d ?? ""}
          </span>
        ))}
      </div>
      {stats && (stats.battery != null || stats.cpuLoad != null) && (
        <div className={w.stats}>
          {stats.battery != null && (
            <span title={stats.charging ? "正在充电" : "电池"}>
              <LineIcon className={w.statIcon}>
                <>
                  <rect x="3" y="7.5" width="16" height="9" rx="2" />
                  <path d="M21 10.5v3" />
                  <rect x="5" y="9.5" width={Math.max(1, (12 * stats.battery) / 100)} height="5" rx="0.8" className={w.fill} />
                </>
              </LineIcon>
              {stats.battery}%{stats.charging ? " ⚡" : ""}
            </span>
          )}
          {stats.cpuLoad != null && (
            <span title="1 分钟平均负载 / 核心数">
              <LineIcon className={w.statIcon}>
                <>
                  <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
                  <path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3" />
                </>
              </LineIcon>
              CPU {Math.round(Math.min(1, stats.cpuLoad) * 100)}%
            </span>
          )}
        </div>
      )}
    </section>
  );
}

const FOLDER_GLYPH: Record<DesktopFolder["kind"], ReactNode> = {
  downloads: <path d="M24 17v9M20 22.5l4 4 4-4" />,
  documents: <path d="M19.5 19.5h9M19.5 23h9M19.5 26.5h6" />,
  desktop: <path d="M18.5 18.5h11v7h-11zM22 28.5h4" />,
  applications: <path d="M24 18l1.6 3.2 3.4.5-2.5 2.4.6 3.4-3.1-1.6-3.1 1.6.6-3.4-2.5-2.4 3.4-.5z" />,
  custom: <circle cx="24" cy="22.5" r="2.2" />,
};

function FolderShortcuts({ className }: { className?: string }) {
  const [list, setList] = useState<DesktopFolder[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => void api.listDesktopFolders().then((l) => alive && setList(l)).catch(() => undefined);
    load();
    let off: (() => void) | undefined;
    void on("settings-changed", load).then((u) => (alive ? (off = u) : u()));
    return () => {
      alive = false;
      off?.();
    };
  }, []);
  if (!list.length) return null;
  return (
    <nav className={`${w.folders} ${className ?? ""}`} aria-label="文件夹">
      {list.map((f) => (
        <button
          key={f.path}
          type="button"
          className={`${w.folder} ${f.exists ? "" : w.folderMissing}`}
          title={f.exists ? `在访达中打开 ${f.path}` : `找不到 ${f.path}`}
          onClick={() => void api.openDesktopFolder(f.path).catch(() => undefined)}
        >
          <svg viewBox="0 0 48 40" className={w.folderIcon} aria-hidden>
            <path className={w.folderBack} d="M5.5 9.5a3 3 0 0 1 3-3h9.2l3.4 3.4h18.4a3 3 0 0 1 3 3V31a3 3 0 0 1-3 3h-31a3 3 0 0 1-3-3z" />
            <path className={w.folderLip} d="M5.5 14.5h37" />
            <g transform="translate(0 -1)">{FOLDER_GLYPH[f.kind]}</g>
          </svg>
          <span className={w.folderLabel}>{f.name}</span>
        </button>
      ))}
    </nav>
  );
}

export function DesktopWidgets({ style, now, saver, saverNotes }: { style: DesktopStyle; now: Date; saver: boolean; saverNotes: boolean }) {
  if (saver) {
    return saverNotes ? (
      <div className={w.layer} data-style={style} data-mode="screensaver">
        <PinnedNotes saver className={w.saverNotes} />
      </div>
    ) : null;
  }
  const showCard = style === "sonoma" || style === "sea";
  return (
    <div className={w.layer} data-style={style} data-mode="desktop">
      {showCard && (
        <div className={w.left}>
          <WeatherCalendar now={now} />
          <PinnedNotes max={2} />
        </div>
      )}
      <FolderShortcuts />
      {!showCard && <PinnedNotes max={style === "poster" ? 1 : 2} className={w.notesAlt} />}
    </div>
  );
}
