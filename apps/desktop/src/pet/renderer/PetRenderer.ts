import type { DisplayState, Emotion, PetMood } from "@desktop-pet/shared";
import type { TouchKind } from "../touchReactions";

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
  /** Where the head is inside the stage, as fractions (0..1); null/absent = default (0.5, 0.38). */
  headAnchor?(): { x: number; y: number } | null;
  setAnimationsEnabled(enabled: boolean): void;
  /** One-shot reaction when the user clicks/taps the pet. */
  poke(): void;
  /** Phase 2: resolved display state (mood or ambient activity such as music / nap). */
  setDisplayState?(state: DisplayState): void;
  /** Phase 2: 小喵 is talking (TTS playing) – animate the mouth. */
  setSpeaking?(speaking: boolean): void;
  /** Phase 2: 小喵 is listening to the user (mic open) – perk the ears. */
  setListening?(listening: boolean): void;
  /** Touch / drag reaction (head pat, poke, rub, drag, drop, shake): motion + expression. */
  react?(kind: TouchKind): void;
  destroy(): void;
}

/** Normalise a cursor offset (px) into -1..1 with a soft falloff. */
export function normaliseLook(dx: number, dy: number, radius = 260): { x: number; y: number } {
  const f = (v: number) => Math.max(-1, Math.min(1, Math.tanh(v / radius) * 1.15));
  return { x: f(dx), y: f(dy) };
}
