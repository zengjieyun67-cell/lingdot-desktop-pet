import { describe, expect, it } from "vitest";
import { DEFAULT_HEAD, feedIsFor, GazeIdle, gazeOffset, LOOK_RADIUS, reachFor } from "./gaze";
import { normaliseLook } from "./renderer/PetRenderer";
import { Live2DRenderer } from "./renderer/Live2DRenderer";

describe("gaze mapping (window px → head offset)", () => {
  it("floating pet: same as the old centre/38% math", () => {
    const box = { left: 0, top: 0, width: 200, height: 240 };
    expect(gazeOffset({ x: 100, y: 240 * 0.38 }, box)).toEqual({ dx: 0, dy: 0 });
    expect(gazeOffset({ x: 300, y: 0 }, box)).toEqual({ dx: 200, dy: -240 * 0.38 });
  });

  it("desktop scene: measured from the pet slot, not the window centre", () => {
    // pet slot in the middle-right of a 1512×982 scene
    const box = { left: 900, top: 200, width: 400, height: 660 };
    const head = { x: 0.5, y: 0.2 };
    // cursor exactly on her head → centre, even though it is far from the window centre
    const o = gazeOffset({ x: 1100, y: 332 }, box, head, LOOK_RADIUS);
    expect(o.dx).toBeCloseTo(0);
    expect(o.dy).toBeCloseTo(0);
    // cursor at the far left of the screen → looks left
    const l = gazeOffset({ x: 0, y: 332 }, box, head, LOOK_RADIUS);
    expect(l.dx).toBeLessThan(0);
    expect(normaliseLook(l.dx, l.dy).x).toBeLessThan(-0.9);
  });

  it("cursor on another monitor / outside the window still gives a direction", () => {
    const box = { left: 0, top: 0, width: 1440, height: 900 };
    const o = gazeOffset({ x: 3000, y: -200 }, box, DEFAULT_HEAD, reachFor(1440, 900, true));
    const n = normaliseLook(o.dx, o.dy);
    expect(n.x).toBeGreaterThan(0.9);
    expect(n.y).toBeLessThan(0);
  });

  it("scene reach scales with the window so mid-screen is a partial turn", () => {
    const reach = reachFor(1512, 982, true);
    expect(reach).toBeCloseTo(1512 * 0.45);
    expect(reachFor(200, 240, false)).toBe(LOOK_RADIUS);
    const box = { left: 556, top: 0, width: 400, height: 982 };
    const o = gazeOffset({ x: 756 + 200, y: 982 * 0.38 }, box, DEFAULT_HEAD, reach);
    const n = normaliseLook(o.dx, o.dy);
    expect(n.x).toBeGreaterThan(0.1);
    expect(n.x).toBeLessThan(0.7);
  });

  it("feed events are filtered by window label (old payloads = pet)", () => {
    expect(feedIsFor({ window: "desktop", x: 1, y: 2 }, "desktop")).toBe(true);
    expect(feedIsFor({ window: "pet", x: 1, y: 2 }, "desktop")).toBe(false);
    expect(feedIsFor({ dx: 1, dy: 2 }, "pet")).toBe(true);
    expect(feedIsFor({ dx: 1, dy: 2 }, "desktop")).toBe(false);
  });
});

describe("GazeIdle", () => {
  it("centres once after the idle period, again only after new movement", () => {
    const g = new GazeIdle(1000);
    expect(g.shouldCentre(0)).toBe(false); // starts centred
    g.moved(100);
    expect(g.shouldCentre(900)).toBe(false);
    expect(g.shouldCentre(1200)).toBe(true);
    expect(g.shouldCentre(5000)).toBe(false);
    g.moved(6000);
    expect(g.shouldCentre(7100)).toBe(true);
  });
});

describe("Live2DRenderer.lookAt", () => {
  const withFake = () => {
    const calls: Array<[number, number]> = [];
    const r = new Live2DRenderer({ modelUrl: "x" } as never);
    const fc = { focus: (x: number, y: number) => calls.push([x, y]) };
    (r as unknown as { model: unknown }).model = { internalModel: { focusController: fc }, focus: () => calls.push([NaN, NaN]) };
    return { r, calls };
  };

  it("straight ahead is the centre, not a full turn (old model.focus bug)", () => {
    const { r, calls } = withFake();
    r.lookAt(0, 0);
    expect(calls).toEqual([[0, -0]]);
  });

  it("keeps magnitude and flips y (Live2D +y = up)", () => {
    const { r, calls } = withFake();
    r.lookAt(60, 60);
    const [x, y] = calls[0];
    expect(x).toBeGreaterThan(0.1);
    expect(x).toBeLessThan(0.5);
    expect(y).toBeCloseTo(-x);
    r.lookAt(-5000, -5000);
    expect(calls[1]).toEqual([-1, 1]);
  });

  it("animations off → looks ahead", () => {
    const { r, calls } = withFake();
    (r as unknown as { animations: boolean }).animations = false;
    r.lookAt(500, 500);
    expect(calls[0][0]).toBe(0);
  });
});
