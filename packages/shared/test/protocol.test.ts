import { describe, expect, it } from "vitest";
import vectors from "../test-vectors/protocol.json";
import { validateEnvelope, validateRawMessage, randomId, ID_PATTERN } from "../src/protocol-validation";
import { MAX_BODY_BYTES, observedToMessageType } from "../src/event-types";

describe("protocol validation — shared vectors", () => {
  for (const c of vectors.cases) {
    it(`${c.valid ? "accepts" : "rejects"}: ${c.name}`, () => {
      const r = validateEnvelope(c.message);
      expect(r.ok, r.ok ? "" : r.error).toBe(c.valid);
    });
  }
});

describe("raw message validation", () => {
  it("rejects oversize bodies", () => {
    const big = JSON.stringify({ pad: "x".repeat(MAX_BODY_BYTES) });
    const r = validateRawMessage(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too large/);
  });
  it("rejects invalid JSON", () => {
    const r = validateRawMessage("{nope");
    expect(r.ok).toBe(false);
  });
  it("accepts a valid serialized message", () => {
    const r = validateRawMessage(JSON.stringify(vectors.cases[0]!.message));
    expect(r.ok).toBe(true);
  });
});

describe("helpers", () => {
  it("randomId matches the id pattern", () => {
    for (let i = 0; i < 20; i++) expect(ID_PATTERN.test(randomId())).toBe(true);
  });
  it("maps observed state to message type", () => {
    expect(observedToMessageType("completed", false)).toBe("task.completed");
    expect(observedToMessageType("failed", false)).toBe("task.failed");
    expect(observedToMessageType("needs_attention", false)).toBe("task.needs_attention");
    expect(observedToMessageType("running", false)).toBe("task.status_changed");
    expect(observedToMessageType("unknown", true)).toBe("task.status_changed");
    expect(observedToMessageType("unknown", false)).toBe("task.observed");
  });
});
