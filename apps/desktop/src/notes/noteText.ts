/**
 * 便签 markdown-lite: `- [ ] todo` / `- [x] done` lines become clickable checkboxes,
 * `# title` lines are bold, everything else is plain text. Pure helpers (unit tested).
 */
import type { Note, NoteColor } from "../api/types";

export type NoteLine =
  | { kind: "check"; index: number; checked: boolean; text: string }
  | { kind: "heading"; index: number; text: string }
  | { kind: "text"; index: number; text: string };

const CHECK = /^(\s*)[-*]\s\[( |x|X)\]\s?(.*)$/;

export function parseNote(content: string): NoteLine[] {
  return content.split("\n").map((raw, index): NoteLine => {
    const m = CHECK.exec(raw);
    if (m) return { kind: "check", index, checked: m[2] !== " ", text: m[3] ?? "" };
    const h = /^#{1,3}\s+(.*)$/.exec(raw);
    if (h) return { kind: "heading", index, text: h[1] ?? "" };
    return { kind: "text", index, text: raw };
  });
}

/** Flip the checkbox on line `index` (no-op for other lines). */
export function toggleCheck(content: string, index: number): string {
  const lines = content.split("\n");
  const line = lines[index];
  if (line === undefined) return content;
  const m = CHECK.exec(line);
  if (!m) return content;
  lines[index] = line.replace(/\[( |x|X)\]/, m[2] === " " ? "[x]" : "[ ]");
  return lines.join("\n");
}

/** Enter on a checkbox line continues the list (`- [ ] `); on an empty item it ends the list. */
export function continueList(content: string, caret: number): { content: string; caret: number } | null {
  const start = content.lastIndexOf("\n", caret - 1) + 1;
  const line = content.slice(start, caret);
  const m = /^(\s*)[-*]\s\[( |x|X)\]\s?(.*)$/.exec(line);
  if (!m) return null;
  if (!(m[3] ?? "").trim()) {
    // empty item: drop the marker
    const next = content.slice(0, start) + content.slice(caret);
    return { content: next, caret: start };
  }
  const insert = `\n${m[1] ?? ""}- [ ] `;
  return { content: content.slice(0, caret) + insert + content.slice(caret), caret: caret + insert.length };
}

export function checkStats(content: string): { done: number; total: number } {
  const ls = parseNote(content).filter((l) => l.kind === "check");
  return { done: ls.filter((l) => l.kind === "check" && l.checked).length, total: ls.length };
}

/** First meaningful line, for list titles / reminder bubbles. */
export function noteTitle(content: string, max = 24): string {
  const first = parseNote(content)
    .map((l) => l.text.trim())
    .find((t) => t.length > 0);
  if (!first) return "空白便签";
  return [...first].length > max ? [...first].slice(0, max).join("") + "…" : first;
}

export function matchesQuery(n: Pick<Note, "content">, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return n.content.toLowerCase().includes(t);
}

export const COLOR_LABEL: Record<NoteColor, string> = {
  yellow: "奶黄",
  pink: "樱粉",
  mint: "薄荷",
  lavender: "薰衣草",
  sky: "天空",
};

/** Paper tint (light, dark) per preset; used as translucent fills over frosted glass. */
export const COLOR_TINT: Record<NoteColor, { light: string; dark: string; dot: string }> = {
  yellow: { light: "rgba(255, 236, 160, 0.78)", dark: "rgba(120, 100, 30, 0.55)", dot: "#ffd84d" },
  pink: { light: "rgba(255, 206, 222, 0.78)", dark: "rgba(130, 50, 80, 0.55)", dot: "#ff8fb4" },
  mint: { light: "rgba(196, 244, 220, 0.78)", dark: "rgba(30, 110, 80, 0.55)", dot: "#5fdcaa" },
  lavender: { light: "rgba(224, 214, 255, 0.78)", dark: "rgba(80, 60, 140, 0.55)", dot: "#a993ff" },
  sky: { light: "rgba(196, 230, 255, 0.78)", dark: "rgba(30, 80, 130, 0.55)", dot: "#62b8ff" },
};

const pad = (n: number) => String(n).padStart(2, "0");

/** 「今天 15:30」「明天 09:00」「10/18 20:00」 */
export function remindLabel(at: number, now = Date.now()): string {
  const d = new Date(at);
  const day0 = new Date(now);
  day0.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((d.getTime() - day0.getTime()) / 86_400_000);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diffDays === 0) return `今天 ${hm}`;
  if (diffDays === 1) return `明天 ${hm}`;
  if (diffDays === -1) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** `<input type="datetime-local">` value <-> epoch ms (local time). */
export function toLocalInput(at: number | null): string {
  if (at == null) return "";
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** The pet's spoken reminder: ≤ 8 characters. */
export function reminderSpoken(): string {
  return "便签提醒喵";
}
