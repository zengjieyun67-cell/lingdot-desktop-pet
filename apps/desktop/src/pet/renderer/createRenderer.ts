import { isTauri, convertFileSrc } from "../../api/client";
import type { AppSettings } from "../../api/types";
import type { PetRenderer } from "./PetRenderer";
import { SvgCatgirlRenderer } from "./SvgCatgirlRenderer";

export const BUNDLED_CORE_URL = "/live2d/live2dcubismcore.min.js";

/** Resolve a user-entered path to a URL the webview can load. */
export function resolveAssetUrl(path: string): string {
  const p = path.trim();
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p; // note: CSP only allows local sources by default
  if (p.startsWith("/live2d/")) return p; // bundled into the app (public/live2d)
  if (isTauri() && (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p))) return convertFileSrc(p);
  return p;
}

export interface RendererResult {
  renderer: PetRenderer;
  /** Human readable status for the settings panel. */
  status: string;
  error?: string;
}

/**
 * Pick a renderer based on settings. Always succeeds: any Live2D failure falls
 * back to the built-in SVG catgirl, with the reason returned in `error`.
 */
export async function createRenderer(settings: AppSettings, container: HTMLElement): Promise<RendererResult> {
  const wantLive2D =
    settings.rendererMode === "live2d" || (settings.rendererMode === "auto" && settings.live2dModelPath.trim() !== "");
  if (wantLive2D) {
    if (!settings.live2dModelPath.trim()) {
      return fallback(container, "未设置 Live2D 模型路径（.model3.json）");
    }
    try {
      const { Live2DRenderer } = await import("./Live2DRenderer");
      const r = new Live2DRenderer({
        modelUrl: resolveAssetUrl(settings.live2dModelPath),
        coreUrl: settings.live2dCorePath.trim() ? resolveAssetUrl(settings.live2dCorePath) : BUNDLED_CORE_URL,
      });
      await r.mount(container);
      return { renderer: r, status: `Live2D 模型已加载（${r.info}）` };
    } catch (e) {
      container.replaceChildren();
      return fallback(container, (e as Error)?.message ?? String(e));
    }
  }
  const r = new SvgCatgirlRenderer();
  await r.mount(container);
  return { renderer: r, status: "内置 SVG 猫娘" };
}

async function fallback(container: HTMLElement, error: string): Promise<RendererResult> {
  const r = new SvgCatgirlRenderer();
  await r.mount(container);
  return { renderer: r, status: "内置 SVG 猫娘（Live2D 不可用，已回退）", error };
}
