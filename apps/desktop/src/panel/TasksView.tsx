import { useCallback, useEffect, useState } from "react";
import { TASK_STATUSES, type Site, type Task, type TaskDetail, type TaskStatus } from "@desktop-pet/shared";
import { api } from "../api/client";
import type { TaskInput } from "../api/types";
import { usePanel } from "./PanelApp";
import { Button, Empty, Field, inputClass, selectClass, Spinner, StatusBadge } from "./ui";
import {
  confidenceLabel,
  DETECTION_LABEL,
  EVENT_KIND_LABEL,
  fullTime,
  isImageIcon,
  relTime,
  statusLabel,
} from "./format";
import s from "./Panel.module.css";

export function SiteIcon({ site }: { site?: Site | null }) {
  if (!site) return <span className={s.siteIcon}>🗂️</span>;
  return <span className={s.siteIcon}>{isImageIcon(site.icon) ? <img src={site.icon} alt="" /> : site.icon || "🌐"}</span>;
}

export function TasksView() {
  const { sites, tasksVersion, reportError } = usePanel();
  const [siteFilter, setSiteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | TaskStatus>("");
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setTasks(await api.listTasks({ siteId: siteFilter || null, status: statusFilter || null }));
    } catch (e) {
      reportError(e);
      setTasks([]);
    }
  }, [siteFilter, statusFilter, reportError]);

  useEffect(() => {
    void load();
  }, [load, tasksVersion]);

  if (selected) return <TaskDetailView id={selected} onBack={() => setSelected(null)} />;

  const siteOf = (id: string | null) => sites.find((x) => x.id === id);

  return (
    <div>
      <div className={s.toolbar}>
        <select className={selectClass} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="按网站筛选">
          <option value="">全部网站</option>
          {sites.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as TaskStatus | "")}
          aria-label="按状态筛选"
        >
          <option value="">全部状态</option>
          {TASK_STATUSES.map((st) => (
            <option key={st} value={st}>
              {statusLabel(st)}
            </option>
          ))}
        </select>
        <Button variant="primary" onClick={() => setCreating((v) => !v)}>
          {creating ? "取消" : "＋ 新建"}
        </Button>
      </div>

      {creating && (
        <TaskForm
          sites={sites}
          onCancel={() => setCreating(false)}
          onSubmit={async (input) => {
            await api.createTask(input);
            setCreating(false);
            await load();
          }}
        />
      )}

      {tasks === null ? (
        <Spinner />
      ) : tasks.length === 0 ? (
        <Empty icon="🧶" title={siteFilter || statusFilter ? "没有符合条件的任务" : "还没有任务"}>
          <span>在已授权的网站上开始一个 AI 任务，桌宠会自动记录；也可以点「新建」手动添加。</span>
        </Empty>
      ) : (
        <div className={s.list}>
          {tasks.map((t) => {
            const site = siteOf(t.siteId);
            return (
              <button key={t.id} className={s.card} onClick={() => setSelected(t.id)}>
                <SiteIcon site={site} />
                <div className={s.cardMain}>
                  <div className={s.cardTitle}>{t.title}</div>
                  <div className={s.cardMeta}>
                    <span>{site?.name ?? "未关联网站"}</span>·<span>{relTime(t.updatedAt)}</span>
                    {t.runCount > 1 && <span>· 第 {t.runCount} 轮</span>}
                  </div>
                </div>
                <StatusBadge status={t.status} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskForm({
  sites,
  initial,
  onSubmit,
  onCancel,
}: {
  sites: Site[];
  initial?: TaskInput;
  onSubmit: (input: TaskInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [siteId, setSiteId] = useState(initial?.siteId ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) return setErr("请填写任务标题");
    if (url && !/^https?:\/\//i.test(url)) return setErr("链接需以 http:// 或 https:// 开头");
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({ title: title.trim(), siteId: siteId || null, url: url.trim(), status: initial?.status ?? null });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.form}>
      <Field label="标题">
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：让 ChatGPT 写一份周报" autoFocus maxLength={300} />
      </Field>
      <div className={s.formRow}>
        <Field label="网站">
          <select
            className={selectClass}
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              const st = sites.find((x) => x.id === e.target.value);
              if (st && !url) setUrl(st.url);
            }}
          >
            <option value="">不关联</option>
            {sites.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="链接（可选）">
          <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </Field>
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

function TaskDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const { sites, tasksVersion, reportError } = usePanel();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api.getTaskDetail(id));
    } catch {
      setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, tasksVersion]);

  if (missing) {
    return (
      <div>
        <Button small className={s.back} onClick={onBack}>
          ‹ 返回
        </Button>
        <Empty icon="🫥" title="任务不存在或已被删除" />
      </div>
    );
  }
  if (!detail) return <Spinner />;
  const t = detail.task;
  const site = sites.find((x) => x.id === t.siteId);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      reportError(e);
    }
  };

  return (
    <div>
      <Button small className={s.back} onClick={onBack}>
        ‹ 返回
      </Button>
      <div className={s.detailHead}>
        <SiteIcon site={site} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={s.detailTitle}>{t.title}</div>
          <div style={{ marginTop: 4 }}>
            <StatusBadge status={t.status} />
          </div>
        </div>
      </div>

      {editing ? (
        <TaskForm
          sites={sites}
          initial={{ title: t.title, siteId: t.siteId, url: t.url }}
          onCancel={() => setEditing(false)}
          onSubmit={async (input) => {
            await api.updateTask(t.id, input);
            setEditing(false);
            await load();
          }}
        />
      ) : (
        <>
          <dl className={s.kv}>
            <dt>网站</dt>
            <dd>{site?.name ?? "未关联"}</dd>
            <dt>链接</dt>
            <dd>{t.url || "—"}</dd>
            <dt>来源</dt>
            <dd>{DETECTION_LABEL[t.detectionSource] ?? t.detectionSource}</dd>
            <dt>判定可信度</dt>
            <dd title="状态判定的把握程度，不代表任务进度">{confidenceLabel(t.confidence)}（不代表进度）</dd>
            <dt>创建</dt>
            <dd>{fullTime(t.createdAt)}</dd>
            <dt>开始</dt>
            <dd>{fullTime(t.startedAt)}</dd>
            <dt>完成</dt>
            <dd>{fullTime(t.completedAt)}</dd>
            <dt>最近观察</dt>
            <dd>{relTime(t.lastObservedAt)}</dd>
            <dt>已通知</dt>
            <dd>{t.notificationSent ? "是" : "否"}</dd>
          </dl>
          <div className={s.actions}>
            <Button variant="primary" small disabled={!t.url} onClick={() => act(() => api.openTask(t.id))}>
              打开页面
            </Button>
            <select
              className={selectClass}
              style={{ height: 24, fontSize: 11.5 }}
              value=""
              onChange={(e) => e.target.value && act(() => api.setTaskStatus(t.id, e.target.value as TaskStatus))}
              aria-label="手动修改状态"
            >
              <option value="">标记为…</option>
              {TASK_STATUSES.filter((x) => x !== t.status).map((x) => (
                <option key={x} value={x}>
                  {statusLabel(x)}
                </option>
              ))}
            </select>
            <Button small onClick={() => setEditing(true)}>
              编辑
            </Button>
            {confirmDelete ? (
              <>
                <Button small variant="danger" onClick={() => act(async () => { await api.deleteTask(t.id); onBack(); })}>
                  确认删除
                </Button>
                <Button small onClick={() => setConfirmDelete(false)}>
                  取消
                </Button>
              </>
            ) : (
              <Button small variant="danger" onClick={() => setConfirmDelete(true)}>
                删除
              </Button>
            )}
          </div>
        </>
      )}

      {detail.runs.length > 0 && (
        <>
          <div className={s.sectionTitle}>执行轮次</div>
          <div className={s.list} style={{ marginBottom: 10 }}>
            {detail.runs.map((r) => (
              <div key={r.id} className={s.card} style={{ cursor: "default" }}>
                <div className={s.cardMain}>
                  <div className={s.cardTitle}>第 {r.runNo} 轮</div>
                  <div className={s.cardMeta}>
                    {fullTime(r.startedAt)} → {r.endedAt ? fullTime(r.endedAt) : "进行中"}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </div>
        </>
      )}

      <div className={s.sectionTitle}>状态历史</div>
      {detail.events.length === 0 ? (
        <Empty icon="📜" title="暂无历史" />
      ) : (
        <ul className={s.timeline}>
          {detail.events.map((ev) => (
            <li key={ev.id}>
              <div>
                <b>{EVENT_KIND_LABEL[ev.kind] ?? ev.kind}</b>
                {ev.fromStatus && ev.toStatus && ev.fromStatus !== ev.toStatus && (
                  <span>
                    {" "}
                    · {statusLabel(ev.fromStatus)} → {statusLabel(ev.toStatus)}
                  </span>
                )}
                <span style={{ color: "var(--text-3)" }}> · {relTime(ev.createdAt)}</span>
              </div>
              {ev.evidence.length > 0 && <div className={s.evidence}>{ev.evidence.join(" · ")}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
