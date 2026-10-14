import type { Emotion, PetMood } from "@desktop-pet/shared";
import styles from "./Catgirl.module.css";
import { buildCatgirlSvg } from "./catgirlSvg";
import { normaliseLook, type PetRenderer } from "./PetRenderer";

const EMOTION_CLASS: Record<Emotion, string | undefined> = {
  neutral: undefined,
  happy: styles.emoHappy,
  shy: styles.emoShy,
  angry: styles.emoAngry,
  sleepy: styles.emoSleepy,
};

const MOOD_CLASS: Record<PetMood, string | undefined> = {
  idle: undefined,
  working: styles.working,
  completed: styles.completed,
  needs_attention: styles.needsAttention,
};

/** Built-in layered SVG catgirl with CSS/JS Live2D-style motion. */
export class SvgCatgirlRenderer implements PetRenderer {
  readonly kind = "svg" as const;
  private root: HTMLDivElement | null = null;
  private blinkTimer: number | undefined;
  private idleLookTimer: number | undefined;
  private mood: PetMood = "idle";
  private emotion: Emotion = "neutral";
  private animations = true;
  private lastLookAt = 0;

  async mount(container: HTMLElement): Promise<void> {
    const root = document.createElement("div");
    root.className = styles.root ?? "";
    root.innerHTML = buildCatgirlSvg(styles, `cg${Math.random().toString(36).slice(2, 7)}`);
    container.appendChild(root);
    this.root = root;
    this.applyClasses();
    this.scheduleBlink();
    this.scheduleIdleLook();
  }

  setMood(mood: PetMood): void {
    this.mood = mood;
    this.applyClasses();
  }

  setEmotion(emotion: Emotion): void {
    this.emotion = emotion;
    this.applyClasses();
  }

  lookAt(dx: number, dy: number): void {
    if (!this.root) return;
    this.lastLookAt = Date.now();
    const { x, y } = this.animations ? normaliseLook(dx, dy) : { x: 0, y: 0 };
    this.root.style.setProperty("--lx", x.toFixed(3));
    this.root.style.setProperty("--ly", y.toFixed(3));
  }

  setAnimationsEnabled(enabled: boolean): void {
    this.animations = enabled;
    if (!enabled) this.lookAt(0, 0);
    this.applyClasses();
  }

  poke(): void {
    if (!this.root || !this.animations) return;
    // quick double blink + ear flick
    this.blink();
    window.setTimeout(() => this.blink(), 260);
  }

  destroy(): void {
    window.clearTimeout(this.blinkTimer);
    window.clearTimeout(this.idleLookTimer);
    this.root?.remove();
    this.root = null;
  }

  private applyClasses(): void {
    if (!this.root) return;
    const cls = [styles.root, EMOTION_CLASS[this.emotion], MOOD_CLASS[this.mood], this.animations ? undefined : styles.still];
    this.root.className = cls.filter(Boolean).join(" ");
  }

  private blink(): void {
    const r = this.root;
    if (!r || !styles.blinking) return;
    r.classList.add(styles.blinking);
    window.setTimeout(() => styles.blinking && r.classList.remove(styles.blinking), 130);
  }

  private scheduleBlink(): void {
    const next = 2200 + Math.random() * 3200;
    this.blinkTimer = window.setTimeout(() => {
      if (this.animations && this.mood !== "completed" && this.emotion !== "sleepy") {
        this.blink();
        if (Math.random() < 0.18) window.setTimeout(() => this.blink(), 240);
      }
      this.scheduleBlink();
    }, next);
  }

  /** When the cursor feed is quiet, glance around occasionally. */
  private scheduleIdleLook(): void {
    this.idleLookTimer = window.setTimeout(() => {
      if (this.animations && Date.now() - this.lastLookAt > 8000 && this.root) {
        const x = (Math.random() * 2 - 1) * 0.7;
        const y = (Math.random() * 2 - 1) * 0.4;
        this.root.style.setProperty("--lx", x.toFixed(3));
        this.root.style.setProperty("--ly", y.toFixed(3));
      }
      this.scheduleIdleLook();
    }, 3500 + Math.random() * 3000);
  }
}
