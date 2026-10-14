//! Domain types. Mirrors `packages/shared/src/task-types.ts` (camelCase on the wire).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Running,
    Completed,
    NeedsAttention,
    Failed,
    Unknown,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Pending => "pending",
            TaskStatus::Running => "running",
            TaskStatus::Completed => "completed",
            TaskStatus::NeedsAttention => "needs_attention",
            TaskStatus::Failed => "failed",
            TaskStatus::Unknown => "unknown",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "pending" => TaskStatus::Pending,
            "running" => TaskStatus::Running,
            "completed" => TaskStatus::Completed,
            "needs_attention" => TaskStatus::NeedsAttention,
            "failed" => TaskStatus::Failed,
            "unknown" => TaskStatus::Unknown,
            _ => return None,
        })
    }
    pub fn is_terminal(&self) -> bool {
        matches!(self, TaskStatus::Completed | TaskStatus::Failed)
    }
    pub fn label_zh(&self) -> &'static str {
        match self {
            TaskStatus::Pending => "待开始",
            TaskStatus::Running => "进行中",
            TaskStatus::Completed => "已完成",
            TaskStatus::NeedsAttention => "需要处理",
            TaskStatus::Failed => "失败",
            TaskStatus::Unknown => "状态未知",
        }
    }
}

/// States an adapter may observe (no `pending`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservedState {
    Running,
    Completed,
    Failed,
    NeedsAttention,
    Unknown,
}

impl ObservedState {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "running" => ObservedState::Running,
            "completed" => ObservedState::Completed,
            "failed" => ObservedState::Failed,
            "needs_attention" => ObservedState::NeedsAttention,
            "unknown" => ObservedState::Unknown,
            _ => return None,
        })
    }
}

pub const ADAPTER_TYPES: [&str; 5] = ["generic", "chatgpt", "hark", "bilibili", "capcut"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Site {
    pub id: String,
    pub name: String,
    pub url: String,
    pub icon: String,
    pub sort_order: i64,
    pub enabled: bool,
    pub monitor_enabled: bool,
    pub adapter_type: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Input for creating/updating a site from the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteInput {
    pub name: String,
    pub url: String,
    pub icon: String,
    pub enabled: bool,
    pub monitor_enabled: bool,
    pub adapter_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub site_id: Option<String>,
    pub url: String,
    pub status: TaskStatus,
    pub external_key: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub last_observed_at: Option<i64>,
    /// Classifier confidence for the current status (NOT progress).
    pub confidence: f64,
    pub notification_sent: bool,
    pub detection_source: String,
    pub active_run_no: Option<i64>,
    pub run_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub title: String,
    pub site_id: Option<String>,
    pub url: String,
    /// Optional manual status change.
    pub status: Option<TaskStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRun {
    pub id: String,
    pub task_id: String,
    pub run_no: i64,
    pub status: TaskStatus,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub end_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub id: i64,
    pub task_id: String,
    pub run_no: Option<i64>,
    pub event_id: Option<String>,
    pub kind: String,
    pub from_status: Option<TaskStatus>,
    pub to_status: Option<TaskStatus>,
    pub evidence: Vec<String>,
    pub source: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    pub task: Task,
    pub runs: Vec<TaskRun>,
    pub events: Vec<TaskEvent>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFilter {
    pub site_id: Option<String>,
    pub status: Option<TaskStatus>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRecord {
    pub id: String,
    pub task_id: Option<String>,
    /// completed | failed | needs_attention | connection_lost
    pub kind: String,
    pub title: String,
    pub body: String,
    pub url: Option<String>,
    pub created_at: i64,
    pub read: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PetMood {
    Idle,
    Working,
    Completed,
    NeedsAttention,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PetPosition {
    pub x: i32,
    pub y: i32,
}

/// Persisted application settings (one JSON blob in the `settings` table).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub pet_visible: bool,
    pub animations_enabled: bool,
    pub pet_scale: f64,
    /// auto | svg | live2d
    pub renderer_mode: String,
    /// Path or URL of a `.model3.json`. Empty => built-in SVG catgirl.
    pub live2d_model_path: String,
    /// Optional absolute path to live2dcubismcore.min.js (default: bundled /live2d/).
    pub live2d_core_path: String,
    pub monitor_enabled: bool,
    pub notifications_enabled: bool,
    pub sound_enabled: bool,
    pub autostart: bool,
    /// default | app
    pub launch_mode: String,
    /// macOS application name for `open -a`, e.g. "Google Chrome".
    pub launch_browser_app: String,
    pub server_port: u16,
    /// Empty => accept any chrome-extension:// origin.
    pub allowed_extension_id: String,
    pub rotate_token_on_startup: bool,
    pub first_run_done: bool,
    pub pet_position: Option<PetPosition>,
    pub running_timeout_secs: u64,
    pub heartbeat_timeout_secs: u64,
    // ---- 小喵 persona
    pub pet_name: String,
    /// How the pet addresses the user (称呼), default 主人.
    pub user_title: String,
    pub persona_bubbles: bool,
    pub memory_enabled: bool,
    pub meal_reminders: bool,
    pub late_night_reminders: bool,
    pub chat_enabled: bool,
    pub chat_endpoint: String,
    pub chat_model: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            pet_visible: true,
            animations_enabled: true,
            pet_scale: 1.0,
            renderer_mode: "auto".into(),
            live2d_model_path: String::new(),
            live2d_core_path: String::new(),
            monitor_enabled: true,
            notifications_enabled: true,
            sound_enabled: true,
            autostart: false,
            launch_mode: "default".into(),
            launch_browser_app: "Google Chrome".into(),
            server_port: 17321,
            allowed_extension_id: String::new(),
            rotate_token_on_startup: false,
            first_run_done: false,
            pet_position: None,
            running_timeout_secs: 600,
            heartbeat_timeout_secs: 75,
            pet_name: "小喵".into(),
            user_title: "主人".into(),
            persona_bubbles: true,
            memory_enabled: true,
            meal_reminders: true,
            late_night_reminders: true,
            chat_enabled: false,
            chat_endpoint: "https://api.openai.com/v1".into(),
            chat_model: "gpt-4o-mini".into(),
        }
    }
}

impl AppSettings {
    /// Clamp/normalise values coming from the UI.
    pub fn sanitized(mut self) -> Self {
        if !(0.5..=2.0).contains(&self.pet_scale) || !self.pet_scale.is_finite() {
            self.pet_scale = 1.0;
        }
        if !["auto", "svg", "live2d"].contains(&self.renderer_mode.as_str()) {
            self.renderer_mode = "auto".into();
        }
        if !["default", "app"].contains(&self.launch_mode.as_str()) {
            self.launch_mode = "default".into();
        }
        self.launch_browser_app = self
            .launch_browser_app
            .chars()
            .filter(|c| c.is_alphanumeric() || " .-_".contains(*c))
            .take(64)
            .collect();
        self.allowed_extension_id = self
            .allowed_extension_id
            .chars()
            .filter(|c| c.is_ascii_lowercase())
            .take(32)
            .collect();
        if self.server_port < 1024 {
            self.server_port = 17321;
        }
        self.running_timeout_secs = self.running_timeout_secs.clamp(30, 86_400);
        self.heartbeat_timeout_secs = self.heartbeat_timeout_secs.clamp(20, 3_600);
        let name: String = self.pet_name.trim().chars().filter(|c| !c.is_control()).take(12).collect();
        self.pet_name = if name.is_empty() { "小喵".into() } else { name };
        let title: String = self.user_title.trim().chars().filter(|c| !c.is_control()).take(12).collect();
        self.user_title = if title.is_empty() { "主人".into() } else { title };
        self.chat_endpoint = self.chat_endpoint.trim().chars().take(300).collect();
        self.chat_model = self
            .chat_model
            .trim()
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || "._:/-@".contains(*c))
            .take(100)
            .collect();
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub connected: bool,
    pub client_id: Option<String>,
    pub extension_version: Option<String>,
    pub last_heartbeat_at: Option<i64>,
    pub connected_at: Option<i64>,
}

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
