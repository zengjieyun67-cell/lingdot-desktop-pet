/**
 * 小喵's emotion state machine (pure, unit-tested).
 *
 * Emotions: neutral | happy | shy | angry (sulky, cat-like) | sleepy
 * Inputs : interaction / task / connection / time triggers, local hour, affinity (0..100).
 * Output : next emotion + when it started (non-neutral emotions decay back on `tick`).
 *
 * This only drives facial expression and line choice — it never changes task state.
 */
export const EMOTIONS = ["neutral", "happy", "shy", "angry", "sleepy"] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const PERSONA_TRIGGERS = [
  "greeting", // app start
  "returned", // user came back after an absence
  "task_completed",
  "task_failed",
  "needs_attention",
  "disconnected",
  "reconnected",
  "clicked",
  "dragged",
  "pat", // rubbing the head
  "ignored", // long time without interaction
  "late_night", // 23:00–05:00 rest reminder
  "meal_time",
  "many_tasks",
] as const;
export type PersonaTrigger = (typeof PERSONA_TRIGGERS)[number];

export type EmotionInput = PersonaTrigger | "tick";

export interface EmotionState {
  emotion: Emotion;
  since: number;
  /** Recent interaction timestamps used for "too many clicks" / "lots of pats". */
  recentClicks: number[];
  recentPats: number[];
}

export interface EmotionContext {
  now: number;
  /** Local hour 0..23. */
  hour: number;
  /** 0..100 */
  affinity: number;
}

/** How long a non-neutral emotion lasts before `tick` relaxes it (ms). */
export const EMOTION_DURATION: Record<Emotion, number> = {
  neutral: Infinity,
  happy: 60_000,
  shy: 30_000,
  angry: 90_000,
  sleepy: 120_000,
};

const BURST_WINDOW = 10_000;

export function isLateNight(hour: number): boolean {
  return hour >= 23 || hour < 5;
}

export function initialEmotion(now = 0): EmotionState {
  return { emotion: "neutral", since: now, recentClicks: [], recentPats: [] };
}

function set(s: EmotionState, emotion: Emotion, now: number): EmotionState {
  return { ...s, emotion, since: s.emotion === emotion ? s.since : now };
}

export function nextEmotion(prev: EmotionState, input: EmotionInput, ctx: EmotionContext): EmotionState {
  const { now, hour, affinity } = ctx;
  const s: EmotionState = {
    ...prev,
    recentClicks: prev.recentClicks.filter((t) => now - t < BURST_WINDOW),
    recentPats: prev.recentPats.filter((t) => now - t < BURST_WINDOW),
  };
  const late = isLateNight(hour);

  switch (input) {
    case "tick": {
      const age = now - s.since;
      if (s.emotion === "sleepy") {
        // stays sleepy for the whole late-night period
        return late || age < EMOTION_DURATION.sleepy ? s : set(s, "neutral", now);
      }
      if (s.emotion !== "neutral" && age >= EMOTION_DURATION[s.emotion]) {
        return set(s, late ? "sleepy" : "neutral", now);
      }
      if (s.emotion === "neutral" && late && age >= 5 * 60_000) return set(s, "sleepy", now);
      return s;
    }
    case "greeting":
      if (late) return set(s, "sleepy", now);
      return set(s, affinity >= 50 ? "happy" : "neutral", now);
    case "returned":
      return set(s, affinity >= 50 ? "happy" : "shy", now);
    case "task_completed":
      return set(s, "happy", now);
    case "task_failed":
      return set(s, "angry", now); // sulking at the website, not at the user
    case "needs_attention":
      return set(s, "neutral", now);
    case "disconnected":
      return set(s, "angry", now);
    case "reconnected":
      return set(s, "happy", now);
    case "clicked": {
      const clicks = [...s.recentClicks, now];
      const next = { ...s, recentClicks: clicks };
      if (clicks.length >= 5) return set(next, "angry", now); // "别戳了！"
      if (s.emotion === "sleepy") return next; // sleepy cats stay sleepy
      return next;
    }
    case "dragged":
      return set(s, affinity >= 50 ? "shy" : "angry", now);
    case "pat": {
      const pats = [...s.recentPats, now];
      const next = { ...s, recentPats: pats };
      if (pats.length >= 3) return set(next, "happy", now); // 呼噜呼噜
      if (affinity < 25) return set(next, "angry", now); // "谁准你摸的！"（害羞的炸毛）
      return set(next, "shy", now);
    }
    case "ignored":
      return set(s, "angry", now);
    case "late_night":
      return set(s, "sleepy", now);
    case "meal_time":
      return s.emotion === "angry" ? s : set(s, "neutral", now);
    case "many_tasks":
      return s.emotion === "sleepy" ? s : set(s, "neutral", now);
  }
}

/** Which trigger a task notification kind maps to. */
export function triggerForNotification(kind: string): PersonaTrigger | null {
  switch (kind) {
    case "completed":
      return "task_completed";
    case "failed":
      return "task_failed";
    case "needs_attention":
      return "needs_attention";
    case "connection_lost":
      return "disconnected";
    default:
      return null;
  }
}

/**
 * Expression mapping for renderers. `svgClass` is a semantic name the SVG renderer
 * maps to CSS; Live2D lists are tried in order (first that exists in the model wins).
 */
export const EMOTION_EXPRESSIONS: Record<
  Emotion,
  { svg: { blush: boolean; puffedCheeks: boolean; halfEyes: boolean; ears: "up" | "down" | "back" | "normal"; mark?: "anger" | "zzz" | "heart" }; live2dExpressions: string[]; live2dMotions: string[] }
> = {
  neutral: { svg: { blush: false, puffedCheeks: false, halfEyes: false, ears: "normal" }, live2dExpressions: ["normal", "default", "f00"], live2dMotions: [] },
  happy: { svg: { blush: true, puffedCheeks: false, halfEyes: false, ears: "up", mark: "heart" }, live2dExpressions: ["happy", "smile", "joy", "f02"], live2dMotions: ["Happy", "TapHead"] },
  shy: { svg: { blush: true, puffedCheeks: false, halfEyes: false, ears: "down" }, live2dExpressions: ["shy", "blush", "embarrassed", "f04"], live2dMotions: ["Shy", "FlickDown"] },
  angry: { svg: { blush: true, puffedCheeks: true, halfEyes: false, ears: "back", mark: "anger" }, live2dExpressions: ["angry", "pout", "f03"], live2dMotions: ["Angry", "Shake"] },
  sleepy: { svg: { blush: false, puffedCheeks: false, halfEyes: true, ears: "down", mark: "zzz" }, live2dExpressions: ["sleepy", "tired", "eyes_closed", "f05"], live2dMotions: ["Sleepy", "Idle"] },
};
