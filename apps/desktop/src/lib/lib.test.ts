import { describe, expect, it } from "vitest";
import { clampPetScale, petWindowSize, scaleFromWheel, scalePercent, PET_SCALE_MAX, PET_SCALE_MIN } from "./petSize";
import { applyPreset, chatCompletionsUrl, detectProvider, isDeepSeekEndpoint, DEEPSEEK_BASE_URL } from "./chatPresets";

describe("pet size", () => {
  it("clamps to 60%–250%", () => {
    expect(clampPetScale(1)).toBe(1);
    expect(clampPetScale(0.1)).toBe(PET_SCALE_MIN);
    expect(clampPetScale(9)).toBe(PET_SCALE_MAX);
    expect(clampPetScale(Number.NaN)).toBe(1);
    expect(clampPetScale(1.234)).toBe(1.23);
  });
  it("keeps the 200:240 aspect", () => {
    expect(petWindowSize(1)).toEqual({ width: 200, height: 240 });
    expect(petWindowSize(2.5)).toEqual({ width: 500, height: 600 });
    expect(petWindowSize(0.6)).toEqual({ width: 120, height: 144 });
  });
  it("wheel up grows, wheel down shrinks, bounded", () => {
    expect(scaleFromWheel(1, -100)).toBeGreaterThan(1);
    expect(scaleFromWheel(1, 100)).toBeLessThan(1);
    expect(scaleFromWheel(1, -10_000)).toBe(1.1);
    expect(scaleFromWheel(2.5, -100)).toBe(2.5);
    expect(scaleFromWheel(0.6, 100)).toBe(0.6);
    expect(scaleFromWheel(1.2, 0)).toBe(1.2);
    expect(scalePercent(1.5)).toBe("150%");
  });
});

describe("chat presets", () => {
  it("DeepSeek preset fills URL and model", () => {
    const p = applyPreset("deepseek", { chatEndpoint: "https://api.openai.com/v1", chatModel: "gpt-4o-mini" });
    expect(p).toEqual({ chatProvider: "deepseek", chatEndpoint: DEEPSEEK_BASE_URL, chatModel: "deepseek-flash" });
    expect(applyPreset("deepseek", { chatEndpoint: "", chatModel: "deepseek-v4-pro" }).chatModel).toBe("deepseek-v4-pro");
  });
  it("custom clears the DeepSeek values but keeps a custom URL", () => {
    expect(applyPreset("custom", { chatEndpoint: DEEPSEEK_BASE_URL, chatModel: "deepseek-flash" })).toEqual({
      chatProvider: "custom",
      chatEndpoint: "",
      chatModel: "",
    });
    expect(applyPreset("custom", { chatEndpoint: "http://localhost:11434/v1", chatModel: "qwen" }).chatEndpoint).toBe("http://localhost:11434/v1");
  });
  it("detects provider and builds the completions URL like Rust", () => {
    expect(isDeepSeekEndpoint("https://api.deepseek.com")).toBe(true);
    expect(isDeepSeekEndpoint("https://api.deepseek.com.evil.io")).toBe(false);
    expect(detectProvider({ chatProvider: "deepseek", chatEndpoint: "https://api.openai.com/v1" })).toBe("custom");
    expect(detectProvider({ chatProvider: "deepseek", chatEndpoint: "https://api.deepseek.com" })).toBe("deepseek");
    expect(chatCompletionsUrl("https://api.deepseek.com")).toBe("https://api.deepseek.com/chat/completions");
    expect(chatCompletionsUrl("https://api.deepseek.com/v1/")).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(chatCompletionsUrl("https://x.com/v1/chat/completions")).toBe("https://x.com/v1/chat/completions");
  });
});
