/**
 * Long-term memory shape (stored locally in SQLite by the Rust side, see
 * pet-core/src/persona.rs). Derived ONLY from app usage (interactions with the
 * pet, which launcher sites were opened, when the app is used) — never page content.
 */
import type { Emotion } from "./emotion";

export interface PersonaMemory {
  /** 好感度 0..100 */
  affinity: number;
  /** 熟悉度 0..100 */
  familiarity: number;
  todayMood: Emotion;
  /** YYYY-MM-DD (local) of `todayMood` / daily counters */
  today: string;
  lastInteractionAt: number | null;
  streakDays: number;
  lastActiveDay: string | null;
  /** 24 buckets: interactions per local hour */
  activeHours: number[];
  /** siteId -> launches */
  siteUsage: Record<string, number>;
  lateNightCount: number;
  patsToday: number;
  interactionsToday: number;
  totalInteractions: number;
}

export type InteractionKind = "click" | "pat" | "drag" | "chat" | "launch_site" | "task_completed" | "ignored" | "open";

/** Meal reminder windows (local time, minutes since midnight). */
export const MEAL_WINDOWS = [
  { id: "breakfast", from: 7 * 60 + 30, to: 8 * 60 + 30 },
  { id: "lunch", from: 11 * 60 + 45, to: 12 * 60 + 45 },
  { id: "dinner", from: 17 * 60 + 45, to: 18 * 60 + 45 },
] as const;

export function mealWindowAt(date: Date): string | null {
  const m = date.getHours() * 60 + date.getMinutes();
  return MEAL_WINDOWS.find((w) => m >= w.from && m < w.to)?.id ?? null;
}

export function localDay(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function affinityLabel(a: number): string {
  if (a >= 80) return "非常亲密";
  if (a >= 60) return "喜欢";
  if (a >= 40) return "友好";
  if (a >= 20) return "普通";
  return "警惕";
}

export function familiarityLabel(f: number): string {
  if (f >= 60) return "黏人";
  if (f >= 20) return "熟悉";
  return "生疏";
}
