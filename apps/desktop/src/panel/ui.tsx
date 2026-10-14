import type { ButtonHTMLAttributes, ReactNode } from "react";
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

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyIcon}>{icon}</div>
      <div className={s.emptyTitle}>{title}</div>
      {children}
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
