import { useCallback, useEffect, useRef, useState } from "react";
import {
  resolveDisplayState,
  STATE_REGISTRY,
  triggerForNotification,
  type DisplayState,
  type Emotion,
  type InteractionKind,
  type PetMood,
} from "@desktop-pet/shared";
import { api, isTauri, on, startDragging } from "../api/client";
import type {
  ActivityEvent,
  ActivitySnapshot,
  AppSettings,
  ConnectionStatus,
  Note,
  NotificationEventPayload,
  PersonaMemory,
} from "../api/types";
import { noteTitle, reminderSpoken } from "../notes/noteText";
import { useVoice, voicePhaseLabel } from "../lib/voice";
import { createRenderer, type Live2DPaths } from "./renderer/createRenderer";
import { RadialMenu, radialProgress, type RadialAction } from "./RadialMenu";
import { Spectrum } from "./Spectrum";
import { hitArea, ShakeDetector, TouchReactor, type TouchKind } from "./touchReactions";
import type { PetRenderer } from "./renderer/PetRenderer";
import { PatDetector, PersonaController, type Spoken } from "./persona";
import { playChime } from "./chime";
import { scaleFromWheel, scalePercent } from "../lib/petSize";
import styles from "./Pet.module.css";

const BADGE: Record<PetMood, string | null> = { idle: null, working: "✨", completed: "💖", needs_attention: "❗" };
const DRAG_THRESHOLD = 4;
const NOTIFY_BUBBLE_MS = 9000;
const LINE_BUBBLE_MS = 6000;
const PERSONA_TICK_MS = 30_000;
const LONG_PRESS_MS = 450;
const MUSIC_LINE_GAP_MS = 4 * 60_000;

const NO_ACTIVITY: ActivitySnapshot = { kind: "none", music: null, idleSecs: 0 };

interface Bubble {
  /** In-character line (may be absent when persona bubbles are off). */
  line: string | null;
  /** Plain task info for notification bubbles. */
  title?: string;
  body?: string;
  notificationId?: string;
  url?: string | null;
  /** 便签 reminder: clicking opens the note. */
  noteId?: string;
}

/** What the renderer depends on: SVG vs Live2D + the two paths (auto → live2d alone does not remount). */
export function rendererKey(s: Pick<AppSettings, "rendererMode" | "live2dModelPath" | "live2dCorePath">): string {
  return [s.rendererMode === "svg" ? "svg" : "l2d", s.live2dModelPath.trim(), s.live2dCorePath.trim()].join("|");
}

/** Find + import the user's Live2D model when the configured one is missing (Tauri only). */
async function autoImportLive2D(): Promise<Live2DPaths | null> {
  const r = await api.scanImportLive2D(false);
  return r.modelPath ? { modelPath: r.modelPath, corePath: r.corePath ?? "" } : null;
}

function personaSettings(s: AppSettings) {
  return {
    petName: s.petName,
    userTitle: s.userTitle,
    personaBubbles: s.personaBubbles,
    mealReminders: s.mealReminders,
    lateNightReminders: s.lateNightReminders,
  };
}

/**
 * `variant="desktop"`: lives inside the 桌面 / 屏保 scene instead of its own window.
 * `quiet`: 屏保模式 — no speech bubbles or chips, just 小喵.
 */
export function PetWindow({ variant = "pet", quiet = false }: { variant?: "pet" | "desktop"; quiet?: boolean } = {}) {
  const isDesktop = variant === "desktop";
  const quietRef = useRef(quiet);
  quietRef.current = quiet;
  const stageRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<PetRenderer | null>(null);
  const settingsRef = useRef<AppSettings | null>(null);
  const personaRef = useRef<PersonaController | null>(null);
  const patRef = useRef(new PatDetector());
  const moodRef = useRef<PetMood>("idle");
  const connectedRef = useRef<boolean | null>(null);
  const [mood, setMood] = useState<PetMood>("idle");
  const [kind, setKind] = useState<"svg" | "live2d">("svg");
  const [animations, setAnimations] = useState(true);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const bubbleTimer = useRef<number | undefined>(undefined);
  const down = useRef<{ x: number; y: number; dragging: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const scaleSend = useRef<number | undefined>(undefined);
  const [sizeHint, setSizeHint] = useState<string | null>(null);
  const sizeHintTimer = useRef<number | undefined>(undefined);
  const activityRef = useRef<ActivitySnapshot>(NO_ACTIVITY);
  const [activity, setActivity] = useState<ActivitySnapshot>(NO_ACTIVITY);
  const [displayState, setDisplayState] = useState<DisplayState>("idle");
  const displayRef = useRef<DisplayState>("idle");
  const lastMusicLine = useRef(0);
  const pressTimer = useRef<number | undefined>(undefined);
  const pttActive = useRef(false);
  const longTouched = useRef(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const { status: voiceStatus, pttStart, pttStop } = useVoice();
  const mountedKey = useRef("");
  const reactorRef = useRef(new TouchReactor());
  const lastPatAt = useRef(0);
  const voicePhaseRef = useRef(voiceStatus.phase);
  voicePhaseRef.current = voiceStatus.phase;
  const dragRef = useRef<{ active: boolean; shake: ShakeDetector; dropTimer?: number; lastShakeAt: number }>({
    active: false,
    shake: new ShakeDetector(),
    lastShakeAt: 0,
  });
  const [dial, setDial] = useState<{ progress: number; label: string } | null>(null);
  const [dropHover, setDropHover] = useState(false);

  /** Recompute the single state 小喵 shows (task mood vs. music / stretch / nap). */
  const refreshDisplay = useCallback(() => {
    const s = settingsRef.current;
    const next = resolveDisplayState(moodRef.current, activityRef.current.kind, {
      idleStates: s?.idleStates ?? true,
      music: s?.musicDetection ?? true,
    });
    displayRef.current = next;
    setDisplayState(next);
    rendererRef.current?.setDisplayState?.(next);
  }, []);

  // Voice -> mouth / ears
  useEffect(() => {
    const r = rendererRef.current;
    r?.setSpeaking?.(voiceStatus.phase === "speaking" || !!voiceStatus.speaking);
    r?.setListening?.(voiceStatus.phase === "listening");
  }, [voiceStatus]);

  // Cmd/Ctrl + scroll (or trackpad pinch, which arrives as ctrl+wheel) resizes the pet.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || isDesktop) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      const next = scaleFromWheel(scaleRef.current, e.deltaY);
      if (next === scaleRef.current) return;
      scaleRef.current = next;
      setSizeHint(scalePercent(next));
      window.clearTimeout(sizeHintTimer.current);
      sizeHintTimer.current = window.setTimeout(() => setSizeHint(null), 900);
      // Throttle window resizes to ~16/s; Rust clamps, resizes around the feet and persists.
      if (scaleSend.current === undefined) {
        scaleSend.current = window.setTimeout(() => {
          scaleSend.current = undefined;
          void api.setPetScale(scaleRef.current).catch(() => undefined);
        }, 60);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isDesktop]);

  const showBubble = useCallback((b: Bubble, ms: number) => {
    setBubble(b);
    window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), ms);
  }, []);

  const applyEmotion = useCallback((e: Emotion) => {
    rendererRef.current?.setEmotion(e);
  }, []);

  /** Show an in-character line (if any) and push the emotion to the renderer + memory. */
  const speak = useCallback(
    (s: Spoken | null) => {
      if (!s) return;
      applyEmotion(s.emotion);
      void api.setTodayMood(s.emotion).catch(() => undefined);
      if (s.text) showBubble({ line: s.text }, LINE_BUBBLE_MS);
    },
    [applyEmotion, showBubble],
  );

  const remember = useCallback((k: InteractionKind) => {
    void api
      .personaInteraction(k)
      .then((m) => {
        const p = personaRef.current;
        if (p) {
          p.affinity = m.affinity;
          p.familiarity = m.familiarity;
        }
      })
      .catch(() => undefined);
  }, []);

  /** Head pat / poke / rub / long touch / drag / drop / shake: motion + bubble, occasionally a short spoken line. */
  const touchReact = useCallback(
    (kind: TouchKind) => {
      const p = personaRef.current;
      if (!p) return;
      p.touch();
      p.feel(kind === "drag_start" || kind === "shake" || kind === "drop" ? "dragged" : kind === "body_poke" || kind === "long_touch" ? "clicked" : "pat");
      const st = settingsRef.current;
      const voiceAllowed = isTauri() && (st?.touchVoice ?? true) && (voicePhaseRef.current ?? "idle") === "idle";
      const r = reactorRef.current.react(kind, { affinity: p.affinity, hour: new Date().getHours(), emotion: p.emotion }, voiceAllowed);
      const rend = rendererRef.current;
      if (rend?.react) rend.react(kind);
      else rend?.poke();
      applyEmotion(p.emotion);
      showBubble({ line: r.text }, 3200);
      if (r.speak) void api.voiceSpeak(r.text).catch(() => undefined);
      remember(kind === "drag_start" || kind === "shake" || kind === "drop" ? "drag" : kind === "body_poke" || kind === "long_touch" ? "click" : "pat");
    },
    [applyEmotion, showBubble, remember],
  );

  // Dragging the floating pet: the OS moves the window, so watch window moves for shake + drop.
  useEffect(() => {
    if (isDesktop || !isTauri()) return;
    let off: (() => void) | undefined;
    let alive = true;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .onMoved(({ payload }) => {
          const d = dragRef.current;
          if (!d.active) return;
          const now = Date.now();
          if (d.shake.feed(payload.x, now) && now - d.lastShakeAt > 2500) {
            d.lastShakeAt = now;
            touchReact("shake");
          }
          window.clearTimeout(d.dropTimer);
          d.dropTimer = window.setTimeout(() => {
            d.active = false;
            d.shake.reset();
            touchReact("drop");
          }, 550);
        })
        .then((u) => (alive ? (off = u) : u())),
    ).catch(() => undefined);
    return () => {
      alive = false;
      off?.();
    };
  }, [isDesktop, touchReact]);

  const mountRenderer = useCallback(async (s: AppSettings) => {
    const stage = stageRef.current;
    if (!stage) return;
    rendererRef.current?.destroy();
    stage.replaceChildren();
    mountedKey.current = rendererKey(s);
    const res = await createRenderer(s, stage, isTauri() ? { autoImport: autoImportLive2D } : {});
    if (res.imported) mountedKey.current = rendererKey({ rendererMode: "live2d", live2dModelPath: res.imported.modelPath, live2dCorePath: res.imported.corePath });
    rendererRef.current = res.renderer;
    res.renderer.setAnimationsEnabled(s.animationsEnabled);
    res.renderer.setMood(moodRef.current);
    res.renderer.setEmotion(personaRef.current?.emotion ?? "neutral");
    res.renderer.setDisplayState?.(displayRef.current);
    setKind(res.renderer.kind);
    localStorage.setItem("pet-renderer-status", JSON.stringify({ status: res.status, error: res.error ?? null, at: Date.now() }));
  }, []);

  const checkRunningTasks = useCallback(async () => {
    try {
      const running = await api.listTasks({ status: "running" });
      speak(personaRef.current?.runningTasks(running.length) ?? null);
    } catch {
      /* ignore */
    }
  }, [speak]);

  useEffect(() => {
    let disposed = false;
    const unlisten: Array<() => void> = [];
    let tick: number | undefined;
    (async () => {
      const boot = await api.bootstrap();
      if (disposed) return;
      settingsRef.current = boot.settings;
      setVoiceEnabled(boot.settings.voiceEnabled);
      scaleRef.current = boot.settings.petScale;
      setAnimations(boot.settings.animationsEnabled);
      moodRef.current = boot.mood;
      setMood(boot.mood);
      let memory: PersonaMemory | null = null;
      try {
        memory = await api.getPersonaMemory();
      } catch {
        /* memory unavailable: defaults */
      }
      const persona = new PersonaController(personaSettings(boot.settings), memory?.affinity ?? 30, memory?.familiarity ?? 0);
      personaRef.current = persona;
      await mountRenderer(boot.settings);
      speak(persona.greet(memory?.lastInteractionAt ?? null));
      remember("open");
      try {
        const snap = await api.getActivity();
        activityRef.current = snap;
        setActivity(snap);
      } catch {
        /* activity probe unavailable */
      }
      refreshDisplay();
      connectedRef.current = boot.connection.status.connected;

      unlisten.push(
        await on<PetMood>("pet-mood", (m) => {
          moodRef.current = m;
          setMood(m);
          rendererRef.current?.setMood(m);
          refreshDisplay();
        }),
        await on<ActivitySnapshot>("pet-activity", (snap) => {
          activityRef.current = snap;
          setActivity(snap);
          refreshDisplay();
        }),
        await on<ActivityEvent>("pet-activity-event", (ev) => {
          const s = settingsRef.current;
          if (ev.type === "music_started" || ev.type === "track_changed") {
            if (s && !s.musicDetection) return;
            // Don't chatter on every track: at most one line every few minutes.
            if (Date.now() - lastMusicLine.current < MUSIC_LINE_GAP_MS) return;
            lastMusicLine.current = Date.now();
            speak(persona.say("music_start", { song: ev.title ?? undefined, app: ev.app }));
          } else if (ev.type === "nap_started") {
            if (s && !s.idleStates) return;
            speak(persona.say("napping"));
          } else if (ev.type === "woke") {
            if (s && !s.idleStates) return;
            speak(persona.say("woke"));
          }
        }),
        await on<{ dx: number; dy: number }>("pet-cursor", ({ dx, dy }) => rendererRef.current?.lookAt(dx, dy)),
        await on<AppSettings>("settings-changed", (s) => {
          const prev = settingsRef.current;
          settingsRef.current = s;
          if (scaleSend.current === undefined) scaleRef.current = s.petScale;
          persona.settings = personaSettings(s);
          setVoiceEnabled(s.voiceEnabled);
          refreshDisplay();
          setAnimations(s.animationsEnabled);
          if (!prev || (rendererKey(prev) !== rendererKey(s) && mountedKey.current !== rendererKey(s))) void mountRenderer(s);
          else rendererRef.current?.setAnimationsEnabled(s.animationsEnabled);
        }),
        await on<NotificationEventPayload>("notification", ({ record, sound }) => {
          const trig = triggerForNotification(record.kind);
          const site = record.body.split(" · ")[0];
          const task = record.body.split(" · ")[1]?.split(" — ")[0];
          const spoken = trig ? persona.say(trig, { task, site }) : null;
          if (spoken) {
            applyEmotion(spoken.emotion);
            void api.setTodayMood(spoken.emotion).catch(() => undefined);
          }
          if (record.kind === "completed") remember("task_completed");
          if (record.kind === "connection_lost") connectedRef.current = false;
          showBubble(
            { line: spoken?.text ?? null, title: record.title, body: record.body, notificationId: record.id, url: record.url },
            NOTIFY_BUBBLE_MS,
          );
          if (sound) playChime(record.kind);
        }),
        await on<ConnectionStatus>("connection-changed", (st) => {
          const was = connectedRef.current;
          connectedRef.current = st.connected;
          if (st.connected && was === false) speak(persona.say("reconnected"));
        }),
        await on("tasks-changed", () => void checkRunningTasks()),
        await on<Note>("note-reminder", (n) => {
          const st = settingsRef.current;
          // one pet answers: the floating one in 桌宠模式, the scene one in 桌面模式 (never the screen saver)
          if (quietRef.current || (st?.displayMode === "desktop") !== isDesktop) return;
          rendererRef.current?.react?.("head_pat");
          applyEmotion("happy");
          showBubble({ line: `${st?.userTitle ?? "主人"}，便签提醒：${noteTitle(n.content, 18)}`, noteId: n.id }, NOTIFY_BUBBLE_MS);
          // short spoken line, same rule as touch voice (「摸摸时说话」 off = silent, never over another line)
          if (isTauri() && (st?.touchVoice ?? true) && (voicePhaseRef.current ?? "idle") === "idle") {
            void api.voiceSpeak(reminderSpoken()).catch(() => undefined);
          }
        }),
        await on<PersonaMemory>("persona-memory", (m) => {
          persona.affinity = m.affinity;
          persona.familiarity = m.familiarity;
        }),
      );

      tick = window.setInterval(() => {
        const s = persona.tick();
        if (s?.trigger === "ignored") remember("ignored");
        if (s) speak(s);
        else applyEmotion(persona.emotion); // decay
      }, PERSONA_TICK_MS);
    })();
    return () => {
      disposed = true;
      window.clearInterval(tick);
      unlisten.forEach((u) => u());
      rendererRef.current?.destroy();
    };
  }, [mountRenderer, speak, remember, applyEmotion, showBubble, checkRunningTasks, refreshDisplay]);

  const onMouseMove = (e: React.MouseEvent) => {
    const d = down.current;
    if (d && !d.dragging && !pttActive.current && Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_THRESHOLD) {
      d.dragging = true;
      window.clearTimeout(pressTimer.current);
      if (isDesktop) return; // the desktop scene is fixed; only the floating pet can be dragged
      dragRef.current.active = true;
      dragRef.current.shake.reset();
      touchReact("drag_start");
      void startDragging();
    }
    const rect = e.currentTarget.getBoundingClientRect();
    rendererRef.current?.lookAt(e.clientX - rect.width / 2, e.clientY - rect.height * 0.38);
    // Head pat: rubbing back and forth over the upper part of the pet without pressing.
    const overHead = e.clientY < rect.height * 0.55 && e.clientY > rect.height * 0.12;
    if (!d && e.buttons === 0 && overHead) {
      if (patRef.current.feed(e.clientX, Date.now())) {
        // a second stroke soon after the first = repeated rubbing
        const now = Date.now();
        touchReact(now - lastPatAt.current < 5000 ? "rub" : "head_pat");
        lastPatAt.current = now;
      }
    } else if (!overHead) {
      patRef.current.reset();
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    down.current = { x: e.clientX, y: e.clientY, dragging: false };
    // Long press = push-to-talk (when voice is on).
    window.clearTimeout(pressTimer.current);
    if (settingsRef.current?.voiceEnabled) {
      pressTimer.current = window.setTimeout(() => {
        if (!down.current || down.current.dragging) return;
        pttActive.current = true;
        void pttStart();
      }, LONG_PRESS_MS);
    } else {
      // voice off: a long touch is a gentle "hold" reaction instead of push-to-talk
      pressTimer.current = window.setTimeout(() => {
        if (!down.current || down.current.dragging) return;
        longTouched.current = true;
        touchReact("long_touch");
      }, LONG_PRESS_MS * 2);
    }
  };

  const onMouseUp = (e: React.MouseEvent) => {
    const d = down.current;
    down.current = null;
    window.clearTimeout(pressTimer.current);
    if (pttActive.current) {
      pttActive.current = false;
      void pttStop();
      return;
    }
    if (e.button !== 0 || !d || d.dragging) return;
    if (longTouched.current) {
      longTouched.current = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    touchReact(hitArea(e.clientY - rect.top, rect.height) === "head" ? "head_pat" : "body_poke");
    void api.togglePanel();
  };

  /** Right-click: radial glass dial (聊天 / 任务 / 音乐 / 设置 + push-to-talk mic). */
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (quiet) return;
    setDial({ progress: 0, label: "今日任务" });
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    void api
      .listTasks({ limit: 60 })
      .then((ts) => {
        const done = ts.filter((t) => t.status === "completed" && t.updatedAt >= from.getTime()).length;
        const running = ts.filter((t) => t.status === "running" || t.status === "needs_attention").length;
        setDial((d) => d && { progress: radialProgress(done, running), label: `今日完成 ${done} · 进行中 ${running}` });
      })
      .catch(() => undefined);
  };

  const onDialAction = (a: RadialAction) => {
    setDial(null);
    if (a === "notes") {
      void api.newQuickNote().catch(() => undefined);
      showBubble({ line: "要记什么？写在便签上吧～" }, 3200);
      return;
    }
    if (a === "music") {
      const m = activityRef.current.music;
      showBubble({ line: m ? `正在听《${m.title ?? "这首歌"}》${m.artist ? ` — ${m.artist}` : ""}，主人品味不错嘛～` : "现在没有在放歌哦，放一首给我听听？" }, LINE_BUBBLE_MS);
      return;
    }
    void api.showPanel(a);
  };

  const openBubble = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!bubble) return;
    setBubble(null);
    if (bubble.noteId) void api.popOutNote(bubble.noteId).catch(() => undefined);
    else if (bubble.notificationId && bubble.url) void api.openNotification(bubble.notificationId);
    else if (bubble.notificationId) void api.showPanel("notifications");
  };

  // Live2D models without a matching motion get a small badge instead.
  const stateBadge = STATE_REGISTRY[displayState].source === "activity" ? STATE_REGISTRY[displayState].badge : null;
  const badge = kind === "live2d" ? (stateBadge ?? BADGE[mood]) : null;
  const voiceLabel = voicePhaseLabel(voiceStatus);
  const musicTitle = displayState === "listening_music" && activity.music ? activity.music.title ?? activity.music.app : null;
  const hint = voiceEnabled
    ? "单击打开面板 · 长按说话 · 拖动移动 · 在头上来回摸摸 · ⌘/Ctrl+滚轮调大小 · 右键快捷菜单"
    : "单击打开面板 · 拖动移动 · 在头上来回摸摸 · ⌘/Ctrl+滚轮调大小 · 右键快捷菜单";

  return (
    <div
      ref={wrapRef}
      data-pet-variant={variant}
      className={`${styles.wrap} ${animations ? "" : styles.still} ${isDesktop ? styles.desktop : ""} ${dropHover ? styles.dropHover : ""}`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        down.current = null;
        window.clearTimeout(pressTimer.current);
        if (pttActive.current) {
          pttActive.current = false;
          void pttStop();
        }
        patRef.current.reset();
      }}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if (quiet || !e.dataTransfer.types.includes("text/plain")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropHover(true);
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(e) => {
        setDropHover(false);
        if (quiet) return;
        const text = (e.dataTransfer.getData("text/plain") || "").trim();
        if (!text) return;
        e.preventDefault();
        void api
          .createNote({ content: text.slice(0, 4000) })
          .then(() => {
            touchReact("head_pat");
            showBubble({ line: "记下来啦，贴在便签里了～" }, LINE_BUBBLE_MS);
          })
          .catch(() => showBubble({ line: "呜…没记住，再拖一次？" }, 3200));
      }}
      title={isDesktop ? hint.replace(" · 拖动移动", "").replace(" · ⌘/Ctrl+滚轮调大小", "") : hint}
    >
      {bubble && !quiet && !dial && (
        <div
          className={`${styles.bubble} ${bubble.notificationId || bubble.noteId ? "" : styles.bubbleLine}`}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={openBubble}
          role={bubble.notificationId || bubble.noteId ? "button" : "status"}
        >
          {bubble.line && <span className={styles.bubbleSay}>{bubble.line}</span>}
          {bubble.noteId && <span className={styles.bubbleHint}>点我打开便签</span>}
          {bubble.notificationId && (!bubble.line || bubble.title) && (
            <>
              {!bubble.line && <span className={styles.bubbleTitle}>{bubble.title}</span>}
              <span className={styles.bubbleBody}>{bubble.line ? bubble.title : bubble.body}</span>
              <span className={styles.bubbleHint}>{bubble.url ? "点我打开页面" : "点我查看"}</span>
            </>
          )}
        </div>
      )}
      {badge && !quiet && <div className={styles.badge}>{badge}</div>}
      {quiet ? null : voiceLabel ? (
        <div className={`${styles.chip} ${styles.chipVoice}`}>
          {voiceStatus.phase === "listening" ? "🎙️ " : voiceStatus.phase === "thinking" ? "💭 " : "💬 "}
          {voiceStatus.phase === "listening" && voiceStatus.transcript ? voiceStatus.transcript : voiceLabel}
        </div>
      ) : (
        musicTitle && !bubble && <div className={styles.chip}>♪ 正在听：{musicTitle}</div>
      )}
      {sizeHint && <div className={styles.sizeHint}>{sizeHint}</div>}
      {isDesktop && displayState === "listening_music" && <Spectrum className={styles.spectrum} />}
      {dial && (
        <RadialMenu
          progress={dial.progress}
          progressLabel={dial.label}
          listening={voiceStatus.phase === "listening"}
          voiceEnabled={voiceEnabled}
          onAction={onDialAction}
          onMicDown={() => {
            pttActive.current = true;
            void pttStart();
          }}
          onMicUp={() => {
            if (!pttActive.current) return;
            pttActive.current = false;
            void pttStop();
          }}
          onClose={() => setDial(null)}
        />
      )}
      <div ref={stageRef} className={styles.stage} />
    </div>
  );
}
