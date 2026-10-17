import { api } from "../api/client";
import { NoteBody } from "./NoteBody";
import { IconBtn, sortForDesktop, tintVars } from "./NoteParts";
import { remindLabel } from "./noteText";
import { useNotes } from "./useNotes";
import s from "./Notes.module.css";
import { Icon } from "../ui/Icon";

/**
 * Pinned notes as small glass cards on the 桌面模式 scene (editable), or — on the screen saver,
 * only when 「屏保显示便签」 is on — at most two, read-only and very faint.
 */
export function PinnedNotes({ max = 2, saver = false, className = "" }: { max?: number; saver?: boolean; className?: string }) {
  const { notes } = useNotes();
  const list = sortForDesktop(notes ?? []).slice(0, saver ? Math.min(2, max) : max);
  if (!list.length) return null;
  return (
    <div className={`${s.pinned} ${saver ? s.pinnedSaver : ""} ${className}`} data-count={list.length}>
      {list.map((n, i) => (
        <article key={n.id} className={s.mini} style={{ ...tintVars(n.color), ["--tilt" as string]: `${i % 2 ? 1.2 : -1.1}deg` }}>
          {!saver && (
            <div className={s.miniBar}>
              {n.remindAt && !n.reminded ? <span className={s.miniRemind}><Icon name="bell" className={s.miniBell} />{remindLabel(n.remindAt)}</span> : <span className={s.miniTag}>NOTE · {String(i + 1).padStart(2, "0")}</span>}
              <span className={s.barSpacer} />
              <IconBtn name="popout" title="变成浮动小窗" onClick={() => void api.popOutNote(n.id).catch(() => undefined)} />
            </div>
          )}
          <div className={s.miniBody}>
            <NoteBody note={n} compact readOnly={saver} />
          </div>
        </article>
      ))}
    </div>
  );
}
