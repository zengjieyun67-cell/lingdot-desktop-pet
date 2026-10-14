import { describe, expect, it } from "vitest";
import vectors from "../test-vectors/state-machine.json";
import { applyEvent, initialMachineState, type MachineEvent, type MachineState } from "../src/state-machine";
import type { TaskStatus } from "../src/task-types";

interface Step {
  event: MachineEvent;
  expect: Partial<{ status: TaskStatus; notify: string | null; runAction: string; runNo: number | null; ignored: boolean; reason: string }>;
}

describe("state machine — shared vectors", () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      let state: MachineState = {
        ...initialMachineState(c.initial.status as TaskStatus),
        activeRunNo: c.initial.activeRunNo,
        runCount: c.initial.runCount,
      };
      (c.steps as Step[]).forEach((step, i) => {
        const r = applyEvent(state, step.event);
        const ctx = `${c.name} / step ${i} (${step.event.eventId})`;
        const e = step.expect;
        if (e.status !== undefined) expect(r.to, ctx).toBe(e.status);
        if (e.notify !== undefined) expect(r.notify, ctx).toBe(e.notify);
        if (e.runAction !== undefined) expect(r.runAction, ctx).toBe(e.runAction);
        if (e.runNo !== undefined) expect(r.runNo, ctx).toBe(e.runNo);
        if (e.ignored !== undefined) expect(r.ignored, ctx).toBe(e.ignored);
        if (e.reason !== undefined) expect(r.reason, ctx).toBe(e.reason);
        state = r.state;
      });
    });
  }
});

describe("state machine — invariants", () => {
  const kinds: MachineEvent["kind"][] = ["running", "completed", "failed", "needs_attention", "unknown", "timeout"];

  it("no-signal / timeout / conflict events never produce completed or failed (random walk)", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let walk = 0; walk < 200; walk++) {
      let state = initialMachineState();
      for (let i = 0; i < 40; i++) {
        const kind = kinds[Math.floor(rnd() * kinds.length)]!;
        const conflict = rnd() < 0.5;
        const r = applyEvent(state, { eventId: `w${walk}-${i}`, kind, conflict });
        if (kind === "unknown" || kind === "timeout") {
          if (r.changed) expect(["completed", "failed"]).not.toContain(r.to);
          expect(r.notify).toBeNull();
        }
        if (r.to === "completed" && r.changed) expect(kind).toBe("completed");
        if (r.to === "failed" && r.changed) expect(kind).toBe("failed");
        if (r.to === "running" && r.changed) expect(kind).toBe("running");
        state = r.state;
      }
    }
  });

  it("each (run, status) notifies at most once", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let walk = 0; walk < 200; walk++) {
      let state = initialMachineState();
      const fired = new Set<string>();
      for (let i = 0; i < 60; i++) {
        const kind = kinds[Math.floor(rnd() * kinds.length)]!;
        const r = applyEvent(state, { eventId: `n${walk}-${i}`, kind });
        if (r.notify) {
          const key = `${r.runNo ?? 0}:${r.notify}`;
          expect(fired.has(key), key).toBe(false);
          fired.add(key);
        }
        state = r.state;
      }
    }
  });

  it("seen event ids are capped", () => {
    let state = initialMachineState();
    for (let i = 0; i < 400; i++) state = applyEvent(state, { eventId: `id${i}`, kind: "unknown" }).state;
    expect(state.seenEventIds.length).toBe(256);
  });
});
