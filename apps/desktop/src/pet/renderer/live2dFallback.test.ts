import { describe, expect, it, vi } from "vitest";

const mounts: string[] = [];
vi.mock("./Live2DRenderer", async (orig) => {
  const real = await orig<typeof import("./Live2DRenderer")>();
  class FakeLive2D {
    readonly kind = "live2d" as const;
    info = "fake";
    constructor(private src: { modelUrl: string }) {}
    async mount() {
      mounts.push(this.src.modelUrl);
      if (this.src.modelUrl.includes("/nope/")) throw new Error("Live2D 模型加载失败：404");
    }
    setMood() {}
    setEmotion() {}
    lookAt() {}
    setAnimationsEnabled() {}
    poke() {}
    destroy() {}
  }
  return { ...real, Live2DRenderer: FakeLive2D };
});
import { createRenderer, live2dAttempts, wantsLive2D } from "./createRenderer";
import { live2dFraming } from "./Live2DRenderer";
import { DEFAULT_SETTINGS } from "../../api/types";
import { rendererKey } from "../PetWindow";
import { needsLive2DCard } from "../../panel/Live2DImport";

describe("Live2D path resolution / fallback", () => {
  it("only skips Live2D in svg mode or auto without path and importer", () => {
    expect(wantsLive2D({ ...DEFAULT_SETTINGS, rendererMode: "svg", live2dModelPath: "/a.model3.json" }, true)).toBe(false);
    expect(wantsLive2D(DEFAULT_SETTINGS, false)).toBe(false);
    expect(wantsLive2D(DEFAULT_SETTINGS, true)).toBe(true);
    expect(wantsLive2D({ ...DEFAULT_SETTINGS, rendererMode: "live2d" }, false)).toBe(true);
  });

  it("tries the configured path first, then the imported one (deduplicated)", () => {
    const cfg = { modelPath: " /live2d/models/m/m.model3.json ", corePath: "" };
    const imp = { modelPath: "/Users/d/Library/Application Support/com.desktoppet.app/live2d/models/m/m.model3.json", corePath: "/x/core.js" };
    expect(live2dAttempts(cfg, imp)).toEqual([{ modelPath: "/live2d/models/m/m.model3.json", corePath: "" }, imp]);
    expect(live2dAttempts({ modelPath: "", corePath: "" }, imp)).toEqual([imp]);
    expect(live2dAttempts(imp, imp)).toEqual([imp]);
  });

  it("auto-imports when the configured model is missing, and SVG is the last fallback", async () => {
    const host = document.createElement("div");
    const autoImport = vi.fn(async () => null);
    const res = await createRenderer({ ...DEFAULT_SETTINGS, rendererMode: "auto", live2dModelPath: "" }, host, { autoImport });
    expect(autoImport).toHaveBeenCalledTimes(1);
    expect(res.renderer.kind).toBe("svg");
    expect(res.error).toBeTruthy();
    expect(res.status).toMatch(/回退/);
  });

  it("does not loop when the importer returns the same broken paths", async () => {
    const host = document.createElement("div");
    const same = { modelPath: "/nope/m.model3.json", corePath: "/nope/core.js" };
    const autoImport = vi.fn(async () => same);
    const res = await createRenderer({ ...DEFAULT_SETTINGS, rendererMode: "live2d", live2dModelPath: same.modelPath, live2dCorePath: same.corePath }, host, { autoImport });
    expect(autoImport).toHaveBeenCalledTimes(1);
    expect(res.renderer.kind).toBe("svg");
    expect(res.error).toMatch(/404/);
  });

  it("loads the imported model after the configured bundled path fails", async () => {
    const host = document.createElement("div");
    mounts.length = 0;
    const imported = { modelPath: "/ok/maid/maid.model3.json", corePath: "/ok/core.js" };
    const res = await createRenderer(
      { ...DEFAULT_SETTINGS, rendererMode: "live2d", live2dModelPath: "/nope/live2d/models/maid/maid.model3.json" },
      host,
      { autoImport: async () => imported },
    );
    expect(res.renderer.kind).toBe("live2d");
    expect(res.imported).toEqual(imported);
    expect(mounts).toEqual(["/nope/live2d/models/maid/maid.model3.json", "/ok/maid/maid.model3.json"]);
  });

  it("auto → live2d with the same paths does not remount", () => {
    const a = { rendererMode: "auto" as const, live2dModelPath: "/m.model3.json", live2dCorePath: "/c.js" };
    expect(rendererKey(a)).toBe(rendererKey({ ...a, rendererMode: "live2d" }));
    expect(rendererKey(a)).not.toBe(rendererKey({ ...a, rendererMode: "svg" }));
  });

  it("poster slot frames a half-body close-up, everything else full body", () => {
    const slot = document.createElement("div");
    slot.dataset.framing = "bust";
    const inner = document.createElement("div");
    slot.appendChild(inner);
    expect(live2dFraming(inner)).toBe("bust");
    expect(live2dFraming(document.createElement("div"))).toBe("full");
  });

  it("shows the import card unless Live2D is loaded", () => {
    expect(needsLive2DCard(null)).toBe(true);
    expect(needsLive2DCard("内置 SVG 猫娘（Live2D 不可用，已回退）")).toBe(true);
    expect(needsLive2DCard("Live2D 模型已加载（模型 4500×7532）")).toBe(false);
  });
});
