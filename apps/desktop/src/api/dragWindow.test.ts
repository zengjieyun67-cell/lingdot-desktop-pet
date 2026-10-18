import { describe, expect, it, vi } from "vitest";
import { DRAG_START_PX, dragWindowOnMove } from "./client";

const move = (x: number, y: number, buttons = 1) => window.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, buttons }));

describe("dragWindowOnMove (Windows: a plain click must stay a click)", () => {
  it("does not start a window drag for a click without movement", () => {
    const start = vi.fn();
    dragWindowOnMove({ button: 0, clientX: 10, clientY: 10 }, start);
    move(11, 11);
    window.dispatchEvent(new MouseEvent("mouseup"));
    move(40, 40); // after release: listeners are gone
    expect(start).not.toHaveBeenCalled();
  });

  it("starts exactly one drag once the pointer travels with the button held", () => {
    const start = vi.fn();
    dragWindowOnMove({ button: 0, clientX: 10, clientY: 10 }, start);
    move(10 + DRAG_START_PX + 1, 10);
    move(60, 60);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("ignores right / middle buttons and moves without the button", () => {
    const start = vi.fn();
    dragWindowOnMove({ button: 2, clientX: 0, clientY: 0 }, start);
    move(50, 50);
    dragWindowOnMove({ button: 0, clientX: 0, clientY: 0 }, start);
    move(50, 50, 0); // button already released (mouseup eaten elsewhere)
    move(90, 90);
    expect(start).not.toHaveBeenCalled();
  });
});
