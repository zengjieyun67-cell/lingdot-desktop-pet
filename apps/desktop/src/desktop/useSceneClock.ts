import { useEffect, useState } from "react";
import type { DesktopStyle } from "../api/types";

/**
 * Browser-preview overrides (no effect inside the app unless the URL carries them):
 *   ?t=18:20        freeze the clock at that time (screenshots of every 时段)
 *   ?style=poster   force a style regardless of settings
 */
export function previewTime(): { h: number; m: number } | null {
  try {
    const t = new URLSearchParams(window.location.search).get("t");
    const m = t?.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    return h < 24 && mi < 60 ? { h, m: mi } : null;
  } catch {
    return null;
  }
}

export function previewStyle(): DesktopStyle | null {
  try {
    const s = new URLSearchParams(window.location.search).get("style");
    return s === "sonoma" || s === "poster" ? s : null;
  } catch {
    return null;
  }
}

function current(): Date {
  const d = new Date();
  const p = previewTime();
  if (p) d.setHours(p.h, p.m, 0, 0);
  return d;
}

/** The time, updated right on every minute boundary (the 时间系统 ticks once a minute). */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(current);
  useEffect(() => {
    if (previewTime()) return;
    let timer: number | undefined;
    const schedule = () => {
      const d = new Date();
      const wait = 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50;
      timer = window.setTimeout(() => {
        setNow(current());
        schedule();
      }, wait);
    };
    schedule();
    // Coming back from sleep: timers may have been paused, refresh immediately.
    const onVis = () => document.visibilityState === "visible" && setNow(current());
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return now;
}
