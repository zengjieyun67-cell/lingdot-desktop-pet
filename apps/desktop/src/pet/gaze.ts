/**
 * Gaze mapping: where 小喵 should look.
 *
 * Two cursor sources feed this:
 *  - local `mousemove` (clientX/clientY, only while the cursor is over the page), and
 *  - the Rust `pet-cursor` feed (~30 fps, global cursor converted to this window's logical px),
 *    which is what keeps her following the mouse in 桌面模式, where the scene sits behind
 *    every other window and almost never gets mouse events.
 *
 * Both arrive in window coordinates; `gazeOffset` turns them into an offset from her head,
 * measured from the pet element's real position in the window (in 桌面模式 she is not at
 * the window's centre).
 */

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Fraction of the pet box where the head is when the renderer can't say. */
export const DEFAULT_HEAD: Point = { x: 0.5, y: 0.38 };

/** The radius `normaliseLook` saturates around (PetRenderer.ts). */
export const LOOK_RADIUS = 260;

/**
 * Cursor (window logical px) → offset from the head (px, in `normaliseLook` space).
 *
 * `head` is the head position inside `box` as fractions (0..1). `reach` is how far (px) the
 * cursor has to go for a full turn: for the small floating pet the old 260 px feels right; in a
 * full-screen scene we scale it to the window so the screen edges ≈ full turn instead of
 * saturating a few centimetres away from her.
 */
export function gazeOffset(cursor: Point, box: Box, head: Point = DEFAULT_HEAD, reach = LOOK_RADIUS): { dx: number; dy: number } {
  const hx = box.left + box.width * head.x;
  const hy = box.top + box.height * head.y;
  const k = reach > 0 ? LOOK_RADIUS / reach : 1;
  return { dx: (cursor.x - hx) * k, dy: (cursor.y - hy) * k };
}

/** Full-turn distance for a window of this size: the pet's 260 px, or ~45 % of a big scene. */
export function reachFor(windowW: number, windowH: number, isScene: boolean): number {
  if (!isScene) return LOOK_RADIUS;
  return Math.max(LOOK_RADIUS, Math.max(windowW, windowH) * 0.45);
}

/** The cursor payload from Rust (`windows::spawn_cursor_feed`). */
export interface CursorFeed {
  window?: string;
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
}

/** Is this feed event for us? (JS `listen` hears events targeted at every window.) Older builds sent no label → pet only. */
export function feedIsFor(p: CursorFeed, label: string): boolean {
  return (p.window ?? "pet") === label;
}

/** After this long without the cursor moving she eases back to looking straight ahead. */
export const GAZE_IDLE_MS = 4500;

/**
 * Tracks cursor activity and says when to return to centre. Pure (clock passed in) so it is testable.
 */
export class GazeIdle {
  private last = -Infinity;
  private centred = true;
  constructor(private readonly idleMs = GAZE_IDLE_MS) {}

  /** A real cursor movement happened. */
  moved(now: number): void {
    this.last = now;
    this.centred = false;
  }

  /** Call periodically: true exactly once per idle period (then look at 0,0). */
  shouldCentre(now: number): boolean {
    if (this.centred || now - this.last < this.idleMs) return false;
    this.centred = true;
    return true;
  }
}
