import type { PageSignals } from "@desktop-pet/shared";
import { DomAdapter, EMPTY_SIGNALS, isVisible, queryFirst } from "./types";

/**
 * Generic adapter (any authorised site without a dedicated adapter).
 *
 * Deliberately weak: it only recognises standard ARIA "busy"/progress markers as
 * an execution signal. It has NO explicit success or error signal, so it never
 * reports `completed` or `failed` — those need a site-specific adapter or a
 * manual status change in the panel. Element disappearance is NOT success.
 */
export const GENERIC_SELECTORS = {
  busy: ['main [aria-busy="true"]', '[role="main"] [aria-busy="true"]', 'main[aria-busy="true"]'],
  progress: ['main [role="progressbar"]', '[role="main"] [role="progressbar"]'],
} as const;

export class GenericAdapter extends DomAdapter {
  readonly type: "generic" | "hark" | "bilibili" | "capcut" = "generic";

  matches(_url: URL): boolean {
    return true;
  }

  getCurrentSignals(): PageSignals {
    const busy = isVisible(queryFirst(this.doc, GENERIC_SELECTORS.busy));
    const progress = isVisible(queryFirst(this.doc, GENERIC_SELECTORS.progress));
    return { ...EMPTY_SIGNALS, executing: busy || progress };
  }
}
