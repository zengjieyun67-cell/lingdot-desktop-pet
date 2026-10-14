/** Shared helpers for background / popup / options (pure where possible, unit-tested). */
import type { MonitoredSiteInfo } from "@desktop-pet/shared";

export interface Pairing {
  port: number;
  token: string;
}

export type ConnState = "unpaired" | "connecting" | "connected" | "unauthorized" | "offline";

export interface ConnStatus {
  state: ConnState;
  lastOkAt: number | null;
  lastError: string | null;
  port: number | null;
}

/** Messages exchanged inside the extension (content/popup -> background). */
export type InternalMessage =
  | { kind: "observation"; payload: import("@desktop-pet/shared").TaskObservationPayload; event: import("@desktop-pet/shared").TaskMessageType }
  | { kind: "getStatus" }
  | { kind: "savePairing"; pairing: Pairing }
  | { kind: "unpair" }
  | { kind: "testConnection" }
  | { kind: "fetchSites" }
  | { kind: "syncScripts" };

export interface SitesResponse {
  ok: boolean;
  sites?: MonitoredSiteInfo[];
  error?: string;
}

/**
 * Accepts the pairing code copied from the desktop panel:
 *   {"port":17321,"token":"<64 hex>"}   or   "17321 <token>"   or   "127.0.0.1:17321 <token>"
 */
export function parsePairing(raw: string): Pairing | null {
  const s = raw.trim();
  if (!s) return null;
  let port: unknown;
  let token: unknown;
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as { port?: unknown; token?: unknown };
      port = o.port;
      token = o.token;
    } catch {
      return null;
    }
  } else {
    const m = s.match(/^(?:127\.0\.0\.1:)?(\d{2,5})\s+([A-Za-z0-9]+)$/);
    if (!m) return null;
    port = Number(m[1]);
    token = m[2];
  }
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65535) return null;
  if (typeof token !== "string" || !/^[A-Za-z0-9]{16,128}$/.test(token)) return null;
  return { port, token };
}

/** Exponential backoff with jitter: 1s, 2s, 4s … capped at 30s. */
export function backoffMs(attempt: number, rand = Math.random()): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + rand * 0.4));
}

/** Retry only on network errors and 5xx / 429. Auth / schema errors are permanent. */
export function isRetryable(status: number | null): boolean {
  return status === null || status === 429 || status >= 500;
}

/** Turn an origin like https://chatgpt.com into a match pattern. */
export function originToPattern(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

export function patternToOrigin(pattern: string): string {
  return pattern.replace(/\/\*$/, "");
}

export const LOCAL_PATTERN = "http://127.0.0.1/*";
