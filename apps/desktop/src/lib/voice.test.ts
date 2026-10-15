import { describe, expect, it } from "vitest";
import { IDLE_VOICE } from "../api/types";
import { speechText, voicePhaseLabel } from "./voice";

describe("speechText", () => {
  it("strips markdown, links, emoji and short stage directions", () => {
    expect(speechText("**哼**（脸红）才不是 [链接](https://x.y) 😺 呢")).toBe("哼才不是 链接 呢");
  });
  it("drops code blocks and bare urls", () => {
    expect(speechText("看这里 https://example.com\n```js\nx()\n```好了")).toBe("看这里 好了");
  });
});

describe("voicePhaseLabel", () => {
  it("labels each phase", () => {
    expect(voicePhaseLabel(IDLE_VOICE)).toBeNull();
    expect(voicePhaseLabel({ ...IDLE_VOICE, mode: "live", phase: "listening" })).toContain("实时对话");
    expect(voicePhaseLabel({ ...IDLE_VOICE, mode: "push_to_talk", phase: "thinking" })).toBe("想一想…");
    expect(voicePhaseLabel({ ...IDLE_VOICE, mode: "push_to_talk", phase: "speaking" })).toBe("说话中…");
    expect(voicePhaseLabel({ ...IDLE_VOICE, phase: "listening", error: "x" })).toBeNull();
  });
});
