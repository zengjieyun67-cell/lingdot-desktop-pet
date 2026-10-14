/**
 * Adapter tests use SYNTHETIC fixtures that mimic the selectors in
 * chatgpt.selectors.ts. They prove the adapter/classifier logic, NOT that the
 * selectors match today's live ChatGPT DOM (that must be verified manually).
 */
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { validateEnvelope, observedToMessageType } from "@desktop-pet/shared";
import { pickAdapter, ChatGPTAdapter, GenericAdapter } from "../src/adapters";

function dom(url: string, body: string) {
  return new JSDOM(`<!doctype html><html><head><title>写一首诗 - ChatGPT</title></head><body>${body}</body></html>`, { url });
}

const COMPOSER = `<div id="prompt-textarea" contenteditable="true"></div>`;
const STOP = `<button data-testid="stop-button" aria-label="Stop streaming"></button>`;
const SPEECH = `<button data-testid="composer-speech-button"></button>`;
const reply = (text: string) => `<div data-message-author-role="assistant"><p>${text}</p></div>`;

describe("adapter registry", () => {
  it("picks chatgpt for chatgpt.com and generic otherwise", () => {
    expect(pickAdapter("https://chatgpt.com/c/abc", dom("https://chatgpt.com/", "").window.document).type).toBe("chatgpt");
    expect(pickAdapter("https://chat.openai.com/", dom("https://chat.openai.com/", "").window.document).type).toBe("chatgpt");
    expect(pickAdapter("https://hark.com/", dom("https://hark.com/", "").window.document).type).toBe("hark");
    expect(pickAdapter("https://www.bilibili.com/", dom("https://www.bilibili.com/", "").window.document).type).toBe("bilibili");
    expect(pickAdapter("https://www.capcut.com/", dom("https://www.capcut.com/", "").window.document).type).toBe("capcut");
    expect(pickAdapter("https://example.org/", dom("https://example.org/", "").window.document).type).toBe("generic");
  });
});

describe("ChatGPT adapter", () => {
  it("task key uses conversation id or a per-tab new-chat key", () => {
    expect(new ChatGPTAdapter(dom("https://chatgpt.com/c/6720aa-bb12", "").window.document).taskKey()).toBe("chatgpt:c:6720aa-bb12");
    expect(new ChatGPTAdapter(dom("https://chatgpt.com/g/g-xyz/c/abcdef12", "").window.document).taskKey()).toBe("chatgpt:c:abcdef12");
    expect(new ChatGPTAdapter(dom("https://chatgpt.com/", "").window.document).taskKey()).toMatch(/^chatgpt:new:/);
  });

  it("stop button => running; then completion requires stability", () => {
    const d = dom("https://chatgpt.com/c/abcdef12", `${COMPOSER}${STOP}${reply("Hel")}`);
    const doc = d.window.document;
    const a = new ChatGPTAdapter(doc);
    expect(a.classifyState(0).observed).toBe("running");

    // generation finished: stop gone, speech button back, reply present
    doc.querySelector('[data-testid="stop-button"]')!.remove();
    doc.body.insertAdjacentHTML("beforeend", SPEECH);
    doc.querySelector('[data-message-author-role="assistant"] p')!.textContent = "Hello world";
    expect(a.classifyState(1000).observed).toBe("unknown"); // awaiting stability
    expect(a.classifyState(2000).observed).toBe("unknown");
    const done = a.classifyState(3100);
    expect(done.observed).toBe("completed");
    expect(done.evidence).toContain("result_stable");
  });

  it("stop button vanishing without composer returning is NOT completion", () => {
    const d = dom("https://chatgpt.com/c/abcdef12", `${STOP}${reply("x")}`);
    const doc = d.window.document;
    const a = new ChatGPTAdapter(doc);
    expect(a.classifyState(0).observed).toBe("running");
    doc.querySelector('[data-testid="stop-button"]')!.remove();
    expect(a.classifyState(10_000).observed).toBe("unknown");
    expect(a.classifyState(20_000).observed).toBe("unknown");
  });

  it("explicit error => failed", () => {
    const d = dom("https://chatgpt.com/c/abcdef12", `${COMPOSER}${SPEECH}<div role="alert">Something went wrong. Please try again.</div>`);
    expect(new ChatGPTAdapter(d.window.document).classifyState(0).observed).toBe("failed");
  });

  it("login wall => needs_attention", () => {
    const d = dom("https://chatgpt.com/", `<button data-testid="login-button">Log in</button>`);
    expect(new ChatGPTAdapter(d.window.document).classifyState(0).observed).toBe("needs_attention");
    const d2 = dom("https://auth.openai.com/log-in", ``);
    expect(new ChatGPTAdapter(d2.window.document).classifyState(0).observed).toBe("needs_attention");
  });

  it("no known signal => unknown", () => {
    const d = dom("https://chatgpt.com/c/abcdef12", `<div>totally different markup</div>`);
    const c = new ChatGPTAdapter(d.window.document).classifyState(0);
    expect(c.observed).toBe("unknown");
    expect(c.conflict).toBe(false);
  });

  it("error while generating => unknown with conflict", () => {
    const d = dom("https://chatgpt.com/c/abcdef12", `${STOP}<div data-testid="error-message"></div>`);
    const c = new ChatGPTAdapter(d.window.document).classifyState(0);
    expect(c.observed).toBe("unknown");
    expect(c.conflict).toBe(true);
  });

  it("privacy: transmitted signals contain no strings and the envelope validates", () => {
    const secret = "MY SECRET PROMPT";
    const d = dom("https://chatgpt.com/c/abcdef12", `${COMPOSER}${STOP}${reply(secret)}`);
    const doc = d.window.document;
    const a = new ChatGPTAdapter(doc);
    const sig = a.getCurrentSignals();
    const tx = a.transmittableSignals(sig);
    for (const v of Object.values(tx)) expect(["boolean", "number"]).toContain(typeof v);
    const c = a.classifyState(0);
    const env = {
      v: 1, id: "evt_test_0001", type: observedToMessageType(c.observed, c.conflict), ts: Date.now(), clientId: "client_test01",
      payload: { taskKey: a.taskKey(), adapter: a.type, url: doc.location.href, title: doc.title, observed: c.observed,
        signals: tx, evidence: c.evidence, confidence: c.confidence, visible: true, conflict: c.conflict },
    };
    expect(validateEnvelope(env).ok).toBe(true);
    expect(JSON.stringify(env)).not.toContain(secret);
  });
});

describe("Generic adapter", () => {
  it("only aria-busy/progress counts as execution and it never completes", () => {
    const d = dom("https://example.org/", `<main><div aria-busy="true"></div></main>`);
    const doc = d.window.document;
    const a = new GenericAdapter(doc);
    expect(a.classifyState(0).observed).toBe("running");
    doc.querySelector('[aria-busy]')!.setAttribute("aria-busy", "false");
    for (const t of [5000, 20000, 60000]) expect(a.classifyState(t).observed).toBe("unknown");
  });
});
