import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../api/client";
import type { Note } from "../api/types";
import { usePanel } from "../panel/PanelApp";
import { Button, Empty, Spinner, inputClass } from "../panel/ui";
import { relTime } from "../panel/format";
import p from "../panel/Panel.module.css";
import { NoteBody } from "./NoteBody";
import { ColorDots, IconBtn, tintVars } from "./NoteParts";
import { RemindRow } from "./NoteWindow";
import { checkStats, matchesQuery, noteTitle, parseNote, remindLabel } from "./noteText";
import { useNotes } from "./useNotes";
import s from "./Notes.module.css";
import { NEW_NOTE_KEY } from "../lib/platform";

const UNDO_MS = 6000;

/** 面板「便签」: search, new, colour, pop out, pin, delete with 撤销. */
export function NotesView() {
  const { reportError, settings } = usePanel();
  const { notes, reload } = useNotes();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [undo, setUndo] = useState<Note | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  const create = async () => {
    try {
      const n = await api.createNote({ content: "" });
      setQ("");
      await reload();
      setOpen(n.id);
    } catch (e) {
      reportError(e);
    }
  };

  const remove = async (n: Note) => {
    try {
      const gone = await api.deleteNote(n.id);
      if (open === n.id) setOpen(null);
      setUndo(gone);
      window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
      await reload();
    } catch (e) {
      reportError(e);
    }
  };

  const restore = async () => {
    if (!undo) return;
    try {
      await api.restoreNote(undo);
      setUndo(null);
      await reload();
    } catch (e) {
      reportError(errorText(e));
    }
  };

  const patch = (n: Note, patch: Parameters<typeof api.updateNote>[1]) => void api.updateNote(n.id, patch).catch(reportError);
  const list = (notes ?? []).filter((n) => matchesQuery(n, q));

  return (
    <div className={s.panel}>
      <div className={p.sectionTitle}>
        <span>我的便签</span>
        <Button small variant="primary" onClick={() => void create()}>
          ＋ 新建
        </Button>
      </div>
      <input className={`${inputClass} ${s.search}`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索便签…" aria-label="搜索便签" />

      {notes === null ? (
        <Spinner />
      ) : list.length === 0 ? (
        q ? (
          <Empty title="没有找到" quip="换个关键词试试？" />
        ) : (
          <Empty title="还没有便签" quip={`想记点什么就告诉${settings.petName}，本猫记性可好了。`}>
            <span>点「＋ 新建」，或在任何地方按 {NEW_NOTE_KEY}；聊天里说「记一下…」也行</span>
          </Empty>
        )
      ) : (
        <div className={s.list}>
          {list.map((n) => {
            const isOpen = open === n.id;
            const st = checkStats(n.content);
            const preview = parseNote(n.content)
              .slice(1)
              .map((l) => (l.kind === "check" ? `${l.checked ? "☑" : "☐"} ${l.text}` : l.text))
              .filter((t) => t.trim())
              .slice(0, 2)
              .join("  ·  ");
            return (
              <div key={n.id} className={`${s.card} ${isOpen ? s.cardOpen : ""} ${n.done ? s.cardDone : ""}`} style={tintVars(n.color)}>
                <div className={s.cardHead} onClick={() => setOpen(isOpen ? null : n.id)} role="button" aria-expanded={isOpen}>
                  <span className={s.cardStripe} aria-hidden />
                  <div className={s.cardMain}>
                    <div className={s.cardTitle}>{noteTitle(n.content, 30)}</div>
                    {!isOpen && preview && <div className={s.cardPreview}>{preview}</div>}
                    <div className={s.cardMeta}>
                      <span>{relTime(n.updatedAt)}</span>
                      {n.remindAt && !n.reminded && <span className={s.metaRemind}>⏰ {remindLabel(n.remindAt)}</span>}
                      {st.total > 0 && (
                        <span>
                          ✓ {st.done}/{st.total}
                        </span>
                      )}
                      {n.pinned && <span className={s.metaPin}>置顶</span>}
                      {n.popped && <span>桌面上</span>}
                    </div>
                  </div>
                  <div className={s.cardActions}>
                    <IconBtn name="popout" title="贴到桌面（独立小窗口）" onClick={() => void api.popOutNote(n.id).catch(reportError)} />
                    <IconBtn name="pin" title={n.pinned ? "取消置顶" : "置顶（也会显示在桌面模式）"} active={n.pinned} onClick={() => patch(n, { pinned: !n.pinned })} />
                    <IconBtn name="trash" title="删除（可撤销）" onClick={() => void remove(n)} />
                  </div>
                </div>
                {isOpen && (
                  <div className={s.cardEditor}>
                    <NoteBody note={n} startEditing={!n.content} />
                    <div className={s.cardTools}>
                      <ColorDots value={n.color} onPick={(color) => patch(n, { color })} />
                      <span className={s.barSpacer} />
                      <IconBtn name="done" title={n.done ? "标记为未完成" : "整张标记为完成"} active={n.done} onClick={() => patch(n, { done: !n.done })} />
                    </div>
                    <RemindRow note={n} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className={s.hint}>{NEW_NOTE_KEY} 随时新建 · 托盘「新建便签」 · 右键{settings.petName}选「便签」 · 把文字拖到{settings.petName}身上也能记</div>
      {undo && (
        <div className={s.toast} role="status">
          已删除「{noteTitle(undo.content, 12)}」
          <button type="button" className={s.toastBtn} onClick={() => void restore()}>
            撤销
          </button>
        </div>
      )}
    </div>
  );
}
