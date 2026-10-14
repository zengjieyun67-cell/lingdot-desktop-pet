import { describe, expect, it } from "vitest";
import { confidenceLabel, relTime, isImageIcon } from "./format";

describe("format", () => {
  it("never renders confidence as a percentage", () => {
    for (const c of [0, 0.3, 0.5, 0.86, 1]) expect(confidenceLabel(c)).not.toMatch(/%/);
    expect(confidenceLabel(0.9)).toBe("高");
    expect(confidenceLabel(0.6)).toBe("中");
    expect(confidenceLabel(0.1)).toBe("低");
  });
  it("relative time", () => {
    const now = 1_000_000_000;
    expect(relTime(now - 1000, now)).toBe("刚刚");
    expect(relTime(now - 5 * 60_000, now)).toBe("5 分钟前");
    expect(relTime(null, now)).toBe("—");
  });
  it("detects image icons", () => {
    expect(isImageIcon("data:image/png;base64,AA")).toBe(true);
    expect(isImageIcon("💬")).toBe(false);
  });
});
