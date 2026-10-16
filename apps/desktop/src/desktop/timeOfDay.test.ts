import { describe, expect, it } from "vitest";
import { hexToRgb, mixHex, PALETTES, posterHeadline, themeAt, themeVars } from "./timeOfDay";

describe("时间系统 timeOfDay", () => {
  it("pins each phase to its palette", () => {
    expect(themeAt(2 * 60).palette).toEqual(PALETTES.night);
    expect(themeAt(6 * 60 + 30).palette).toEqual(PALETTES.dawn);
    expect(themeAt(12 * 60).palette).toEqual(PALETTES.day);
    expect(themeAt(18 * 60 + 15).palette).toEqual(PALETTES.dusk);
    expect(themeAt(22 * 60).palette).toEqual(PALETTES.night);
    expect(themeAt(12 * 60).phase).toBe("day");
    expect(themeAt(18 * 60 + 15).phase).toBe("dusk");
  });

  it("blends smoothly between phases (no jumps minute to minute)", () => {
    const dist = (a: string, b: string) => {
      const x = hexToRgb(a), y = hexToRgb(b);
      return Math.max(...x.map((v, i) => Math.abs(v - y[i]!)));
    };
    for (let m = 0; m < 1440; m++) {
      const a = themeAt(m).palette;
      const b = themeAt(m + 1).palette;
      for (const k of Object.keys(a) as Array<keyof typeof a>) expect(dist(a[k], b[k])).toBeLessThanOrEqual(12);
    }
    // halfway dawn → day is neither endpoint
    const mid = themeAt(8 * 60 + 30).palette.a1;
    expect(mid).not.toBe(PALETTES.dawn.a1);
    expect(mid).not.toBe(PALETTES.day.a1);
  });

  it("wraps around midnight and handles odd input", () => {
    expect(themeAt(1440 + 120).palette).toEqual(themeAt(120).palette);
    expect(themeAt(-60).palette).toEqual(themeAt(23 * 60).palette);
  });

  it("mixes colours in OKLab and exposes css variables", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#ff0000", "#0000ff", 0.5)).toMatch(/^#[0-9a-f]{6}$/);
    const vars = themeVars(themeAt(12 * 60));
    expect(vars["--tod-base"]).toBe(PALETTES.day.base);
    expect(vars["--tod-paper-dark"]).toBe("0");
    expect(themeVars(themeAt(23 * 60))["--tod-paper-dark"]).toBe("1");
  });

  it("has a poster headline for every hour", () => {
    for (let h = 0; h < 24; h++) expect(posterHeadline(h)).toHaveLength(2);
  });
});
