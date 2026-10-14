import {
  classifySignals,
  initialClassifierMemory,
  type AdapterType,
  type Classification,
  type ClassifierMemory,
  type PageSignals,
} from "@desktop-pet/shared";

/**
 * A site adapter turns *visible* DOM state into PageSignals.
 * It must never read or transmit page body text, form values, cookies or storage.
 * (It may test whether an element exists / is visible / is disabled, and may
 * compute a local, non-transmitted fingerprint of an element's size/length.)
 */
export interface SiteAdapter {
  readonly type: AdapterType;
  matches(url: URL): boolean;
  /** Start observing; `cb` is invoked (throttled) whenever relevant DOM changes. */
  observe(cb: () => void): void;
  getCurrentSignals(): PageSignals;
  /** Classify the current signals (stateful: tracks execution + stability). */
  classifyState(now?: number): Classification;
  /** Stable key for the task on this page. */
  taskKey(): string;
  /** Numeric/boolean signals safe to transmit. */
  transmittableSignals(sig: PageSignals): Record<string, boolean | number>;
  dispose(): void;
}

export const EMPTY_SIGNALS: PageSignals = {
  executing: false,
  streaming: false,
  composerReady: false,
  resultPresent: false,
  resultFingerprint: "",
  error: false,
  loginWall: false,
  confirmRequired: false,
};

export function isVisible(el: Element | null): boolean {
  if (!el) return false;
  const h = el as HTMLElement;
  if (h.hidden) return false;
  const view = h.ownerDocument?.defaultView;
  if (view && typeof view.getComputedStyle === "function") {
    const cs = view.getComputedStyle(h);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
  }
  return true;
}

export function queryFirst(root: ParentNode, selectors: readonly string[]): Element | null {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch {
      /* invalid selector in config: ignore */
    }
  }
  return null;
}

export function queryAll(root: ParentNode, selectors: readonly string[]): Element[] {
  const out = new Set<Element>();
  for (const sel of selectors) {
    try {
      root.querySelectorAll(sel).forEach((e) => out.add(e));
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

/** Base class: MutationObserver + throttle + shared classifier memory. */
export abstract class DomAdapter implements SiteAdapter {
  abstract readonly type: AdapterType;
  protected memory: ClassifierMemory = initialClassifierMemory(Date.now());
  protected observer: MutationObserver | null = null;
  private throttle: number | undefined;
  protected readonly sessionId = Math.random().toString(36).slice(2, 10);
  protected stableMs = 2000;

  constructor(protected readonly doc: Document = document) {}

  abstract matches(url: URL): boolean;
  abstract getCurrentSignals(): PageSignals;

  observe(cb: () => void): void {
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => {
      if (this.throttle !== undefined) return;
      this.throttle = window.setTimeout(() => {
        this.throttle = undefined;
        cb();
      }, 350);
    });
    this.observer.observe(this.doc.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-label", "data-testid", "class", "hidden", "aria-busy"],
      characterData: true,
    });
  }

  classifyState(now = Date.now()): Classification {
    const r = classifySignals(this.getCurrentSignals(), this.memory, now, this.stableMs);
    this.memory = r.memory;
    return r;
  }

  taskKey(): string {
    const loc = this.doc.location;
    return `${this.type}:${loc.host}${loc.pathname}`.slice(0, 256).replace(/[^\x21-\x7e]/g, "_");
  }

  transmittableSignals(sig: PageSignals): Record<string, boolean | number> {
    return {
      executing: sig.executing,
      streaming: sig.streaming,
      composerReady: sig.composerReady,
      resultPresent: sig.resultPresent,
      error: sig.error,
      loginWall: sig.loginWall,
      confirmRequired: sig.confirmRequired,
    };
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    window.clearTimeout(this.throttle);
  }
}
