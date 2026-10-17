import type { ReactNode } from "react";

/** One line-icon set (24×24 grid, shared stroke width) so tabs, the radial dial and widgets match
    instead of mixing colour emoji with glyphs. */
export type IconName = "tasks" | "sites" | "notes" | "chat" | "bell" | "settings" | "music" | "check";

const PATHS: Record<IconName, ReactNode> = {
  tasks: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <path d="m8.5 12.2 2.4 2.4 4.8-5" />
    </>
  ),
  sites: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.4 2.3 3.5 5 3.5 8s-1.1 5.7-3.5 8c-2.4-2.3-3.5-5-3.5-8s1.1-5.7 3.5-8z" />
    </>
  ),
  notes: (
    <>
      <path d="M6.5 4h11a2.5 2.5 0 0 1 2.5 2.5V14l-6 6H6.5A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4z" />
      <path d="M20 14h-3.5a2.5 2.5 0 0 0-2.5 2.5V20M8 9h8M8 12.5h4.5" />
    </>
  ),
  chat: <path d="M12 4.5c4.4 0 8 2.9 8 6.6s-3.6 6.6-8 6.6c-.9 0-1.7-.1-2.5-.3L5.5 19.5l.9-3.4C5 14.9 4 13.1 4 11.1c0-3.7 3.6-6.6 8-6.6z" />,
  bell: <path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5zM10 20.5h4" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" />
    </>
  ),
  music: (
    <>
      <path d="M9.5 17.5V6l9-2v11.5" />
      <circle cx="7" cy="17.5" r="2.5" />
      <circle cx="16" cy="15.5" r="2.5" />
    </>
  ),
  check: <path d="m6 12.5 4 4 8-9" />,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ strokeWidth: "var(--icon-stroke, 1.6)" }}
    >
      {PATHS[name]}
    </svg>
  );
}
