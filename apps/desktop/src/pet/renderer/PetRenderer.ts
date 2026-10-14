import type { Emotion, PetMood } from "@desktop-pet/shared";

/**
 * Abstraction over the pet character. Two implementations:
 *  - SvgCatgirlRenderer  (built-in, always available)
 *  - Live2DRenderer      (pixi.js + pixi-live2d-display, needs user-provided
 *                         Cubism Core + .model3.json)
 */
export interface PetRenderer {
  readonly kind: "svg" | "live2d";
  mount(container: HTMLElement): Promise<void>;
  setMood(mood: PetMood): void;
  /** 小喵's emotion (expression layer on top of the task mood). */
  setEmotion(emotion: Emotion): void;
  /** Cursor direction relative to the pet's head, in logical px. */
  lookAt(dx: number, dy: number): void;
  setAnimationsEnabled(enabled: boolean): void;
  /** One-shot reaction when the user clicks/taps the pet. */
  poke(): void;
  destroy(): void;
}

/** Normalise a cursor offset (px) into -1..1 with a soft falloff. */
export function normaliseLook(dx: number, dy: number, radius = 260): { x: number; y: number } {
  const f = (v: number) => Math.max(-1, Math.min(1, Math.tanh(v / radius) * 1.15));
  return { x: f(dx), y: f(dy) };
}
