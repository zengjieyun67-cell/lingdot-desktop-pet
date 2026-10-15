/**
 * 小喵 display-state registry (phase 2).
 *
 * The pet shows exactly one "display state" at a time. Task moods (from the
 * Rust state machine) and ambient activities (music / idle stretch / nap)
 * compete by priority; higher wins, ties go to the task mood.
 *
 *   needs_attention 100 > completed 90 > working 80 >
 *   listening_music 60 > stretching 50 > napping 40 > idle 0
 */
export const DISPLAY_STATES = [
  "idle",
  "working",
  "completed",
  "needs_attention",
  "listening_music",
  "stretching",
  "napping",
] as const;
export type DisplayState = (typeof DISPLAY_STATES)[number];

export type MoodState = "idle" | "working" | "completed" | "needs_attention";
export type ActivityKind = "none" | "listening_music" | "stretching" | "napping";

export interface DisplayStateInfo {
  id: DisplayState;
  priority: number;
  /** Where the state comes from. */
  source: "mood" | "activity";
  /** Short Chinese label for UI (panel header, desktop scene). */
  label: string;
  /** Badge emoji used over Live2D models / in compact UI. */
  badge: string | null;
  /** Live2D motion groups tried in order (case-insensitive). */
  live2dMotions: string[];
}

export const STATE_REGISTRY: Record<DisplayState, DisplayStateInfo> = {
  needs_attention: { id: "needs_attention", priority: 100, source: "mood", label: "有任务等你处理", badge: "❗", live2dMotions: ["Alert", "Surprised", "Shake"] },
  completed: { id: "completed", priority: 90, source: "mood", label: "任务完成啦", badge: "💖", live2dMotions: ["Happy", "Joy", "TapHead"] },
  working: { id: "working", priority: 80, source: "mood", label: "帮你盯着任务", badge: "✨", live2dMotions: ["Working", "Work", "TapBody"] },
  listening_music: { id: "listening_music", priority: 60, source: "activity", label: "一起听歌中", badge: "♪", live2dMotions: ["Music", "Dance", "Happy", "happy"] },
  stretching: { id: "stretching", priority: 50, source: "activity", label: "伸懒腰～", badge: "🙆", live2dMotions: ["Stretch", "Idle"] },
  napping: { id: "napping", priority: 40, source: "activity", label: "打盹中 zZ", badge: "💤", live2dMotions: ["Sleep", "Sleepy", "Idle"] },
  idle: { id: "idle", priority: 0, source: "mood", label: "悠闲地晒太阳", badge: null, live2dMotions: ["Idle"] },
};

export function statePriority(s: DisplayState): number {
  return STATE_REGISTRY[s].priority;
}

/** Map an activity kind to its display state (none -> idle). */
export function activityState(kind: ActivityKind): DisplayState {
  return kind === "none" ? "idle" : kind;
}

/**
 * Resolve what the pet should show. Higher priority wins; on a tie the task
 * mood wins. When `idleStates` is false, stretching / napping are ignored;
 * when `music` is false, listening_music is ignored.
 */
export function resolveDisplayState(
  mood: MoodState,
  activity: ActivityKind,
  opts: { idleStates?: boolean; music?: boolean } = {},
): DisplayState {
  let act: ActivityKind = activity;
  if (opts.idleStates === false && (act === "stretching" || act === "napping")) act = "none";
  if (opts.music === false && act === "listening_music") act = "none";
  const a = activityState(act);
  return statePriority(a) > statePriority(mood) ? a : mood;
}
