/**
 * Strict schema validation for protocol messages.
 *
 * The Rust server re-implements exactly these rules in
 * apps/desktop/src-tauri/pet-core/src/protocol.rs (the desktop is the security
 * boundary — TS validation in the extension is a courtesy to fail early).
 * Both implementations are tested against test-vectors/protocol.json.
 */
import { z } from "zod";
import { ADAPTER_TYPES, OBSERVED_STATES } from "./task-types";
import {
  MAX_BODY_BYTES,
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  REQUIRED_OBSERVED,
  type ProtocolEnvelope,
} from "./event-types";

export const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
export const TASK_KEY_PATTERN = /^[\x21-\x7e]{1,256}$/;
export const SIGNAL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
export const EVIDENCE_PATTERN = /^[a-z0-9_:.-]{1,64}$/;
export const VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,32}$/;
export const LIMITS = {
  url: 2048,
  title: 300,
  signals: 32,
  evidence: 16,
  browser: 64,
  reason: 128,
  maxTs: 10_000_000_000_000, // year 2286, sanity bound
} as const;

const httpUrl = z
  .string()
  .max(LIMITS.url)
  .refine((s) => {
    if (!/^https?:\/\//i.test(s)) return false;
    try {
      const u = new URL(s);
      return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
    } catch {
      return false;
    }
  }, "url must be an absolute http(s) URL");

const signalsSchema = z
  .record(z.union([z.boolean(), z.number().finite()]))
  .refine((r) => Object.keys(r).length <= LIMITS.signals, `at most ${LIMITS.signals} signals`)
  .refine((r) => Object.keys(r).every((k) => SIGNAL_KEY_PATTERN.test(k)), "invalid signal key");

export const taskObservationSchema = z
  .object({
    taskKey: z.string().regex(TASK_KEY_PATTERN),
    previousTaskKey: z.string().regex(TASK_KEY_PATTERN).optional(),
    adapter: z.enum(ADAPTER_TYPES),
    url: httpUrl,
    title: z.string().max(LIMITS.title),
    observed: z.enum(OBSERVED_STATES),
    signals: signalsSchema,
    evidence: z.array(z.string().regex(EVIDENCE_PATTERN)).max(LIMITS.evidence),
    confidence: z.number().min(0).max(1),
    visible: z.boolean(),
    conflict: z.boolean().optional(),
  })
  .strict();

const connectedSchema = z
  .object({
    extensionVersion: z.string().regex(VERSION_PATTERN),
    browser: z.string().max(LIMITS.browser).optional(),
  })
  .strict();
const disconnectedSchema = z.object({ reason: z.string().max(LIMITS.reason).optional() }).strict();
const heartbeatSchema = z.object({ activeTabs: z.number().int().min(0).max(1000) }).strict();

const envelopeBase = z
  .object({
    v: z.literal(PROTOCOL_VERSION),
    id: z.string().regex(ID_PATTERN),
    type: z.enum(MESSAGE_TYPES),
    ts: z.number().int().positive().max(LIMITS.maxTs),
    clientId: z.string().regex(ID_PATTERN),
    payload: z.unknown(),
  })
  .strict();

export type ValidationResult =
  | { ok: true; value: ProtocolEnvelope }
  | { ok: false; error: string };

function payloadSchemaFor(type: (typeof MESSAGE_TYPES)[number]): z.ZodTypeAny {
  switch (type) {
    case "monitor.connected":
      return connectedSchema;
    case "monitor.disconnected":
      return disconnectedSchema;
    case "monitor.heartbeat":
      return heartbeatSchema;
    default:
      return taskObservationSchema;
  }
}

function formatZod(e: z.ZodError, prefix: string): string {
  const first = e.issues[0];
  const path = [prefix, ...(first?.path ?? [])].filter((p) => p !== "").join(".");
  return `${path || "message"}: ${first?.message ?? "invalid"}`;
}

/** Validate an already-parsed JSON value. */
export function validateEnvelope(input: unknown): ValidationResult {
  const base = envelopeBase.safeParse(input);
  if (!base.success) return { ok: false, error: formatZod(base.error, "") };
  const payload = payloadSchemaFor(base.data.type).safeParse(base.data.payload);
  if (!payload.success) return { ok: false, error: formatZod(payload.error, "payload") };
  const required = REQUIRED_OBSERVED[base.data.type];
  if (required && (payload.data as { observed: string }).observed !== required) {
    return { ok: false, error: `payload.observed: must be "${required}" for ${base.data.type}` };
  }
  return { ok: true, value: { ...base.data, payload: payload.data } as ProtocolEnvelope };
}

/** Validate a raw request body (size + JSON + schema). */
export function validateRawMessage(raw: string): ValidationResult {
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return { ok: false, error: "body too large" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid JSON" };
  }
  return validateEnvelope(parsed);
}

/** Random protocol id (event ids, client ids). */
export function randomId(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}
