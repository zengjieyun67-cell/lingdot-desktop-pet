/**
 * Core domain types shared by the desktop app (frontend) and the browser extension.
 * The Rust side (apps/desktop/src-tauri/pet-core/src/model.rs) mirrors these with
 * `#[serde(rename_all = "camelCase")]`, so field names here are the wire format.
 */

export const TASK_STATUSES = [
  "pending",
  "running",
  "completed",
  "needs_attention",
  "failed",
  "unknown",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** States a page adapter may *observe*. `pending` is desktop-only (never observed). */
export const OBSERVED_STATES = ["running", "completed", "failed", "needs_attention", "unknown"] as const;
export type ObservedState = (typeof OBSERVED_STATES)[number];

export const ADAPTER_TYPES = ["generic", "chatgpt", "hark", "bilibili", "capcut"] as const;
export type AdapterType = (typeof ADAPTER_TYPES)[number];

export const DETECTION_SOURCES = ["manual", "extension", "timeout", "system"] as const;
export type DetectionSource = (typeof DETECTION_SOURCES)[number];

export interface Site {
  id: string;
  name: string;
  url: string;
  /** Emoji, `data:image/...` URL, or https favicon URL. */
  icon: string;
  sortOrder: number;
  enabled: boolean;
  monitorEnabled: boolean;
  adapterType: AdapterType;
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: string;
  title: string;
  siteId: string | null;
  url: string;
  status: TaskStatus;
  /** Stable key from the adapter (e.g. `chatgpt:c:<conversationId>`). null for manual tasks. */
  externalKey: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  lastObservedAt: number | null;
  /**
   * Classifier confidence 0..1 for the *current status*, NOT progress.
   * UI must never render this as a percentage progress bar.
   */
  confidence: number;
  notificationSent: boolean;
  detectionSource: DetectionSource;
  activeRunNo: number | null;
  runCount: number;
}

export interface TaskRun {
  id: string;
  taskId: string;
  runNo: number;
  status: TaskStatus;
  startedAt: number;
  endedAt: number | null;
  endReason: string | null;
}

export interface TaskEvent {
  id: number;
  taskId: string;
  runNo: number | null;
  eventId: string | null;
  kind: string;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  evidence: string[];
  source: DetectionSource;
  createdAt: number;
}

export interface TaskDetail {
  task: Task;
  runs: TaskRun[];
  events: TaskEvent[];
}

export type NotificationKind = "completed" | "failed" | "needs_attention" | "connection_lost";

export interface NotificationRecord {
  id: string;
  taskId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  url: string | null;
  createdAt: number;
  read: boolean;
}

/** Aggregated pet mood shown by the desktop pet. */
export type PetMood = "idle" | "working" | "completed" | "needs_attention";

export function isTerminal(status: TaskStatus): boolean {
  return status === "completed" || status === "failed";
}

export const STATUS_LABEL_ZH: Record<TaskStatus, string> = {
  pending: "待开始",
  running: "进行中",
  completed: "已完成",
  needs_attention: "需要处理",
  failed: "失败",
  unknown: "状态未知",
};
