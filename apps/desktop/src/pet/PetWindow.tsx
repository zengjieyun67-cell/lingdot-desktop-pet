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
import { api, on, startDragging } from "../api/client";
import type {
  ActivityEvent,
  ActivitySnapshot,
  AppSettings,
  ConnectionStatus,
  NotificationEventPayload,
  PersonaMemory,
} from "../api/types";
import { useVoice, voicePhaseLabel } from "../lib/voice";
import { createRenderer } from "./renderer/createRenderer";
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
}

function rendererKey(s: AppSettings): string {
  return [s.rendererMode, s.live2dModelPath, s.live2dCorePath].join("|");
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
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const { status: voiceStatus, pttStart, pttStop } = useVoice();

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

  const mountRenderer = useCallback(async (s: AppSettings) => {
    const stage = stageRef.current;
    if (!stage) return;
    rendererRef.current?.destroy();
    stage.replaceChildren();
    const res = await createRenderer(s, stage);
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
          if (!prev || rendererKey(prev) !== rendererKey(s)) void mountRenderer(s);
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
      void startDragging().then(() => {
        const p = personaRef.current;
        if (!p) return;
        p.touch();
        speak(p.say("dragged", {}, true));
        remember("drag");
      });
    }
    const rect = e.currentTarget.getBoundingClientRect();
    rendererRef.current?.lookAt(e.clientX - rect.width / 2, e.clientY - rect.height * 0.38);
    // Head pat: rubbing back and forth over the upper part of the pet without pressing.
    const overHead = e.clientY < rect.height * 0.55 && e.clientY > rect.height * 0.12;
    if (!d && e.buttons === 0 && overHead) {
      if (patRef.current.feed(e.clientX, Date.now())) {
        const p = personaRef.current;
        if (p) {
          p.touch();
          speak(p.say("pat"));
          remember("pat");
        }
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
    rendererRef.current?.poke();
    const p = personaRef.current;
    if (p) {
      p.touch();
      speak(p.say("clicked", {}, true));
      remember("click");
    }
    void api.togglePanel();
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    void api.showPanel("settings");
  };

  const openBubble = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!bubble) return;
    setBubble(null);
    if (bubble.notificationId && bubble.url) void api.openNotification(bubble.notificationId);
    else if (bubble.notificationId) void api.showPanel("notifications");
  };

  // Live2D models without a matching motion get a small badge instead.
  const stateBadge = STATE_REGISTRY[displayState].source === "activity" ? STATE_REGISTRY[displayState].badge : null;
  const badge = kind === "live2d" ? (stateBadge ?? BADGE[mood]) : null;
  const voiceLabel = voicePhaseLabel(voiceStatus);
  const musicTitle = displayState === "listening_music" && activity.music ? activity.music.title ?? activity.music.app : null;
  const hint = voiceEnabled
    ? "单击打开面板 · 长按说话 · 拖动移动 · 在头上来回摸摸 · ⌘/Ctrl+滚轮调大小 · 右键设置"
    : "单击打开面板 · 拖动移动 · 在头上来回摸摸 · ⌘/Ctrl+滚轮调大小 · 右键设置";

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${animations ? "" : styles.still} ${isDesktop ? styles.desktop : ""}`}
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
      title={isDesktop ? hint.replace(" · 拖动移动", "").replace(" · ⌘/Ctrl+滚轮调大小", "") : hint}
    >
      {bubble && !quiet && (
        <div
          className={`${styles.bubble} ${bubble.notificationId ? "" : styles.bubbleLine}`}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={openBubble}
          role={bubble.notificationId ? "button" : "status"}
        >
          {bubble.line && <span className={styles.bubbleSay}>{bubble.line}</span>}
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
      <div ref={stageRef} className={styles.stage} />
    </div>
  );
}
