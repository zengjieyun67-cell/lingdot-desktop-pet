import { describe, expect, it } from "vitest";
import { classifySignals, initialClassifierMemory, type PageSignals, type ClassifierMemory } from "../src/classifier";

const idle: PageSignals = {
  executing: false, streaming: false, composerReady: true, resultPresent: false,
  resultFingerprint: "", error: false, loginWall: false, confirmRequired: false,
};

function run(seq: Array<[number, Partial<PageSignals>]>, stableMs = 2000) {
  let mem: ClassifierMemory = initialClassifierMemory(0);
  return seq.map(([t, s]) => {
    const r = classifySignals({ ...idle, ...s }, mem, t, stableMs);
    mem = r.memory;
    return r;
  });
}

describe("classifier", () => {
  it("returns unknown (no conflict) when nothing is recognised", () => {
    const [r] = run([[0, { composerReady: false }]]);
    expect(r!.observed).toBe("unknown");
    expect(r!.conflict).toBe(false);
    expect(r!.evidence).toContain("no_known_signal");
  });

  it("stop button => running", () => {
    const [r] = run([[0, { executing: true, composerReady: false }]]);
    expect(r!.observed).toBe("running");
  });

  it("completed only after execution, composer ready, result present and stable", () => {
    const rs = run([
      [0, { executing: true, composerReady: false, resultPresent: true, resultFingerprint: "a" }],
      [500, { executing: true, streaming: true, composerReady: false, resultPresent: true, resultFingerprint: "b" }],
      [1000, { resultPresent: true, resultFingerprint: "c" }], // stop gone, send back, still changing
      [2000, { resultPresent: true, resultFingerprint: "c" }], // stable 1000ms < 2000
      [3100, { resultPresent: true, resultFingerprint: "c" }], // stable 2100ms
      [4000, { resultPresent: true, resultFingerprint: "c" }], // already reported
    ]);
    expect(rs.map((r) => r.observed)).toEqual(["running", "running", "unknown", "unknown", "completed", "unknown"]);
    expect(rs[4]!.evidence).toContain("result_stable");
  });

  it("never completes without having seen execution (page loaded with old answer)", () => {
    const rs = run([
      [0, { resultPresent: true, resultFingerprint: "x" }],
      [10000, { resultPresent: true, resultFingerprint: "x" }],
    ]);
    expect(rs.every((r) => r.observed === "unknown")).toBe(true);
  });

  it("element vanished without composer returning stays unknown", () => {
    const rs = run([
      [0, { executing: true, composerReady: false }],
      [5000, { composerReady: false, resultPresent: true, resultFingerprint: "z" }],
      [9000, { composerReady: false, resultPresent: true, resultFingerprint: "z" }],
    ]);
    expect(rs.map((r) => r.observed)).toEqual(["running", "unknown", "unknown"]);
  });

  it("error => failed; error while executing => conflict", () => {
    expect(run([[0, { error: true }]])[0]!.observed).toBe("failed");
    const c = run([[0, { error: true, executing: true }]])[0]!;
    expect(c.observed).toBe("unknown");
    expect(c.conflict).toBe(true);
  });

  it("login wall => needs_attention; with execution => conflict", () => {
    expect(run([[0, { loginWall: true }]])[0]!.observed).toBe("needs_attention");
    expect(run([[0, { confirmRequired: true }]])[0]!.observed).toBe("needs_attention");
    const c = run([[0, { loginWall: true, streaming: true }]])[0]!;
    expect(c.observed).toBe("unknown");
    expect(c.conflict).toBe(true);
  });

  it("evidence codes are protocol-safe", () => {
    const r = run([[0, { executing: true, error: true, loginWall: true }]])[0]!;
    for (const e of r.evidence) expect(e).toMatch(/^[a-z0-9_:.-]{1,64}$/);
  });
});
