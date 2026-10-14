import { describe, expect, it } from "vitest";
import { normaliseLook } from "./PetRenderer";
import { pickName, LIVE2D_MOOD_MAP } from "./Live2DRenderer";
import { resolveAssetUrl, createRenderer } from "./createRenderer";
import { SvgCatgirlRenderer } from "./SvgCatgirlRenderer";
import { DEFAULT_SETTINGS } from "../../api/types";

describe("normaliseLook", () => {
  it("clamps to -1..1 and keeps sign", () => {
    expect(normaliseLook(0, 0)).toEqual({ x: 0, y: 0 });
    const far = normaliseLook(10_000, -10_000);
    expect(far.x).toBe(1);
    expect(far.y).toBe(-1);
    expect(normaliseLook(50, 0).x).toBeGreaterThan(0);
  });
});

describe("Live2D motion mapping", () => {
  it("picks the first available name case-insensitively", () => {
    expect(pickName(["idle", "TAP_BODY"], ["Idle"])).toBe("idle");
    expect(pickName(["Tap"], LIVE2D_MOOD_MAP.working.motions)).toBe("Tap");
    expect(pickName(["Foo"], LIVE2D_MOOD_MAP.completed.motions)).toBeUndefined();
  });
  it("defines fallbacks for every mood", () => {
    for (const m of ["idle", "working", "completed", "needs_attention"] as const) {
      expect(LIVE2D_MOOD_MAP[m].motions.length).toBeGreaterThan(1);
    }
  });
});

describe("resolveAssetUrl", () => {
  it("keeps bundled and http paths", () => {
    expect(resolveAssetUrl("/live2d/models/a/a.model3.json")).toBe("/live2d/models/a/a.model3.json");
    expect(resolveAssetUrl("https://x.com/a.json")).toBe("https://x.com/a.json");
    expect(resolveAssetUrl("  ")).toBe("");
  });
});

describe("SvgCatgirlRenderer", () => {
  it("mounts an svg and switches mood classes", async () => {
    const host = document.createElement("div");
    const r = new SvgCatgirlRenderer();
    await r.mount(host);
    const root = host.firstElementChild as HTMLElement;
    expect(root.querySelector("svg")).not.toBeNull();
    const base = root.className;
    r.setMood("working");
    expect(root.className).not.toBe(base);
    r.setMood("idle");
    expect(root.className).toBe(base);
    r.lookAt(500, 0);
    expect(Number(root.style.getPropertyValue("--lx"))).toBeGreaterThan(0.5);
    r.setAnimationsEnabled(false);
    expect(root.style.getPropertyValue("--lx")).toBe("0.000");
    r.destroy();
    expect(host.children.length).toBe(0);
  });
});

describe("createRenderer", () => {
  it("uses SVG by default", async () => {
    const host = document.createElement("div");
    const res = await createRenderer(DEFAULT_SETTINGS, host);
    expect(res.renderer.kind).toBe("svg");
    expect(res.error).toBeUndefined();
  });
  it("falls back to SVG with a reason when Live2D is requested without a model", async () => {
    const host = document.createElement("div");
    const res = await createRenderer({ ...DEFAULT_SETTINGS, rendererMode: "live2d" }, host);
    expect(res.renderer.kind).toBe("svg");
    expect(res.error).toMatch(/模型路径/);
  });
});
