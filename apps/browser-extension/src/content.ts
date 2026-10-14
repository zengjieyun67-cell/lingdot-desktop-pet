/**
 * Content script (registered dynamically ONLY for origins the user granted).
 * Observes visible signals through a site adapter and reports classified state
 * changes to the background worker. Sends only: title, url, boolean/number
 * signals and short evidence codes. Never page text, form values or cookies.
 */
import { observedToMessageType, type ObservedState, type TaskObservationPayload } from "@desktop-pet/shared";
import { pickAdapter } from "./adapters";
import type { InternalMessage } from "./lib";

declare global {
  interface Window {
    __desktopPetMonitor?: boolean;
  }
}

const PERIODIC_MS = 30_000;
const TICK_MS = 1000;

function main() {
  if (window.__desktopPetMonitor) return; // already injected
  window.__desktopPetMonitor = true;

  const adapter = pickAdapter(location.href);
  let lastSent: { key: string; observed: ObservedState; conflict: boolean } | null = null;
  let lastSentAt = 0;
  let currentKey = adapter.taskKey();
  let previousKey: string | undefined;
  let alive = true;

  const send = (msg: InternalMessage) => {
    try {
      chrome.runtime.sendMessage(msg).catch(() => undefined);
    } catch {
      // Extension reloaded/updated: this script is orphaned.
      alive = false;
      adapter.dispose();
    }
  };

  const evaluate = (force = false) => {
    if (!alive) return;
    const key = adapter.taskKey();
    if (key !== currentKey) {
      previousKey = currentKey;
      currentKey = key;
    }
    const sig = adapter.getCurrentSignals();
    const c = adapter.classifyState(Date.now());
    const changed = !lastSent || lastSent.key !== key || lastSent.observed !== c.observed || lastSent.conflict !== c.conflict;
    const periodic = Date.now() - lastSentAt > PERIODIC_MS;
    // Only explicit states or periodic keep-alives are sent; quiet "unknown" is cheap.
    if (!changed && !periodic && !force) return;

    const payload: TaskObservationPayload = {
      taskKey: key,
      ...(previousKey && previousKey !== key ? { previousTaskKey: previousKey } : {}),
      adapter: adapter.type,
      url: location.href.slice(0, 2048),
      title: (document.title || "").slice(0, 300),
      observed: c.observed,
      signals: adapter.transmittableSignals(sig),
      evidence: c.evidence.slice(0, 16),
      confidence: Math.round(c.confidence * 100) / 100,
      visible: document.visibilityState === "visible",
      conflict: c.conflict,
    };
    send({ kind: "observation", event: observedToMessageType(c.observed, c.conflict), payload });
    lastSent = { key, observed: c.observed, conflict: c.conflict };
    lastSentAt = Date.now();
    if (previousKey && c.observed !== "unknown") previousKey = undefined;
  };

  adapter.observe(() => evaluate());
  const timer = window.setInterval(() => evaluate(), TICK_MS);
  document.addEventListener("visibilitychange", () => evaluate(true));
  window.addEventListener("pagehide", () => {
    window.clearInterval(timer);
    adapter.dispose();
  });
  evaluate();
}

main();
