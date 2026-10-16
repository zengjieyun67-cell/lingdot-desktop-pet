import { useCallback, useEffect, useState } from "react";
import { api, on } from "../api/client";
import type { Note } from "../api/types";

/** All notes, kept fresh via the `notes-changed` event (any window can edit them). */
export function useNotes(): { notes: Note[] | null; reload: () => Promise<void> } {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const reload = useCallback(async () => {
    try {
      setNotes(await api.listNotes());
    } catch {
      setNotes((n) => n ?? []);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    let off: (() => void) | undefined;
    void reload();
    void on("notes-changed", () => alive && void reload()).then((u) => (alive ? (off = u) : u()));
    return () => {
      alive = false;
      off?.();
    };
  }, [reload]);
  return { notes, reload };
}
