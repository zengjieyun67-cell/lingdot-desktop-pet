import type { ConnStatus, SitesResponse } from "./lib";
import { originToPattern } from "./lib";
import { $, grantedPatterns, renderGranted, renderStatus, requestOrigin, send } from "./ui-common";

async function refresh() {
  const { status, pairing } = await send<{ status: ConnStatus; pairing: boolean }>({ kind: "getStatus" });
  renderStatus(status, pairing);
  const granted = await grantedPatterns();
  renderGranted($("granted"), granted, refresh);

  const sitesEl = $("sites");
  sitesEl.replaceChildren();
  if (!pairing) {
    sitesEl.innerHTML = '<div class="empty">请先在「设置」中完成配对</div>';
    return;
  }
  const res = await send<SitesResponse>({ kind: "fetchSites" });
  const r2 = await send<{ status: ConnStatus; pairing: boolean }>({ kind: "getStatus" });
  renderStatus(r2.status, r2.pairing);
  if (!res.ok || !res.sites) {
    sitesEl.innerHTML = "";
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = res.error ?? "无法获取网站列表";
    sitesEl.appendChild(d);
    return;
  }
  if (!res.sites.length) {
    sitesEl.innerHTML = '<div class="empty">桌宠中没有开启「监控」的网站</div>';
    return;
  }
  for (const s of res.sites) {
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("span");
    name.className = "grow";
    name.textContent = `${s.name}  `;
    const sub = document.createElement("span");
    sub.className = "muted";
    sub.textContent = s.origin;
    name.appendChild(sub);
    const pattern = originToPattern(s.origin);
    const isGranted = !!pattern && granted.includes(pattern);
    const btn = document.createElement("button");
    btn.textContent = isGranted ? "已授权" : "授权";
    btn.className = isGranted ? "" : "primary";
    btn.disabled = isGranted;
    btn.onclick = async () => {
      try {
        await requestOrigin(s.origin);
      } finally {
        void refresh();
      }
    };
    row.append(name, btn);
    sitesEl.appendChild(row);
  }
}

$("test").onclick = async () => {
  $("state").textContent = "测试中…";
  await send({ kind: "testConnection" });
  void refresh();
};
$("options").onclick = () => chrome.runtime.openOptionsPage();
void refresh();
