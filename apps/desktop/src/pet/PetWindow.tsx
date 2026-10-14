import { useCallback, useEffect, useRef, useState } from "react";
import { triggerForNotification, type Emotion, type InteractionKind, type PetMood } from "@desktop-pet/shared";
import { api, on, startDragging } from "../api/client";
import type { AppSettings, ConnectionStatus, NotificationEventPayload, PersonaMemory } from "../api/types";
import { createRenderer } from "./renderer/createRenderer";
import type { PetRenderer } from "./renderer/PetRenderer";
import { PatDetector, PersonaController, type Spoken } from "./persona";
import { playChime } from "./chime";
import styles from "./Pet.module.css";

const BADGE: Record<PetMood, string | null> = { idle: null, working: "✨", completed: "💖", needs_attention: "❗" };
const DRAG_THRESHOLD = 4;
const NOTIFY_BUBBLE_MS = 9000;
const LINE_BUBBLE_MS = 6000;
const PERSONA_TICK_MS = 30_000;

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

export function PetWindow() {
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
      connectedRef.current = boot.connection.status.connected;

      unlisten.push(
        await on<PetMood>("pet-mood", (m) => {
          moodRef.current = m;
          setMood(m);
          rendererRef.current?.setMood(m);
        }),
        await on<{ dx: number; dy: number }>("pet-cursor", ({ dx, dy }) => rendererRef.current?.lookAt(dx, dy)),
        await on<AppSettings>("settings-changed", (s) => {
          const prev = settingsRef.current;
          settingsRef.current = s;
          persona.settings = personaSettings(s);
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
  }, [mountRenderer, speak, remember, applyEmotion, showBubble, checkRunningTasks]);

  const onMouseMove = (e: React.MouseEvent) => {
    const d = down.current;
    if (d && !d.dragging && Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_THRESHOLD) {
      d.dragging = true;
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
  };

  const onMouseUp = (e: React.MouseEvent) => {
    const d = down.current;
    down.current = null;
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

  const badge = kind === "live2d" ? BADGE[mood] : null;

  return (
    <div
      className={`${styles.wrap} ${animations ? "" : styles.still}`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        down.current = null;
        patRef.current.reset();
      }}
      onContextMenu={onContextMenu}
      title="单击打开面板 · 拖动移动 · 在头上来回摸摸 · 右键设置"
    >
      {bubble && (
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
      {badge && <div className={styles.badge}>{badge}</div>}
      <div ref={stageRef} className={styles.stage} />
    </div>
  );
}
