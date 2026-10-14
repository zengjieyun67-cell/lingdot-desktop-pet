import type { ConnStatus, InternalMessage } from "./lib";
import { LOCAL_PATTERN, originToPattern, patternToOrigin } from "./lib";

export function send<T = unknown>(msg: InternalMessage): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const STATE_TEXT: Record<ConnStatus["state"], string> = {
  unpaired: "未配对",
  connecting: "连接中…",
  connected: "已连接桌宠",
  unauthorized: "配对码无效",
  offline: "桌宠未运行或无法连接",
};

export function renderStatus(status: ConnStatus, paired: boolean): void {
  const dot = $("dot");
  dot.className = `dot ${status.state}`;
  $("state").textContent = paired ? STATE_TEXT[status.state] : "未配对";
  const detail = document.getElementById("detail");
  if (detail) {
    detail.textContent = status.lastError
      ? status.lastError
      : status.lastOkAt
        ? `端口 ${status.port ?? "?"} · 最近通信 ${new Date(status.lastOkAt).toLocaleTimeString()}`
        : paired
          ? ""
          : "打开「设置」粘贴桌宠的配对码";
  }
}

export async function grantedPatterns(): Promise<string[]> {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter((o) => o !== LOCAL_PATTERN);
}

/** Must be called from a user gesture (click handler). */
export async function requestOrigin(origin: string): Promise<boolean> {
  const pattern = originToPattern(origin);
  if (!pattern) throw new Error("请输入 http(s) 网址，例如 https://chatgpt.com");
  const ok = await chrome.permissions.request({ origins: [pattern] });
  if (ok) await send({ kind: "syncScripts" });
  return ok;
}

export async function revokePattern(pattern: string): Promise<void> {
  await chrome.permissions.remove({ origins: [pattern] });
  await send({ kind: "syncScripts" });
}

export function renderGranted(container: HTMLElement, patterns: string[], onChange: () => void): void {
  container.replaceChildren();
  if (!patterns.length) {
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = "尚未授权任何网站";
    container.appendChild(d);
    return;
  }
  for (const p of patterns) {
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("span");
    name.className = "grow";
    name.textContent = patternToOrigin(p);
    const btn = document.createElement("button");
    btn.className = "danger";
    btn.textContent = "撤销";
    btn.onclick = async () => {
      await revokePattern(p);
      onChange();
    };
    row.append(name, btn);
    container.appendChild(row);
  }
}
