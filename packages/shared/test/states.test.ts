import { describe, expect, it } from "vitest";
import { DISPLAY_STATES, STATE_REGISTRY, activityState, resolveDisplayState, statePriority, nextEmotion, initialEmotion, fillLine, candidates, LINES } from "../src/persona";

describe("display states", () => {
  it("registry covers every state with strictly ordered priorities", () => {
    for (const s of DISPLAY_STATES) {
      expect(STATE_REGISTRY[s].id).toBe(s);
      expect(STATE_REGISTRY[s].label.length).toBeGreaterThan(0);
      expect(STATE_REGISTRY[s].live2dMotions.length).toBeGreaterThan(0);
    }
    const order = ["needs_attention", "completed", "working", "listening_music", "stretching", "napping", "idle"] as const;
    for (let i = 1; i < order.length; i++) expect(statePriority(order[i - 1])).toBeGreaterThan(statePriority(order[i]));
    expect(STATE_REGISTRY.listening_music.badge).toBe("♪");
  });

  it("activityState maps none to idle", () => {
    expect(activityState("none")).toBe("idle");
    expect(activityState("napping")).toBe("napping");
  });

  it("task moods beat activities, activities beat idle", () => {
    expect(resolveDisplayState("idle", "listening_music")).toBe("listening_music");
    expect(resolveDisplayState("working", "listening_music")).toBe("working");
    expect(resolveDisplayState("needs_attention", "napping")).toBe("needs_attention");
    expect(resolveDisplayState("completed", "stretching")).toBe("completed");
    expect(resolveDisplayState("idle", "napping")).toBe("napping");
    expect(resolveDisplayState("idle", "none")).toBe("idle");
  });

  it("respects idleStates / music switches", () => {
    expect(resolveDisplayState("idle", "napping", { idleStates: false })).toBe("idle");
    expect(resolveDisplayState("idle", "stretching", { idleStates: false })).toBe("idle");
    expect(resolveDisplayState("idle", "listening_music", { idleStates: false })).toBe("listening_music");
    expect(resolveDisplayState("idle", "listening_music", { music: false })).toBe("idle");
    expect(resolveDisplayState("idle", "napping", { music: false })).toBe("napping");
  });
});

describe("phase 2 triggers", () => {
  const ctx = { now: 1000, hour: 14, affinity: 50 };
  it("music_start -> happy, napping -> sleepy, woke -> neutral", () => {
    expect(nextEmotion(initialEmotion(0), "music_start", ctx).emotion).toBe("happy");
    const nap = nextEmotion(initialEmotion(0), "napping", ctx);
    expect(nap.emotion).toBe("sleepy");
    expect(nextEmotion(nap, "woke", { ...ctx, now: 5000 }).emotion).toBe("neutral");
  });

  it("new triggers have lines in every tier and fill {song}/{app}", () => {
    for (const t of ["music_start", "napping", "woke"] as const) {
      for (const tier of ["distant", "normal", "clingy"] as const) {
        expect(LINES[t].any?.[tier]?.length, `${t}/${tier}`).toBeGreaterThan(0);
        expect(candidates(LINES, t, "neutral", tier).length).toBeGreaterThan(0);
      }
    }
    expect(fillLine("正在听：{song}（{app}）", { song: "晴天", app: "QQ音乐" })).toBe("正在听：晴天（QQ音乐）");
    expect(fillLine("{song}{app}", {})).toBe("这首歌音乐");
  });
});
