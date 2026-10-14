import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PetMood, Site } from "@desktop-pet/shared";
import { api, errorText, hideCurrentWindow, on } from "../api/client";
import type { AppSettings, ConnectionInfo, ConnectionStatus, NotificationEventPayload } from "../api/types";
import { ErrorBanner, Spinner } from "./ui";
import { TasksView } from "./TasksView";
import { SitesView } from "./SitesView";
import { NotificationsView } from "./NotificationsView";
import { SettingsView } from "./SettingsView";
import { FirstRun } from "./FirstRun";
import { ChatView } from "./ChatView";
import s from "./Panel.module.css";

export type Tab = "tasks" | "sites" | "chat" | "notifications" | "settings";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "tasks", label: "任务" },
  { id: "sites", label: "网站" },
  { id: "chat", label: "聊天" },
  { id: "notifications", label: "通知" },
  { id: "settings", label: "设置" },
];

const MOOD_TEXT: Record<PetMood, { face: string; text: string }> = {
  idle: { face: "🐱", text: "悠闲中，随时待命" },
  working: { face: "⌨️", text: "有任务正在进行…" },
  completed: { face: "💖", text: "任务完成啦！" },
  needs_attention: { face: "❗", text: "有任务需要你处理" },
};

interface PanelCtxValue {
  settings: AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>;
  sites: Site[];
  reloadSites: () => Promise<void>;
  connection: ConnectionInfo | null;
  setConnection: (c: ConnectionInfo) => void;
  tasksVersion: number;
  notifVersion: number;
  reportError: (e: unknown) => void;
  setTab: (t: Tab) => void;
}

const PanelCtx = createContext<PanelCtxValue | null>(null);
export function usePanel(): PanelCtxValue {
  const v = useContext(PanelCtx);
  if (!v) throw new Error("PanelCtx missing");
  return v;
}

export function PanelApp() {
  // `?tab=` lets the browser preview (mock mode) open a specific tab.
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return TABS.some((x) => x.id === t) ? (t as Tab) : "tasks";
  });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [mood, setMood] = useState<PetMood>("idle");
  const [tasksVersion, setTasksVersion] = useState(0);
  const [notifVersion, setNotifVersion] = useState(0);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const reportError = useCallback((e: unknown) => setError(errorText(e)), []);

  const reloadSites = useCallback(async () => {
    try {
      setSites(await api.listSites());
    } catch (e) {
      reportError(e);
    }
  }, [reportError]);

  const refreshUnread = useCallback(async () => {
    try {
      const list = await api.listNotifications(50);
      setUnread(list.filter((n) => !n.read).length);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    const unlisten: Array<() => void> = [];
    (async () => {
      try {
        const boot = await api.bootstrap();
        setSettings(boot.settings);
        setConnection(boot.connection);
        setMood(boot.mood);
        await reloadSites();
        await refreshUnread();
      } catch (e) {
        setFatal(errorText(e));
      }
      unlisten.push(
        await on("tasks-changed", () => setTasksVersion((v) => v + 1)),
        await on("sites-changed", () => void reloadSites()),
        await on<AppSettings>("settings-changed", (st) => setSettings(st)),
        await on<PetMood>("pet-mood", (m) => setMood(m)),
        await on<ConnectionStatus>("connection-changed", (status) =>
          setConnection((c) => (c ? { ...c, status } : c)),
        ),
        await on<NotificationEventPayload>("notification", () => {
          setNotifVersion((v) => v + 1);
          void refreshUnread();
        }),
        await on<string>("panel-tab", (t) => {
          if (TABS.some((x) => x.id === t)) setTab(t as Tab);
        }),
        await on("panel-shown", () => {
          setTasksVersion((v) => v + 1);
          void api.getConnectionInfo().then(setConnection).catch(() => undefined);
        }),
      );
    })();
    return () => unlisten.forEach((u) => u());
  }, [reloadSites, refreshUnread]);

  // Keep "last heartbeat" fresh while open.
  useEffect(() => {
    const t = window.setInterval(() => {
      void api.getConnectionInfo().then(setConnection).catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (tab === "notifications" && unread > 0) {
      void api.markNotificationsRead().then(() => setUnread(0));
    }
  }, [tab, unread]);

  // Esc hides the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void api.hidePanel().catch(() => hideCurrentWindow());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const saveSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      if (!settings) return;
      const next = { ...settings, ...patch };
      setSettings(next); // optimistic
      try {
        setSettings(await api.updateSettings(next));
      } catch (e) {
        setSettings(settings);
        reportError(e);
      }
    },
    [settings, reportError],
  );

  const ctx = useMemo<PanelCtxValue | null>(
    () =>
      settings
        ? { settings, saveSettings, sites, reloadSites, connection, setConnection, tasksVersion, notifVersion, reportError, setTab }
        : null,
    [settings, saveSettings, sites, reloadSites, connection, tasksVersion, notifVersion, reportError],
  );

  const connected = connection?.status.connected ?? false;

  return (
    <div className={s.shell}>
      <header className={s.header}>
        <div className={s.avatar}>{MOOD_TEXT[mood].face}</div>
        <div className={s.titleBox}>
          <div className={s.title}>{settings?.petName ?? "小喵"}</div>
          <div className={s.subtitle}>{MOOD_TEXT[mood].text}</div>
        </div>
        <button className={s.conn} onClick={() => setTab("settings")} title="浏览器扩展连接状态">
          <span className={`${s.dot} ${connected ? s.dotOn : ""}`} />
          {connected ? "扩展已连接" : "扩展未连接"}
        </button>
        <button
          className={s.conn}
          style={{ padding: "3px 7px" }}
          onClick={() => void api.hidePanel().catch(() => hideCurrentWindow())}
          aria-label="关闭面板"
          title="关闭（Esc）"
        >
          ✕
        </button>
      </header>

      <nav className={s.tabs}>
        {TABS.map((t) => (
          <button key={t.id} className={`${s.tab} ${tab === t.id ? s.tabActive : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === "notifications" && unread > 0 && <span className={s.tabCount}>{unread > 9 ? "9+" : unread}</span>}
          </button>
        ))}
      </nav>

      <main className={s.body}>
        {fatal ? (
          <ErrorBanner message={`无法连接桌宠后台：${fatal}`} />
        ) : !ctx ? (
          <Spinner />
        ) : (
          <PanelCtx.Provider value={ctx}>
            <ErrorBanner message={error} onClose={() => setError(null)} />
            {tab === "tasks" && <TasksView />}
            {tab === "sites" && <SitesView />}
            {tab === "chat" && <ChatView />}
            {tab === "notifications" && <NotificationsView />}
            {tab === "settings" && <SettingsView />}
            {!ctx.settings.firstRunDone && <FirstRun />}
          </PanelCtx.Provider>
        )}
      </main>
    </div>
  );
}
