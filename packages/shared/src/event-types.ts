/**
 * Wire protocol between the Chrome extension and the desktop app's local server.
 *
 * Transport: HTTP POST http://127.0.0.1:<port>/v1/events
 *   Authorization: Bearer <session token>
 *   Origin: chrome-extension://<id>   (set automatically by Chrome)
 *   Body: JSON `ProtocolEnvelope`, max 16 KiB.
 *
 * PRIVACY: payloads carry only title, url and boolean/number "signals".
 * Never page body text, cookies, form values or passwords.
 */
import type { AdapterType, ObservedState } from "./task-types";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_BODY_BYTES = 16 * 1024;

export const MESSAGE_TYPES = [
  "monitor.connected",
  "monitor.disconnected",
  "monitor.heartbeat",
  "task.observed",
  "task.status_changed",
  "task.completed",
  "task.failed",
  "task.needs_attention",
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const TASK_MESSAGE_TYPES = [
  "task.observed",
  "task.status_changed",
  "task.completed",
  "task.failed",
  "task.needs_attention",
] as const;
export type TaskMessageType = (typeof TASK_MESSAGE_TYPES)[number];

/** For typed task messages the observed state is fixed. */
export const REQUIRED_OBSERVED: Partial<Record<MessageType, ObservedState>> = {
  "task.completed": "completed",
  "task.failed": "failed",
  "task.needs_attention": "needs_attention",
};

export interface MonitorConnectedPayload {
  extensionVersion: string;
  browser?: string;
}
export interface MonitorDisconnectedPayload {
  reason?: string;
}
export interface MonitorHeartbeatPayload {
  activeTabs: number;
}

export type SignalValue = boolean | number;

export interface TaskObservationPayload {
  /** Stable per-task key produced by the adapter. */
  taskKey: string;
  /** When the URL changes mid-task (e.g. ChatGPT "/" -> "/c/<id>"), the old key. */
  previousTaskKey?: string;
  adapter: AdapterType;
  url: string;
  title: string;
  observed: ObservedState;
  /** Only booleans / numbers. No strings => no page text can leak. */
  signals: Record<string, SignalValue>;
  /** Short machine-readable evidence codes, e.g. "stop_button_visible". */
  evidence: string[];
  confidence: number;
  visible: boolean;
  /** True when signals contradict each other (desktop resolves to `unknown`). */
  conflict?: boolean;
}

export type PayloadFor<T extends MessageType> = T extends "monitor.connected"
  ? MonitorConnectedPayload
  : T extends "monitor.disconnected"
    ? MonitorDisconnectedPayload
    : T extends "monitor.heartbeat"
      ? MonitorHeartbeatPayload
      : TaskObservationPayload;

export interface ProtocolEnvelope<T extends MessageType = MessageType> {
  v: typeof PROTOCOL_VERSION;
  /** Unique event id (dedupe key). 8–64 chars of [A-Za-z0-9_-]. */
  id: string;
  type: T;
  /** Sender timestamp, ms since epoch. */
  ts: number;
  /** Random id of the extension installation/session. */
  clientId: string;
  payload: PayloadFor<T>;
}

/** Server response body. */
export interface ServerAck {
  ok: boolean;
  /** "accepted" | "duplicate" | "ignored" */
  result?: string;
  error?: string;
}

/** Site list returned by GET /v1/sites (only monitor-enabled sites). */
export interface MonitoredSiteInfo {
  id: string;
  name: string;
  url: string;
  origin: string;
  adapterType: AdapterType;
}

export function observedToMessageType(observed: ObservedState, conflict: boolean): TaskMessageType {
  switch (observed) {
    case "completed":
      return "task.completed";
    case "failed":
      return "task.failed";
    case "needs_attention":
      return "task.needs_attention";
    case "running":
      return "task.status_changed";
    case "unknown":
      return conflict ? "task.status_changed" : "task.observed";
  }
}
