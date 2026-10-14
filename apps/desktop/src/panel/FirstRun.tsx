import { useState } from "react";
import { api, requestNotificationPermission } from "../api/client";
import { usePanel } from "./PanelApp";
import { Button } from "./ui";
import s from "./Panel.module.css";

/** First-run explanation: what the pet does, notification permission, pairing. */
export function FirstRun() {
  const { reportError, setTab, settings } = usePanel();
  const [result, setResult] = useState<string | null>(null);

  const finish = async (goTo?: "settings") => {
    try {
      await api.completeFirstRun();
      if (goTo) setTab(goTo);
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div className={s.overlay}>
      <div className={s.dialog}>
        <h3>🐱 哼，本猫是{settings.petName}。</h3>
        <div>才不是特意来帮你的……只是顺便住在屏幕角落，在网页上的 AI 任务完成、失败或需要你处理时提醒你。（在设置 → 小喵 里可以改名字、称呼，或关闭对话气泡。）</div>
        <ul>
          <li>
            <b>通知权限</b>：macOS 会询问是否允许「DesktopPet」发送通知。允许后才能在其他窗口时收到提醒；拒绝也没关系，桌宠气泡和「通知」页仍会显示。
          </li>
          <li>
            <b>浏览器扩展</b>：加载扩展后，在扩展设置里粘贴「设置 → 浏览器扩展」中的配对码，并只授权你想监控的网站。
          </li>
          <li>
            <b>隐私</b>：扩展只上报页面标题、网址和按钮状态等信号，不读取正文、Cookie 或密码；服务只监听本机 127.0.0.1。
          </li>
        </ul>
        {result && <div className={s.notice}>{result}</div>}
        <div className={s.formActions}>
          <Button onClick={() => finish()}>稍后</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const r = await requestNotificationPermission();
              if (r === "granted") {
                await api.testNotification().catch(() => undefined);
                setResult("已允许通知，并发送了一条测试通知。");
              } else if (r === "denied") {
                setResult("通知被拒绝。可稍后在 系统设置 → 通知 → DesktopPet 中开启。");
              } else {
                setResult("当前环境无法请求通知权限（浏览器预览或开发模式）。");
              }
              window.setTimeout(() => void finish("settings"), 1800);
            }}
          >
            允许通知并开始
          </Button>
        </div>
      </div>
    </div>
  );
}
