/**
 * PersonaController: glue between 小喵's pure persona modules (packages/shared/persona)
 * and the pet window. Owns the emotion state, line history, reminder cooldowns.
 * Clock is injectable so the scheduling rules are unit-testable.
 */
import {
  fillLine,
  initialEmotion,
  isLateNight,
  localDay,
  mealWindowAt,
  nextEmotion,
  pickLine,
  type Emotion,
  type EmotionInput,
  type EmotionState,
  type LineContext,
  type PersonaTrigger,
} from "@desktop-pet/shared";

export interface PersonaSettings {
  petName: string;
  userTitle: string;
  personaBubbles: boolean;
  mealReminders: boolean;
  lateNightReminders: boolean;
}

export interface Spoken {
  trigger: PersonaTrigger;
  emotion: Emotion;
  /** null when bubbles are off or nothing fits. */
  text: string | null;
}

export const IGNORED_AFTER_MS = 45 * 60_000;
export const IGNORED_COOLDOWN_MS = 2 * 3600_000;
export const LATE_NIGHT_COOLDOWN_MS = 60 * 60_000;
export const MANY_TASKS_COOLDOWN_MS = 10 * 60_000;
export const MANY_TASKS_THRESHOLD = 3;
export const RETURN_AFTER_MS = 6 * 3600_000;
/** Minimum gap between chatty (non-event) lines so she isn't annoying. */
export const CHATTER_GAP_MS = 8_000;

export class PersonaController {
  emotionState: EmotionState;
  private recent: string[] = [];
  private lastInteractionAt: number;
  private lastIgnoredAt = -Infinity;
  private lastLateNightAt = -Infinity;
  private lastManyTasksAt = -Infinity;
  private lastChatterAt = -Infinity;
  private mealsDone = new Set<string>();

  constructor(
    public settings: PersonaSettings,
    public affinity = 30,
    public familiarity = 0,
    private readonly clock: () => Date = () => new Date(),
    private readonly rand: () => number = Math.random,
  ) {
    const now = this.clock().getTime();
    this.emotionState = initialEmotion(now);
    this.lastInteractionAt = now;
  }

  get emotion(): Emotion {
    return this.emotionState.emotion;
  }

  private ctx() {
    const d = this.clock();
    return { now: d.getTime(), hour: d.getHours(), affinity: this.affinity };
  }

  /** Feed an input into the emotion machine without speaking. */
  feel(input: EmotionInput): Emotion {
    this.emotionState = nextEmotion(this.emotionState, input, this.ctx());
    return this.emotion;
  }

  /** Update emotion and pick an in-character line for `trigger`. */
  say(trigger: PersonaTrigger, lineCtx: Omit<LineContext, "name" | "user"> = {}, chatter = false): Spoken {
    const emotion = this.feel(trigger);
    const now = this.clock().getTime();
    if (!this.settings.personaBubbles) return { trigger, emotion, text: null };
    if (chatter && now - this.lastChatterAt < CHATTER_GAP_MS) return { trigger, emotion, text: null };
    const raw = pickLine(trigger, emotion, this.familiarity, this.recent, this.rand);
    if (!raw) return { trigger, emotion, text: null };
    this.recent = [...this.recent, raw].slice(-12);
    if (chatter) this.lastChatterAt = now;
    return { trigger, emotion, text: fillLine(raw, { ...lineCtx, name: this.settings.petName, user: this.settings.userTitle }) };
  }

  /** Startup line: greeting, or "welcome back" after a long absence. */
  greet(lastInteractionAt: number | null): Spoken {
    const now = this.clock().getTime();
    const away = lastInteractionAt !== null && now - lastInteractionAt > RETURN_AFTER_MS;
    return this.say(away ? "returned" : "greeting");
  }

  /** Any direct interaction (click / drag / pat / chat) resets the "ignored" timer. */
  touch(): void {
    this.lastInteractionAt = this.clock().getTime();
  }

  /** Report the number of running tasks; speaks at most once per cooldown. */
  runningTasks(count: number): Spoken | null {
    const now = this.clock().getTime();
    if (count < MANY_TASKS_THRESHOLD || now - this.lastManyTasksAt < MANY_TASKS_COOLDOWN_MS) return null;
    this.lastManyTasksAt = now;
    return this.say("many_tasks");
  }

  /**
   * Periodic check (call ~every 30s). Returns at most one scheduled line:
   * late-night rest reminder > meal reminder > "you ignored me".
   */
  tick(): Spoken | null {
    this.feel("tick");
    const d = this.clock();
    const now = d.getTime();
    if (this.settings.lateNightReminders && isLateNight(d.getHours()) && now - this.lastLateNightAt >= LATE_NIGHT_COOLDOWN_MS) {
      this.lastLateNightAt = now;
      return this.say("late_night");
    }
    const meal = this.settings.mealReminders ? mealWindowAt(d) : null;
    if (meal) {
      const key = `${localDay(d)}:${meal}`;
      if (!this.mealsDone.has(key)) {
        this.mealsDone.add(key);
        return this.say("meal_time");
      }
    }
    if (now - this.lastInteractionAt >= IGNORED_AFTER_MS && now - this.lastIgnoredAt >= IGNORED_COOLDOWN_MS) {
      this.lastIgnoredAt = now;
      return this.say("ignored");
    }
    return null;
  }
}

/** Detects a "head pat": the cursor rubbing back and forth over the head area. */
export class PatDetector {
  private lastX: number | null = null;
  private lastDir = 0;
  private turns: number[] = [];

  constructor(
    private readonly windowMs = 1200,
    private readonly turnsNeeded = 3,
    private readonly minStep = 3,
  ) {}

  /** Feed a cursor x position (only while over the head). Returns true when a pat is detected. */
  feed(x: number, now: number): boolean {
    if (this.lastX === null) {
      this.lastX = x;
      return false;
    }
    const dx = x - this.lastX;
    if (Math.abs(dx) < this.minStep) return false;
    const dir = Math.sign(dx);
    this.lastX = x;
    if (this.lastDir !== 0 && dir !== this.lastDir) {
      this.turns = [...this.turns.filter((t) => now - t < this.windowMs), now];
    }
    this.lastDir = dir;
    if (this.turns.length >= this.turnsNeeded) {
      this.turns = [];
      return true;
    }
    return false;
  }

  reset(): void {
    this.lastX = null;
    this.lastDir = 0;
    this.turns = [];
  }
}
