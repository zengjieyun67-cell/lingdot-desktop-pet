import { useRef, useState } from "react";
import { ADAPTER_TYPES, type AdapterType, type Site } from "@desktop-pet/shared";
import { api } from "../api/client";
import type { SiteInput } from "../api/types";
import { usePanel } from "./PanelApp";
import { SiteIcon } from "./TasksView";
import { ExtensionGuide } from "./ExtensionGuide";
import { Button, Empty, Field, inputClass, selectClass, Toggle } from "./ui";
import { ADAPTER_LABEL, isImageIcon } from "./format";
import s from "./Panel.module.css";

const EMOJIS = ["💬", "✨", "📺", "🎬", "🤖", "🧠", "🎨", "📝", "🔍", "🎵", "📚", "🛒", "💼", "🌐", "🐱", "⭐"];

export function SitesView() {
  const { sites, reloadSites, reportError } = usePanel();
  const [manage, setManage] = useState(false);
  const [editing, setEditing] = useState<Site | "new" | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const enabled = sites.filter((x) => x.enabled);

  const launch = async (id: string) => {
    try {
      await api.launchSite(id);
      void api.personaInteraction("launch_site", id).catch(() => undefined);
    } catch (e) {
      reportError(e);
    }
  };

  const drop = async (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = sites.map((x) => x.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    try {
      await api.reorderSites(ids);
      await reloadSites();
    } catch (e) {
      reportError(e);
    }
  };

  const move = async (id: string, delta: number) => {
    const ids = sites.map((x) => x.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    try {
      await api.reorderSites(ids);
      await reloadSites();
    } catch (e) {
      reportError(e);
    }
  };

  const toggleField = async (site: Site, patch: Partial<SiteInput>) => {
    try {
      await api.updateSite(site.id, { ...toInput(site), ...patch });
      await reloadSites();
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div>
      <ExtensionGuide />
      <div className={s.sectionTitle}>
        <span>快速打开</span>
        <Button small variant="ghost" onClick={() => setManage((v) => !v)}>
          {manage ? "完成" : "管理网站"}
        </Button>
      </div>

      {enabled.length === 0 ? (
        <Empty title="还没有启用的网站" quip="一个常去的地方都没有？真拿你没办法。">
          <Button small variant="primary" onClick={() => { setManage(true); setEditing("new"); }}>
            添加网站
          </Button>
        </Empty>
      ) : (
        <div className={s.grid}>
          {enabled.map((x) => (
            <button key={x.id} className={s.launch} onClick={() => launch(x.id)} title={x.url}>
              <SiteIcon site={x} />
              <span className={s.launchName}>{x.name}</span>
            </button>
          ))}
        </div>
      )}

      {manage && (
        <>
          <div className={s.sectionTitle}>
            <span>网站管理（拖动排序）</span>
            <Button small variant="primary" onClick={() => setEditing("new")}>
              ＋ 添加
            </Button>
          </div>
          {editing === "new" && (
            <SiteForm
              onCancel={() => setEditing(null)}
              onSubmit={async (input) => {
                await api.createSite(input);
                setEditing(null);
                await reloadSites();
              }}
            />
          )}
          <div className={s.list}>
            {sites.map((x, i) =>
              editing !== "new" && editing?.id === x.id ? (
                <SiteForm
                  key={x.id}
                  initial={toInput(x)}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (input) => {
                    await api.updateSite(x.id, input);
                    setEditing(null);
                    await reloadSites();
                  }}
                />
              ) : (
                <div
                  key={x.id}
                  className={`${s.card} ${dragId === x.id ? s.dragging : ""} ${overId === x.id && dragId !== x.id ? s.dropTarget : ""}`}
                  style={{ cursor: "default" }}
                  draggable
                  onDragStart={(e) => {
                    setDragId(x.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", x.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverId(x.id);
                  }}
                  onDragLeave={() => setOverId((o) => (o === x.id ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    void drop(x.id);
                    setDragId(null);
                    setOverId(null);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                >
                  <span className={s.dragHandle} title="拖动排序">⋮⋮</span>
                  <SiteIcon site={x} />
                  <div className={s.cardMain}>
                    <div className={s.cardTitle}>{x.name}</div>
                    <div className={s.cardMeta}>
                      <span>{ADAPTER_LABEL[x.adapterType] ?? x.adapterType}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
                    <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 10.5, color: "var(--text-3)" }}>
                      启用 <Toggle label="启用" checked={x.enabled} onChange={(v) => toggleField(x, { enabled: v })} />
                    </label>
                    <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 10.5, color: "var(--text-3)" }}>
                      监控 <Toggle label="监控" checked={x.monitorEnabled} onChange={(v) => toggleField(x, { monitorEnabled: v })} />
                    </label>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <Button small icon onClick={() => move(x.id, -1)} disabled={i === 0} aria-label="上移">
                      ↑
                    </Button>
                    <Button small icon onClick={() => move(x.id, 1)} disabled={i === sites.length - 1} aria-label="下移">
                      ↓
                    </Button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <Button small onClick={() => setEditing(x)}>编辑</Button>
                    {confirmDel === x.id ? (
                      <Button
                        small
                        variant="danger"
                        onClick={async () => {
                          try {
                            await api.deleteSite(x.id);
                            setConfirmDel(null);
                            await reloadSites();
                          } catch (e) {
                            reportError(e);
                          }
                        }}
                      >
                        确认
                      </Button>
                    ) : (
                      <Button small variant="danger" onClick={() => setConfirmDel(x.id)}>删除</Button>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

function toInput(x: Site): SiteInput {
  return { name: x.name, url: x.url, icon: x.icon, enabled: x.enabled, monitorEnabled: x.monitorEnabled, adapterType: x.adapterType };
}

/** Resize an uploaded image to a 64px square PNG data URL. */
async function fileToIcon(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("无法读取图片"));
      i.src = url;
    });
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const side = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 64, 64);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function SiteForm({ initial, onSubmit, onCancel }: { initial?: SiteInput; onSubmit: (i: SiteInput) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState<SiteInput>(
    initial ?? { name: "", url: "https://", icon: "🌐", enabled: true, monitorEnabled: false, adapterType: "generic" },
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<SiteInput>) => setV((o) => ({ ...o, ...patch }));

  const useFavicon = () => {
    try {
      const host = new URL(v.url).hostname;
      set({ icon: `https://icons.duckduckgo.com/ip3/${host}.ico` });
    } catch {
      setErr("请先填写正确的网址");
    }
  };

  const submit = async () => {
    if (!v.name.trim()) return setErr("请填写名称");
    try {
      const u = new URL(v.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    } catch {
      return setErr("网址需为 http(s) 开头的完整地址");
    }
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({ ...v, name: v.name.trim(), url: v.url.trim() });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.form}>
      <div className={s.formRow}>
        <Field label="名称">
          <input className={inputClass} value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={60} autoFocus />
        </Field>
        <Field label="适配器">
          <select className={selectClass} value={v.adapterType} onChange={(e) => set({ adapterType: e.target.value as AdapterType })}>
            {ADAPTER_TYPES.map((a) => (
              <option key={a} value={a}>
                {ADAPTER_LABEL[a]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="网址">
        <input className={inputClass} value={v.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com" />
      </Field>
      <Field label="图标" hint="可选 emoji、上传图片（自动缩放为 64px），或使用网站 favicon">
        <div className={s.iconPicker}>
          <span className={s.siteIcon}>{isImageIcon(v.icon) ? <img src={v.icon} alt="" /> : v.icon || "🌐"}</span>
          <input
            className={inputClass}
            style={{ width: 64 }}
            value={isImageIcon(v.icon) ? "" : v.icon}
            placeholder="emoji"
            maxLength={8}
            onChange={(e) => set({ icon: e.target.value })}
          />
          <Button small onClick={() => fileRef.current?.click()}>上传</Button>
          <Button small onClick={useFavicon}>favicon</Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                set({ icon: await fileToIcon(f) });
              } catch (er) {
                setErr(String(er));
              }
              e.target.value = "";
            }}
          />
        </div>
        <div className={s.emojiRow}>
          {EMOJIS.map((em) => (
            <button key={em} type="button" className={s.emojiBtn} onClick={() => set({ icon: em })}>
              {em}
            </button>
          ))}
        </div>
      </Field>
      <div className={s.checkRow}>
        <span>在启动器中显示</span>
        <Toggle checked={v.enabled} onChange={(x) => set({ enabled: x })} />
      </div>
      <div className={s.checkRow}>
        <span>监控此网站任务（需在扩展中授权该网站）</span>
        <Toggle checked={v.monitorEnabled} onChange={(x) => set({ monitorEnabled: x })} />
      </div>
      {err && <div style={{ color: "var(--red)", fontSize: 12, marginBottom: 6 }}>{err}</div>}
      <div className={s.formActions}>
        <Button onClick={onCancel}>取消</Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}
