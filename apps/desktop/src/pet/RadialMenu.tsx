import { useEffect, useRef } from "react";
import styles from "./RadialMenu.module.css";
import { Icon, type IconName } from "../ui/Icon";

export type RadialAction = "chat" | "tasks" | "music" | "settings" | "notes";

export const RADIAL_ITEMS: Array<{ id: RadialAction; label: string; icon: IconName }> = [
  { id: "chat", label: "聊天", icon: "chat" },
  { id: "tasks", label: "任务", icon: "tasks" },
  { id: "music", label: "音乐", icon: "music" },
  { id: "settings", label: "设置", icon: "settings" },
  { id: "notes", label: "便签", icon: "notes" },
];

/** Ring position (deg, 0 = right, clockwise) of each pill: top-left, top-right, bottom-right, bottom-left, bottom. */
export const RADIAL_ANGLES = [-148, -32, 32, 148, 90];

/** Arc length 0..1 for the yellow progress ring: today's finished share of tasks. */
export function radialProgress(done: number, running: number): number {
  const total = done + running;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, done / total));
}

/**
 * Glass radial dial around the pet (right-click): center mic = push-to-talk (hold) or open chat,
 * pills on the ring = 聊天 / 任务 / 音乐 / 设置 / 便签 (quick-add), yellow arc = today's task progress
 * (pulses while listening).
 */
export function RadialMenu({
  progress,
  progressLabel,
  listening,
  voiceEnabled,
  onAction,
  onMicDown,
  onMicUp,
  onClose,
}: {
  progress: number;
  progressLabel: string;
  listening: boolean;
  voiceEnabled: boolean;
  onAction: (a: RadialAction) => void;
  onMicDown: () => void;
  onMicUp: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const micPressed = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const R = 42; // arc radius in the 100×100 viewBox
  const C = 2 * Math.PI * R;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        stop(e);
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseUp={stop}
      onMouseMove={stop}
      onContextMenu={(e) => {
        e.preventDefault();
        stop(e);
        onClose();
      }}
    >
      <div ref={ref} className={`${styles.dial} ${listening ? styles.listening : ""}`} role="menu" aria-label="快捷菜单">
        <div className={styles.lights} aria-hidden>
          <button className={styles.lightRed} onClick={onClose} title="关闭" />
          <i className={styles.lightYellow} />
          <i className={styles.lightGreen} />
        </div>
        <svg className={styles.ring} viewBox="0 0 100 100" aria-hidden>
          <circle cx="50" cy="50" r={R} className={styles.track} />
          <circle
            cx="50"
            cy="50"
            r={R}
            className={styles.arc}
            strokeDasharray={`${Math.max(0.02, progress) * C} ${C}`}
            transform="rotate(-90 50 50)"
          />
        </svg>
        {RADIAL_ITEMS.map((it, i) => {
          const a = (RADIAL_ANGLES[i]! * Math.PI) / 180;
          return (
            <button
              key={it.id}
              role="menuitem"
              className={styles.pill}
              style={{ left: `${50 + Math.cos(a) * 39}%`, top: `${50 + Math.sin(a) * 39}%` }}
              onClick={() => onAction(it.id)}
            >
              <span className={styles.pillIcon}><Icon name={it.icon} /></span>
              {it.label}
            </button>
          );
        })}
        <button
          className={styles.mic}
          title={voiceEnabled ? "按住说话" : "打开聊天"}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (e.button !== 0) return;
            micPressed.current = true;
            if (voiceEnabled) onMicDown();
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            // the right-click that opened the dial releases over the mic: not a press
            if (e.button !== 0 || !micPressed.current) return;
            micPressed.current = false;
            if (voiceEnabled) onMicUp();
            else onAction("chat");
          }}
          onPointerLeave={() => voiceEnabled && listening && onMicUp()}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <rect x="9" y="3.5" width="6" height="11" rx="3" />
            <path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V21" />
          </svg>
        </button>
        <div className={styles.caption}>{listening ? "在听…" : progressLabel}</div>
      </div>
    </div>
  );
}
