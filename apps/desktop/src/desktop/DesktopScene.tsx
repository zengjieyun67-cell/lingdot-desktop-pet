import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Task } from "@desktop-pet/shared";
import { api, on } from "../api/client";
import type { ActivitySnapshot, AppSettings } from "../api/types";
import s from "./DesktopScene.module.css";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const STATUS_TEXT: Record<string, string> = {
  pending: "等待中",
  running: "进行中",
  completed: "完成啦",
  needs_attention: "等你处理",
  failed: "失败了",
  unknown: "不确定",
};
const NAV: Array<{ id: string; label: string }> = [
  { id: "home", label: "桌面" },
  { id: "tasks", label: "任务" },
  { id: "chat", label: "聊天" },
  { id: "settings", label: "设置" },
];
const SERVICES: Array<{ tab: string; label: string; icon: ReactNode }> = [
  { tab: "tasks", label: "任务", icon: <path d="M5 6h14M5 12h14M5 18h9" /> },
  { tab: "chat", label: "聊天", icon: <path d="M4 5h16v11H9l-5 4z" /> },
  { tab: "sites", label: "网站", icon: <><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16" /></> },
  { tab: "notifications", label: "通知", icon: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20h4" /> },
  { tab: "settings", label: "设置", icon: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></> },
  { tab: "settings", label: "语音", icon: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></> },
];

function greeting(h: number): string {
  if (h < 5) return "夜深了，早点睡";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好，记得吃饭";
  if (h < 18) return "下午好";
  if (h < 22) return "晚上好";
  return "夜深了，早点睡";
}

function dayStart(offset = 0): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.getTime();
}

const open = (tab: string) => void api.showPanel(tab).catch(() => undefined);

/** 桌面模式: a soft glass dashboard with the user's Live2D 小喵 standing in the middle. */
export function DesktopScene({ pet }: { pet: ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<ActivitySnapshot | null>(null);
  const [name, setName] = useState("小喵");

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    const offs: Array<() => void> = [];
    const load = () =>
      void api
        .listTasks({ limit: 60 })
        .then((ts) => alive && setTasks(ts))
        .catch(() => undefined);
    load();
    void api.bootstrap().then((b) => alive && setName(b.settings.petName || "小喵")).catch(() => undefined);
    void api.getActivity().then((a) => alive && setActivity(a)).catch(() => undefined);
    const sub = <T,>(ev: string, cb: (p: T) => void) =>
      void on<T>(ev, cb).then((u) => (alive ? offs.push(u) : u())).catch(() => undefined);
    sub("tasks-changed", load);
    sub<ActivitySnapshot>("pet-activity", (a) => setActivity(a));
    sub<AppSettings>("settings-changed", (st) => setName(st.petName || "小喵"));
    return () => {
      alive = false;
      offs.forEach((u) => u());
    };
  }, []);

  const from = dayStart();
  const today = useMemo(
    () => tasks.filter((t) => t.updatedAt >= from || t.status === "running" || t.status === "needs_attention"),
    [tasks, from],
  );
  const running = today.filter((t) => t.status === "running").length;
  const attention = today.filter((t) => t.status === "needs_attention").length;
  const done = today.filter((t) => t.status === "completed").length;

  // completed per day over the last 7 days (for the little bar card)
  const week = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const start = dayStart(i - 6);
      const end = start + 86_400_000;
      const n = tasks.filter((t) => t.status === "completed" && t.updatedAt >= start && t.updatedAt < end).length;
      const d = new Date(start);
      return { label: i === 6 ? "今天" : `${d.getMonth() + 1}.${d.getDate()}`, n };
    });
    const max = Math.max(1, ...days.map((d) => d.n));
    return days.map((d) => ({ ...d, h: 12 + (d.n / max) * 48 }));
  }, [tasks]);

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const music = activity?.kind === "listening_music" ? activity.music : null;
  const stateText =
    activity?.kind === "listening_music" ? "一起听歌中" : activity?.kind === "napping" ? "打盹中 zZ" : activity?.kind === "stretching" ? "伸懒腰～" : running ? "帮你盯着任务" : "悠闲中";

  return (
    <div className={s.scene}>
      <div className={s.frame}>
        {/* ---------- sidebar ---------- */}
        <aside className={s.side}>
          <div className={s.brand}>
            <span className={s.logo}>l</span>
            <span className={s.brandName}>lingdot</span>
            <span className={s.avatar}>🐾</span>
          </div>
          <div className={s.search}>
            <span className={s.searchDot} />
            {greeting(now.getHours())}，今天也加油
          </div>

          <button className={`${s.acct} ${s.acctOn}`} onClick={() => open("tasks")}>
            <span className={`${s.chip} ${s.chipPink}`}>进行中</span>
            <span className={s.acctNum}>{running}</span>
            <span className={s.chev}>›</span>
          </button>
          <button className={s.acct} onClick={() => open("tasks")}>
            <span className={`${s.chip} ${s.chipBlue}`}>等你</span>
            <span className={s.acctNum}>{attention}</span>
            <span className={s.chev}>›</span>
          </button>

          <div className={s.sideTitle}>快捷</div>
          <div className={s.grid}>
            {SERVICES.map((it) => (
              <button key={it.label} className={s.svc} onClick={() => open(it.tab)}>
                <svg viewBox="0 0 24 24" className={s.svcIcon} aria-hidden>
                  {it.icon}
                </svg>
                {it.label}
              </button>
            ))}
          </div>

          <div className={s.sideFoot}>
            <span>{name}</span>
            <span className={s.footDot} />
            <span>{stateText}</span>
          </div>
        </aside>

        {/* ---------- main ---------- */}
        <main className={s.main}>
          <nav className={s.nav}>
            {NAV.map((n) => (
              <button key={n.id} className={`${s.navItem} ${n.id === "home" ? s.navOn : ""}`} onClick={() => n.id !== "home" && open(n.id)}>
                {n.label}
              </button>
            ))}
          </nav>

          <h1 className={s.title}>
            {now.getMonth() + 1}月{now.getDate()}日 <span>{WEEKDAYS[now.getDay()]}</span>
          </h1>

          <div className={s.stageArea}>
            <div className={s.orb} />
            <div className={s.petSlot} data-pet-slot>
              {pet}
            </div>

            {/* floating bubbles */}
            <div className={`${s.bub} ${s.bubPurple} ${s.b1}`}>
              <span className={s.bubLabel}>现在</span>
              <span className={s.bubBig}>
                {hh}:{mm}
              </span>
            </div>
            <div className={`${s.bub} ${s.bubBlue} ${s.b2}`}>
              <span className={s.bubLabel}>{music ? music.app : "音乐"}</span>
              <span className={s.bubMid}>{music ? music.title ?? "正在播放" : "没在放歌"}</span>
            </div>
            <div className={`${s.bub} ${s.bubOrange} ${s.b3}`}>
              <span className={s.bubLabel}>今日完成</span>
              <span className={s.bubBig}>{done}</span>
            </div>
            <button className={`${s.bub} ${s.bubWhite} ${s.b4}`} onClick={() => open("chat")}>
              聊天
            </button>

            {/* weekly bars */}
            <div className={s.bars}>
              {week.map((d) => (
                <div key={d.label} className={s.barCol}>
                  <span className={s.barNum}>{d.n}</span>
                  <span className={`${s.bar} ${d.label === "今天" ? s.barToday : ""}`} style={{ height: d.h }} />
                  <span className={s.barLabel}>{d.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={s.bottom}>
            <section className={s.list}>
              <div className={s.listHead}>
                <span>今天的任务</span>
                <span className={s.listCount}>{today.length}</span>
              </div>
              {today.length === 0 ? (
                <div className={s.empty}>今天还没有任务，先陪{name}晒会儿太阳</div>
              ) : (
                today.slice(0, 3).map((t) => (
                  <div key={t.id} className={s.row}>
                    <span className={`${s.rowIcon} ${s["st_" + t.status] ?? ""}`}>{t.title.slice(0, 1)}</span>
                    <span className={s.rowText}>
                      <span className={s.rowTitle}>{t.title}</span>
                      <span className={s.rowSub}>
                        {new Date(t.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </span>
                    <span className={s.rowStatus}>{STATUS_TEXT[t.status] ?? t.status}</span>
                  </div>
                ))
              )}
            </section>
            <section className={s.list}>
              <div className={s.listHead}>
                <span>{name}的状态</span>
              </div>
              <div className={s.people}>
                {[
                  { k: "♪", t: "听歌", on: activity?.kind === "listening_music" },
                  { k: "🙆", t: "伸懒腰", on: activity?.kind === "stretching" },
                  { k: "💤", t: "打盹", on: activity?.kind === "napping" },
                  { k: "✨", t: "工作", on: running > 0 },
                ].map((p) => (
                  <div key={p.t} className={`${s.person} ${p.on ? s.personOn : ""}`}>
                    <span className={s.personAv}>{p.k}</span>
                    <span>{p.t}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
