export type {
  Site,
  Task,
  TaskRun,
  TaskEvent,
  TaskDetail,
  TaskStatus,
  NotificationRecord,
  PetMood,
  AdapterType,
} from "@desktop-pet/shared";
import type { AdapterType, TaskStatus, PetMood } from "@desktop-pet/shared";

/** Mirrors pet-core `AppSettings` (camelCase). */
export interface AppSettings {
  petVisible: boolean;
  animationsEnabled: boolean;
  petScale: number;
  rendererMode: "auto" | "svg" | "live2d";
  live2dModelPath: string;
  live2dCorePath: string;
  monitorEnabled: boolean;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  autostart: boolean;
  launchMode: "default" | "app";
  launchBrowserApp: string;
  serverPort: number;
  allowedExtensionId: string;
  rotateTokenOnStartup: boolean;
  firstRunDone: boolean;
  petPosition: { x: number; y: number } | null;
  runningTimeoutSecs: number;
  heartbeatTimeoutSecs: number;
  // 小喵 persona
  petName: string;
  /** 称呼 — how 小喵 addresses the user */
  userTitle: string;
  personaBubbles: boolean;
  memoryEnabled: boolean;
  mealReminders: boolean;
  lateNightReminders: boolean;
  chatEnabled: boolean;
  /** UI preset: deepseek | custom */
  chatProvider: "deepseek" | "custom";
  chatEndpoint: string;
  chatModel: string;
  /** Where the user last dragged the panel (physical px); null = beside the pet. */
  panelPosition: { x: number; y: number } | null;
  // phase 2: voice
  voiceEnabled: boolean;
  /** `say` voice name; "" = auto */
  voiceName: string;
  voiceRate: number;
  voiceSilenceMs: number;
  voiceReadReplies: boolean;
  voiceOnDevice: boolean;
  voiceBargeIn: boolean;
  // phase 2: activity
  musicDetection: boolean;
  musicIncludeBrowsers: boolean;
  idleStates: boolean;
  // phase 2: display mode
  displayMode: DisplayMode;
  desktopInteractive: boolean;
}

export type DisplayMode = "pet" | "desktop";

export interface SiteInput {
  name: string;
  url: string;
  icon: string;
  enabled: boolean;
  monitorEnabled: boolean;
  adapterType: AdapterType;
}

export interface TaskInput {
  title: string;
  siteId: string | null;
  url: string;
  status?: TaskStatus | null;
}

export interface TaskFilter {
  siteId?: string | null;
  status?: TaskStatus | null;
  limit?: number;
}

export interface ConnectionStatus {
  connected: boolean;
  clientId: string | null;
  extensionVersion: string | null;
  lastHeartbeatAt: number | null;
  connectedAt: number | null;
}

export interface ConnectionInfo {
  status: ConnectionStatus;
  port: number;
  token: string;
  allowedExtensionId: string;
  serverError: string | null;
}

export interface Bootstrap {
  settings: AppSettings;
  mood: PetMood;
  connection: ConnectionInfo;
  platform: string;
}

export interface NotificationEventPayload {
  record: import("@desktop-pet/shared").NotificationRecord;
  sound: boolean;
  test?: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  petVisible: true,
  animationsEnabled: true,
  petScale: 1,
  rendererMode: "auto",
  live2dModelPath: "",
  live2dCorePath: "",
  monitorEnabled: true,
  notificationsEnabled: true,
  soundEnabled: true,
  autostart: false,
  launchMode: "default",
  launchBrowserApp: "Google Chrome",
  serverPort: 17321,
  allowedExtensionId: "",
  rotateTokenOnStartup: false,
  firstRunDone: false,
  petPosition: null,
  runningTimeoutSecs: 600,
  heartbeatTimeoutSecs: 75,
  petName: "小喵",
  userTitle: "主人",
  personaBubbles: true,
  memoryEnabled: true,
  mealReminders: true,
  lateNightReminders: true,
  chatEnabled: false,
  chatProvider: "deepseek",
  chatEndpoint: "https://api.deepseek.com",
  chatModel: "deepseek-flash",
  panelPosition: null,
  voiceEnabled: false,
  voiceName: "",
  voiceRate: 1.1,
  voiceSilenceMs: 1200,
  voiceReadReplies: false,
  voiceOnDevice: true,
  voiceBargeIn: true,
  musicDetection: true,
  musicIncludeBrowsers: false,
  idleStates: true,
  displayMode: "pet",
  desktopInteractive: false,
};

export type { PersonaMemory, InteractionKind } from "@desktop-pet/shared";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ---- phase 2 ----

export type VoiceMode = "off" | "push_to_talk" | "live";
export type VoicePhase = "idle" | "listening" | "thinking" | "speaking";
export type VoicePermission = "authorized" | "denied" | "restricted" | "not_determined" | "unsupported";

export interface VoiceStatus {
  mode: VoiceMode;
  phase: VoicePhase;
  /** live transcript of what the user says */
  transcript: string;
  /** what 小喵 is currently saying */
  speaking: string;
  error: string | null;
  sttSupported: boolean;
  ttsSupported: boolean;
  permission: VoicePermission;
}

export const IDLE_VOICE: VoiceStatus = {
  mode: "off", phase: "idle", transcript: "", speaking: "", error: null,
  sttSupported: false, ttsSupported: false, permission: "unsupported",
};

export interface VoiceInfo {
  name: string;
  locale: string;
  sample: string;
}

export interface MusicInfo {
  appId: string;
  app: string;
  title: string | null;
  artist: string | null;
}

export type ActivityKind = "none" | "listening_music" | "stretching" | "napping";

export interface ActivitySnapshot {
  kind: ActivityKind;
  music: MusicInfo | null;
  idleSecs: number;
}

export type ActivityEvent =
  | { type: "music_started"; app: string; title: string | null }
  | { type: "track_changed"; app: string; title: string | null }
  | { type: "music_stopped" }
  | { type: "nap_started" }
  | { type: "woke" };

export type VoiceTurn = ChatMessage;
