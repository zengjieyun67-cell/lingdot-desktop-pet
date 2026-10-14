import { describe, expect, it } from "vitest";
import { IGNORED_AFTER_MS, PatDetector, PersonaController, type PersonaSettings } from "./persona";

const S: PersonaSettings = { petName: "小喵", userTitle: "主人", personaBubbles: true, mealReminders: true, lateNightReminders: true };

function clockAt(start: Date) {
  let t = start.getTime();
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

describe("PersonaController", () => {
  it("speaks in character with name/user filled and no immediate repeats", () => {
    const c = clockAt(new Date(2026, 9, 14, 15, 0));
    const p = new PersonaController(S, 50, 30, c.now);
    let last = "";
    for (let i = 0; i < 20; i++) {
      c.advance(20_000);
      const s = p.say("task_completed", { task: "写周报", site: "ChatGPT" });
      expect(s.text).toBeTruthy();
      expect(s.text).not.toContain("{");
      expect(s.text).not.toBe(last);
      last = s.text!;
    }
    expect(p.emotion).toBe("happy");
  });

  it("bubbles off: emotion still changes, no text", () => {
    const c = clockAt(new Date(2026, 9, 14, 15, 0));
    const p = new PersonaController({ ...S, personaBubbles: false }, 50, 30, c.now);
    const s = p.say("task_failed");
    expect(s.text).toBeNull();
    expect(s.emotion).toBe("angry");
  });

  it("returns 'returned' after a long absence, 'greeting' otherwise", () => {
    const c = clockAt(new Date(2026, 9, 14, 10, 0));
    const p = new PersonaController(S, 50, 30, c.now);
    expect(p.greet(c.now().getTime() - 7 * 3600_000).trigger).toBe("returned");
    expect(p.greet(c.now().getTime() - 60_000).trigger).toBe("greeting");
    expect(p.greet(null).trigger).toBe("greeting");
  });

  it("late-night reminder at most once per hour, with sleepy emotion and the user's title available", () => {
    const c = clockAt(new Date(2026, 9, 14, 23, 30));
    const p = new PersonaController({ ...S, userTitle: "前辈" }, 50, 30, c.now);
    const first = p.tick();
    expect(first?.trigger).toBe("late_night");
    expect(first?.emotion).toBe("sleepy");
    c.advance(10 * 60_000);
    expect(p.tick()?.trigger).not.toBe("late_night");
    c.advance(51 * 60_000);
    expect(p.tick()?.trigger).toBe("late_night");
  });

  it("meal reminder once per meal window per day", () => {
    const c = clockAt(new Date(2026, 9, 14, 12, 0));
    const p = new PersonaController(S, 50, 30, c.now);
    expect(p.tick()?.trigger).toBe("meal_time");
    c.advance(5 * 60_000);
    expect(p.tick()).toBeNull();
  });

  it("'ignored' after 45 minutes without interaction, then cooldown; touch resets", () => {
    const c = clockAt(new Date(2026, 9, 14, 14, 0));
    const p = new PersonaController(S, 50, 30, c.now);
    c.advance(IGNORED_AFTER_MS - 1000);
    expect(p.tick()).toBeNull();
    c.advance(2000);
    expect(p.tick()?.trigger).toBe("ignored");
    expect(p.emotion).toBe("angry");
    c.advance(30 * 60_000);
    expect(p.tick()).toBeNull();
    const q = new PersonaController(S, 50, 30, c.now);
    c.advance(IGNORED_AFTER_MS - 1000);
    q.touch();
    c.advance(2000);
    expect(q.tick()).toBeNull();
  });

  it("many running tasks speaks once per cooldown", () => {
    const c = clockAt(new Date(2026, 9, 14, 14, 0));
    const p = new PersonaController(S, 50, 30, c.now);
    expect(p.runningTasks(2)).toBeNull();
    expect(p.runningTasks(3)?.trigger).toBe("many_tasks");
    c.advance(60_000);
    expect(p.runningTasks(4)).toBeNull();
  });

  it("chatter lines are rate limited, event lines are not", () => {
    const c = clockAt(new Date(2026, 9, 14, 14, 0));
    const p = new PersonaController(S, 50, 30, c.now);
    expect(p.say("clicked", {}, true).text).toBeTruthy();
    expect(p.say("clicked", {}, true).text).toBeNull();
    expect(p.say("task_completed").text).toBeTruthy();
  });
});

describe("PatDetector", () => {
  it("detects rubbing back and forth, ignores a straight pass", () => {
    const d = new PatDetector();
    let hit = false;
    [0, 10, 20, 30, 40, 50].forEach((x, i) => (hit = hit || d.feed(x, i * 50)));
    expect(hit).toBe(false);
    d.reset();
    const xs = [0, 15, 0, 15, 0, 15];
    hit = false;
    xs.forEach((x, i) => (hit = hit || d.feed(x, i * 100)));
    expect(hit).toBe(true);
  });
});
