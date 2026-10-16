/**
 * Typed bridge to the Rust commands (src-tauri/src/commands.rs).
 * Outside Tauri (plain `vite dev` in a browser) a localStorage mock is used so
 * the UI can be developed and previewed without the native shell.
 */
import type { PetMood, Site, Task, TaskDetail, TaskStatus, NotificationRecord } from "@desktop-pet/shared";
import type { InteractionKind, PersonaMemory } from "@desktop-pet/shared";
import { localDay } from "@desktop-pet/shared";
import type { ActivitySnapshot, AppSettings, Live2DImport, Bootstrap, ChatMessage, ConnectionInfo, DesktopFolder, DisplayMode, Note, NoteInput, NotePatch, SiteInput, SystemStats, TaskFilter, TaskInput, VoiceInfo, VoiceStatus, Weather } from "./types";
import { mockInvoke, mockListen } from "./mock";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return mockInvoke<T>(cmd, args);
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(cmd, args);
}

export function convertFileSrc(path: string): string {
  const w = window as unknown as { __TAURI_INTERNALS__?: { convertFileSrc?: (p: string, proto?: string) => string } };
  return w.__TAURI_INTERNALS__?.convertFileSrc?.(path, "asset") ?? path;
}

export type Unlisten = () => void;

export async function on<T>(event: string, cb: (payload: T) => void): Promise<Unlisten> {
  if (!isTauri()) return mockListen<T>(event, cb);
  const ev = await import("@tauri-apps/api/event");
  return ev.listen<T>(event, (e) => cb(e.payload));
}

export async function startDragging(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

export async function hideCurrentWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().hide();
}

export async function requestNotificationPermission(): Promise<"granted" | "denied" | "default" | "unsupported"> {
  if (!isTauri()) return "unsupported";
  try {
    const n = await import("@tauri-apps/plugin-notification");
    if (await n.isPermissionGranted()) return "granted";
    return (await n.requestPermission()) as "granted" | "denied" | "default";
  } catch {
    return "unsupported";
  }
}

export const api = {
  bootstrap: () => invoke<Bootstrap>("get_bootstrap"),

  listSites: () => invoke<Site[]>("list_sites"),
  createSite: (input: SiteInput) => invoke<Site>("create_site", { input }),
  updateSite: (id: string, input: SiteInput) => invoke<Site>("update_site", { id, input }),
  deleteSite: (id: string) => invoke<void>("delete_site", { id }),
  reorderSites: (ids: string[]) => invoke<Site[]>("reorder_sites", { ids }),
  launchSite: (id: string) => invoke<void>("launch_site", { id }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),

  listTasks: (filter?: TaskFilter) => invoke<Task[]>("list_tasks", { filter: filter ?? null }),
  getTaskDetail: (id: string) => invoke<TaskDetail>("get_task_detail", { id }),
  createTask: (input: TaskInput) => invoke<Task>("create_task", { input }),
  updateTask: (id: string, input: TaskInput) => invoke<Task>("update_task", { id, input }),
  setTaskStatus: (id: string, status: TaskStatus) => invoke<Task>("set_task_status", { id, status }),
  deleteTask: (id: string) => invoke<void>("delete_task", { id }),
  openTask: (id: string) => invoke<void>("open_task", { id }),

  getSettings: () => invoke<AppSettings>("get_settings"),
  updateSettings: (settings: AppSettings) => invoke<AppSettings>("update_settings", { settings }),
  completeFirstRun: () => invoke<AppSettings>("complete_first_run"),

  listNotifications: (limit = 50) => invoke<NotificationRecord[]>("list_notifications", { limit }),
  markNotificationsRead: () => invoke<void>("mark_notifications_read"),
  clearNotifications: () => invoke<void>("clear_notifications"),
  openNotification: (id: string) => invoke<void>("open_notification", { id }),
  testNotification: () => invoke<void>("test_notification"),

  getConnectionInfo: () => invoke<ConnectionInfo>("get_connection_info"),
  rotateToken: () => invoke<ConnectionInfo>("rotate_token"),
  cleanupData: (olderThanDays: number, all: boolean) => invoke<number>("cleanup_data", { olderThanDays, all }),

  togglePanel: () => invoke<void>("toggle_panel"),
  showPanel: (tab?: string) => invoke<void>("show_panel", { tab: tab ?? null }),
  hidePanel: () => invoke<void>("hide_panel"),
  setPetVisible: (visible: boolean) => invoke<void>("set_pet_visible", { visible }),
  resetPetPosition: () => invoke<void>("reset_pet_position"),
  /** Resize the pet window (Rust clamps to 60%–250% and persists it). */
  setPetScale: (scale: number) => invoke<number>("set_pet_scale", { scale }),
  resetPanelPosition: () => invoke<void>("reset_panel_position"),
  getPetMood: () => invoke<PetMood>("get_pet_mood"),
  getLive2DInfo: () => invoke<{ modelsDir: string }>("get_live2d_info"),
  /** 一键导入我的 Live2D: scan 下载/桌面/文稿/~/Live2D/old checkouts, copy into app data, update settings. */
  scanImportLive2D: (force = true) => invoke<Live2DImport>("scan_and_import_live2d", { force }),
  importLive2DFolder: (path: string) => invoke<Live2DImport>("import_live2d_folder", { path }),
  /** Native folder picker; null when cancelled. */
  pickLive2DFolder: () => invoke<string | null>("pick_live2d_folder"),
  quit: () => invoke<void>("quit_app"),

  // 小喵: memory (local day/hour come from this webview's clock = user's timezone)
  getPersonaMemory: () => invoke<PersonaMemory>("get_persona_memory"),
  personaInteraction: (kind: InteractionKind, siteId?: string) => {
    const d = new Date();
    return invoke<PersonaMemory>("persona_interaction", { kind, siteId: siteId ?? null, localDay: localDay(d), localHour: d.getHours() });
  },
  setTodayMood: (mood: string) => invoke<void>("set_today_mood", { mood, localDay: localDay(new Date()) }),
  resetPersonaMemory: () => invoke<PersonaMemory>("reset_persona_memory"),
  getPersonaPromptPath: () => invoke<string>("get_persona_prompt_path"),
  // chat (API key goes straight to the OS keychain; it is never returned to the UI)
  setChatApiKey: (key: string) => invoke<void>("set_chat_api_key", { key }),
  clearChatApiKey: () => invoke<void>("clear_chat_api_key"),
  hasChatApiKey: () => invoke<boolean>("has_chat_api_key"),
  chatSend: (history: ChatMessage[]) => invoke<string>("chat_send", { history }),
  /** 测试连接 with the URL/model currently in the form and the key from the keychain. */
  chatTest: (endpoint: string, model: string) => invoke<string>("chat_test", { endpoint, model }),

  // phase 2: voice (macOS native STT + `say`; see lib/voice.ts for the browser fallback)
  voiceStatus: () => invoke<VoiceStatus>("voice_status"),
  voicePttStart: (history?: ChatMessage[]) => invoke<VoiceStatus>("voice_ptt_start", history ? { history } : {}),
  voicePttStop: () => invoke<VoiceStatus>("voice_ptt_stop"),
  voiceSetLive: (enabled: boolean, history?: ChatMessage[]) =>
    invoke<VoiceStatus>("voice_set_live", history ? { enabled, history } : { enabled }),
  voiceStop: () => invoke<VoiceStatus>("voice_stop"),
  voiceStopSpeaking: () => invoke<VoiceStatus>("voice_stop_speaking"),
  voiceSpeak: (text: string) => invoke<null>("voice_speak", { text }),
  voiceListVoices: () => invoke<VoiceInfo[]>("voice_list_voices"),
  // phase 2: activity + display mode
  getActivity: () => invoke<ActivitySnapshot>("get_activity"),
  setDisplayMode: (mode: DisplayMode) => invoke<AppSettings>("set_display_mode", { mode }),
  // 屏保模式 (full-screen, look-only window at #/screensaver)
  startScreensaver: () => invoke<void>("start_screensaver"),
  exitScreensaver: () => invoke<void>("exit_screensaver"),

  // 便签
  listNotes: () => invoke<Note[]>("list_notes"),
  createNote: (input: NoteInput, popOut = false) => invoke<Note>("create_note", { input, popOut }),
  updateNote: (id: string, patch: NotePatch) => invoke<Note>("update_note", { id, patch }),
  /** Returns the deleted note so the UI can offer 「撤销」 (restoreNote). */
  deleteNote: (id: string) => invoke<Note>("delete_note", { id }),
  restoreNote: (note: Note) => invoke<Note>("restore_note", { note }),
  popOutNote: (id: string) => invoke<void>("pop_out_note", { id }),
  closeNoteWindow: (id: string) => invoke<void>("close_note_window", { id }),
  /** 「记一下…」: creates a note (with a reminder when a time is named); null when the text is not a note request. */
  noteFromText: (text: string) => invoke<Note | null>("note_from_text", { text, tzOffsetMin: -new Date().getTimezoneOffset() }),
  newQuickNote: () => invoke<void>("new_quick_note_cmd"),

  // 桌面 widgets
  listDesktopFolders: () => invoke<DesktopFolder[]>("list_desktop_folders"),
  openDesktopFolder: (path: string) => invoke<void>("open_desktop_folder", { path }),
  /** No path = native folder picker. */
  addDesktopFolder: (path?: string) => invoke<DesktopFolder[]>("add_desktop_folder", { path: path ?? null }),
  removeDesktopFolder: (path: string) => invoke<DesktopFolder[]>("remove_desktop_folder", { path }),
  getWeather: () => invoke<Weather | null>("get_weather"),
  getSystemStats: () => invoke<SystemStats>("get_system_stats"),
};

/** Current webview window helpers (floating notes resize themselves; macOS has no native edge resize for borderless windows). */
export async function setCurrentWindowSize(w: number, h: number): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setSize(new LogicalSize(w, h));
}

export async function currentWindowLogicalSize(): Promise<{ w: number; h: number }> {
  if (!isTauri()) return { w: window.innerWidth, h: window.innerHeight };
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const [size, sf] = await Promise.all([win.innerSize(), win.scaleFactor()]);
  return { w: size.width / sf, h: size.height / sf };
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
