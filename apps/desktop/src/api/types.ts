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
  chatEndpoint: string;
  chatModel: string;
}

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
  chatEndpoint: "https://api.openai.com/v1",
  chatModel: "gpt-4o-mini",
};

export type { PersonaMemory, InteractionKind } from "@desktop-pet/shared";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
