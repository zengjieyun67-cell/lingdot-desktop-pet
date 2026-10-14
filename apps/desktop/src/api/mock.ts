/**
 * Browser-only mock of the Rust commands, used when the UI runs outside Tauri
 * (`pnpm --filter @desktop-pet/desktop dev` in a normal browser). Persists to
 * localStorage. NOT used in the packaged app.
 */
import type { NotificationRecord, PetMood, Site, Task, TaskDetail, TaskEvent, TaskStatus } from "@desktop-pet/shared";
import { DEFAULT_SETTINGS, type AppSettings, type SiteInput, type TaskFilter, type TaskInput } from "./types";
import type { PersonaMemory } from "@desktop-pet/shared";

function defaultMemory(): PersonaMemory {
  return {
    affinity: 30, familiarity: 0, todayMood: "neutral", today: "", lastInteractionAt: null, streakDays: 0,
    lastActiveDay: null, activeHours: Array(24).fill(0), siteUsage: {}, lateNightCount: 0, patsToday: 0,
    interactionsToday: 0, totalInteractions: 0,
  };
}

interface MockDb {
  sites: Site[];
  tasks: Task[];
  events: TaskEvent[];
  notifications: NotificationRecord[];
  settings: AppSettings;
  token: string;
  memory?: PersonaMemory;
  hasKey?: boolean;
}

const KEY = "desktop-pet-mock-v1";
const listeners = new Map<string, Set<(p: unknown) => void>>();

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function seed(): MockDb {
  const now = Date.now();
  const mk = (name: string, url: string, icon: string, monitor: boolean, adapterType: Site["adapterType"], i: number): Site => ({
    id: uid(), name, url, icon, sortOrder: i, enabled: true, monitorEnabled: monitor, adapterType, createdAt: now, updatedAt: now,
  });
  const sites = [
    mk("ChatGPT", "https://chatgpt.com", "💬", true, "chatgpt", 0),
    mk("Hark", "https://hark.com", "✨", false, "hark", 1),
    mk("哔哩哔哩", "https://www.bilibili.com", "📺", false, "bilibili", 2),
    mk("CapCut", "https://www.capcut.com", "🎬", false, "capcut", 3),
  ];
  const task = (title: string, status: TaskStatus, ago: number): Task => ({
    id: uid(), title, siteId: sites[0]!.id, url: "https://chatgpt.com/c/demo", status, externalKey: null,
    createdAt: now - ago, updatedAt: now - ago, startedAt: now - ago, completedAt: status === "completed" ? now - ago : null,
    lastObservedAt: now - ago, confidence: 0.9, notificationSent: status !== "running", detectionSource: "extension",
    activeRunNo: status === "running" ? 1 : null, runCount: 1,
  });
  return {
    sites,
    tasks: [task("帮我把周报润色成正式语气", "running", 60_000), task("总结这篇论文的方法部分", "completed", 3_600_000)],
    events: [],
    notifications: [],
    settings: { ...DEFAULT_SETTINGS },
    token: uid() + uid() + uid(),
  };
}

function load(): MockDb {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as MockDb;
  } catch {
    /* ignore */
  }
  const db = seed();
  if (new URLSearchParams(window.location.search).has("skipFirstRun")) db.settings.firstRunDone = true;
  save(db);
  return db;
}

function save(db: MockDb): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* ignore */
  }
}

function emit(event: string, payload: unknown): void {
  listeners.get(event)?.forEach((cb) => cb(payload));
}

function mood(db: MockDb): PetMood {
  if (db.tasks.some((t) => t.status === "needs_attention")) return "needs_attention";
  if (db.tasks.some((t) => t.status === "running")) return "working";
  if (db.tasks.some((t) => t.status === "completed" && t.completedAt && Date.now() - t.completedAt < 12_000)) return "completed";
  return "idle";
}

function validateUrl(url: string): void {
  if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new Error(`URL 必须是 http(s) 地址: ${url}`);
}

export async function mockInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const db = load();
  const now = Date.now();
  const done = <R>(v: R): T => {
    save(db);
    return v as unknown as T;
  };
  switch (cmd) {
    case "get_bootstrap":
      return done({
        settings: db.settings,
        mood: mood(db),
        connection: {
          status: { connected: false, clientId: null, extensionVersion: null, lastHeartbeatAt: null, connectedAt: null },
          port: db.settings.serverPort,
          token: db.token,
          allowedExtensionId: db.settings.allowedExtensionId,
          serverError: "浏览器预览模式：未运行本地服务",
        },
        platform: "browser",
      });
    case "list_sites":
      return done([...db.sites].sort((a, b) => a.sortOrder - b.sortOrder));
    case "create_site": {
      const input = args.input as SiteInput;
      if (!input.name.trim()) throw new Error("名称不能为空");
      validateUrl(input.url);
      const s: Site = { ...input, id: uid(), sortOrder: db.sites.length, createdAt: now, updatedAt: now };
      db.sites.push(s);
      return done(s);
    }
    case "update_site": {
      const input = args.input as SiteInput;
      validateUrl(input.url);
      const s = db.sites.find((x) => x.id === args.id);
      if (!s) throw new Error("not found");
      Object.assign(s, input, { updatedAt: now });
      return done(s);
    }
    case "delete_site":
      db.sites = db.sites.filter((s) => s.id !== args.id);
      return done(undefined);
    case "reorder_sites": {
      const ids = args.ids as string[];
      ids.forEach((id, i) => {
        const s = db.sites.find((x) => x.id === id);
        if (s) s.sortOrder = i;
      });
      return done([...db.sites].sort((a, b) => a.sortOrder - b.sortOrder));
    }
    case "launch_site": {
      const s = db.sites.find((x) => x.id === args.id);
      if (s) window.open(s.url, "_blank", "noopener");
      return done(undefined);
    }
    case "open_url":
      validateUrl(String(args.url));
      window.open(String(args.url), "_blank", "noopener");
      return done(undefined);
    case "list_tasks": {
      const f = (args.filter ?? {}) as TaskFilter;
      return done(
        db.tasks
          .filter((t) => (!f.siteId || t.siteId === f.siteId) && (!f.status || t.status === f.status))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
    }
    case "get_task_detail": {
      const t = db.tasks.find((x) => x.id === args.id);
      if (!t) throw new Error("not found");
      const detail: TaskDetail = {
        task: t,
        runs: t.runCount
          ? [{ id: "r1", taskId: t.id, runNo: 1, status: t.status, startedAt: t.startedAt ?? t.createdAt, endedAt: t.completedAt, endReason: null }]
          : [],
        events: db.events.filter((e) => e.taskId === t.id).sort((a, b) => b.createdAt - a.createdAt),
      };
      return done(detail);
    }
    case "create_task": {
      const input = args.input as TaskInput;
      if (!input.title.trim()) throw new Error("标题不能为空");
      if (input.url) validateUrl(input.url);
      const t: Task = {
        id: uid(), title: input.title, siteId: input.siteId, url: input.url, status: input.status ?? "pending",
        externalKey: null, createdAt: now, updatedAt: now, startedAt: null, completedAt: null, lastObservedAt: null,
        confidence: 1, notificationSent: false, detectionSource: "manual", activeRunNo: null, runCount: 0,
      };
      db.tasks.push(t);
      db.events.push({ id: now, taskId: t.id, runNo: null, eventId: null, kind: "created", fromStatus: null, toStatus: t.status, evidence: [], source: "manual", createdAt: now });
      emit("tasks-changed", null);
      return done(t);
    }
    case "update_task":
    case "set_task_status": {
      const t = db.tasks.find((x) => x.id === args.id);
      if (!t) throw new Error("not found");
      const from = t.status;
      if (cmd === "update_task") {
        const input = args.input as TaskInput;
        Object.assign(t, { title: input.title, siteId: input.siteId, url: input.url });
        if (input.status) t.status = input.status;
      } else {
        t.status = args.status as TaskStatus;
      }
      if (t.status === "completed") t.completedAt = now;
      t.updatedAt = now;
      db.events.push({ id: now, taskId: t.id, runNo: null, eventId: null, kind: "manual_status", fromStatus: from, toStatus: t.status, evidence: [], source: "manual", createdAt: now });
      emit("tasks-changed", null);
      emit("pet-mood", mood(db));
      return done(t);
    }
    case "delete_task":
      db.tasks = db.tasks.filter((t) => t.id !== args.id);
      emit("tasks-changed", null);
      return done(undefined);
    case "open_task": {
      const t = db.tasks.find((x) => x.id === args.id);
      if (t?.url) window.open(t.url, "_blank", "noopener");
      return done(undefined);
    }
    case "get_settings":
      return done(db.settings);
    case "update_settings":
      db.settings = { ...(args.settings as AppSettings) };
      emit("settings-changed", db.settings);
      return done(db.settings);
    case "complete_first_run":
      db.settings.firstRunDone = true;
      return done(db.settings);
    case "list_notifications":
      return done(db.notifications.slice(0, Number(args.limit ?? 50)));
    case "mark_notifications_read":
      db.notifications.forEach((n) => (n.read = true));
      return done(undefined);
    case "clear_notifications":
      db.notifications = [];
      return done(undefined);
    case "open_notification": {
      const n = db.notifications.find((x) => x.id === args.id);
      if (n?.url) window.open(n.url, "_blank", "noopener");
      return done(undefined);
    }
    case "test_notification": {
      const rec: NotificationRecord = { id: uid(), taskId: null, kind: "completed", title: "🐱 桌宠通知测试", body: "浏览器预览模式下的模拟通知", url: null, createdAt: now, read: false };
      db.notifications.unshift(rec);
      emit("notification", { record: rec, sound: db.settings.soundEnabled, test: true });
      return done(undefined);
    }
    case "get_connection_info":
    case "rotate_token":
      if (cmd === "rotate_token") db.token = uid() + uid() + uid();
      return done({
        status: { connected: false, clientId: null, extensionVersion: null, lastHeartbeatAt: null, connectedAt: null },
        port: db.settings.serverPort,
        token: db.token,
        allowedExtensionId: db.settings.allowedExtensionId,
        serverError: "浏览器预览模式：未运行本地服务",
      });
    case "cleanup_data": {
      const before = db.tasks.length;
      const cutoff = now - Number(args.olderThanDays ?? 0) * 86_400_000;
      db.tasks = args.all ? [] : db.tasks.filter((t) => !(["completed", "failed"].includes(t.status) && t.updatedAt < cutoff));
      emit("tasks-changed", null);
      return done(before - db.tasks.length);
    }
    case "get_pet_mood":
      return done(mood(db));
    case "get_live2d_info":
      return done({ modelsDir: "~/Library/Application Support/com.desktoppet.app/live2d" });
    case "get_persona_memory":
      return done(db.memory ?? defaultMemory());
    case "persona_interaction": {
      const m = db.memory ?? defaultMemory();
      if (db.settings.memoryEnabled) {
        const kind = String(args.kind);
        if (kind === "pat") m.affinity = Math.min(100, m.affinity + 3);
        else if (kind === "ignored") m.affinity = Math.max(0, m.affinity - 2);
        else m.affinity = Math.min(100, m.affinity + 0.5);
        m.familiarity = Math.min(100, Math.round((m.familiarity + 0.2) * 10) / 10);
        m.activeHours[Number(args.localHour) || 0]! += 1;
        if (kind === "launch_site" && args.siteId) m.siteUsage[String(args.siteId)] = (m.siteUsage[String(args.siteId)] ?? 0) + 1;
        m.totalInteractions += 1;
        m.lastInteractionAt = now;
        db.memory = m;
      }
      return done(m);
    }
    case "set_today_mood":
      if (db.memory) db.memory.todayMood = String(args.mood) as PersonaMemory["todayMood"];
      return done(undefined);
    case "reset_persona_memory":
      db.memory = defaultMemory();
      return done(db.memory);
    case "get_persona_prompt_path":
      return done("~/Library/Application Support/com.desktoppet.app/persona/xiaomiao.md");
    case "set_chat_api_key":
      db.hasKey = true;
      return done(undefined);
    case "clear_chat_api_key":
      db.hasKey = false;
      return done(undefined);
    case "has_chat_api_key":
      return done(!!db.hasKey);
    case "chat_send":
      if (!db.settings.chatEnabled) throw new Error("聊天功能未开启（设置 → 小喵 → 聊天）");
      return done(`哼，${db.settings.userTitle}，这里是浏览器预览模式，本猫没法真的联网聊天啦。`);
    case "toggle_panel":
    case "show_panel":
    case "hide_panel":
    case "set_pet_visible":
    case "reset_pet_position":
    case "quit_app":
      return done(undefined);
    default:
      throw new Error(`mock: unknown command ${cmd}`);
  }
}

export async function mockListen<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  const set = listeners.get(event) ?? new Set();
  const wrapped = cb as (p: unknown) => void;
  set.add(wrapped);
  listeners.set(event, set);
  return () => set.delete(wrapped);
}
