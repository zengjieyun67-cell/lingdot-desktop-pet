import { useCallback, useEffect, useState } from "react";
import type { NotificationRecord } from "@desktop-pet/shared";
import { api } from "../api/client";
import { usePanel } from "./PanelApp";
import { Button, Empty, Spinner } from "./ui";
import { relTime } from "./format";
import s from "./Panel.module.css";

const KIND_ICON: Record<string, string> = { completed: "✅", failed: "❌", needs_attention: "⚠️", connection_lost: "🔌" };

export function NotificationsView() {
  const { notifVersion, reportError, settings, saveSettings } = usePanel();
  const [list, setList] = useState<NotificationRecord[] | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api.listNotifications(100));
    } catch (e) {
      reportError(e);
      setList([]);
    }
  }, [reportError]);

  useEffect(() => {
    void load();
  }, [load, notifVersion]);

  return (
    <div>
      {!settings.notificationsEnabled && (
        <div className={s.notice}>
          系统通知已关闭，新事件只会记录在这里并显示在桌宠气泡中。{" "}
          <Button small onClick={() => saveSettings({ notificationsEnabled: true })}>
            开启通知
          </Button>
        </div>
      )}
      <div className={s.sectionTitle}>
        <span>最近通知</span>
        <span style={{ display: "flex", gap: 4 }}>
          <Button small variant="ghost" onClick={() => api.testNotification().then(load).catch(reportError)}>
            测试通知
          </Button>
          <Button
            small
            variant="danger"
            disabled={!list?.length}
            onClick={async () => {
              try {
                await api.clearNotifications();
                await load();
              } catch (e) {
                reportError(e);
              }
            }}
          >
            清空
          </Button>
        </span>
      </div>
      {list === null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty title="暂无通知" quip="安安静静的，本猫也乐得清闲～">
          <span>任务完成、失败或需要你处理时会出现在这里</span>
        </Empty>
      ) : (
        <div className={s.list}>
          {list.map((n) => (
            <div key={n.id} className={`${s.card} ${n.read ? "" : s.unread}`} style={{ cursor: "default" }}>
              <span className={s.siteIcon}>{KIND_ICON[n.kind] ?? "🔔"}</span>
              <div className={s.cardMain}>
                <div className={s.cardTitle}>{n.title}</div>
                <div className={s.cardBody} title={n.body}>
                  {n.body}
                </div>
                <div className={s.cardMeta}>{relTime(n.createdAt)}</div>
              </div>
              {n.url && (
                <Button small variant="primary" onClick={() => api.openNotification(n.id).catch(reportError)}>
                  打开
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
