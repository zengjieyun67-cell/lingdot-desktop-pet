/* Live2D (Cubism 4) renderer via pixi.js v6 + pixi-live2d-display.
 *
 * Licensing: Live2D Cubism Core (live2dcubismcore.min.js) may NOT be
 * redistributed with this project. Users download it from the official Live2D
 * site (scripts/setup-live2d.sh explains how) and either place it in
 * apps/desktop/public/live2d/ before building, or point "Cubism Core 路径" in
 * settings at a local copy. Models are user-provided (.model3.json).
 */
import { EMOTION_EXPRESSIONS, STATE_REGISTRY, type DisplayState, type Emotion, type PetMood } from "@desktop-pet/shared";
import { normaliseLook, type PetRenderer } from "./PetRenderer";
import { TOUCH_MOTIONS, type TouchKind } from "../touchReactions";

declare global {
  interface Window {
    Live2DCubismCore?: unknown;
  }
}

/** Motion groups / expressions tried per mood (first match wins, case-insensitive). */
export const LIVE2D_MOOD_MAP: Record<PetMood, { motions: string[]; expressions: string[] }> = {
  idle: { motions: ["Idle", "idle", "Main"], expressions: ["normal", "default", "f00", "exp_01"] },
  working: { motions: ["Working", "Work", "TapBody", "Tap", "tap_body"], expressions: ["focus", "serious", "f01", "exp_02"] },
  completed: { motions: ["Happy", "Joy", "TapHead", "FlickUp", "tap_head", "Tap"], expressions: ["happy", "smile", "joy", "f02", "exp_03"] },
  needs_attention: { motions: ["Alert", "Surprised", "Shake", "Flick", "FlickDown", "TapBody"], expressions: ["surprised", "angry", "f03", "exp_04"] },
};

export interface Live2DSources {
  modelUrl: string;
  coreUrl: string;
}

function loadScript(src: string): Promise<void> {
  if (window.Live2DCubismCore) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => (window.Live2DCubismCore ? resolve() : reject(new Error("Cubism Core 加载后未注册 Live2DCubismCore")));
    s.onerror = () => reject(new Error(`未找到 Cubism Core：${src}`));
    document.head.appendChild(s);
  });
}

export function pickName(available: string[], wanted: string[]): string | undefined {
  const lower = available.map((a) => a.toLowerCase());
  for (const w of wanted) {
    const i = lower.indexOf(w.toLowerCase());
    if (i >= 0) return available[i];
  }
  return undefined;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Cubism Core 5.3+ / 6.x removed `drawables.renderOrders` (replaced by
 * `model.getRenderOrders()`), which pixi-live2d-display 0.4 still reads every
 * frame -> render throws and nothing is drawn. Re-add it as a getter.
 */
export function patchRenderOrders(live2dModel: any): void {
  const core = live2dModel?.internalModel?.coreModel?._model;
  const d = core?.drawables;
  if (!d || d.renderOrders !== undefined) return;
  const count: number = d.count ?? d.ids?.length ?? 0;
  const fromDrawOrders = (): Int32Array => {
    const draw: Int32Array = d.drawOrders;
    const idx = Array.from({ length: count }, (_, i) => i).sort((a, b) => draw[a] - draw[b] || a - b);
    const out = new Int32Array(count);
    idx.forEach((drawable, order) => (out[drawable] = order));
    return out;
  };
  Object.defineProperty(d, "renderOrders", {
    configurable: true,
    get(): Int32Array {
      if (typeof core.getRenderOrders === "function") {
        const ro: Int32Array = core.getRenderOrders();
        if (ro && ro.length >= count) {
          let ok = true;
          for (let i = 0; i < count; i++) if (ro[i] < 0 || ro[i] >= count) { ok = false; break; }
          if (ok) return ro.length === count ? ro : ro.subarray(0, count);
        }
      }
      return fromDrawOrders();
    },
  });
}

/** Where the face sits, as a fraction of the model's drawn height from its top. */
export const HEAD_FRACTION = 0.13;
const clampFrac = (v: number) => (Number.isFinite(v) ? Math.min(0.95, Math.max(0.05, v)) : 0.3);

/** Part of the model height shown in the half-body (bust) framing. */
export const BUST_FRACTION = 0.58;

/** Full body everywhere, except the magazine poster slot (`data-framing="bust"`) = half-body close-up. */
export function live2dFraming(container: Element | null): "full" | "bust" {
  return container?.closest?.('[data-framing="bust"]') ? "bust" : "full";
}

export class Live2DRenderer implements PetRenderer {
  readonly kind = "live2d" as const;
  private app: any = null;
  private model: any = null;
  private container: HTMLElement | null = null;
  private animations = true;
  private mood: PetMood = "idle";
  private resizeObs: ResizeObserver | null = null;
  private displayState: DisplayState = "idle";
  private mouthTimer: number | undefined;

  constructor(private readonly src: Live2DSources) {}

  async mount(container: HTMLElement): Promise<void> {
    await this.mountWith(container, false);
    // WKWebView (macOS) sometimes draws nothing with WebGL2: if nothing visible,
    // retry once on WebGL1.
    await new Promise((r) => setTimeout(r, 400));
    const visible = this.visiblePixels();
    if (visible === 0 && this.glVersion === 2) {
      this.destroyInternal();
      await this.mountWith(container, true);
      await new Promise((r) => setTimeout(r, 400));
      this.diag(this.visiblePixels());
    } else {
      this.diag(visible);
    }
  }

  private glVersion = 0;
  private texInfo = "";

  private diag(visible: number): void {
    const gl = this.app?.renderer?.gl;
    const max = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0;
    const lost = gl?.isContextLost?.() ? "，上下文丢失" : "";
    this.info += `，WebGL${this.glVersion}，可见像素 ${visible < 0 ? "未知" : visible}，纹理 ${this.texInfo}，最大纹理 ${max}${lost}${this.renderError ? `，绘制错误：${this.renderError}` : ""}`;
  }

  /** Count non-transparent pixels actually drawn on the canvas (-1 = unknown). */
  private visiblePixels(): number {
    try {
      const r = this.app?.renderer;
      const gl: WebGLRenderingContext | undefined = r?.gl;
      if (!r || !gl) return -1;
      r.render(this.app.stage);
      r.renderTexture?.bind?.(null);
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let n = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 8) n++;
      return n;
    } catch (e) {
      this.renderError = String((e as Error)?.message ?? e).slice(0, 80);
      return -1;
    }
  }

  private renderError = "";

  private async mountWith(container: HTMLElement, forceWebGL1: boolean): Promise<void> {
    this.container = container;
    await loadScript(this.src.coreUrl);
    const PIXI: any = await import("pixi.js");
    (window as any).PIXI = PIXI;
    const { Live2DModel }: any = await import("pixi-live2d-display/cubism4");
    Live2DModel.registerTicker(PIXI.Ticker);
    PIXI.settings.PREFER_ENV = forceWebGL1 ? PIXI.ENV.WEBGL : PIXI.ENV.WEBGL2;

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);
    this.app = new PIXI.Application({
      view: canvas,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      width: container.clientWidth,
      height: container.clientHeight,
    });
    this.glVersion = this.app.renderer.context?.webGLVersion ?? (forceWebGL1 ? 1 : 2);
    try {
      this.model = await Live2DModel.from(this.src.modelUrl, { autoInteract: false });
    } catch (e) {
      this.destroyInternal();
      throw new Error(`Live2D 模型加载失败：${(e as Error)?.message ?? e}`);
    }
    patchRenderOrders(this.model);
    this.texInfo = (this.model.textures ?? [])
      .map((t: any) => `${t?.baseTexture?.realWidth ?? "?"}×${t?.baseTexture?.realHeight ?? "?"}${t?.baseTexture?.valid ? "" : "(无效)"}`)
      .join(" ") || "无";
    this.app.stage.addChild(this.model);
    this.fit();
    this.resizeObs = new ResizeObserver(() => this.fit());
    this.resizeObs.observe(container);
    this.setMood(this.mood);
  }

  private fit(): void {
    if (!this.model || !this.container || !this.app) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.app.renderer.resize(w, h);
    // Measure the model at scale 1 using its real drawn bounds (some models have
    // huge canvases with the character occupying only part of it).
    this.model.scale.set(1);
    this.model.anchor?.set(0, 0);
    this.model.position.set(0, 0);
    const b = this.model.getLocalBounds?.() ?? { x: 0, y: 0, width: this.model.width, height: this.model.height };
    const bw = b.width || this.model.internalModel?.width || 1;
    const bh = b.height || this.model.internalModel?.height || 1;
    const framing = live2dFraming(this.container);
    if (framing === "bust") {
      // 杂志海报: half-body close-up — the top ~58% of the model fills the visible part of the slot.
      const top = this.container.getBoundingClientRect().top;
      const visibleH = Math.max(1, Math.min(h, (window.innerHeight || h) - Math.max(0, top)));
      const scale = Math.min(w / bw, visibleH / (bh * BUST_FRACTION));
      this.model.scale.set(scale);
      this.model.position.set(w / 2 - (b.x + bw / 2) * scale, visibleH * 0.03 - b.y * scale);
      this.head = { x: 0.5, y: clampFrac((visibleH * 0.03 + bh * scale * HEAD_FRACTION) / h) };
      this.info = `模型 ${Math.round(bw)}×${Math.round(bh)}，半身特写，缩放 ${scale.toFixed(3)}，窗口 ${w}×${h}`;
      return;
    }
    const scale = Math.min(w / bw, h / bh) * 0.96;
    this.model.scale.set(scale);
    // centre horizontally, sit on the bottom edge
    this.model.position.set(w / 2 - (b.x + bw / 2) * scale, h - (b.y + bh) * scale);
    this.head = { x: 0.5, y: clampFrac((h - bh * scale + bh * scale * HEAD_FRACTION) / h) };
    this.info = `模型 ${Math.round(bw)}×${Math.round(bh)}，缩放 ${scale.toFixed(3)}，窗口 ${w}×${h}`;
  }

  /** Diagnostic line for the settings panel. */
  info = "";

  private motionGroups(): string[] {
    const defs = this.model?.internalModel?.motionManager?.definitions ?? {};
    return Object.keys(defs);
  }

  private expressionNames(): string[] {
    const em = this.model?.internalModel?.motionManager?.expressionManager;
    const defs: any[] = em?.definitions ?? [];
    return defs.map((d) => d.Name ?? d.name).filter(Boolean);
  }

  setMood(mood: PetMood): void {
    this.mood = mood;
    if (!this.model) return;
    const map = LIVE2D_MOOD_MAP[mood];
    const expr = pickName(this.expressionNames(), map.expressions);
    if (expr) this.model.expression(expr);
    if (!this.animations) return;
    const group = pickName(this.motionGroups(), map.motions);
    // priority 3 = FORCE so state changes interrupt idle motions
    if (group) this.model.motion(group, undefined, mood === "idle" ? 1 : 3);
  }

  /** Emotion -> expression (and a short motion) using EMOTION_EXPRESSIONS from the persona config. */
  setEmotion(emotion: Emotion): void {
    if (!this.model) return;
    const cfg = EMOTION_EXPRESSIONS[emotion];
    const expr = pickName(this.expressionNames(), cfg.live2dExpressions);
    if (expr) this.model.expression(expr);
    if (!this.animations || this.mood !== "idle") return; // task-mood motions take priority
    const group = pickName(this.motionGroups(), cfg.live2dMotions);
    if (group) this.model.motion(group, undefined, 2);
  }

  /**
   * Turn head/eyes. Drives the focus controller directly with the soft -1..1 value:
   * `model.focus()` in pixi-live2d-display keeps only the *direction* (atan2) at full strength,
   * so any target — including "straight ahead" — became a full turn, and a stale target froze
   * her looking one way (桌面模式 bug, build-11).
   */
  lookAt(dx: number, dy: number): void {
    if (!this.model) return;
    const { x, y } = this.animations ? normaliseLook(dx, dy) : { x: 0, y: 0 };
    const fc = this.model.internalModel?.focusController;
    if (fc && typeof fc.focus === "function") fc.focus(x, -y); // Live2D: +y = up
  }

  /** Head position inside the stage (fractions), measured from the fitted model. */
  private head = { x: 0.5, y: 0.3 };
  headAnchor(): { x: number; y: number } {
    return this.head;
  }

  setAnimationsEnabled(enabled: boolean): void {
    this.animations = enabled;
    if (this.app) {
      if (enabled) this.app.ticker.start();
      else this.app.ticker.stop();
    }
  }

  poke(): void {
    if (!this.model || !this.animations) return;
    const group = pickName(this.motionGroups(), ["TapHead", "Tap", "tap_head", "TapBody"]);
    if (group) this.model.motion(group, undefined, 2);
  }

  /** Touch / drag reaction: expression + a short motion (FORCE priority so it shows right away). */
  react(kind: TouchKind): void {
    if (!this.model) return;
    const cfg = TOUCH_MOTIONS[kind];
    const expr = pickName(this.expressionNames(), cfg.expressions);
    if (expr) this.model.expression(expr);
    if (!this.animations) return;
    const group = pickName(this.motionGroups(), cfg.motions);
    if (group) this.model.motion(group, undefined, 3);
    else this.poke();
  }

  /** Phase 2: ambient state -> try the registry's motion groups. Returns true if a motion played. */
  setDisplayState(state: DisplayState): void {
    if (state === this.displayState) return;
    this.displayState = state;
    if (!this.model || !this.animations) return;
    if (STATE_REGISTRY[state].source !== "activity") return; // moods handled by setMood
    const group = pickName(this.motionGroups(), STATE_REGISTRY[state].live2dMotions);
    if (group) this.model.motion(group, undefined, 2);
  }

  /** True when the model has a motion for this state (otherwise the window shows a badge). */
  hasMotionFor(state: DisplayState): boolean {
    return !!pickName(this.motionGroups(), STATE_REGISTRY[state].live2dMotions);
  }

  /** Phase 2: drive ParamMouthOpenY while TTS is speaking (if the model has it). */
  setSpeaking(speaking: boolean): void {
    window.clearInterval(this.mouthTimer);
    this.mouthTimer = undefined;
    const core = this.model?.internalModel?.coreModel;
    const set = (v: number) => {
      try {
        core?.setParameterValueById?.("ParamMouthOpenY", v);
      } catch {
        /* model without the parameter */
      }
    };
    if (!speaking) {
      set(0);
      return;
    }
    let t = 0;
    this.mouthTimer = window.setInterval(() => {
      t += 1;
      set(0.25 + 0.75 * Math.abs(Math.sin(t * 0.9)) * (0.6 + 0.4 * Math.random()));
    }, 80);
  }

  destroy(): void {
    window.clearInterval(this.mouthTimer);
    this.destroyInternal();
  }

  private destroyInternal(): void {
    this.resizeObs?.disconnect();
    try {
      this.app?.destroy(true, { children: true });
    } catch {
      /* ignore */
    }
    this.app = null;
    this.model = null;
    this.container?.replaceChildren();
  }
}
