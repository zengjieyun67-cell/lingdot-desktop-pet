import { useState } from "react";
import { usePanel } from "./PanelApp";
import { Button } from "./ui";
import s from "./Panel.module.css";

const DISMISS_KEY = "desktop-pet-ext-guide-dismissed-v1";

export function pairingCode(c: { port: number; token: string } | null): string {
  return c ? JSON.stringify({ port: c.port, token: c.token }) : "";
}

export function isGuideDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setGuideDismissed(v: boolean): void {
  try {
    if (v) localStorage.setItem(DISMISS_KEY, "1");
    else localStorage.removeItem(DISMISS_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("ext-guide-changed"));
}

/**
 * 3-step guide shown in 任务 / 网站 while the Chrome extension is not connected.
 * Website monitoring only works through the extension; the protocol is unchanged.
 */
export function ExtensionGuide() {
  const { connection, reportError } = usePanel();
  const [dismissed, setDismissed] = useState(isGuideDismissed);
  const [copied, setCopied] = useState<"code" | "url" | null>(null);

  if (connection?.status.connected) return null;

  const copy = async (text: string, what: "code" | "url") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1600);
    } catch (e) {
      reportError(e);
    }
  };

  if (dismissed) {
    return (
      <div className={s.notice} style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1 }}>🔌 浏览器扩展还没连上，小喵暂时看不到网页任务。</span>
        <Button
          small
          variant="ghost"
          onClick={() => {
            setGuideDismissed(false);
            setDismissed(false);
          }}
        >
          查看引导
        </Button>
      </div>
    );
  }

  return (
    <section className={s.guide} aria-label="安装浏览器扩展引导">
      <button
        type="button"
        className={s.guideClose}
        aria-label="先不用了"
        title="先不用了"
        onClick={() => {
          setGuideDismissed(true);
          setDismissed(true);
        }}
      >
        ✕
      </button>
      <div className={s.guideHead}>
        <span className={s.guideEmoji} aria-hidden="true">🐾</span>
        <span className={s.guideTitle}>让小喵帮你盯 ChatGPT</span>
      </div>
      <p className={s.guideSub}>哼，装个扩展而已，三步就好。才不是想帮你呢！</p>
      <ol className={s.steps}>
        <li className={s.step}>
          <span className={s.stepNo}>1</span>
          <div className={s.stepBody}>
            在 Chrome 打开 <span className={s.kbd}>chrome://extensions</span>
            <Button small variant="ghost" onClick={() => void copy("chrome://extensions", "url")} style={{ height: 22, padding: "0 8px", marginLeft: 4 }}>
              {copied === "url" ? "已复制 ✓" : "复制"}
            </Button>
            <br />→ 右上角开启 <b>开发者模式</b> → 点 <b>加载已解压的扩展程序</b>，选解压好的扩展文件夹（从 GitHub Releases 下载 <b>browser-extension.zip</b> 解压，文件夹里有 manifest.json）
          </div>
        </li>
        <li className={s.step}>
          <span className={s.stepNo}>2</span>
          <div className={s.stepBody} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>复制配对码</span>
            <Button small variant="primary" disabled={!connection} onClick={() => void copy(pairingCode(connection), "code")}>
              {copied === "code" ? "已复制 ✓" : "📋 复制配对码"}
            </Button>
          </div>
        </li>
        <li className={s.step}>
          <span className={s.stepNo}>3</span>
          <div className={s.stepBody}>
            点浏览器里的小喵扩展图标 → 设置 → <b>粘贴</b>并「保存并连接」，再在弹窗里给 ChatGPT 点 <b>授权</b>
          </div>
        </li>
      </ol>
      {connection?.serverError && <div className={s.guideFoot} style={{ color: "var(--red)", opacity: 1 }}>本地服务：{connection.serverError}</div>}
      <div className={s.guideFoot}>连上之后这张卡片会自己消失。配对码相当于密码，别发给别人哦。</div>
    </section>
  );
}
