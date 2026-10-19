import { describe, expect, it } from "vitest";
import { clampPetScale, petWindowSize, scaleFromWheel, scalePercent, PET_SCALE_MAX, PET_SCALE_MIN } from "./petSize";
import rustPresets from "../../src-tauri/pet-core/src/chat_provider.rs?raw";
import { applyPreset, CHAT_PRESETS, chatCompletionsUrl, detectProvider, isDeepSeekEndpoint, isLocalEndpoint, keyRequired, resolveBaseUrl } from "./chatPresets";

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
  it("every preset fills its base URL and default model", () => {
    for (const p of CHAT_PRESETS.filter((x) => x.id !== "custom")) {
      const r = applyPreset(p.id, { chatEndpoint: "https://old.example/v1", chatModel: "old-model" });
      expect(r).toEqual({ chatProvider: p.id, chatEndpoint: p.baseUrl, chatModel: p.defaultModel });
      expect(p.models).toContain(p.defaultModel);
      expect(resolveBaseUrl(p.baseUrl)).toBe(p.baseUrl); // already normalized
    }
    expect(applyPreset("deepseek", { chatEndpoint: "", chatModel: "deepseek-v4-pro" }).chatModel).toBe("deepseek-v4-pro");
    expect(applyPreset("ollama", { chatEndpoint: "", chatModel: "x" })).toEqual({
      chatProvider: "ollama",
      chatEndpoint: "http://localhost:11434/v1",
      chatModel: "qwen2.5",
    });
  });
  it("has all requested providers, ids unique", () => {
    const ids = CHAT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["deepseek", "openai", "moonshot", "dashscope", "zhipu", "siliconflow", "openrouter", "gemini", "anthropic", "ollama", "custom"]) {
      expect(ids).toContain(id);
    }
  });
  it("matches the Rust preset table", () => {
    const rust = rustPresets;
    for (const p of CHAT_PRESETS) {
      const line = rust.split("\n").findIndex((l) => l.includes(`id: "${p.id}"`) || (l.includes("id: CUSTOM") && p.id === "custom"));
      expect(line, p.id).toBeGreaterThan(-1);
      const lines = rust.split("\n");
      let end = line;
      while (end < lines.length - 1 && !lines[end]!.includes("},")) end++;
      const block = lines.slice(line, end + 1).join("\n");
      expect(block, p.id).toContain(`base_url: "${p.baseUrl}"`);
      expect(block, p.id).toContain(`default_model: "${p.defaultModel}"`);
      expect(block.includes("key_optional: true"), p.id).toBe(!!p.keyOptional);
    }
  });
  it("自定义 keeps what is typed", () => {
    expect(applyPreset("custom", { chatEndpoint: "http://localhost:1234/v1", chatModel: "qwen" })).toEqual({
      chatProvider: "custom",
      chatEndpoint: "http://localhost:1234/v1",
      chatModel: "qwen",
    });
  });
  it("detects provider (unknown → 自定义), DeepSeek host check", () => {
    expect(detectProvider({ chatProvider: "openrouter" })).toBe("openrouter");
    expect(detectProvider({ chatProvider: "evil" })).toBe("custom");
    expect(detectProvider({})).toBe("custom");
    expect(isDeepSeekEndpoint("https://api.deepseek.com")).toBe(true);
    expect(isDeepSeekEndpoint("https://api.deepseek.com.evil.io")).toBe(false);
  });
  it("joins URLs with or without /v1 like Rust", () => {
    expect(chatCompletionsUrl("https://api.deepseek.com")).toBe("https://api.deepseek.com/chat/completions");
    expect(chatCompletionsUrl("https://api.deepseek.com/v1/")).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(chatCompletionsUrl("https://x.com/v1/chat/completions")).toBe("https://x.com/v1/chat/completions");
    expect(chatCompletionsUrl("https://api.openai.com")).toBe("https://api.openai.com/v1/chat/completions");
    expect(chatCompletionsUrl("https://API.OpenAI.com/v1/")).toBe("https://api.openai.com/v1/chat/completions");
    expect(chatCompletionsUrl("http://localhost:11434")).toBe("http://localhost:11434/v1/chat/completions");
    expect(chatCompletionsUrl("https://open.bigmodel.cn")).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect(chatCompletionsUrl("https://dashscope.aliyuncs.com")).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(chatCompletionsUrl("https://openrouter.ai")).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(chatCompletionsUrl("https://generativelanguage.googleapis.com/v1beta")).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(chatCompletionsUrl("https://x.example/v1?api-version=1")).toBe("https://x.example/v1/chat/completions?api-version=1");
    expect(chatCompletionsUrl("http://evil.com/v1")).toBe("—");
    expect(chatCompletionsUrl("nonsense")).toBe("—");
  });
  it("key is optional only for Ollama / localhost", () => {
    expect(keyRequired("openai", "https://api.openai.com/v1")).toBe(true);
    expect(keyRequired("ollama", "http://localhost:11434/v1")).toBe(false);
    expect(keyRequired("custom", "http://127.0.0.1:1234/v1")).toBe(false);
    expect(keyRequired("custom", "https://api.example.com/v1")).toBe(true);
    expect(isLocalEndpoint("http://[::1]:8080/v1")).toBe(true);
  });
});
