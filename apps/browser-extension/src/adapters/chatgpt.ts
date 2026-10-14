import type { PageSignals } from "@desktop-pet/shared";
import { CHATGPT_SELECTORS as S } from "./chatgpt.selectors";
import { DomAdapter, isVisible, queryAll, queryFirst } from "./types";

const HOSTS = ["chatgpt.com", "chat.openai.com"];

/** Cheap 32-bit string hash for a local fingerprint (never transmitted). */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export class ChatGPTAdapter extends DomAdapter {
  readonly type = "chatgpt" as const;
  protected stableMs = 2000;

  matches(url: URL): boolean {
    return HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`)) || (S.loginHosts as readonly string[]).includes(url.hostname);
  }

  /** `chatgpt:c:<conversationId>` once a conversation exists, else a per-tab "new chat" key. */
  taskKey(): string {
    const m = this.doc.location.pathname.match(/\/c\/([A-Za-z0-9-]{6,80})/);
    if (m) return `chatgpt:c:${m[1]}`;
    return `chatgpt:new:${this.sessionId}`;
  }

  getCurrentSignals(): PageSignals {
    const d = this.doc;
    const stop = queryFirst(d, S.stopButton);
    const executing = isVisible(stop);
    const streaming = !!queryFirst(d, S.streaming);

    const composer = queryFirst(d, S.composer);
    const send = queryFirst(d, S.sendButton) as HTMLButtonElement | null;
    const idleBtn = queryFirst(d, S.idleComposerButtons);
    const composerReady =
      !!composer && !executing && ((!!send && isVisible(send)) || (!!idleBtn && isVisible(idleBtn)));

    const assistants = queryAll(d, S.assistantMessage);
    const last = assistants[assistants.length - 1];
    // Fingerprint = count + length + node count of the last reply. Used only locally
    // to detect that the reply stopped changing; the text itself is never sent.
    const fp = last ? hash(`${assistants.length}:${(last.textContent ?? "").length}:${last.querySelectorAll("*").length}`) : "";

    let error = !!queryFirst(d, S.error);
    if (!error) {
      error = queryAll(d, S.errorContainers).some((el) => {
        const t = el.textContent ?? "";
        return S.errorPhrases.some((p) => t.includes(p));
      });
    }

    const loc = d.location;
    const loginWall =
      (S.loginHosts as readonly string[]).includes(loc.hostname) ||
      S.loginPaths.some((p) => loc.pathname.startsWith(p)) ||
      (!composer && isVisible(queryFirst(d, S.loginWall)));
    const confirmRequired = isVisible(queryFirst(d, S.confirm));

    return {
      executing,
      streaming,
      composerReady,
      resultPresent: assistants.length > 0,
      resultFingerprint: fp,
      error,
      loginWall,
      confirmRequired,
    };
  }

  transmittableSignals(sig: PageSignals): Record<string, boolean | number> {
    return {
      ...super.transmittableSignals(sig),
      assistantMessages: queryAll(this.doc, S.assistantMessage).length,
    };
  }
}
