import { describe, expect, it } from "vitest";
import { monthGrid, weatherKind } from "./DesktopWidgets";
import { spectrumProfile } from "../pet/Spectrum";
import { RADIAL_ANGLES, RADIAL_ITEMS } from "../pet/RadialMenu";

describe("desktop widgets", () => {
  it("maps WMO weather codes", () => {
    expect(weatherKind(0)).toEqual({ icon: "sun", text: "晴" });
    expect(weatherKind(2).icon).toBe("cloudSun");
    expect(weatherKind(61).icon).toBe("rain");
    expect(weatherKind(81).text).toBe("阵雨");
    expect(weatherKind(73).icon).toBe("snow");
    expect(weatherKind(96).icon).toBe("storm");
  });
  it("builds a Monday-first month grid", () => {
    const g = monthGrid(new Date(2026, 9, 16)); // Oct 2026 starts on a Thursday
    expect(g.slice(0, 3)).toEqual([null, null, null]);
    expect(g[3]).toBe(1);
    expect(g.filter((x) => x !== null)).toHaveLength(31);
  });
  it("spectrum stays a thin, bounded profile", () => {
    const p = spectrumProfile();
    expect(p.length).toBeGreaterThan(20);
    expect(Math.max(...p)).toBeLessThanOrEqual(1);
  });
  it("radial dial has a pill position for every item incl. 便签", () => {
    expect(RADIAL_ITEMS.map((i) => i.id)).toContain("notes");
    expect(RADIAL_ANGLES).toHaveLength(RADIAL_ITEMS.length);
  });
});
