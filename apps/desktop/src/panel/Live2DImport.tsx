import { useState } from "react";
import { api, errorText } from "../api/client";
import type { Live2DImport } from "../api/types";
import { Button, inputClass } from "./ui";
import s from "./Panel.module.css";

/** True when the pet is not showing a Live2D model right now (→ show the import card). */
export function needsLive2DCard(status: string | null | undefined): boolean {
  return !status || !status.startsWith("Live2D 模型已加载");
}

/**
 * 「一键导入我的 Live2D」 card (设置 → 角色): scan 下载 / 桌面 / 文稿 / ~/Live2D / old project folders,
 * or pick a folder. Rust copies the model + Cubism Core into the app data folder and switches the
 * renderer; every window reloads the character by itself.
 */
export function Live2DImportCard({ prominent }: { prominent: boolean }) {
  const [busy, setBusy] = useState<"scan" | "pick" | "path" | null>(null);
  const [result, setResult] = useState<Live2DImport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [path, setPath] = useState("");

  const run = async (kind: "scan" | "pick" | "path", f: () => Promise<Live2DImport | null>) => {
    setBusy(kind);
    setErr(null);
    try {
      const r = await f();
      if (r) setResult(r);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const scan = () => run("scan", () => api.scanImportLive2D(true));
  const pick = () =>
    run("pick", async () => {
      const dir = await api.pickLive2DFolder();
      return dir ? api.importLive2DFolder(dir) : null;
    });
  const fromPath = () => run("path", () => api.importLive2DFolder(path.trim()));
  const ok = result && result.modelPath && result.corePath;

  return (
    <div className={`${s.l2dCard} ${prominent ? s.l2dCardHot : ""}`}>
      <div className={s.l2dTag}>L2D · 01</div>
      <div className={s.l2dTitle}>{prominent ? "换成我的 Live2D 角色" : "重新导入 Live2D"}</div>
      <div className={s.rowDesc}>
        {prominent ? "现在显示的是内置猫娘。" : null}
        把模型文件夹（里面有 <b>.model3.json</b>）和官网下载的 <b>CubismSdkForWeb-*.zip</b> 放进「下载」文件夹，然后点一键导入。
        第一次会弹出访问「下载 / 桌面 / 文稿」的权限，点「好」就行。以前在 Mac 上配置过的项目文件夹也会自动找到。
      </div>
      <div className={s.l2dActions}>
        <Button variant="primary" disabled={!!busy} onClick={scan}>
          {busy === "scan" ? "正在找…" : "✨ 一键导入我的 Live2D"}
        </Button>
        <Button disabled={!!busy} onClick={pick}>
          {busy === "pick" ? "导入中…" : "📁 选择模型文件夹"}
        </Button>
      </div>
      <div className={s.inline} style={{ marginTop: 8 }}>
        <input
          className={inputClass}
          style={{ flex: 1 }}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="或粘贴模型文件夹路径，例如 /Users/你/Downloads/女仆猫娘"
        />
        <Button small disabled={!!busy || !path.trim()} onClick={fromPath}>
          导入
        </Button>
      </div>
      {(result || err) && (
        <div className={`${s.l2dResult} ${ok ? s.l2dOk : ""}`} role="status">
          {err ?? result?.message}
          {ok && result?.modelSource ? <div className={s.l2dSrc}>来自：{result.modelSource}</div> : null}
        </div>
      )}
    </div>
  );
}
