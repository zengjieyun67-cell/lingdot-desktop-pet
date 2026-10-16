import styles from "./Spectrum.module.css";

const BARS = 28;

/** Deterministic pseudo-random bar profile (taller in the middle, like a music spectrum). */
export function spectrumProfile(n = BARS): number[] {
  return Array.from({ length: n }, (_, i) => {
    const mid = 1 - Math.abs(i - (n - 1) / 2) / (n / 2);
    const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    return Math.round((0.25 + 0.6 * mid + 0.15 * Math.abs(jitter)) * 100) / 100;
  });
}

/** Animated audio-spectrum bars (decorative; shown while music is playing). */
export function Spectrum({ className = "" }: { className?: string }) {
  return (
    <div className={`${styles.spectrum} ${className}`} aria-hidden>
      {spectrumProfile().map((h, i) => (
        <i key={i} style={{ ["--h" as string]: h, animationDelay: `${-(i * 137) % 900}ms`, animationDuration: `${620 + ((i * 53) % 420)}ms` }} />
      ))}
    </div>
  );
}
