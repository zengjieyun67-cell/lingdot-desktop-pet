/**
 * Touch / drag reactions: which short line 小喵 says (bubble, always) and whether she also
 * says it out loud (occasionally, via macOS `say`). Pure + injectable clock/random → unit tested.
 *
 * Rules
 *  - kinds: head_pat · body_poke · rub (repeated stroking) · long_touch · drag_start · drop · shake
 *  - lines vary by emotion, affection tier and time of day (late night = sleepy)
 *  - never the same line twice in a row; every line ≤ 8 characters
 *  - voice: at most one line every VOICE_MIN_GAP_MS, only after ≥ 2 silent interactions,
 *    ~40% chance, guaranteed by the 4th — so roughly every 2–4 interactions
 */
import type { Emotion } from "@desktop-pet/shared";

export type TouchKind = "head_pat" | "body_poke" | "rub" | "long_touch" | "drag_start" | "drop" | "shake";
export type Tier = "low" | "mid" | "high";

export const MAX_LINE_CHARS = 8;
export const VOICE_MIN_GAP_MS = 7_000;
export const VOICE_CHANCE = 0.4;
export const VOICE_MIN_SILENT = 2;
export const VOICE_FORCE_AFTER = 4;

type LineSet = Partial<Record<Tier | "night" | Emotion, string[]>> & { mid: string[] };

export const TOUCH_LINES: Record<TouchKind, LineSet> = {
  head_pat: {
    low: ["干、干嘛啦", "别乱摸喵", "哼…勉强让你摸"],
    mid: ["嗯…再摸一下", "喵～舒服", "头发要乱啦", "好吧…就一下"],
    high: ["最喜欢主人了", "再多摸摸嘛", "喵呜～好幸福"],
    night: ["好困…再摸摸", "要睡着了喵"],
    angry: ["哼，别想收买我", "才不消气呢"],
    shy: ["脸…脸红了啦", "被看到啦…"],
  },
  body_poke: {
    low: ["戳什么戳！", "再戳咬你哦", "喵！"],
    mid: ["干嘛戳我～", "痒痒的喵", "有事找我吗？", "嗯？叫我？"],
    high: ["主人找我呀？", "嘿嘿，在呢～", "陪我玩嘛"],
    night: ["嗯…还不睡？", "困困…"],
    angry: ["不理你了！", "哼！"],
  },
  rub: {
    low: ["够、够了吧", "毛都炸了！"],
    mid: ["呼噜呼噜…", "喵～不要停", "好舒服喵"],
    high: ["呼噜噜～最爱", "要融化了喵", "再一会儿嘛"],
    night: ["呼…要睡了", "zzz…再摸"],
  },
  long_touch: {
    low: ["按着我干嘛", "放手啦！"],
    mid: ["嗯？怎么了", "一直按着…", "我在听哦"],
    high: ["想抱抱吗？", "我陪着你～"],
    night: ["陪你熬夜喵", "该睡觉啦"],
  },
  drag_start: {
    low: ["别拽啦！", "放开我喵！"],
    mid: ["要去哪儿呀", "呀，飞起来了", "慢点慢点！"],
    high: ["带我去玩吗？", "抱稳哦～"],
    night: ["困…别晃我", "要去哪儿…"],
    angry: ["别碰我！", "哼，放开！"],
  },
  drop: {
    low: ["哼，总算放下", "摔疼了啦"],
    mid: ["这里不错喵", "落地成功！", "新家耶～"],
    high: ["谢谢主人～", "这里看得到你"],
    night: ["就睡这吧…"],
  },
  shake: {
    low: ["晕了晕了！", "别晃啦！"],
    mid: ["头好晕喵～", "放我下来喵", "别甩我呀！"],
    high: ["好晕…抱紧我", "呜哇～慢点"],
    night: ["呜…要吐了", "别晃…困"],
    angry: ["再晃生气了！"],
  },
};

/** Live2D motion groups / expressions tried per kind (first existing name wins). */
export const TOUCH_MOTIONS: Record<TouchKind, { motions: string[]; expressions: string[] }> = {
  head_pat: { motions: ["TapHead", "tap_head", "Pat", "Happy", "Tap"], expressions: ["happy", "smile", "shy", "f02", "F02"] },
  body_poke: { motions: ["TapBody", "tap_body", "Poke", "Tap", "Flick"], expressions: ["surprised", "f03", "F03"] },
  rub: { motions: ["Pat", "TapHead", "Happy", "Idle"], expressions: ["shy", "blush", "happy", "f04", "F04"] },
  long_touch: { motions: ["Hold", "TapBody", "Tap"], expressions: ["shy", "normal", "f01", "F01"] },
  drag_start: { motions: ["Drag", "Surprised", "FlickUp", "Flick", "Shake"], expressions: ["surprised", "angry", "f03", "F03"] },
  drop: { motions: ["Landing", "FlickDown", "TapBody", "Idle"], expressions: ["normal", "default", "f01", "F01"] },
  shake: { motions: ["Shake", "Dizzy", "Flick", "FlickDown"], expressions: ["dizzy", "angry", "sad", "f05", "F05"] },
};

export function affinityTier(affinity: number): Tier {
  return affinity < 25 ? "low" : affinity >= 70 ? "high" : "mid";
}

export function isNightHour(h: number): boolean {
  return h >= 23 || h < 5;
}

export interface TouchContext {
  affinity: number;
  hour: number;
  emotion: Emotion;
}

/** Candidate lines for a context: emotion-specific > night > affection tier (always non-empty). */
export function candidateLines(kind: TouchKind, c: TouchContext): string[] {
  const set = TOUCH_LINES[kind];
  const emo = c.emotion !== "neutral" && c.emotion !== "happy" ? set[c.emotion] : undefined;
  if (emo?.length) return emo;
  if ((isNightHour(c.hour) || c.emotion === "sleepy") && set.night?.length) return set.night;
  return set[affinityTier(c.affinity)] ?? set.mid;
}

export interface TouchReaction {
  kind: TouchKind;
  /** Always set: the bubble shows even when she stays silent. */
  text: string;
  /** Also say it out loud. */
  speak: boolean;
}

export class TouchReactor {
  private last: string | null = null;
  private silent = 0;
  private lastVoiceAt = -Infinity;

  constructor(
    private readonly clock: () => number = () => Date.now(),
    private readonly rand: () => number = Math.random,
  ) {}

  /** Pick a line (never the previous one) and decide whether to voice it. */
  react(kind: TouchKind, c: TouchContext, voiceAllowed: boolean): TouchReaction {
    const pool = candidateLines(kind, c);
    const options = pool.length > 1 ? pool.filter((l) => l !== this.last) : pool;
    const text = options[Math.floor(this.rand() * options.length) % options.length]!;
    this.last = text;
    const now = this.clock();
    let speak = false;
    if (voiceAllowed && now - this.lastVoiceAt >= VOICE_MIN_GAP_MS) {
      this.silent += 1;
      speak = this.silent >= VOICE_FORCE_AFTER || (this.silent >= VOICE_MIN_SILENT && this.rand() < VOICE_CHANCE);
    } else if (voiceAllowed) {
      this.silent += 1;
    }
    if (speak) {
      this.silent = 0;
      this.lastVoiceAt = now;
    }
    return { kind, text, speak };
  }
}

/** Window shake while dragging: ≥ 3 horizontal direction reversals of ≥ 12px within 1s. */
export class ShakeDetector {
  private lastX: number | null = null;
  private dir = 0;
  private turns: number[] = [];

  constructor(
    private readonly windowMs = 1000,
    private readonly turnsNeeded = 3,
    private readonly minStep = 12,
  ) {}

  feed(x: number, now: number): boolean {
    if (this.lastX === null) {
      this.lastX = x;
      return false;
    }
    const dx = x - this.lastX;
    if (Math.abs(dx) < this.minStep) return false;
    this.lastX = x;
    const d = Math.sign(dx);
    if (this.dir !== 0 && d !== this.dir) this.turns = [...this.turns.filter((t) => now - t < this.windowMs), now];
    this.dir = d;
    if (this.turns.length >= this.turnsNeeded) {
      this.turns = [];
      return true;
    }
    return false;
  }

  reset(): void {
    this.lastX = null;
    this.dir = 0;
    this.turns = [];
  }
}

/** Head (upper ~42% of the character) vs body hit area, from a y offset inside the pet stage. */
export function hitArea(y: number, height: number): "head" | "body" {
  return y < height * 0.42 ? "head" : "body";
}
