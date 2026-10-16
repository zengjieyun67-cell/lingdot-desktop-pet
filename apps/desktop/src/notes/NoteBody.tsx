import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Note } from "../api/types";
import { continueList, parseNote, toggleCheck } from "./noteText";
import s from "./Notes.module.css";

const SAVE_DELAY = 350;

/**
 * A note's text: rendered (checkbox lines toggle on click) until clicked, then a plain
 * textarea that auto-saves while typing. Shared by the floating window, the panel and the desktop.
 */
export function NoteBody({
  note,
  readOnly = false,
  startEditing = false,
  compact = false,
  onSaved,
}: {
  note: Note;
  readOnly?: boolean;
  startEditing?: boolean;
  compact?: boolean;
  onSaved?: (n: Note) => void;
}) {
  const [text, setText] = useState(note.content);
  const [editing, setEditing] = useState(startEditing && !readOnly);
  const pending = useRef<{ timer?: number; value?: string }>({});
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [saved, setSaved] = useState(true);

  // Follow edits made elsewhere (another window, the panel) unless we are mid-typing.
  useEffect(() => {
    if (pending.current.value === undefined && !editing) setText(note.content);
  }, [note.content, editing]);

  const flush = useCallback(() => {
    const p = pending.current;
    window.clearTimeout(p.timer);
    if (p.value === undefined) return;
    const value = p.value;
    p.value = undefined;
    void api
      .updateNote(note.id, { content: value })
      .then((n) => {
        setSaved(true);
        onSaved?.(n);
      })
      .catch(() => setSaved(false));
  }, [note.id, onSaved]);

  const queue = useCallback(
    (value: string, now = false) => {
      setText(value);
      setSaved(false);
      pending.current.value = value;
      window.clearTimeout(pending.current.timer);
      if (now) flush();
      else pending.current.timer = window.setTimeout(flush, SAVE_DELAY);
    },
    [flush],
  );

  useEffect(() => () => flush(), [flush]);

  useEffect(() => {
    if (editing) {
      const a = areaRef.current;
      a?.focus();
      if (a) a.selectionStart = a.selectionEnd = a.value.length;
    }
  }, [editing]);

  if (editing) {
    return (
      <textarea
        ref={areaRef}
        className={`${s.area} ${compact ? s.compactText : ""}`}
        value={text}
        placeholder="写点什么…  「- [ ] 」开头变成待办"
        spellCheck={false}
        onChange={(e) => queue(e.target.value)}
        onBlur={() => {
          flush();
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            (e.target as HTMLTextAreaElement).blur();
          } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            const a = e.currentTarget;
            const r = continueList(text, a.selectionStart);
            if (r) {
              e.preventDefault();
              queue(r.content);
              requestAnimationFrame(() => {
                a.selectionStart = a.selectionEnd = r.caret;
              });
            }
          }
        }}
        data-saved={saved ? "1" : "0"}
      />
    );
  }

  const lines = parseNote(text);
  const empty = !text.trim();
  return (
    <div
      className={`${s.view} ${compact ? s.compactText : ""} ${readOnly ? s.readOnly : ""}`}
      onClick={() => !readOnly && setEditing(true)}
      role={readOnly ? undefined : "textbox"}
      tabIndex={readOnly ? -1 : 0}
      onKeyDown={(e) => !readOnly && e.key === "Enter" && setEditing(true)}
    >
      {empty ? (
        <span className={s.placeholder}>{readOnly ? "空白便签" : "点这里写点什么…"}</span>
      ) : (
        lines.map((l) =>
          l.kind === "check" ? (
            <div key={l.index} className={`${s.check} ${l.checked ? s.checked : ""}`}>
              <button
                type="button"
                className={s.box}
                aria-pressed={l.checked}
                aria-label={l.checked ? "标记为未完成" : "标记为完成"}
                disabled={readOnly}
                onClick={(e) => {
                  e.stopPropagation();
                  queue(toggleCheck(text, l.index), true);
                }}
              >
                <svg viewBox="0 0 12 12" aria-hidden>
                  <path d="M2.5 6.3 5 8.6 9.6 3.6" />
                </svg>
              </button>
              <span className={s.checkText}>{l.text || " "}</span>
            </div>
          ) : l.kind === "heading" ? (
            <div key={l.index} className={s.heading}>
              {l.text}
            </div>
          ) : (
            <div key={l.index} className={s.line}>
              {l.text || " "}
            </div>
          ),
        )
      )}
    </div>
  );
}
