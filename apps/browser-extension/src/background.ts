/**
 * MV3 service worker.
 *  - Holds the pairing (port + token) in chrome.storage.local.
 *  - Registers the content script dynamically, only for origins the user granted
 *    via chrome.permissions.request (optional_host_permissions).
 *  - Forwards observations to http://127.0.0.1:<port>/v1/events with Bearer auth,
 *    retrying transient failures with exponential backoff.
 *  - Sends monitor.heartbeat every 30s (chrome.alarms) so the desktop can detect loss.
 */
import {
  randomId,
  validateEnvelope,
  type MessageType,
  type PayloadFor,
  type ProtocolEnvelope,
} from "@desktop-pet/shared";
import {
  backoffMs,
  isRetryable,
  LOCAL_PATTERN,
  type ConnStatus,
  type InternalMessage,
  type Pairing,
  type SitesResponse,
} from "./lib";

const SCRIPT_ID = "desktop-pet-monitor";
const HEARTBEAT_ALARM = "desktop-pet-heartbeat";
const MAX_ATTEMPTS = 5;

let status: ConnStatus = { state: "unpaired", lastOkAt: null, lastError: null, port: null };

async function getPairing(): Promise<Pairing | null> {
  const { pairing } = await chrome.storage.local.get("pairing");
  return (pairing as Pairing | undefined) ?? null;
}

async function getClientId(): Promise<string> {
  const { clientId } = await chrome.storage.local.get("clientId");
  if (typeof clientId === "string") return clientId;
  const id = randomId(12);
  await chrome.storage.local.set({ clientId: id });
  return id;
}

async function setStatus(patch: Partial<ConnStatus>): Promise<void> {
  status = { ...status, ...patch };
  await chrome.storage.session?.set({ status }).catch(() => undefined);
  const badge = status.state === "connected" ? "" : status.state === "unpaired" ? "" : "!";
  chrome.action.setBadgeText({ text: badge }).catch(() => undefined);
  chrome.action.setBadgeBackgroundColor({ color: "#EC5A6F" }).catch(() => undefined);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post<T extends MessageType>(type: T, payload: PayloadFor<T>, retry = true): Promise<boolean> {
  const pairing = await getPairing();
  if (!pairing) {
    await setStatus({ state: "unpaired", port: null });
    return false;
  }
  const env: ProtocolEnvelope<T> = { v: 1, id: randomId(), type, ts: Date.now(), clientId: await getClientId(), payload };
  const check = validateEnvelope(env);
  if (!check.ok) {
    console.warn("[desktop-pet] dropping invalid message", check.error);
    return false;
  }
  const body = JSON.stringify(env);
  for (let attempt = 0; attempt < (retry ? MAX_ATTEMPTS : 1); attempt++) {
    let httpStatus: number | null = null;
    try {
      const res = await fetch(`http://127.0.0.1:${pairing.port}/v1/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${pairing.token}` },
        body,
        cache: "no-store",
      });
      httpStatus = res.status;
      if (res.ok) {
        await setStatus({ state: "connected", lastOkAt: Date.now(), lastError: null, port: pairing.port });
        return true;
      }
      if (res.status === 401 || res.status === 403) {
        await setStatus({ state: "unauthorized", lastError: `HTTP ${res.status}：配对码无效或已重新生成`, port: pairing.port });
        return false;
      }
      if (!isRetryable(res.status)) {
        const text = await res.text().catch(() => "");
        await setStatus({ lastError: `HTTP ${res.status} ${text.slice(0, 120)}` });
        return false;
      }
    } catch (e) {
      await setStatus({ state: "offline", lastError: `无法连接桌宠（${(e as Error).message}）`, port: pairing.port });
    }
    if (!isRetryable(httpStatus) || attempt === MAX_ATTEMPTS - 1 || !retry) break;
    await sleep(backoffMs(attempt));
  }
  return false;
}

async function countMonitoredTabs(): Promise<number> {
  const { origins = [] } = await chrome.permissions.getAll();
  const patterns = origins.filter((o) => o !== LOCAL_PATTERN);
  if (!patterns.length) return 0;
  const tabs = await chrome.tabs.query({ url: patterns }).catch(() => []);
  return Math.min(tabs.length, 1000);
}

async function heartbeat(): Promise<void> {
  if (!(await getPairing())) return;
  const wasConnected = status.state === "connected";
  if (!wasConnected) {
    await post("monitor.connected", { extensionVersion: chrome.runtime.getManifest().version, browser: "Chrome" }, false);
  }
  await post("monitor.heartbeat", { activeTabs: await countMonitoredTabs() }, false);
}

/** Register the content script for exactly the granted origins. */
async function syncContentScripts(): Promise<string[]> {
  const { origins = [] } = await chrome.permissions.getAll();
  const matches = origins.filter((o) => o !== LOCAL_PATTERN && /^https?:\/\//.test(o));
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }).catch(() => []);
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => undefined);
  if (matches.length) {
    await chrome.scripting.registerContentScripts([
      { id: SCRIPT_ID, matches, js: ["content.js"], runAt: "document_idle", allFrames: false, persistAcrossSessions: true },
    ]);
    // Inject into already-open tabs of newly granted origins (content.ts guards double-injection).
    const tabs = await chrome.tabs.query({ url: matches }).catch(() => []);
    for (const t of tabs) {
      if (t.id !== undefined) {
        chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }).catch(() => undefined);
      }
    }
  }
  return matches;
}

async function fetchSites(): Promise<SitesResponse> {
  const pairing = await getPairing();
  if (!pairing) return { ok: false, error: "尚未配对" };
  try {
    const res = await fetch(`http://127.0.0.1:${pairing.port}/v1/sites`, {
      headers: { Authorization: `Bearer ${pairing.token}` },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as SitesResponse;
    await setStatus({ state: "connected", lastOkAt: Date.now(), lastError: null, port: pairing.port });
    return data;
  } catch (e) {
    await setStatus({ state: "offline", lastError: (e as Error).message });
    return { ok: false, error: "无法连接桌宠，请确认桌宠已运行" };
  }
}

async function testConnection(): Promise<ConnStatus> {
  const pairing = await getPairing();
  if (!pairing) {
    await setStatus({ state: "unpaired" });
    return status;
  }
  try {
    const res = await fetch(`http://127.0.0.1:${pairing.port}/v1/health`, {
      headers: { Authorization: `Bearer ${pairing.token}` },
      cache: "no-store",
    });
    if (res.ok) {
      await setStatus({ state: "connected", lastOkAt: Date.now(), lastError: null, port: pairing.port });
      await post("monitor.connected", { extensionVersion: chrome.runtime.getManifest().version, browser: "Chrome" }, false);
    } else if (res.status === 401 || res.status === 403) {
      await setStatus({ state: "unauthorized", lastError: `HTTP ${res.status}：配对码无效`, port: pairing.port });
    } else {
      await setStatus({ state: "offline", lastError: `HTTP ${res.status}` });
    }
  } catch (e) {
    await setStatus({ state: "offline", lastError: `无法连接（${(e as Error).message}）`, port: pairing.port });
  }
  return status;
}

chrome.runtime.onMessage.addListener((msg: InternalMessage, sender, sendResponse) => {
  (async () => {
    switch (msg.kind) {
      case "observation": {
        // Only accept observations from our own content scripts in real tabs.
        if (sender.id !== chrome.runtime.id || !sender.tab) return sendResponse({ ok: false });
        const ok = await post(msg.event, msg.payload);
        return sendResponse({ ok });
      }
      case "getStatus":
        return sendResponse({ status, pairing: !!(await getPairing()) });
      case "savePairing":
        await chrome.storage.local.set({ pairing: msg.pairing });
        return sendResponse({ status: await testConnection() });
      case "unpair":
        await post("monitor.disconnected", { reason: "user_unpaired" }, false);
        await chrome.storage.local.remove("pairing");
        await setStatus({ state: "unpaired", port: null, lastError: null });
        return sendResponse({ status });
      case "testConnection":
        return sendResponse({ status: await testConnection() });
      case "fetchSites":
        return sendResponse(await fetchSites());
      case "syncScripts":
        return sendResponse({ matches: await syncContentScripts() });
    }
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true; // async response
});

chrome.permissions.onAdded.addListener(() => void syncContentScripts());
chrome.permissions.onRemoved.addListener(() => void syncContentScripts());

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === HEARTBEAT_ALARM) void heartbeat();
});

async function init() {
  await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  const saved = (await chrome.storage.session?.get("status").catch(() => ({}))) as { status?: ConnStatus } | undefined;
  if (saved?.status) status = saved.status;
  await syncContentScripts().catch(() => undefined);
  void heartbeat();
}

chrome.runtime.onInstalled.addListener(() => void init());
chrome.runtime.onStartup.addListener(() => void init());
void init();
