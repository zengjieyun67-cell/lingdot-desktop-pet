//! Engine: applies validated protocol messages to the store through the
//! authoritative state machine and returns side effects for the shell (Tauri)
//! to execute (OS notifications, UI refresh). Pure Rust, no Tauri dependency.

use crate::db::{Db, DbResult};
use crate::model::*;
use crate::protocol::{Envelope, Payload, TaskObservation};
use crate::state_machine::{apply_event, notify_key, EventKind, MachineEvent, MachineState, NotifyKind, RunAction};
use std::sync::{Mutex, MutexGuard};

#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    TasksChanged,
    Notify(NotificationRecord),
    ConnectionChanged(ConnectionStatus),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    Accepted,
    Duplicate,
    Ignored(&'static str),
}

impl Outcome {
    pub fn as_str(&self) -> &'static str {
        match self {
            Outcome::Accepted => "accepted",
            Outcome::Duplicate => "duplicate",
            Outcome::Ignored(_) => "ignored",
        }
    }
}

#[derive(Debug, Default, Clone)]
struct ConnState {
    connected: bool,
    client_id: Option<String>,
    extension_version: Option<String>,
    last_heartbeat_at: Option<i64>,
    connected_at: Option<i64>,
}

impl ConnState {
    fn status(&self) -> ConnectionStatus {
        ConnectionStatus {
            connected: self.connected,
            client_id: self.client_id.clone(),
            extension_version: self.extension_version.clone(),
            last_heartbeat_at: self.last_heartbeat_at,
            connected_at: self.connected_at,
        }
    }
}

pub struct Engine {
    db: Mutex<Db>,
    conn: Mutex<ConnState>,
}

const MOOD_COMPLETED_WINDOW_MS: i64 = 12_000;
const MOOD_ATTENTION_WINDOW_MS: i64 = 6 * 3600 * 1000;
const MOOD_FAILED_WINDOW_MS: i64 = 60_000;

impl Engine {
    pub fn new(db: Db) -> Self {
        Self { db: Mutex::new(db), conn: Mutex::new(ConnState::default()) }
    }

    pub fn db(&self) -> MutexGuard<'_, Db> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn conn_state(&self) -> MutexGuard<'_, ConnState> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn connection_status(&self) -> ConnectionStatus {
        self.conn_state().status()
    }

    /// Mark liveness; returns a ConnectionChanged effect if we were not connected.
    fn touch_connection(&self, client_id: &str, version: Option<&str>, now: i64, force_new: bool) -> Option<Effect> {
        let mut c = self.conn_state();
        let was = c.connected && c.client_id.as_deref() == Some(client_id);
        c.last_heartbeat_at = Some(now);
        if let Some(v) = version {
            c.extension_version = Some(v.to_string());
        }
        if !was || force_new {
            c.connected = true;
            c.client_id = Some(client_id.to_string());
            c.connected_at = Some(now);
            return Some(Effect::ConnectionChanged(c.status()));
        }
        None
    }

    pub fn handle(&self, env: &Envelope, now: i64) -> DbResult<(Outcome, Vec<Effect>)> {
        let db = self.db();
        if !db.mark_event_processed(&env.id)? {
            return Ok((Outcome::Duplicate, vec![]));
        }
        drop(db);
        let mut effects = vec![];
        match &env.payload {
            Payload::Connected { extension_version, .. } => {
                effects.extend(self.touch_connection(&env.client_id, Some(extension_version), now, true));
                Ok((Outcome::Accepted, effects))
            }
            Payload::Heartbeat { .. } => {
                effects.extend(self.touch_connection(&env.client_id, None, now, false));
                Ok((Outcome::Accepted, effects))
            }
            Payload::Disconnected { .. } => {
                let mut c = self.conn_state();
                if c.client_id.as_deref() == Some(env.client_id.as_str()) && c.connected {
                    c.connected = false;
                    effects.push(Effect::ConnectionChanged(c.status()));
                }
                Ok((Outcome::Accepted, effects))
            }
            Payload::Task(obs) => {
                effects.extend(self.touch_connection(&env.client_id, None, now, false));
                let (outcome, mut fx) = self.handle_task(&env.id, env.msg_type.as_str(), obs, now)?;
                effects.append(&mut fx);
                Ok((outcome, effects))
            }
        }
    }

    fn handle_task(&self, event_id: &str, msg_type: &str, obs: &TaskObservation, now: i64) -> DbResult<(Outcome, Vec<Effect>)> {
        let db = self.db();
        let settings = db.get_settings()?;
        if !settings.monitor_enabled {
            return Ok((Outcome::Ignored("monitor_disabled"), vec![]));
        }
        let Some(site) = db.match_site(&obs.url)? else {
            return Ok((Outcome::Ignored("site_not_configured"), vec![]));
        };
        if !site.enabled || !site.monitor_enabled {
            return Ok((Outcome::Ignored("site_monitor_disabled"), vec![]));
        }

        let mut effects = vec![];
        // Locate task: by key, then by previous key (re-key), else create.
        let mut task = match db.find_task_by_key(&obs.task_key)? {
            Some(t) => Some(t),
            None => match &obs.previous_task_key {
                Some(prev) => db.find_task_by_key(prev)?.map(|mut t| {
                    t.external_key = Some(obs.task_key.clone());
                    t
                }),
                None => None,
            },
        };
        let created = task.is_none();
        if task.is_none() {
            use ObservedState as O;
            // Only explicit signals create tasks; browsing alone never does.
            if !matches!(obs.observed, O::Running | O::NeedsAttention | O::Failed) {
                return Ok((Outcome::Ignored("no_task_for_observation"), vec![]));
            }
            let t = Task {
                id: new_id(),
                title: if obs.title.trim().is_empty() { site.name.clone() } else { obs.title.trim().to_string() },
                site_id: Some(site.id.clone()),
                url: obs.url.clone(),
                status: TaskStatus::Pending,
                external_key: Some(obs.task_key.clone()),
                created_at: now,
                updated_at: now,
                started_at: None,
                completed_at: None,
                last_observed_at: Some(now),
                confidence: obs.confidence,
                notification_sent: false,
                detection_source: "extension".into(),
                active_run_no: None,
                run_count: 0,
            };
            db.insert_task(&t)?;
            db.add_event(&t.id, None, Some(event_id), "auto_created", None, Some(TaskStatus::Pending), &obs.evidence, "extension")?;
            task = Some(t);
        }
        let mut t = task.expect("task present");

        let mut ms = MachineState::new(t.status, t.active_run_no, t.run_count);
        for k in db.notified_keys_for_task(&t.id)? {
            ms.notified_keys.insert(k);
        }
        let ev = MachineEvent { event_id: event_id.to_string(), kind: EventKind::Observed(obs.observed), conflict: obs.conflict };
        let tr = apply_event(&mut ms, &ev);

        // Update observation metadata.
        if !obs.title.trim().is_empty() && t.detection_source != "manual" {
            t.title = obs.title.trim().to_string();
        }
        t.url = obs.url.clone();
        t.last_observed_at = Some(now);
        t.status = ms.status;
        t.active_run_no = ms.active_run_no;
        t.run_count = ms.run_count;
        if tr.changed {
            t.updated_at = now;
            t.confidence = obs.confidence;
            t.detection_source = "extension".into();
        }
        match tr.run_action {
            RunAction::Start => {
                if let Some(n) = tr.run_no {
                    db.start_run(&t.id, n, now)?;
                }
                t.started_at = Some(now);
                t.completed_at = None;
                t.notification_sent = false;
            }
            RunAction::End => {
                if let Some(n) = tr.run_no {
                    db.end_run(&t.id, n, tr.to, now, tr.reason)?;
                }
            }
            RunAction::None => {
                if tr.changed {
                    if let Some(n) = tr.run_no {
                        db.update_run_status(&t.id, n, tr.to)?;
                    }
                }
            }
        }
        if tr.to == TaskStatus::Completed && tr.changed {
            t.completed_at = Some(now);
        }

        if tr.changed || (tr.ignored && tr.reason != "duplicate_event") {
            let mut evidence = obs.evidence.clone();
            evidence.push(format!("reason:{}", tr.reason));
            db.add_event(&t.id, tr.run_no, Some(event_id), msg_type, Some(tr.from), Some(tr.to), &evidence, "extension")?;
        }

        if let Some(kind) = tr.notify {
            let key = format!("task:{}:{}", t.id, notify_key(tr.run_no, kind));
            if !db.notification_tombstoned(&key)? {
                let rec = build_task_notification(&t, &site.name, kind, now);
                if let Some(rec) = db.insert_notification(&rec, &key)? {
                    t.notification_sent = true;
                    effects.push(Effect::Notify(rec));
                }
            }
        }
        db.save_task(&t)?;
        if tr.changed || created || tr.notify.is_some() {
            effects.push(Effect::TasksChanged);
        }
        Ok((Outcome::Accepted, effects))
    }

    /// Periodic housekeeping: heartbeat loss and running-task timeouts.
    pub fn tick(&self, now: i64) -> DbResult<Vec<Effect>> {
        let db = self.db();
        let settings = db.get_settings()?;
        let mut effects = vec![];

        // Heartbeat loss -> disconnected + one notification per connection session.
        {
            let mut c = self.conn_state();
            if c.connected {
                let last = c.last_heartbeat_at.unwrap_or(0);
                if now - last > (settings.heartbeat_timeout_secs as i64) * 1000 {
                    c.connected = false;
                    effects.push(Effect::ConnectionChanged(c.status()));
                    let key = format!(
                        "connection:{}:{}",
                        c.client_id.clone().unwrap_or_default(),
                        c.connected_at.unwrap_or(0)
                    );
                    let rec = NotificationRecord {
                        id: new_id(),
                        task_id: None,
                        kind: "connection_lost".into(),
                        title: "🔌 浏览器扩展已断开".into(),
                        body: "桌宠暂时收不到网页任务状态。请检查 Chrome 是否运行、扩展是否启用。".into(),
                        url: None,
                        created_at: now,
                        read: false,
                    };
                    if let Some(rec) = db.insert_notification(&rec, &key)? {
                        effects.push(Effect::Notify(rec));
                    }
                }
            }
        }

        // Running tasks with no observation for too long -> unknown (never completed/failed).
        let timeout_ms = (settings.running_timeout_secs as i64) * 1000;
        let running = db.list_tasks(&TaskFilter { status: Some(TaskStatus::Running), ..Default::default() })?;
        let mut changed = false;
        for mut t in running {
            if t.detection_source == "manual" {
                continue; // user-managed task; don't time out
            }
            let last = t.last_observed_at.unwrap_or(t.updated_at);
            if now - last <= timeout_ms {
                continue;
            }
            let mut ms = MachineState::new(t.status, t.active_run_no, t.run_count);
            let ev = MachineEvent { event_id: format!("timeout:{}:{}", t.id, last), kind: EventKind::Timeout, conflict: false };
            let tr = apply_event(&mut ms, &ev);
            if tr.changed {
                t.status = ms.status;
                t.updated_at = now;
                t.detection_source = "timeout".into();
                if let Some(n) = tr.run_no {
                    db.update_run_status(&t.id, n, tr.to)?;
                }
                db.save_task(&t)?;
                db.add_event(&t.id, tr.run_no, None, "timeout", Some(tr.from), Some(tr.to), &["reason:observation_timeout".into()], "timeout")?;
                changed = true;
            }
        }
        if changed {
            effects.push(Effect::TasksChanged);
        }
        Ok(effects)
    }

    /// Aggregate mood for the pet.
    pub fn pet_mood(&self, now: i64) -> DbResult<PetMood> {
        let db = self.db();
        let tasks = db.list_tasks(&TaskFilter { limit: Some(500), ..Default::default() })?;
        let attention = tasks.iter().any(|t| {
            (t.status == TaskStatus::NeedsAttention && now - t.updated_at < MOOD_ATTENTION_WINDOW_MS)
                || (t.status == TaskStatus::Failed && now - t.updated_at < MOOD_FAILED_WINDOW_MS)
        });
        if attention {
            return Ok(PetMood::NeedsAttention);
        }
        if tasks.iter().any(|t| t.status == TaskStatus::Running) {
            return Ok(PetMood::Working);
        }
        if tasks
            .iter()
            .any(|t| t.status == TaskStatus::Completed && t.completed_at.map_or(false, |c| now - c < MOOD_COMPLETED_WINDOW_MS))
        {
            return Ok(PetMood::Completed);
        }
        Ok(PetMood::Idle)
    }
}

pub fn build_task_notification(t: &Task, site_name: &str, kind: NotifyKind, now: i64) -> NotificationRecord {
    let (title, status) = match kind {
        NotifyKind::Completed => ("✅ 任务完成", TaskStatus::Completed),
        NotifyKind::Failed => ("❌ 任务失败", TaskStatus::Failed),
        NotifyKind::NeedsAttention => ("⚠️ 需要你处理", TaskStatus::NeedsAttention),
    };
    let short: String = t.title.chars().take(60).collect();
    NotificationRecord {
        id: new_id(),
        task_id: Some(t.id.clone()),
        kind: kind.as_str().into(),
        title: title.into(),
        body: format!("{site_name} · {short} — {}", status.label_zh()),
        url: if t.url.is_empty() { None } else { Some(t.url.clone()) },
        created_at: now,
        read: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::validate_value;
    use serde_json::json;

    fn task_msg(id: &str, ty: &str, observed: &str, key: &str) -> Envelope {
        validate_value(&json!({
            "v":1,"id":id,"type":ty,"ts":1,"clientId":"client_0001",
            "payload":{"taskKey":key,"adapter":"chatgpt","url":"https://chatgpt.com/c/abc","title":"写一首诗",
              "observed":observed,"signals":{},"evidence":["execution_indicator"],"confidence":0.9,"visible":true}
        }))
        .unwrap()
    }

    fn notifies(fx: &[Effect]) -> usize {
        fx.iter().filter(|e| matches!(e, Effect::Notify(_))).count()
    }

    #[test]
    fn running_then_completed_notifies_once() {
        let e = Engine::new(Db::open_in_memory().unwrap());
        let (o, fx) = e.handle(&task_msg("evt_00001", "task.status_changed", "running", "chatgpt:c:abc"), 1000).unwrap();
        assert_eq!(o, Outcome::Accepted);
        assert!(fx.iter().any(|f| matches!(f, Effect::ConnectionChanged(_))));
        assert_eq!(notifies(&fx), 0);
        let (_, fx) = e.handle(&task_msg("evt_00002", "task.completed", "completed", "chatgpt:c:abc"), 2000).unwrap();
        assert_eq!(notifies(&fx), 1);
        // duplicate event id
        let (o, fx) = e.handle(&task_msg("evt_00002", "task.completed", "completed", "chatgpt:c:abc"), 2100).unwrap();
        assert_eq!(o, Outcome::Duplicate);
        assert!(fx.is_empty());
        // another completed event (new id) does not re-notify
        let (_, fx) = e.handle(&task_msg("evt_00003", "task.completed", "completed", "chatgpt:c:abc"), 2200).unwrap();
        assert_eq!(notifies(&fx), 0);
        let db = e.db();
        let t = db.find_task_by_key("chatgpt:c:abc").unwrap().unwrap();
        assert_eq!(t.status, TaskStatus::Completed);
        assert!(t.notification_sent);
        let d = db.task_detail(&t.id).unwrap();
        assert_eq!(d.runs.len(), 1);
        assert_eq!(d.runs[0].status, TaskStatus::Completed);
        assert_eq!(db.list_notifications(10).unwrap().len(), 1);
    }

    #[test]
    fn new_run_after_completion_notifies_again() {
        let e = Engine::new(Db::open_in_memory().unwrap());
        e.handle(&task_msg("a0000001", "task.status_changed", "running", "k1"), 1).unwrap();
        e.handle(&task_msg("a0000002", "task.completed", "completed", "k1"), 2).unwrap();
        e.handle(&task_msg("a0000003", "task.status_changed", "running", "k1"), 3).unwrap();
        let (_, fx) = e.handle(&task_msg("a0000004", "task.completed", "completed", "k1"), 4).unwrap();
        assert_eq!(notifies(&fx), 1);
        let db = e.db();
        let t = db.find_task_by_key("k1").unwrap().unwrap();
        assert_eq!(t.run_count, 2);
        assert_eq!(db.task_detail(&t.id).unwrap().runs.len(), 2);
    }

    #[test]
    fn unknown_or_completed_alone_never_creates_task() {
        let e = Engine::new(Db::open_in_memory().unwrap());
        let (o, _) = e.handle(&task_msg("b0000001", "task.observed", "unknown", "k2"), 1).unwrap();
        assert_eq!(o, Outcome::Ignored("no_task_for_observation"));
        let (o, _) = e.handle(&task_msg("b0000002", "task.completed", "completed", "k2"), 2).unwrap();
        assert_eq!(o, Outcome::Ignored("no_task_for_observation"));
        assert!(e.db().find_task_by_key("k2").unwrap().is_none());
    }

    #[test]
    fn monitor_toggle_and_unconfigured_site() {
        let e = Engine::new(Db::open_in_memory().unwrap());
        {
            let db = e.db();
            let mut s = db.get_settings().unwrap();
            s.monitor_enabled = false;
            db.save_settings(&s).unwrap();
        }
        let (o, _) = e.handle(&task_msg("c0000001", "task.status_changed", "running", "k3"), 1).unwrap();
        assert_eq!(o, Outcome::Ignored("monitor_disabled"));
        {
            let db = e.db();
            let mut s = db.get_settings().unwrap();
            s.monitor_enabled = true;
            db.save_settings(&s).unwrap();
        }
        let mut m = task_msg("c0000002", "task.status_changed", "running", "k3");
        if let Payload::Task(t) = &mut m.payload {
            t.url = "https://unknown-site.example/".into();
        }
        let (o, _) = e.handle(&m, 2).unwrap();
        assert_eq!(o, Outcome::Ignored("site_not_configured"));
        // bilibili is seeded with monitor disabled
        let mut m = task_msg("c0000003", "task.status_changed", "running", "k4");
        if let Payload::Task(t) = &mut m.payload {
            t.url = "https://www.bilibili.com/".into();
        }
        let (o, _) = e.handle(&m, 3).unwrap();
        assert_eq!(o, Outcome::Ignored("site_monitor_disabled"));
    }

    #[test]
    fn rekey_from_previous_task_key() {
        let e = Engine::new(Db::open_in_memory().unwrap());
        e.handle(&task_msg("d0000001", "task.status_changed", "running", "chatgpt:new:xyz"), 1).unwrap();
        let mut m = task_msg("d0000002", "task.completed", "completed", "chatgpt:c:abc");
        if let Payload::Task(t) = &mut m.payload {
            t.previous_task_key = Some("chatgpt:new:xyz".into());
        }
        let (_, fx) = e.handle(&m, 2).unwrap();
        assert_eq!(notifies(&fx), 1);
        let db = e.db();
        assert!(db.find_task_by_key("chatgpt:new:xyz").unwrap().is_none());
        assert_eq!(db.find_task_by_key("chatgpt:c:abc").unwrap().unwrap().status, TaskStatus::Completed);
    }

    #[test]
    fn timeout_moves_running_to_unknown_without_notification() {
        let e = Engine::new(Db::open_in_memory().unwrap());
        let t0 = now_ms();
        e.handle(&task_msg("f0000001", "task.status_changed", "running", "k5"), t0).unwrap();
        let fx = e.tick(t0 + 10_000).unwrap();
        assert!(!fx.contains(&Effect::TasksChanged));
        let fx = e.tick(t0 + 601_000 + 75_000).unwrap();
        assert!(fx.contains(&Effect::TasksChanged));
        let t = e.db().find_task_by_key("k5").unwrap().unwrap();
        assert_eq!(t.status, TaskStatus::Unknown);
        // heartbeat loss produced exactly one connection_lost notification
        assert_eq!(fx.iter().filter(|f| matches!(f, Effect::Notify(n) if n.kind == "connection_lost")).count(), 1);
        let fx2 = e.tick(t0 + 700_000 + 75_000).unwrap();
        assert_eq!(notifies(&fx2), 0);
        assert!(!e.connection_status().connected);
    }

    #[test]
    fn heartbeat_connection_lifecycle() {
        let e = Engine::new(Db::open_in_memory().unwrap());
        let hb = |id: &str| {
            validate_value(&json!({"v":1,"id":id,"type":"monitor.heartbeat","ts":1,"clientId":"client_0001","payload":{"activeTabs":1}})).unwrap()
        };
        let (_, fx) = e.handle(&hb("h0000001"), 1_000).unwrap();
        assert!(matches!(fx.as_slice(), [Effect::ConnectionChanged(s)] if s.connected));
        let (_, fx) = e.handle(&hb("h0000002"), 2_000).unwrap();
        assert!(fx.is_empty());
        assert!(e.tick(30_000).unwrap().is_empty());
        let fx = e.tick(200_000).unwrap();
        assert!(fx.iter().any(|f| matches!(f, Effect::ConnectionChanged(s) if !s.connected)));
        // reconnect
        let (_, fx) = e.handle(&hb("h0000003"), 210_000).unwrap();
        assert!(matches!(fx.as_slice(), [Effect::ConnectionChanged(s)] if s.connected));
    }

    #[test]
    fn pet_mood_aggregation() {
        let e = Engine::new(Db::open_in_memory().unwrap());
        let now = now_ms();
        assert_eq!(e.pet_mood(now).unwrap(), PetMood::Idle);
        e.handle(&task_msg("g0000001", "task.status_changed", "running", "k6"), now).unwrap();
        assert_eq!(e.pet_mood(now).unwrap(), PetMood::Working);
        e.handle(&task_msg("g0000002", "task.completed", "completed", "k6"), now).unwrap();
        assert_eq!(e.pet_mood(now + 1000).unwrap(), PetMood::Completed);
        assert_eq!(e.pet_mood(now + 60_000).unwrap(), PetMood::Idle);
        e.handle(&task_msg("g0000003", "task.needs_attention", "needs_attention", "k7"), now).unwrap();
        assert_eq!(e.pet_mood(now_ms()).unwrap(), PetMood::NeedsAttention);
    }

    #[test]
    fn cleared_notifications_never_refire() {
        let e = Engine::new(Db::open_in_memory().unwrap());
        e.handle(&task_msg("i0000001", "task.status_changed", "running", "k8"), 1).unwrap();
        let (_, fx) = e.handle(&task_msg("i0000002", "task.needs_attention", "needs_attention", "k8"), 2).unwrap();
        assert_eq!(notifies(&fx), 1);
        e.db().clear_notifications().unwrap();
        // same run, same status after a resume: still deduped even though the row is gone
        e.handle(&task_msg("i0000003", "task.status_changed", "running", "k8"), 3).unwrap();
        let (_, fx) = e.handle(&task_msg("i0000004", "task.needs_attention", "needs_attention", "k8"), 4).unwrap();
        assert_eq!(notifies(&fx), 0);
    }
}
