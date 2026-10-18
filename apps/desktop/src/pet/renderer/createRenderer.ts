import { isTauri, convertFileSrc } from "../../api/client";
import type { AppSettings } from "../../api/types";
import type { PetRenderer } from "./PetRenderer";
import { SvgCatgirlRenderer } from "./SvgCatgirlRenderer";

export const BUNDLED_CORE_URL = "/live2d/live2dcubismcore.min.js";

/** Strip Windows verbatim prefixes (`\\?\C:\…`, `\\?\UNC\server\…`) that `canonicalize` produces. */
export function plainPath(path: string): string {
  const p = path.trim();
  if (/^\\\\\?\\UNC\\/i.test(p)) return "\\\\" + p.slice(8);
  if (/^\\\\\?\\[A-Za-z]:/.test(p)) return p.slice(4);
  return p;
}

/** Is this an absolute local file path (POSIX, `C:\…` / `C:/…`, or a `\\server\share` UNC path)? */
export function isLocalPath(path: string): boolean {
  const p = plainPath(path);
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || /^\\\\[^\\]/.test(p);
}

/**
 * Asset-protocol URL for a local file that keeps the path's directory structure in the URL.
 *
 * Tauri's own `convertFileSrc` percent-encodes the WHOLE path (every `/` and `\` becomes
 * %2F / %5C), so the URL has a single path segment. pixi-live2d-display resolves the model's
 * moc / textures / motions *relative* to the model3.json URL — against a one-segment URL they
 * all landed at the protocol root (`http://asset.localhost/free1.moc3`) and 404'd: the model
 * "was not found" even though it was imported. Here every segment is encoded on its own and
 * joined with `/` (the asset protocol percent-decodes the path; Windows accepts `C:/…`).
 *
 * `base` is the protocol origin (`http://asset.localhost/` on Windows, `asset://localhost/` on macOS).
 */
export function fileUrl(path: string, base: string): string {
  let p = plainPath(path).replace(/\\/g, "/");
  const unc = p.startsWith("//");
  p = p.replace(/^\/+/, "");
  const encoded = p.split("/").filter((seg, i) => seg !== "" || i === 0).map((seg) => encodeURIComponent(seg)).join("/");
  // POSIX keeps its leading "/" (encoded as %2F so the protocol sees an absolute path);
  // a drive path starts with "C%3A"; UNC keeps its two leading slashes.
  const lead = unc ? "%2F%2F" : /^[A-Za-z]:/.test(p) ? "" : "%2F";
  return (base.endsWith("/") ? base : base + "/") + lead + encoded;
}

/** The asset protocol origin for this platform (derived from Tauri so it always matches). */
export function assetBase(): string {
  const probe = convertFileSrc("x");
  return probe.endsWith("x") ? probe.slice(0, -1) : /Windows/i.test(navigator.userAgent) ? "http://asset.localhost/" : "asset://localhost/";
}

/** Resolve a user-entered path to a URL the webview can load. */
export function resolveAssetUrl(path: string): string {
  const p = plainPath(path);
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p; // note: CSP only allows local sources by default
  if (p.startsWith("/live2d/")) return p; // bundled into the app (public/live2d)
  if (isTauri() && isLocalPath(p)) return fileUrl(p, assetBase());
  return p;
}

export interface RendererResult {
  renderer: PetRenderer;
  /** Human readable status for the settings panel. */
  status: string;
  error?: string;
  /** Set when the model came from the auto-import (settings were updated by Rust). */
  imported?: Live2DPaths;
}

export interface Live2DPaths {
  modelPath: string;
  corePath: string;
}

export interface RendererOptions {
  /**
   * Called when the configured Live2D model is missing/broken (or not configured in auto mode):
   * finds + imports the user's model (Rust `scan_and_import_live2d`). Returns new paths or null.
   */
  autoImport?: () => Promise<Live2DPaths | null>;
}

/** Live2D is attempted for live2d mode, or auto mode with a path or an importer. SVG is the last fallback. */
export function wantsLive2D(settings: AppSettings, canImport: boolean): boolean {
  if (settings.rendererMode === "svg") return false;
  if (settings.rendererMode === "live2d") return true;
  return settings.live2dModelPath.trim() !== "" || canImport;
}

/** Paths to try, in order: configured first, then the imported ones if they differ. */
export function live2dAttempts(configured: Live2DPaths, imported: Live2DPaths | null): Live2DPaths[] {
  const out: Live2DPaths[] = [];
  const norm = (p: Live2DPaths) => ({ modelPath: p.modelPath.trim(), corePath: p.corePath.trim() });
  const c = norm(configured);
  if (c.modelPath) out.push(c);
  if (imported) {
    const i = norm(imported);
    if (i.modelPath && !out.some((o) => o.modelPath === i.modelPath && o.corePath === i.corePath)) out.push(i);
  }
  return out;
}

async function tryLive2D(p: Live2DPaths, container: HTMLElement): Promise<PetRenderer> {
  const { Live2DRenderer } = await import("./Live2DRenderer");
  const r = new Live2DRenderer({
    modelUrl: resolveAssetUrl(p.modelPath),
    coreUrl: p.corePath ? resolveAssetUrl(p.corePath) : BUNDLED_CORE_URL,
  });
  try {
    await r.mount(container);
  } catch (e) {
    container.replaceChildren();
    throw e;
  }
  return r;
}

/**
 * Pick a renderer based on settings. Always succeeds: Live2D (configured, then auto-imported)
 * first; the built-in SVG catgirl is only the last fallback, with the reason in `error`.
 */
export async function createRenderer(settings: AppSettings, container: HTMLElement, opts: RendererOptions = {}): Promise<RendererResult> {
  if (!wantsLive2D(settings, !!opts.autoImport)) {
    const r = new SvgCatgirlRenderer();
    await r.mount(container);
    return { renderer: r, status: "内置 SVG 猫娘" };
  }
  const configured = { modelPath: settings.live2dModelPath, corePath: settings.live2dCorePath };
  let lastError = settings.live2dModelPath.trim() ? "" : "未设置 Live2D 模型路径（.model3.json）";
  let imported: Live2DPaths | null = null;
  let importTried = false;
  for (let round = 0; round < 2; round++) {
    for (const p of live2dAttempts(configured, imported)) {
      if (round === 1 && p.modelPath === configured.modelPath.trim() && p.corePath === configured.corePath.trim()) continue;
      try {
        const r = await tryLive2D(p, container);
        const info = (r as unknown as { info?: string }).info ?? "";
        return { renderer: r, status: `Live2D 模型已加载（${info}）`, imported: round === 1 ? p : undefined };
      } catch (e) {
        lastError = (e as Error)?.message ?? String(e);
      }
    }
    if (importTried || !opts.autoImport) break;
    importTried = true;
    try {
      imported = await opts.autoImport();
    } catch {
      imported = null;
    }
    if (!imported) break;
  }
  return fallback(container, lastError || "未找到 Live2D 模型");
}

async function fallback(container: HTMLElement, error: string): Promise<RendererResult> {
  const r = new SvgCatgirlRenderer();
  await r.mount(container);
  return { renderer: r, status: "内置 SVG 猫娘（Live2D 不可用，已回退）", error };
}
