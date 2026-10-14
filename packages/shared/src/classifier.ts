/**
 * Extension-local signal classifier.
 *
 * Adapters read *visible DOM signals* (booleans + a content fingerprint) and this
 * pure function turns them into an ObservedState. It is deliberately conservative:
 *  - "completed" requires: execution was seen earlier in this page session, the
 *    execution indicator is gone, the composer is ready again, an assistant
 *    message exists, and its fingerprint has been stable for `stableMs`.
 *  - contradictory signals produce `unknown` + `conflict: true`.
 *  - nothing recognised produces `unknown` (no conflict) => desktop keeps status.
 */
import type { ObservedState } from "./task-types";

export interface PageSignals {
  /** Explicit execution indicator (e.g. a visible "Stop generating" button). */
  executing: boolean;
  /** Streaming indicator (e.g. `.result-streaming`). */
  streaming: boolean;
  /** Composer/send button is present and enabled. */
  composerReady: boolean;
  /** At least one assistant/result message is on the page. */
  resultPresent: boolean;
  /** Hash of the last result's length/structure — never the text itself. */
  resultFingerprint: string;
  /** Explicit error UI (error banner, "regenerate" with error state). */
  error: boolean;
  /** Login wall / auth page. */
  loginWall: boolean;
  /** Explicit confirmation / authorization prompt. */
  confirmRequired: boolean;
}

export interface ClassifierMemory {
  sawExecution: boolean;
  lastFingerprint: string;
  fingerprintSince: number;
}

export interface Classification {
  observed: ObservedState;
  conflict: boolean;
  confidence: number;
  evidence: string[];
  memory: ClassifierMemory;
}

export const DEFAULT_STABLE_MS = 2000;

export function initialClassifierMemory(now = 0): ClassifierMemory {
  return { sawExecution: false, lastFingerprint: "", fingerprintSince: now };
}

export function classifySignals(
  s: PageSignals,
  mem: ClassifierMemory,
  now: number,
  stableMs = DEFAULT_STABLE_MS,
): Classification {
  const evidence: string[] = [];
  if (s.executing) evidence.push("execution_indicator");
  if (s.streaming) evidence.push("streaming_indicator");
  if (s.composerReady) evidence.push("composer_ready");
  if (s.resultPresent) evidence.push("result_present");
  if (s.error) evidence.push("error_visible");
  if (s.loginWall) evidence.push("login_wall");
  if (s.confirmRequired) evidence.push("confirm_required");

  // Fingerprint stability bookkeeping.
  let memory: ClassifierMemory = { ...mem };
  if (s.resultFingerprint !== mem.lastFingerprint) {
    memory = { ...memory, lastFingerprint: s.resultFingerprint, fingerprintSince: now };
  }
  const active = s.executing || s.streaming;
  const attention = s.loginWall || s.confirmRequired;

  // Conflicts first: never guess.
  if (attention && active) {
    return { observed: "unknown", conflict: true, confidence: 0.3, evidence: [...evidence, "conflict"], memory };
  }
  if (s.error && active) {
    return { observed: "unknown", conflict: true, confidence: 0.3, evidence: [...evidence, "conflict"], memory };
  }
  if (attention) {
    return { observed: "needs_attention", conflict: false, confidence: 0.9, evidence, memory };
  }
  if (s.error) {
    return {
      observed: "failed",
      conflict: false,
      confidence: 0.85,
      evidence,
      memory: { ...memory, sawExecution: false },
    };
  }
  if (active) {
    return {
      observed: "running",
      conflict: false,
      confidence: s.executing && s.streaming ? 0.95 : 0.8,
      evidence,
      memory: { ...memory, sawExecution: true },
    };
  }
  if (memory.sawExecution && s.composerReady && s.resultPresent) {
    const stableFor = now - memory.fingerprintSince;
    if (stableFor >= stableMs) {
      return {
        observed: "completed",
        conflict: false,
        confidence: 0.9,
        evidence: [...evidence, "result_stable"],
        memory: { ...memory, sawExecution: false },
      };
    }
    return { observed: "unknown", conflict: false, confidence: 0.5, evidence: [...evidence, "awaiting_stability"], memory };
  }
  return { observed: "unknown", conflict: false, confidence: 0.2, evidence: [...evidence, "no_known_signal"], memory };
}
