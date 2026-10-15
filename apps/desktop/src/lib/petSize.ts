/** Pet window sizing (mirrors pet-core `clamp_pet_scale`). Base window is 200×240. */
export const PET_BASE_W = 200;
export const PET_BASE_H = 240;
export const PET_SCALE_MIN = 0.6;
export const PET_SCALE_MAX = 2.5;

export const SIZE_PRESETS: ReadonlyArray<{ label: string; scale: number }> = [
  { label: "小", scale: 0.75 },
  { label: "中", scale: 1 },
  { label: "大", scale: 1.5 },
];

/** Clamp to 60%–250%, rounded to 0.01; non-finite → 1. */
export function clampPetScale(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.round(Math.min(PET_SCALE_MAX, Math.max(PET_SCALE_MIN, v)) * 100) / 100;
}

/** Logical window size for a scale (aspect ratio is always 200:240). */
export function petWindowSize(scale: number): { width: number; height: number } {
  const s = clampPetScale(scale);
  return { width: Math.round(PET_BASE_W * s), height: Math.round(PET_BASE_H * s) };
}

/**
 * Next scale for a Cmd/Ctrl + wheel event. Scrolling up (deltaY < 0) grows the pet.
 * Proportional to the wheel delta (trackpad pinch sends small deltas), at most ±10% per event.
 */
export function scaleFromWheel(current: number, deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return clampPetScale(current);
  const step = Math.max(-0.1, Math.min(0.1, -deltaY * 0.002));
  return clampPetScale(clampPetScale(current) * (1 + step));
}

export const scalePercent = (s: number) => `${Math.round(clampPetScale(s) * 100)}%`;
