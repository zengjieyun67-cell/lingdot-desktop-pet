//! SQLite persistence (rusqlite, bundled). Schema is versioned with
//! `PRAGMA user_version`; each entry in `MIGRATIONS` runs exactly once.

use crate::model::*;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("sqlite: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("not found")]
    NotFound,
    #[error("invalid input: {0}")]
    Invalid(String),
}

pub type DbResult<T> = Result<T, DbError>;

const MIGRATIONS: &[&str] = &[
    // v1 — initial schema
    r#"
    CREATE TABLE sites (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        monitor_enabled INTEGER NOT NULL DEFAULT 0,
        adapter_type TEXT NOT NULL DEFAULT 'generic',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
        url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        external_key TEXT UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        last_observed_at INTEGER,
        confidence REAL NOT NULL DEFAULT 0,
        notification_sent INTEGER NOT NULL DEFAULT 0,
        detection_source TEXT NOT NULL DEFAULT 'manual',
        active_run_no INTEGER,
        run_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_tasks_status ON tasks(status);
    CREATE INDEX idx_tasks_site ON tasks(site_id);
    CREATE TABLE task_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        run_no INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        end_reason TEXT,
        UNIQUE(task_id, run_no)
    );
    CREATE TABLE task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        run_no INTEGER,
        event_id TEXT,
        kind TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT,
        evidence TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_task_events_task ON task_events(task_id, created_at);
    CREATE TABLE processed_events (
        event_id TEXT PRIMARY KEY,
        received_at INTEGER NOT NULL
    );
    CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        url TEXT,
        dedupe_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        read INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    "#,
    // v2 — 小喵 long-term memory (single row JSON, local only)
    r#"
    CREATE TABLE persona_memory (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );
    "#,
];

pub struct Db {
    conn: Connection,
}

fn b(v: bool) -> i64 {
    v as i64
}

fn status_col(row: &Row, idx: usize) -> rusqlite::Result<TaskStatus> {
    let s: String = row.get(idx)?;
    Ok(TaskStatus::parse(&s).unwrap_or(TaskStatus::Unknown))
}
fn opt_status_col(row: &Row, idx: usize) -> rusqlite::Result<Option<TaskStatus>> {
    let s: Option<String> = row.get(idx)?;
    Ok(s.and_then(|s| TaskStatus::parse(&s)))
}

const SITE_COLS: &str = "id,name,url,icon,sort_order,enabled,monitor_enabled,adapter_type,created_at,updated_at";
fn site_from_row(r: &Row) -> rusqlite::Result<Site> {
    Ok(Site {
        id: r.get(0)?,
        name: r.get(1)?,
        url: r.get(2)?,
        icon: r.get(3)?,
        sort_order: r.get(4)?,
        enabled: r.get::<_, i64>(5)? != 0,
        monitor_enabled: r.get::<_, i64>(6)? != 0,
        adapter_type: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
    })
}

const TASK_COLS: &str = "id,title,site_id,url,status,external_key,created_at,updated_at,started_at,completed_at,last_observed_at,confidence,notification_sent,detection_source,active_run_no,run_count";
fn task_from_row(r: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: r.get(0)?,
        title: r.get(1)?,
        site_id: r.get(2)?,
        url: r.get(3)?,
        status: status_col(r, 4)?,
        external_key: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
        started_at: r.get(8)?,
        completed_at: r.get(9)?,
        last_observed_at: r.get(10)?,
        confidence: r.get(11)?,
        notification_sent: r.get::<_, i64>(12)? != 0,
        detection_source: r.get(13)?,
        active_run_no: r.get(14)?,
        run_count: r.get(15)?,
    })
}

/// Validate a URL for the launcher / tasks: absolute http(s) only.
pub fn validate_http_url(s: &str) -> DbResult<()> {
    match url::Url::parse(s) {
        Ok(u) if (u.scheme() == "http" || u.scheme() == "https") && u.host_str().is_some() => Ok(()),
        _ => Err(DbError::Invalid(format!("URL 必须是 http(s) 地址: {s}"))),
    }
}

fn validate_site_input(input: &SiteInput) -> DbResult<()> {
    if input.name.trim().is_empty() || input.name.chars().count() > 60 {
        return Err(DbError::Invalid("名称不能为空且不超过 60 个字符".into()));
    }
    validate_http_url(&input.url)?;
    if !ADAPTER_TYPES.contains(&input.adapter_type.as_str()) {
        return Err(DbError::Invalid(format!("未知适配器: {}", input.adapter_type)));
    }
    // icon: emoji/short text, data:image URL (<= 96KB), or https URL.
    let icon = input.icon.as_str();
    let ok = icon.chars().count() <= 8
        || (icon.starts_with("data:image/") && icon.len() <= 96 * 1024)
        || (icon.starts_with("https://") && icon.len() <= 2048);
    if !ok {
        return Err(DbError::Invalid("图标需为 emoji、图片 data URL 或 https 链接".into()));
    }
    Ok(())
}

impl Db {
    pub fn open(path: &Path) -> DbResult<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> DbResult<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> DbResult<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        let mut db = Db { conn };
        db.migrate()?;
        db.seed_if_empty()?;
        Ok(db)
    }

    pub fn schema_version(&self) -> DbResult<i64> {
        Ok(self.conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
    }

    fn migrate(&mut self) -> DbResult<()> {
        let current = self.schema_version()? as usize;
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
            let tx = self.conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1))?;
            tx.commit()?;
        }
        Ok(())
    }

    fn seed_if_empty(&mut self) -> DbResult<()> {
        let seeded: Option<String> = self
            .conn
            .query_row("SELECT value FROM settings WHERE key='sites_seeded'", [], |r| r.get(0))
            .optional()?;
        if seeded.is_some() {
            return Ok(());
        }
        let defaults = [
            ("ChatGPT", "https://chatgpt.com", "💬", true, "chatgpt"),
            ("Hark", "https://hark.com", "✨", false, "hark"),
            ("哔哩哔哩", "https://www.bilibili.com", "📺", false, "bilibili"),
            ("CapCut", "https://www.capcut.com", "🎬", false, "capcut"),
        ];
        for (name, url, icon, monitor, adapter) in defaults {
            self.create_site(&SiteInput {
                name: name.into(),
                url: url.into(),
                icon: icon.into(),
                enabled: true,
                monitor_enabled: monitor,
                adapter_type: adapter.into(),
            })?;
        }
        self.conn
            .execute("INSERT INTO settings(key,value) VALUES('sites_seeded','true')", [])?;
        Ok(())
    }

    // ---------------------------------------------------------------- settings

    pub fn get_setting_raw(&self, key: &str) -> DbResult<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0))
            .optional()?)
    }

    pub fn set_setting_raw(&self, key: &str, value: &str) -> DbResult<()> {
        self.conn.execute(
            "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_settings(&self) -> DbResult<AppSettings> {
        match self.get_setting_raw("app_settings")? {
            Some(s) => Ok(serde_json::from_str::<AppSettings>(&s).unwrap_or_default().sanitized()),
            None => Ok(AppSettings::default()),
        }
    }

    pub fn save_settings(&self, s: &AppSettings) -> DbResult<AppSettings> {
        let s = s.clone().sanitized();
        self.set_setting_raw("app_settings", &serde_json::to_string(&s)?)?;
        Ok(s)
    }

    // ------------------------------------------------------------------- sites

    pub fn list_sites(&self) -> DbResult<Vec<Site>> {
        let mut st = self
            .conn
            .prepare(&format!("SELECT {SITE_COLS} FROM sites ORDER BY sort_order ASC, created_at ASC"))?;
        let rows = st.query_map([], site_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn get_site(&self, id: &str) -> DbResult<Site> {
        self.conn
            .query_row(&format!("SELECT {SITE_COLS} FROM sites WHERE id=?1"), [id], site_from_row)
            .optional()?
            .ok_or(DbError::NotFound)
    }

    pub fn create_site(&self, input: &SiteInput) -> DbResult<Site> {
        validate_site_input(input)?;
        let now = now_ms();
        let id = new_id();
        let next: i64 = self
            .conn
            .query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sites", [], |r| r.get(0))?;
        self.conn.execute(
            &format!("INSERT INTO sites({SITE_COLS}) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)"),
            params![
                id,
                input.name.trim(),
                input.url.trim(),
                input.icon,
                next,
                b(input.enabled),
                b(input.monitor_enabled),
                input.adapter_type,
                now
            ],
        )?;
        self.get_site(&id)
    }

    pub fn update_site(&self, id: &str, input: &SiteInput) -> DbResult<Site> {
        validate_site_input(input)?;
        let n = self.conn.execute(
            "UPDATE sites SET name=?2,url=?3,icon=?4,enabled=?5,monitor_enabled=?6,adapter_type=?7,updated_at=?8 WHERE id=?1",
            params![
                id,
                input.name.trim(),
                input.url.trim(),
                input.icon,
                b(input.enabled),
                b(input.monitor_enabled),
                input.adapter_type,
                now_ms()
            ],
        )?;
        if n == 0 {
            return Err(DbError::NotFound);
        }
        self.get_site(id)
    }

    pub fn delete_site(&self, id: &str) -> DbResult<()> {
        let n = self.conn.execute("DELETE FROM sites WHERE id=?1", [id])?;
        if n == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    /// Reorder: `ids` in the desired order. Unlisted sites keep relative order after them.
    pub fn reorder_sites(&mut self, ids: &[String]) -> DbResult<Vec<Site>> {
        let existing = self.list_sites()?;
        let mut order: Vec<String> = ids
            .iter()
            .filter(|id| existing.iter().any(|s| &s.id == *id))
            .cloned()
            .collect();
        for s in &existing {
            if !order.contains(&s.id) {
                order.push(s.id.clone());
            }
        }
        let tx = self.conn.transaction()?;
        for (i, id) in order.iter().enumerate() {
            tx.execute("UPDATE sites SET sort_order=?2 WHERE id=?1", params![id, i as i64])?;
        }
        tx.commit()?;
        self.list_sites()
    }

    /// Match a page URL to a configured site by host (exact or subdomain).
    pub fn match_site(&self, page_url: &str) -> DbResult<Option<Site>> {
        let host = match url::Url::parse(page_url).ok().and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase())) {
            Some(h) => h,
            None => return Ok(None),
        };
        let strip = |h: &str| h.strip_prefix("www.").unwrap_or(h).to_string();
        let page = strip(&host);
        for s in self.list_sites()? {
            if let Some(site_host) = url::Url::parse(&s.url).ok().and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase())) {
                let sh = strip(&site_host);
                if page == sh || page.ends_with(&format!(".{sh}")) {
                    return Ok(Some(s));
                }
            }
        }
        Ok(None)
    }

    // ------------------------------------------------------------------- tasks

    pub fn list_tasks(&self, f: &TaskFilter) -> DbResult<Vec<Task>> {
        let mut sql = format!("SELECT {TASK_COLS} FROM tasks WHERE 1=1");
        let mut args: Vec<rusqlite::types::Value> = vec![];
        if let Some(site) = &f.site_id {
            sql.push_str(" AND site_id=?");
            args.push(site.clone().into());
        }
        if let Some(st) = &f.status {
            sql.push_str(" AND status=?");
            args.push(st.as_str().to_string().into());
        }
        sql.push_str(" ORDER BY updated_at DESC LIMIT ?");
        args.push(f.limit.unwrap_or(200).clamp(1, 1000).into());
        let mut st = self.conn.prepare(&sql)?;
        let rows = st.query_map(rusqlite::params_from_iter(args), task_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn get_task(&self, id: &str) -> DbResult<Task> {
        self.conn
            .query_row(&format!("SELECT {TASK_COLS} FROM tasks WHERE id=?1"), [id], task_from_row)
            .optional()?
            .ok_or(DbError::NotFound)
    }

    pub fn find_task_by_key(&self, key: &str) -> DbResult<Option<Task>> {
        Ok(self
            .conn
            .query_row(&format!("SELECT {TASK_COLS} FROM tasks WHERE external_key=?1"), [key], task_from_row)
            .optional()?)
    }

    pub fn insert_task(&self, t: &Task) -> DbResult<()> {
        self.conn.execute(
            &format!("INSERT INTO tasks({TASK_COLS}) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)"),
            params![
                t.id,
                t.title,
                t.site_id,
                t.url,
                t.status.as_str(),
                t.external_key,
                t.created_at,
                t.updated_at,
                t.started_at,
                t.completed_at,
                t.last_observed_at,
                t.confidence,
                b(t.notification_sent),
                t.detection_source,
                t.active_run_no,
                t.run_count
            ],
        )?;
        Ok(())
    }

    pub fn save_task(&self, t: &Task) -> DbResult<()> {
        let n = self.conn.execute(
            "UPDATE tasks SET title=?2,site_id=?3,url=?4,status=?5,external_key=?6,updated_at=?7,started_at=?8,completed_at=?9,
             last_observed_at=?10,confidence=?11,notification_sent=?12,detection_source=?13,active_run_no=?14,run_count=?15 WHERE id=?1",
            params![
                t.id,
                t.title,
                t.site_id,
                t.url,
                t.status.as_str(),
                t.external_key,
                t.updated_at,
                t.started_at,
                t.completed_at,
                t.last_observed_at,
                t.confidence,
                b(t.notification_sent),
                t.detection_source,
                t.active_run_no,
                t.run_count
            ],
        )?;
        if n == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    pub fn create_manual_task(&self, input: &TaskInput) -> DbResult<Task> {
        if input.title.trim().is_empty() || input.title.chars().count() > 300 {
            return Err(DbError::Invalid("标题不能为空且不超过 300 字".into()));
        }
        if !input.url.is_empty() {
            validate_http_url(&input.url)?;
        }
        if let Some(site) = &input.site_id {
            self.get_site(site)?;
        }
        let now = now_ms();
        let t = Task {
            id: new_id(),
            title: input.title.trim().into(),
            site_id: input.site_id.clone(),
            url: input.url.trim().into(),
            status: TaskStatus::Pending,
            external_key: None,
            created_at: now,
            updated_at: now,
            started_at: None,
            completed_at: None,
            last_observed_at: None,
            confidence: 1.0,
            notification_sent: false,
            detection_source: "manual".into(),
            active_run_no: None,
            run_count: 0,
        };
        self.insert_task(&t)?;
        self.add_event(&t.id, None, None, "created", None, Some(TaskStatus::Pending), &[], "manual")?;
        let t = if let Some(st) = input.status.filter(|s| *s != TaskStatus::Pending) {
            self.manual_set_status(&t.id, st)?
        } else {
            t
        };
        Ok(t)
    }

    pub fn update_manual_task(&self, id: &str, input: &TaskInput) -> DbResult<Task> {
        let mut t = self.get_task(id)?;
        if input.title.trim().is_empty() || input.title.chars().count() > 300 {
            return Err(DbError::Invalid("标题不能为空且不超过 300 字".into()));
        }
        if !input.url.is_empty() {
            validate_http_url(&input.url)?;
        }
        if let Some(site) = &input.site_id {
            self.get_site(site)?;
        }
        t.title = input.title.trim().into();
        t.site_id = input.site_id.clone();
        t.url = input.url.trim().into();
        t.updated_at = now_ms();
        self.save_task(&t)?;
        if let Some(st) = input.status {
            if st != t.status {
                return self.manual_set_status(id, st);
            }
        }
        Ok(t)
    }

    /// Manual status change by the user (bypasses the observation state machine,
    /// but keeps runs consistent: running starts a run, terminal ends it).
    pub fn manual_set_status(&self, id: &str, status: TaskStatus) -> DbResult<Task> {
        let mut t = self.get_task(id)?;
        let from = t.status;
        let now = now_ms();
        if status == TaskStatus::Running && t.active_run_no.is_none() {
            t.run_count += 1;
            t.active_run_no = Some(t.run_count);
            t.started_at = Some(now);
            t.completed_at = None;
            self.start_run(&t.id, t.run_count, now)?;
        }
        if status.is_terminal() {
            if let Some(run) = t.active_run_no.take() {
                self.end_run(&t.id, run, status, now, "manual")?;
            }
            if status == TaskStatus::Completed {
                t.completed_at = Some(now);
            }
        }
        t.status = status;
        t.updated_at = now;
        t.detection_source = "manual".into();
        t.confidence = 1.0;
        self.save_task(&t)?;
        self.add_event(&t.id, t.active_run_no, None, "manual_status", Some(from), Some(status), &[], "manual")?;
        Ok(t)
    }

    pub fn delete_task(&self, id: &str) -> DbResult<()> {
        let n = self.conn.execute("DELETE FROM tasks WHERE id=?1", [id])?;
        if n == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    pub fn task_detail(&self, id: &str) -> DbResult<TaskDetail> {
        let task = self.get_task(id)?;
        let mut st = self.conn.prepare(
            "SELECT id,task_id,run_no,status,started_at,ended_at,end_reason FROM task_runs WHERE task_id=?1 ORDER BY run_no DESC",
        )?;
        let runs = st
            .query_map([id], |r| {
                Ok(TaskRun {
                    id: r.get(0)?,
                    task_id: r.get(1)?,
                    run_no: r.get(2)?,
                    status: status_col(r, 3)?,
                    started_at: r.get(4)?,
                    ended_at: r.get(5)?,
                    end_reason: r.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut st = self.conn.prepare(
            "SELECT id,task_id,run_no,event_id,kind,from_status,to_status,evidence,source,created_at
             FROM task_events WHERE task_id=?1 ORDER BY created_at DESC, id DESC LIMIT 200",
        )?;
        let events = st
            .query_map([id], |r| {
                let ev: String = r.get(7)?;
                Ok(TaskEvent {
                    id: r.get(0)?,
                    task_id: r.get(1)?,
                    run_no: r.get(2)?,
                    event_id: r.get(3)?,
                    kind: r.get(4)?,
                    from_status: opt_status_col(r, 5)?,
                    to_status: opt_status_col(r, 6)?,
                    evidence: serde_json::from_str(&ev).unwrap_or_default(),
                    source: r.get(8)?,
                    created_at: r.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(TaskDetail { task, runs, events })
    }

    pub fn start_run(&self, task_id: &str, run_no: i64, at: i64) -> DbResult<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO task_runs(id,task_id,run_no,status,started_at) VALUES(?1,?2,?3,'running',?4)",
            params![new_id(), task_id, run_no, at],
        )?;
        Ok(())
    }

    pub fn update_run_status(&self, task_id: &str, run_no: i64, status: TaskStatus) -> DbResult<()> {
        self.conn.execute(
            "UPDATE task_runs SET status=?3 WHERE task_id=?1 AND run_no=?2 AND ended_at IS NULL",
            params![task_id, run_no, status.as_str()],
        )?;
        Ok(())
    }

    pub fn end_run(&self, task_id: &str, run_no: i64, status: TaskStatus, at: i64, reason: &str) -> DbResult<()> {
        self.conn.execute(
            "UPDATE task_runs SET status=?3, ended_at=?4, end_reason=?5 WHERE task_id=?1 AND run_no=?2",
            params![task_id, run_no, status.as_str(), at, reason],
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_event(
        &self,
        task_id: &str,
        run_no: Option<i64>,
        event_id: Option<&str>,
        kind: &str,
        from: Option<TaskStatus>,
        to: Option<TaskStatus>,
        evidence: &[String],
        source: &str,
    ) -> DbResult<()> {
        self.conn.execute(
            "INSERT INTO task_events(task_id,run_no,event_id,kind,from_status,to_status,evidence,source,created_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                task_id,
                run_no,
                event_id,
                kind,
                from.map(|s| s.as_str()),
                to.map(|s| s.as_str()),
                serde_json::to_string(evidence)?,
                source,
                now_ms()
            ],
        )?;
        Ok(())
    }

    // ---------------------------------------------------------- dedupe & notif

    /// Returns true if the event id was newly recorded (false => duplicate).
    pub fn mark_event_processed(&self, event_id: &str) -> DbResult<bool> {
        let n = self.conn.execute(
            "INSERT OR IGNORE INTO processed_events(event_id, received_at) VALUES(?1, ?2)",
            params![event_id, now_ms()],
        )?;
        Ok(n == 1)
    }

    pub fn notified_keys_for_task(&self, task_id: &str) -> DbResult<Vec<String>> {
        let prefix = format!("task:{task_id}:");
        let mut st = self.conn.prepare("SELECT dedupe_key FROM notifications WHERE task_id=?1")?;
        let keys = st
            .query_map([task_id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(keys.into_iter().filter_map(|k| k.strip_prefix(&prefix).map(String::from)).collect())
    }

    /// Insert a notification; returns None if the dedupe key already exists.
    pub fn insert_notification(&self, n: &NotificationRecord, dedupe_key: &str) -> DbResult<Option<NotificationRecord>> {
        let changed = self.conn.execute(
            "INSERT OR IGNORE INTO notifications(id,task_id,kind,title,body,url,dedupe_key,created_at,read)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,0)",
            params![n.id, n.task_id, n.kind, n.title, n.body, n.url, dedupe_key, n.created_at],
        )?;
        Ok(if changed == 1 { Some(n.clone()) } else { None })
    }

    pub fn list_notifications(&self, limit: i64) -> DbResult<Vec<NotificationRecord>> {
        let mut st = self.conn.prepare(
            "SELECT id,task_id,kind,title,body,url,created_at,read FROM notifications ORDER BY created_at DESC LIMIT ?1",
        )?;
        let rows = st.query_map([limit.clamp(1, 500)], |r| {
            Ok(NotificationRecord {
                id: r.get(0)?,
                task_id: r.get(1)?,
                kind: r.get(2)?,
                title: r.get(3)?,
                body: r.get(4)?,
                url: r.get(5)?,
                created_at: r.get(6)?,
                read: r.get::<_, i64>(7)? != 0,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn mark_notifications_read(&self) -> DbResult<()> {
        self.conn.execute("UPDATE notifications SET read=1 WHERE read=0", [])?;
        Ok(())
    }

    pub fn clear_notifications(&self) -> DbResult<()> {
        // Keep dedupe semantics: we only hide them by marking a tombstone kind? Simpler:
        // delete rows but keep their dedupe keys in processed form so they never re-fire.
        self.conn.execute_batch(
            "INSERT OR IGNORE INTO processed_events(event_id, received_at)
               SELECT 'notif:' || dedupe_key, created_at FROM notifications;
             DELETE FROM notifications;",
        )?;
        Ok(())
    }

    pub fn notification_tombstoned(&self, dedupe_key: &str) -> DbResult<bool> {
        Ok(self
            .conn
            .query_row(
                "SELECT 1 FROM processed_events WHERE event_id=?1",
                [format!("notif:{dedupe_key}")],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    // ------------------------------------------------------------ persona memory

    pub fn get_persona_memory(&self) -> DbResult<crate::persona::PersonaMemory> {
        let raw: Option<String> = self
            .conn
            .query_row("SELECT data FROM persona_memory WHERE id=1", [], |r| r.get(0))
            .optional()?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
    }

    pub fn save_persona_memory(&self, m: &crate::persona::PersonaMemory) -> DbResult<()> {
        self.conn.execute(
            "INSERT INTO persona_memory(id,data,updated_at) VALUES(1,?1,?2)
             ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            params![serde_json::to_string(m)?, now_ms()],
        )?;
        Ok(())
    }

    pub fn reset_persona_memory(&self) -> DbResult<crate::persona::PersonaMemory> {
        self.conn.execute("DELETE FROM persona_memory", [])?;
        Ok(crate::persona::PersonaMemory::default())
    }

    // ----------------------------------------------------------------- cleanup

    /// Delete finished tasks (completed/failed) older than `older_than_ms` ago,
    /// old processed-event ids, and old notifications. `all=true` wipes all tasks.
    pub fn cleanup(&mut self, older_than_ms: i64, all: bool) -> DbResult<usize> {
        let cutoff = now_ms() - older_than_ms.max(0);
        let tx = self.conn.transaction()?;
        let n = if all {
            tx.execute("DELETE FROM tasks", [])?
        } else {
            tx.execute(
                "DELETE FROM tasks WHERE status IN ('completed','failed') AND updated_at < ?1",
                [cutoff],
            )?
        };
        tx.execute("DELETE FROM processed_events WHERE received_at < ?1 AND event_id NOT LIKE 'notif:%'", [cutoff])?;
        tx.execute("DELETE FROM notifications WHERE created_at < ?1", [cutoff])?;
        tx.commit()?;
        Ok(n)
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn site_input(name: &str) -> SiteInput {
        SiteInput {
            name: name.into(),
            url: "https://example.com".into(),
            icon: "🌟".into(),
            enabled: true,
            monitor_enabled: false,
            adapter_type: "generic".into(),
        }
    }

    #[test]
    fn migrations_and_seed() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as i64);
        let sites = db.list_sites().unwrap();
        let names: Vec<_> = sites.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["ChatGPT", "Hark", "哔哩哔哩", "CapCut"]);
        assert!(sites[0].monitor_enabled);
        assert_eq!(sites[0].adapter_type, "chatgpt");
    }

    #[test]
    fn reopen_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("petdb-{}", new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.sqlite");
        {
            let db = Db::open(&p).unwrap();
            db.delete_site(&db.list_sites().unwrap()[3].id).unwrap();
        }
        let db = Db::open(&p).unwrap();
        // Deleted seed is not re-seeded.
        assert_eq!(db.list_sites().unwrap().len(), 3);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn site_crud_and_reorder() {
        let mut db = Db::open_in_memory().unwrap();
        let s = db.create_site(&site_input("Example")).unwrap();
        assert_eq!(s.sort_order, 4);
        let mut upd = site_input("Example 2");
        upd.icon = "data:image/png;base64,AAAA".into();
        let s2 = db.update_site(&s.id, &upd).unwrap();
        assert_eq!(s2.name, "Example 2");
        let ids: Vec<String> = db.list_sites().unwrap().iter().rev().map(|s| s.id.clone()).collect();
        let re = db.reorder_sites(&ids).unwrap();
        assert_eq!(re[0].name, "Example 2");
        assert_eq!(re[4].name, "ChatGPT");
        db.delete_site(&s.id).unwrap();
        assert!(matches!(db.get_site(&s.id), Err(DbError::NotFound)));
    }

    #[test]
    fn site_validation() {
        let db = Db::open_in_memory().unwrap();
        let mut bad = site_input("x");
        bad.url = "javascript:alert(1)".into();
        assert!(matches!(db.create_site(&bad), Err(DbError::Invalid(_))));
        let mut bad = site_input("x");
        bad.adapter_type = "evil".into();
        assert!(db.create_site(&bad).is_err());
        let mut bad = site_input("");
        bad.name = "  ".into();
        assert!(db.create_site(&bad).is_err());
    }

    #[test]
    fn match_site_by_host() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.match_site("https://chatgpt.com/c/123").unwrap().unwrap().name, "ChatGPT");
        assert_eq!(db.match_site("https://bilibili.com/video/1").unwrap().unwrap().name, "哔哩哔哩");
        assert_eq!(db.match_site("https://member.bilibili.com/x").unwrap().unwrap().name, "哔哩哔哩");
        assert!(db.match_site("https://evilchatgpt.com/").unwrap().is_none());
    }

    #[test]
    fn manual_tasks_and_filters() {
        let db = Db::open_in_memory().unwrap();
        let site = db.list_sites().unwrap()[0].id.clone();
        let t = db
            .create_manual_task(&TaskInput { title: "写周报".into(), site_id: Some(site.clone()), url: "https://chatgpt.com".into(), status: None })
            .unwrap();
        assert_eq!(t.status, TaskStatus::Pending);
        let t = db.manual_set_status(&t.id, TaskStatus::Running).unwrap();
        assert_eq!(t.active_run_no, Some(1));
        let t = db.manual_set_status(&t.id, TaskStatus::Completed).unwrap();
        assert_eq!(t.active_run_no, None);
        assert!(t.completed_at.is_some());
        db.create_manual_task(&TaskInput { title: "other".into(), site_id: None, url: "".into(), status: None }).unwrap();
        let by_site = db.list_tasks(&TaskFilter { site_id: Some(site), ..Default::default() }).unwrap();
        assert_eq!(by_site.len(), 1);
        let done = db.list_tasks(&TaskFilter { status: Some(TaskStatus::Completed), ..Default::default() }).unwrap();
        assert_eq!(done.len(), 1);
        let detail = db.task_detail(&t.id).unwrap();
        assert_eq!(detail.runs.len(), 1);
        assert!(detail.events.len() >= 3);
        let upd = db
            .update_manual_task(&t.id, &TaskInput { title: "新标题".into(), site_id: None, url: "".into(), status: None })
            .unwrap();
        assert_eq!(upd.title, "新标题");
        db.delete_task(&t.id).unwrap();
        assert!(db.get_task(&t.id).is_err());
        assert!(db.create_manual_task(&TaskInput { title: "".into(), site_id: None, url: "".into(), status: None }).is_err());
    }

    #[test]
    fn settings_roundtrip_and_sanitize() {
        let db = Db::open_in_memory().unwrap();
        let mut s = db.get_settings().unwrap();
        assert!(s.notifications_enabled);
        s.pet_scale = 99.0;
        s.launch_browser_app = "Google Chrome; rm -rf /".into();
        s.allowed_extension_id = "ABCdef".into();
        let saved = db.save_settings(&s).unwrap();
        assert_eq!(saved.pet_scale, 1.0);
        assert_eq!(saved.launch_browser_app, "Google Chrome rm -rf ");
        assert_eq!(saved.allowed_extension_id, "def");
        assert_eq!(db.get_settings().unwrap(), saved);
    }

    #[test]
    fn notification_dedupe_and_clear() {
        let db = Db::open_in_memory().unwrap();
        let n = NotificationRecord {
            id: new_id(),
            task_id: None,
            kind: "connection_lost".into(),
            title: "t".into(),
            body: "b".into(),
            url: None,
            created_at: now_ms(),
            read: false,
        };
        assert!(db.insert_notification(&n, "k1").unwrap().is_some());
        let mut n2 = n.clone();
        n2.id = new_id();
        assert!(db.insert_notification(&n2, "k1").unwrap().is_none());
        db.clear_notifications().unwrap();
        assert!(db.list_notifications(10).unwrap().is_empty());
        assert!(db.notification_tombstoned("k1").unwrap());
    }

    #[test]
    fn persona_memory_roundtrip_and_reset() {
        let db = Db::open_in_memory().unwrap();
        let mut m = db.get_persona_memory().unwrap();
        assert_eq!(m.affinity, 30.0);
        crate::persona::apply_interaction(&mut m, "pat", None, "2026-10-14", 20, 1);
        db.save_persona_memory(&m).unwrap();
        assert_eq!(db.get_persona_memory().unwrap(), m);
        assert_eq!(db.reset_persona_memory().unwrap().affinity, 30.0);
        assert_eq!(db.get_persona_memory().unwrap().total_interactions, 0);
    }

    #[test]
    fn cleanup_removes_old_finished() {
        let mut db = Db::open_in_memory().unwrap();
        let t = db.create_manual_task(&TaskInput { title: "a".into(), site_id: None, url: "".into(), status: Some(TaskStatus::Completed) }).unwrap();
        let _keep = db.create_manual_task(&TaskInput { title: "b".into(), site_id: None, url: "".into(), status: None }).unwrap();
        // older_than 0 => cutoff now; task updated_at <= now
        std::thread::sleep(std::time::Duration::from_millis(5));
        let n = db.cleanup(0, false).unwrap();
        assert_eq!(n, 1);
        assert!(db.get_task(&t.id).is_err());
        assert_eq!(db.list_tasks(&TaskFilter::default()).unwrap().len(), 1);
        db.cleanup(0, true).unwrap();
        assert!(db.list_tasks(&TaskFilter::default()).unwrap().is_empty());
    }
}
