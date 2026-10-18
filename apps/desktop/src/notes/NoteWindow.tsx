import { useEffect, useRef, useState } from "react";
import { api, currentWindowLogicalSize, dragWindowOnMove, setCurrentWindowSize } from "../api/client";
import type { Note } from "../api/types";
import { NoteBody } from "./NoteBody";
import { ColorDots, IconBtn, tintVars } from "./NoteParts";
import { checkStats, fromLocalInput, remindLabel, toLocalInput } from "./noteText";
import { useNotes } from "./useNotes";
import s from "./Notes.module.css";
import { Icon } from "../ui/Icon";

const MIN_W = 180;
const MIN_H = 140;

/** `#/note/<id>`: one sticky note in its own borderless, frosted-glass window. */
export function NoteWindow({ id }: { id: string }) {
  const { notes } = useNotes();
  const note = notes?.find((n) => n.id === id) ?? null;
  const [remindOpen, setRemindOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.window = "note";
  }, []);

  if (notes && !note) {
    return (
      <div className={s.window} style={tintVars("yellow")}>
        <div className={s.gone}>这张便签已经删掉啦</div>
      </div>
    );
  }
  if (!note) return <div className={s.window} style={tintVars("yellow")} />;

  const patch = (p: Parameters<typeof api.updateNote>[1]) => void api.updateNote(note.id, p).catch(() => undefined);
  const stats = checkStats(note.content);

  return (
    <div className={s.window} style={tintVars(note.color)} data-color={note.color}>
      <header
        className={s.bar}
        onMouseDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest("button, input")) return;
          e.preventDefault();
          dragWindowOnMove(e); // after real movement only: keeps 双击置顶 + clicks working on Windows
        }}
        onDoubleClick={() => patch({ pinned: !note.pinned })}
        title="拖动移动 · 双击置顶 / 取消置顶"
      >
        <ColorDots value={note.color} onPick={(color) => patch({ color })} small />
        <span className={s.barSpacer} />
        <IconBtn name="bell" title={note.remindAt ? `提醒：${remindLabel(note.remindAt)}` : "设置提醒"} active={!!note.remindAt && !note.reminded} onClick={() => setRemindOpen((v) => !v)} />
        <IconBtn name="pin" title={note.pinned ? "取消置顶（不再浮在最上层，也不在桌面模式显示）" : "置顶：浮在最上层，并显示在桌面模式"} active={note.pinned} onClick={() => patch({ pinned: !note.pinned })} />
        <IconBtn name="close" title="收起（便签还在面板「便签」里）" onClick={() => void api.closeNoteWindow(note.id).catch(() => window.close())} />
      </header>
      {remindOpen && <RemindRow note={note} onDone={() => setRemindOpen(false)} />}
      <div className={s.body}>
        <NoteBody note={note} startEditing={!note.content} />
      </div>
      <footer className={s.foot}>
        {note.remindAt && !note.reminded ? <span className={s.footRemind}><Icon name="bell" className={s.miniBell} />{remindLabel(note.remindAt)}</span> : null}
        {stats.total > 0 && (
          <span>
            ✓ {stats.done}/{stats.total}
          </span>
        )}
        <span className={s.barSpacer} />
        <ResizeGrip />
      </footer>
    </div>
  );
}

export function RemindRow({ note, onDone }: { note: Note; onDone?: () => void }) {
  const [v, setV] = useState(toLocalInput(note.remindAt));
  const apply = (at: number | null) => {
    void api.updateNote(note.id, { remindAt: at }).catch(() => undefined);
    onDone?.();
  };
  const quick = (mins: number) => apply(Date.now() + mins * 60_000);
  return (
    <div className={s.remind} onMouseDown={(e) => e.stopPropagation()}>
      <input type="datetime-local" className={s.remindInput} value={v} onChange={(e) => setV(e.target.value)} aria-label="提醒时间" />
      <button type="button" className={s.chip} onClick={() => apply(fromLocalInput(v))} disabled={!v}>
        好
      </button>
      <button type="button" className={s.chip} onClick={() => quick(30)}>
        30 分钟后
      </button>
      {note.remindAt && (
        <button type="button" className={s.chip} onClick={() => apply(null)}>
          不提醒
        </button>
      )}
    </div>
  );
}

/** macOS borderless windows have no native edge resize: drag this corner to resize. */
function ResizeGrip() {
  const st = useRef<{ x: number; y: number; w: number; h: number; raf: number } | null>(null);
  return (
    <span
      className={s.grip}
      title="拖动调整大小"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const x = e.screenX;
        const y = e.screenY;
        void currentWindowLogicalSize().then((sz) => {
          st.current = { x, y, w: sz.w, h: sz.h, raf: 0 };
        });
      }}
      onPointerMove={(e) => {
        const g = st.current;
        if (!g) return;
        const w = Math.max(MIN_W, Math.round(g.w + e.screenX - g.x));
        const h = Math.max(MIN_H, Math.round(g.h + e.screenY - g.y));
        cancelAnimationFrame(g.raf);
        g.raf = requestAnimationFrame(() => void setCurrentWindowSize(w, h).catch(() => undefined));
      }}
      onPointerUp={() => (st.current = null)}
      onPointerCancel={() => (st.current = null)}
    >
      <svg viewBox="0 0 12 12" aria-hidden>
        <path d="M11 4 4 11M11 8 8 11" />
      </svg>
    </span>
  );
}
