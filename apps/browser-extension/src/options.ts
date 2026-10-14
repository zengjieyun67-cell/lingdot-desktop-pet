import { parsePairing, type ConnStatus } from "./lib";
import { $, grantedPatterns, renderGranted, renderStatus, requestOrigin, send } from "./ui-common";

function msg(id: string, text: string, ok: boolean) {
  const el = $(id);
  el.textContent = text;
  el.className = `msg ${ok ? "ok" : "err"}`;
}

async function refresh() {
  const { status, pairing } = await send<{ status: ConnStatus; pairing: boolean }>({ kind: "getStatus" });
  renderStatus(status, pairing);
  renderGranted($("granted"), await grantedPatterns(), refresh);
}

$("save").onclick = async () => {
  const p = parsePairing($<HTMLTextAreaElement>("pairing").value);
  if (!p) return msg("pairMsg", "配对码格式不正确：应为 {\"port\":17321,\"token\":\"…\"}", false);
  const { status } = await send<{ status: ConnStatus }>({ kind: "savePairing", pairing: p });
  $<HTMLTextAreaElement>("pairing").value = "";
  if (status.state === "connected") msg("pairMsg", "配对成功，已连接桌宠 🎉", true);
  else msg("pairMsg", `已保存，但暂时无法连接：${status.lastError ?? status.state}`, false);
  void refresh();
};

$("unpair").onclick = async () => {
  await send({ kind: "unpair" });
  msg("pairMsg", "已取消配对", true);
  void refresh();
};

$("test").onclick = async () => {
  const { status } = await send<{ status: ConnStatus }>({ kind: "testConnection" });
  msg("pairMsg", status.state === "connected" ? "连接正常" : `连接失败：${status.lastError ?? status.state}`, status.state === "connected");
  void refresh();
};

$("grant").onclick = async () => {
  try {
    const ok = await requestOrigin($<HTMLInputElement>("origin").value.trim());
    msg("grantMsg", ok ? "已授权，监控脚本已注册" : "你拒绝了授权", ok);
  } catch (e) {
    msg("grantMsg", (e as Error).message, false);
  }
  void refresh();
};

void refresh();
