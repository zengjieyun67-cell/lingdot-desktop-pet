/**
 * Task state machine (TypeScript mirror).
 *
 * AUTHORITY: the Rust implementation in
 *   apps/desktop/src-tauri/pet-core/src/state_machine.rs
 * is authoritative — it decides persisted task status and notifications.
 * This mirror exists so UI/extension code and tests can reason about the same
 * rules; both implementations are executed against the same vectors in
 * test-vectors/state-machine.json, so they cannot silently drift.
 *
 * Rules:
 *  - `running` only on an explicit execution signal.
 *  - `completed` only on an explicit success event AND an active run.
 *  - `failed` only on an explicit error event.
 *  - `needs_attention` on login / confirmation / authorization walls.
 *  - "no signal" (unknown without conflict) never changes status.
 *  - conflicting signals -> `unknown` (never completed/failed).
 *  - timeout while running -> `unknown` (never completed/failed).
 *  - duplicate event ids are ignored.
 *  - notifications are deduped by (task, run, status): fire once per run.
 *  - completed/failed -> running starts a NEW run.
 */
import type { ObservedState, TaskStatus } from "./task-types";

export type MachineEventKind = ObservedState | "timeout";

export interface MachineEvent {
  eventId: string;
  kind: MachineEventKind;
  conflict?: boolean;
}

export interface MachineState {
  status: TaskStatus;
  /** Run currently executing (null when no run is active). */
  activeRunNo: number | null;
  runCount: number;
  seenEventIds: string[];
  /** Keys `${runNo}:${status}` that already produced a notification. */
  notifiedKeys: string[];
}

export type RunAction = "none" | "start" | "end";
export type NotifyKind = "completed" | "failed" | "needs_attention";

export interface TransitionResult {
  state: MachineState;
  from: TaskStatus;
  to: TaskStatus;
  changed: boolean;
  ignored: boolean;
  reason: string;
  runAction: RunAction;
  /** Run number the event applied to (after a start, the new run). */
  runNo: number | null;
  notify: NotifyKind | null;
}

export const SEEN_EVENT_CAP = 256;

export function initialMachineState(status: TaskStatus = "pending"): MachineState {
  return { status, activeRunNo: null, runCount: 0, seenEventIds: [], notifiedKeys: [] };
}

export function notifyKey(runNo: number | null, kind: NotifyKind): string {
  return `${runNo ?? 0}:${kind}`;
}

export function applyEvent(prev: MachineState, ev: MachineEvent): TransitionResult {
  const from = prev.status;
  const keep = (state: MachineState, reason: string, ignored = false): TransitionResult => ({
    state,
    from,
    to: state.status,
    changed: false,
    ignored,
    reason,
    runAction: "none",
    runNo: state.activeRunNo,
    notify: null,
  });

  if (prev.seenEventIds.includes(ev.eventId)) {
    return keep(prev, "duplicate_event", true);
  }
  const seen = [...prev.seenEventIds, ev.eventId].slice(-SEEN_EVENT_CAP);
  const s: MachineState = { ...prev, seenEventIds: seen };

  const move = (
    to: TaskStatus,
    reason: string,
    runAction: RunAction,
    notifyKind: NotifyKind | null,
    patch: Partial<MachineState> = {},
  ): TransitionResult => {
    let next: MachineState = { ...s, ...patch, status: to };
    const runNo = runAction === "start" ? next.activeRunNo : s.activeRunNo;
    let notify: NotifyKind | null = null;
    if (notifyKind) {
      const key = notifyKey(runNo, notifyKind);
      if (!next.notifiedKeys.includes(key)) {
        notify = notifyKind;
        next = { ...next, notifiedKeys: [...next.notifiedKeys, key] };
      }
    }
    if (runAction === "end") next = { ...next, activeRunNo: null };
    return { state: next, from, to, changed: from !== to, ignored: false, reason, runAction, runNo, notify };
  };

  const startRun = (reason: string) =>
    move("running", reason, "start", null, { activeRunNo: s.runCount + 1, runCount: s.runCount + 1 });

  switch (ev.kind) {
    case "running": {
      if (s.status === "running") return keep(s, "already_running");
      if (s.status === "completed" || s.status === "failed") return startRun("new_run_after_terminal");
      if (s.activeRunNo === null) return startRun("run_started");
      return move("running", "run_resumed", "none", null);
    }
    case "completed": {
      if (s.status === "completed") return keep(s, "already_completed");
      if (s.activeRunNo === null) return keep(s, "completed_without_active_run", true);
      return move("completed", "explicit_success", "end", "completed");
    }
    case "failed": {
      if (s.status === "failed") return keep(s, "already_failed");
      if (s.status === "completed") return keep(s, "terminal_completed", true);
      return move("failed", "explicit_error", s.activeRunNo === null ? "none" : "end", "failed");
    }
    case "needs_attention": {
      if (s.status === "needs_attention") return keep(s, "already_needs_attention");
      if (s.status === "completed") return keep(s, "terminal_completed", true);
      return move("needs_attention", "attention_required", "none", "needs_attention");
    }
    case "unknown": {
      if (!ev.conflict) return keep(s, "no_signal");
      if (s.status === "completed" || s.status === "failed") return keep(s, "conflict_after_terminal", true);
      if (s.status === "unknown") return keep(s, "already_unknown");
      return move("unknown", "conflicting_signals", "none", null);
    }
    case "timeout": {
      if (s.status !== "running") return keep(s, "timeout_not_running", true);
      return move("unknown", "observation_timeout", "none", null);
    }
  }
}

/** Convenience: fold a sequence of events. */
export function applyEvents(state: MachineState, events: MachineEvent[]): TransitionResult[] {
  const out: TransitionResult[] = [];
  let cur = state;
  for (const ev of events) {
    const r = applyEvent(cur, ev);
    out.push(r);
    cur = r.state;
  }
  return out;
}
