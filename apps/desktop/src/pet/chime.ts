/** Tiny WebAudio chime (no audio assets needed). */
let ctx: AudioContext | null = null;

export function playChime(kind: "completed" | "failed" | "needs_attention" | "connection_lost" | string): void {
  try {
    ctx ??= new AudioContext();
    const notes =
      kind === "completed" ? [880, 1318.5] : kind === "needs_attention" ? [988, 740, 988] : kind === "failed" ? [523.3, 392] : [660, 440];
    const t0 = ctx.currentTime + 0.01;
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const s = t0 + i * 0.13;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.18, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.32);
      o.connect(g).connect(ctx!.destination);
      o.start(s);
      o.stop(s + 0.35);
    });
  } catch {
    /* audio not available */
  }
}
