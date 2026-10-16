import { describe, expect, it } from "vitest";
import {
  affinityTier,
  candidateLines,
  hitArea,
  MAX_LINE_CHARS,
  ShakeDetector,
  TOUCH_LINES,
  TouchReactor,
  VOICE_MIN_GAP_MS,
  type TouchKind,
} from "./touchReactions";

const ctx = { affinity: 50, hour: 14, emotion: "neutral" as const };
const seq = (vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length]!;
};

describe("touch reaction lines", () => {
  it("every line is short (≤ 8 chars) and every kind has mid lines", () => {
    for (const [kind, set] of Object.entries(TOUCH_LINES)) {
      expect(set.mid.length, kind).toBeGreaterThan(1);
      for (const lines of Object.values(set)) for (const l of lines!) expect([...l].length, l).toBeLessThanOrEqual(MAX_LINE_CHARS);
    }
  });
  it("varies by affection, time of day and emotion", () => {
    expect(affinityTier(10)).toBe("low");
    expect(affinityTier(50)).toBe("mid");
    expect(affinityTier(90)).toBe("high");
    expect(candidateLines("head_pat", { ...ctx, affinity: 90 })).toBe(TOUCH_LINES.head_pat.high);
    expect(candidateLines("head_pat", { ...ctx, hour: 1 })).toBe(TOUCH_LINES.head_pat.night);
    expect(candidateLines("drag_start", { ...ctx, emotion: "angry" })).toBe(TOUCH_LINES.drag_start.angry);
    expect(candidateLines("drop", { ...ctx, emotion: "angry" })).toBe(TOUCH_LINES.drop.mid); // no angry set → tier
  });
  it("never repeats the same line twice in a row and always has text", () => {
    const r = new TouchReactor(() => 0, () => 0); // rand 0 → always first option
    const kinds: TouchKind[] = ["head_pat", "head_pat", "head_pat", "body_poke", "body_poke", "shake", "shake"];
    let prev = "";
    for (const k of kinds) {
      const out = r.react(k, ctx, false);
      expect(out.text).toBeTruthy();
      expect(out.text).not.toBe(prev);
      prev = out.text;
    }
  });
});

describe("voice cooldown", () => {
  it("speaks roughly every 2–4 interactions and never within the min gap", () => {
    let now = 0;
    const r = new TouchReactor(() => now, seq([0.99])); // rand never under the chance → only the forced 4th
    const spoken: number[] = [];
    for (let i = 1; i <= 12; i++) {
      now += 8_000;
      if (r.react("body_poke", ctx, true).speak) spoken.push(i);
    }
    expect(spoken).toEqual([4, 8, 12]);
  });
  it("can speak on the 2nd interaction with luck, but not the 1st", () => {
    let now = 0;
    const r = new TouchReactor(() => now, seq([0.1]));
    now += 10_000;
    expect(r.react("head_pat", ctx, true).speak).toBe(false);
    now += 10_000;
    expect(r.react("head_pat", ctx, true).speak).toBe(true);
  });
  it("respects the minimum gap between spoken lines", () => {
    let now = 0;
    const r = new TouchReactor(() => now, seq([0.1]));
    for (let i = 0; i < 10; i++) {
      now += 1_000;
      r.react("rub", ctx, true);
    }
    // 10 interactions in 10s → at most 2 spoken (gap ≥ 7s)
    let spoken = 0;
    let n = 0;
    const r2 = new TouchReactor(() => n, seq([0.1]));
    let last = -Infinity;
    for (let i = 0; i < 10; i++) {
      n += 1_000;
      if (r2.react("rub", ctx, true).speak) {
        expect(n - last).toBeGreaterThanOrEqual(VOICE_MIN_GAP_MS);
        last = n;
        spoken++;
      }
    }
    expect(spoken).toBeLessThanOrEqual(2);
  });
  it("muted = never speaks, bubble text still there", () => {
    let now = 0;
    const r = new TouchReactor(() => now, seq([0]));
    for (let i = 0; i < 8; i++) {
      now += 10_000;
      const out = r.react("drag_start", ctx, false);
      expect(out.speak).toBe(false);
      expect(out.text.length).toBeGreaterThan(0);
    }
  });
});

describe("hit areas + shake", () => {
  it("splits head / body", () => {
    expect(hitArea(40, 240)).toBe("head");
    expect(hitArea(180, 240)).toBe("body");
  });
  it("detects a shake from rapid back-and-forth window moves", () => {
    const d = new ShakeDetector();
    const xs = [100, 140, 100, 140, 100, 140];
    const hits = xs.map((x, i) => d.feed(x, i * 80));
    expect(hits.some(Boolean)).toBe(true);
    const slow = new ShakeDetector();
    expect([100, 140, 100, 140].map((x, i) => slow.feed(x, i * 900)).some(Boolean)).toBe(false);
  });
});
