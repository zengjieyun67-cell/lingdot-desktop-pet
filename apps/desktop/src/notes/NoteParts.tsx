import type { CSSProperties, ReactNode } from "react";
import { NOTE_COLORS, type Note, type NoteColor } from "../api/types";
import { COLOR_LABEL, COLOR_TINT } from "./noteText";
import s from "./Notes.module.css";

/** CSS vars for a note's paper tint (light / dark scheme handled in CSS). */
export function tintVars(color: NoteColor): CSSProperties {
  const t = COLOR_TINT[color] ?? COLOR_TINT.yellow;
  return { ["--note-tint" as string]: t.light, ["--note-tint-dark" as string]: t.dark, ["--note-dot" as string]: t.dot };
}

export function ColorDots({ value, onPick, small }: { value: NoteColor; onPick: (c: NoteColor) => void; small?: boolean }) {
  return (
    <span className={`${s.dots} ${small ? s.dotsSmall : ""}`} role="radiogroup" aria-label="便签颜色">
      {NOTE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          title={COLOR_LABEL[c]}
          className={`${s.colorDot} ${value === c ? s.colorDotOn : ""}`}
          style={{ background: COLOR_TINT[c].dot }}
          onClick={(e) => {
            e.stopPropagation();
            onPick(c);
          }}
        />
      ))}
    </span>
  );
}

const ICON: Record<string, ReactNode> = {
  pin: <path d="M9 3.5h6M10 3.5v5.2L7 12.5h10l-3-3.8V3.5M12 12.5V20" />,
  bell: <path d="M6.5 16.5h11l-1.4-2V10a4.1 4.1 0 0 0-8.2 0v4.5zM10.3 19a1.8 1.8 0 0 0 3.4 0" />,
  close: <path d="M7 7l10 10M17 7 7 17" />,
  popout: <path d="M13.5 5.5H18.5V10.5M18.5 5.5l-7 7M10 6.5H6.5v11h11V14" />,
  trash: <path d="M5.5 7.5h13M10 7.5V5.5h4v2M7.5 7.5l.8 11h7.4l.8-11" />,
  plus: <path d="M12 6v12M6 12h12" />,
  done: <path d="M6 12.5 10 16.5 18 8" />,
  note: <path d="M6 4.5h12v10l-5 5H6zM13 19.5v-5h5" />,
};

export function NoteIcon({ name, className }: { name: keyof typeof ICON | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${s.icon} ${className ?? ""}`} aria-hidden>
      {ICON[name]}
    </svg>
  );
}

export function IconBtn({
  name,
  title,
  onClick,
  active,
  className,
}: {
  name: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`${s.iconBtn} ${active ? s.iconBtnOn : ""} ${className ?? ""}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <NoteIcon name={name} />
    </button>
  );
}

export function sortForDesktop(notes: Note[]): Note[] {
  return notes.filter((n) => n.pinned && !n.done).sort((a, b) => b.updatedAt - a.updatedAt);
}
