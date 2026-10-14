import { describe, expect, it } from "vitest";
import {
  EMOTIONS,
  EMOTION_EXPRESSIONS,
  FORBIDDEN_WORDS,
  LINES,
  PERSONA_TRIGGERS,
  candidates,
  familiarityTier,
  fillLine,
  initialEmotion,
  isLateNight,
  mealWindowAt,
  nextEmotion,
  pickLine,
  triggerForNotification,
  type EmotionState,
} from "../src/persona";

const ctx = (now: number, hour = 14, affinity = 50) => ({ now, hour, affinity });

describe("emotion state machine", () => {
  it("task completed -> happy, then decays to neutral after duration", () => {
    let s = nextEmotion(initialEmotion(0), "task_completed", ctx(0));
    expect(s.emotion).toBe("happy");
    s = nextEmotion(s, "tick", ctx(30_000));
    expect(s.emotion).toBe("happy");
    s = nextEmotion(s, "tick", ctx(61_000));
    expect(s.emotion).toBe("neutral");
  });

  it("failed / disconnected / ignored -> angry (sulky)", () => {
    for (const t of ["task_failed", "disconnected", "ignored"] as const) {
      expect(nextEmotion(initialEmotion(0), t, ctx(0)).emotion).toBe("angry");
    }
    expect(nextEmotion(initialEmotion(0), "reconnected", ctx(0)).emotion).toBe("happy");
  });

  it("pat depends on affinity and repeated pats make her purr (happy)", () => {
    expect(nextEmotion(initialEmotion(0), "pat", ctx(0, 14, 10)).emotion).toBe("angry");
    expect(nextEmotion(initialEmotion(0), "pat", ctx(0, 14, 50)).emotion).toBe("shy");
    let s: EmotionState = initialEmotion(0);
    s = nextEmotion(s, "pat", ctx(0));
    s = nextEmotion(s, "pat", ctx(1000));
    s = nextEmotion(s, "pat", ctx(2000));
    expect(s.emotion).toBe("happy");
    // old pats fall out of the 10s window
    s = nextEmotion({ ...s, emotion: "neutral" }, "pat", ctx(60_000));
    expect(s.emotion).toBe("shy");
  });

  it("clicking 5 times quickly makes her angry; slow clicks do not", () => {
    let s = initialEmotion(0);
    for (let i = 0; i < 5; i++) s = nextEmotion(s, "clicked", ctx(i * 500));
    expect(s.emotion).toBe("angry");
    let t = initialEmotion(0);
    for (let i = 0; i < 5; i++) t = nextEmotion(t, "clicked", ctx(i * 20_000));
    expect(t.emotion).toBe("neutral");
  });

  it("dragging: shy at high affinity, angry at low", () => {
    expect(nextEmotion(initialEmotion(0), "dragged", ctx(0, 14, 80)).emotion).toBe("shy");
    expect(nextEmotion(initialEmotion(0), "dragged", ctx(0, 14, 20)).emotion).toBe("angry");
  });

  it("late night: greeting is sleepy, sleepy persists during the night and neutral drifts to sleepy", () => {
    expect(nextEmotion(initialEmotion(0), "greeting", ctx(0, 1)).emotion).toBe("sleepy");
    let s = nextEmotion(initialEmotion(0), "late_night", ctx(0, 23));
    s = nextEmotion(s, "tick", ctx(10 * 60_000, 23));
    expect(s.emotion).toBe("sleepy");
    s = nextEmotion(s, "tick", ctx(20 * 60_000, 9)); // morning
    expect(s.emotion).toBe("neutral");
    let n = initialEmotion(0);
    n = nextEmotion(n, "tick", ctx(6 * 60_000, 2));
    expect(n.emotion).toBe("sleepy");
    // decaying emotions fall into sleepy at night
    let h = nextEmotion(initialEmotion(0), "task_completed", ctx(0, 0));
    h = nextEmotion(h, "tick", ctx(70_000, 0));
    expect(h.emotion).toBe("sleepy");
  });

  it("greeting / returned depend on affinity", () => {
    expect(nextEmotion(initialEmotion(0), "greeting", ctx(0, 10, 80)).emotion).toBe("happy");
    expect(nextEmotion(initialEmotion(0), "greeting", ctx(0, 10, 10)).emotion).toBe("neutral");
    expect(nextEmotion(initialEmotion(0), "returned", ctx(0, 10, 80)).emotion).toBe("happy");
    expect(nextEmotion(initialEmotion(0), "returned", ctx(0, 10, 10)).emotion).toBe("shy");
  });

  it("meal time does not cancel sulking; `since` only changes on a new emotion", () => {
    const angry = nextEmotion(initialEmotion(0), "ignored", ctx(0));
    expect(nextEmotion(angry, "meal_time", ctx(1000)).emotion).toBe("angry");
    const again = nextEmotion(angry, "task_failed", ctx(5000));
    expect(again.since).toBe(0);
  });

  it("helpers", () => {
    expect(isLateNight(23)).toBe(true);
    expect(isLateNight(4)).toBe(true);
    expect(isLateNight(5)).toBe(false);
    expect(triggerForNotification("completed")).toBe("task_completed");
    expect(triggerForNotification("connection_lost")).toBe("disconnected");
    expect(triggerForNotification("x")).toBeNull();
    expect(mealWindowAt(new Date(2026, 0, 1, 12, 0))).toBe("lunch");
    expect(mealWindowAt(new Date(2026, 0, 1, 15, 0))).toBeNull();
    for (const e of EMOTIONS) expect(EMOTION_EXPRESSIONS[e]).toBeDefined();
  });
});

describe("line library", () => {
  it("every trigger has lines for every emotion and tier (via fallback)", () => {
    for (const t of PERSONA_TRIGGERS) {
      for (const e of EMOTIONS) {
        for (const f of [0, 30, 80]) {
          expect(candidates(LINES, t, e, familiarityTier(f)).length, `${t}/${e}/${f}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("never attacks the user", () => {
    const all = JSON.stringify(LINES);
    for (const w of FORBIDDEN_WORDS) expect(all).not.toContain(w);
  });

  it("uses tsundere markers and self-reference, but 喵 only sparingly", () => {
    const lines = Object.values(LINES).flatMap((e) => Object.values(e).flatMap((t) => Object.values(t ?? {}).flat()));
    expect(lines.length).toBeGreaterThan(100);
    expect(lines.some((l) => l.includes("本猫"))).toBe(true);
    for (const m of ["哼", "切", "才不是", "笨蛋", "真拿你没办法", "勉强", "不要误会哦"]) {
      expect(lines.some((l) => l.includes(m)), m).toBe(true);
    }
    const meow = lines.filter((l) => /喵|呼噜/.test(l.replace("小喵", ""))).length;
    expect(meow / lines.length).toBeLessThan(0.2);
  });

  it("familiarity changes tone", () => {
    expect(familiarityTier(5)).toBe("distant");
    expect(familiarityTier(40)).toBe("normal");
    expect(familiarityTier(90)).toBe("clingy");
    const distant = candidates(LINES, "task_completed", "happy", "distant");
    const clingy = candidates(LINES, "task_completed", "happy", "clingy");
    expect(distant).not.toEqual(clingy);
  });

  it("picks without immediate repeats", () => {
    const recent: string[] = [];
    let seq = 0;
    const rand = () => ((seq = (seq * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 50; i++) {
      const l = pickLine("clicked", "neutral", 30, recent, rand)!;
      expect(l).not.toBe(recent[recent.length - 1]);
      recent.push(l);
    }
    // single-candidate pools still return something
    const one = { ...LINES, reconnected: { any: { all: ["只有一句"] } } };
    expect(pickLine("reconnected", "happy", 50, ["只有一句"], Math.random, one)).toBe("只有一句");
  });

  it("fills placeholders", () => {
    expect(fillLine("{name}：「{task}」@{site}", { name: "喵璃", task: "写周报", site: "ChatGPT" })).toBe("喵璃：「写周报」@ChatGPT");
    expect(fillLine("{name}{task}{site}", {})).toBe("小喵任务网页");
    expect(fillLine("哼，{user}又熬夜了？", {})).toBe("哼，主人又熬夜了？");
    expect(fillLine("哼，{user}又熬夜了？", { user: "前辈" })).toBe("哼，前辈又熬夜了？");
    expect(candidates(LINES, "late_night", "sleepy", "normal").some((l) => l.includes("{user}"))).toBe(true);
    expect(fillLine("{task}", { task: "一二三四五六七八九十一二三四五六七八九十" })).toMatch(/…$/);
  });
});
