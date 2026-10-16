import { describe, expect, it } from "vitest";
import { dailyQuote, greeting, phaseWeights } from "./timeOfDay";
import { radialProgress } from "../pet/RadialMenu";
import { spectrumProfile } from "../pet/Spectrum";

describe("海 crossfade + scene extras", () => {
  it("phase weights sum to 1 and follow the clock", () => {
    for (let m = 0; m < 1440; m += 17) {
      const w = phaseWeights(m);
      expect(w.dawn + w.day + w.dusk + w.night).toBeCloseTo(1, 6);
    }
    expect(phaseWeights(12 * 60).day).toBe(1);
    expect(phaseWeights(2 * 60).night).toBe(1);
    const mid = phaseWeights(8 * 60 + 30); // dawn → day
    expect(mid.dawn).toBeGreaterThan(0);
    expect(mid.day).toBeGreaterThan(0);
  });
  it("greeting + daily quote are stable", () => {
    const d = new Date(2026, 9, 16, 23, 10);
    expect(greeting(d)).toBe("晚安，星期五");
    expect(dailyQuote(d)).toBe(dailyQuote(new Date(2026, 9, 16, 8)));
    expect(dailyQuote(d)).not.toBe(dailyQuote(new Date(2026, 9, 17, 8)));
  });
  it("radial progress clamps", () => {
    expect(radialProgress(0, 0)).toBe(0);
    expect(radialProgress(3, 1)).toBe(0.75);
  });
  it("spectrum profile is taller in the middle", () => {
    const p = spectrumProfile(28);
    expect(p.length).toBe(28);
    expect(p[14]!).toBeGreaterThan(p[0]!);
  });
});
