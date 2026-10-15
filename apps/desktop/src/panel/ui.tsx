import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { TaskStatus } from "@desktop-pet/shared";
import s from "./ui.module.css";
import { statusLabel } from "./format";

type Variant = "default" | "primary" | "danger" | "ghost";

export function Button({
  variant = "default",
  small,
  icon,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean; icon?: boolean }) {
  const cls = [s.btn, variant !== "default" && s[variant], small && s.small, icon && s.icon, className].filter(Boolean).join(" ");
  return <button type="button" className={cls} {...rest} />;
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`${s.toggle} ${checked ? s.toggleOn : ""}`}
      onClick={() => onChange(!checked)}
    />
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`${s.badge} ${s[`s-${status}`] ?? ""}`}>{statusLabel(status)}</span>;
}

/** Little sitting cat used by empty states (inline SVG, follows the pastel palette). */
export function CatDoodle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 104" aria-hidden="true">
      <ellipse cx="60" cy="98" rx="34" ry="5" fill="rgba(255,138,161,0.15)" />
      <path d="M92 86c14-2 18-16 10-22" fill="none" stroke="#ffc9b8" strokeWidth="7" strokeLinecap="round" />
      <ellipse cx="60" cy="76" rx="30" ry="22" fill="#fff4ea" stroke="#ffc9b8" strokeWidth="2.5" />
      <path d="M30 40 L34 14 L50 28 Z" fill="#fff4ea" stroke="#ffc9b8" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M90 40 L86 14 L70 28 Z" fill="#fff4ea" stroke="#ffc9b8" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M35 33 L36 21 L44 28 Z M85 33 L84 21 L76 28 Z" fill="#ffc2cf" />
      <ellipse cx="60" cy="44" rx="31" ry="25" fill="#fff4ea" stroke="#ffc9b8" strokeWidth="2.5" />
      <path d="M45 44 q4 -5 8 0" fill="none" stroke="#6b4a55" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M67 44 q4 -5 8 0" fill="none" stroke="#6b4a55" strokeWidth="2.6" strokeLinecap="round" />
      <ellipse cx="43" cy="52" rx="5" ry="3" fill="#ffb3c4" opacity="0.8" />
      <ellipse cx="77" cy="52" rx="5" ry="3" fill="#ffb3c4" opacity="0.8" />
      <path d="M56 51 q4 4 8 0" fill="none" stroke="#6b4a55" strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="48" cy="94" rx="8" ry="5" fill="#fff4ea" stroke="#ffc9b8" strokeWidth="2.5" />
      <ellipse cx="72" cy="94" rx="8" ry="5" fill="#fff4ea" stroke="#ffc9b8" strokeWidth="2.5" />
      <circle cx="98" cy="24" r="4" fill="#ffd66e" />
      <circle cx="18" cy="60" r="3" fill="#ffd66e" opacity="0.7" />
    </svg>
  );
}

/**
 * Empty state. Pass `icon` for a small emoji, otherwise the cat doodle is shown;
 * `quip` is 小喵's 傲娇 one-liner.
 */
export function Empty({ icon, title, quip, children }: { icon?: string; title: string; quip?: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      {icon ? <div className={s.emptyIcon}>{icon}</div> : <CatDoodle className={s.emptyCat} />}
      <div className={s.emptyTitle}>{title}</div>
      {quip && <div className={s.emptyQuip}>{quip}</div>}
      {children}
    </div>
  );
}

/** Progressive disclosure: secondary details hide behind 「更多」. */
export function More({ label = "更多", children, defaultOpen = false }: { label?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button type="button" className={`${s.more} ${open ? s.moreOpen : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={s.moreArrow}>›</span>
        {open ? "收起" : label}
      </button>
      {open && <div className={s.moreBody}>{children}</div>}
    </div>
  );
}

export function ErrorBanner({ message, onClose }: { message: string | null; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div className={s.error} role="alert">
      <span>⚠️</span>
      <span className={s.errorText}>{message}</span>
      {onClose && (
        <Button small variant="ghost" onClick={onClose} aria-label="关闭">
          ✕
        </Button>
      )}
    </div>
  );
}

export function Spinner() {
  return <div className={s.spinner} aria-label="加载中" />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className={s.field}>
      <span className={s.label}>{label}</span>
      {children}
      {hint && <span className={s.hint}>{hint}</span>}
    </label>
  );
}

export const inputClass = s.input;
export const selectClass = s.select;
