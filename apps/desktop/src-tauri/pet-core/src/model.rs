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
    /// deepseek | custom (UI preset for the OpenAI-compatible chat)
    pub chat_provider: String,
    pub chat_endpoint: String,
    pub chat_model: String,
    /// Last position of the panel window after the user dragged it (physical px).
    pub panel_position: Option<PetPosition>,
    // ---- 语音 (free: macOS speech recognition + system voice)
    pub voice_enabled: bool,
    /// `say` voice name; empty = auto (婷婷 / 美佳 …).
    pub voice_name: String,
    /// Speech speed multiplier 0.5–2.0 (slightly fast = cuter).
    pub voice_rate: f64,
    /// Silence that ends an utterance in 实时对话 (ms).
    pub voice_silence_ms: u32,
    /// Read typed chat replies aloud too.
    pub voice_read_replies: bool,
    /// Prefer on-device recognition when the Mac supports it.
    pub voice_on_device: bool,
    /// Talking over 小喵 stops her (best effort).
    pub voice_barge_in: bool,
    // ---- 状态：听歌 / 打盹
    pub music_detection: bool,
    /// Count audio from browsers as "listening to music".
    pub music_include_browsers: bool,
    pub idle_states: bool,
    // ---- 桌面模式 / 桌宠模式
    /// pet | desktop
    pub display_mode: String,
    /// Desktop mode: sit above desktop icons so the scene is clickable.
    pub desktop_interactive: bool,
    /// Look of 桌面模式 + 屏保模式: sonoma (aurora + thin clock) | poster (magazine poster).
    pub desktop_style: String,
    /// 极简标语 style: the one bold line (user editable).
    pub desktop_slogan: String,
    /// Elegant script weekday ("Friday") overlapping the clock.
    pub desktop_script_weekday: bool,
    /// Touch / drag reactions may be spoken aloud (short lines via `say`).
    pub touch_voice: bool,
    /// Start the lingdot screen saver after this many idle minutes (0 = never).
    pub screensaver_idle_mins: u32,
    /// 屏保显示便签: show at most two pinned notes, very faintly, on the screen saver.
    pub screensaver_notes: bool,
    /// Extra folder shortcuts on the desktop (absolute paths; 下载/文稿/桌面/应用程序 are built in).
    pub desktop_folders: Vec<String>,
    /// Weather widget on the desktop (rough IP location + open-meteo, no key).
    pub desktop_weather: bool,
}

/// Pet size range (multiplier of the 200×240 base window).
pub const PET_SCALE_MIN: f64 = 0.6;
pub const PET_SCALE_MAX: f64 = 2.5;

/// Clamp a requested pet scale into the supported range (non-finite => 1.0).
pub fn clamp_pet_scale(v: f64) -> f64 {
    if !v.is_finite() {
        return 1.0;
    }
    (v.clamp(PET_SCALE_MIN, PET_SCALE_MAX) * 100.0).round() / 100.0
}

pub const DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com";
pub const DEEPSEEK_DEFAULT_MODEL: &str = "deepseek-flash";

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
            chat_provider: "deepseek".into(),
            chat_endpoint: DEEPSEEK_BASE_URL.into(),
            chat_model: DEEPSEEK_DEFAULT_MODEL.into(),
            panel_position: None,
            voice_enabled: false,
            voice_name: String::new(),
            voice_rate: 1.1,
            voice_silence_ms: 1200,
            voice_read_replies: false,
            voice_on_device: true,
            voice_barge_in: true,
            music_detection: true,
            music_include_browsers: false,
            idle_states: true,
            display_mode: "pet".into(),
            desktop_interactive: false,
            desktop_style: "sonoma".into(),
            desktop_slogan: "今天也要元气满满.".into(),
            desktop_script_weekday: true,
            touch_voice: true,
            screensaver_idle_mins: 0,
            screensaver_notes: false,
            desktop_folders: Vec::new(),
            desktop_weather: true,
        }
    }
}

impl AppSettings {
    /// Clamp/normalise values coming from the UI.
    pub fn sanitized(mut self) -> Self {
        self.pet_scale = clamp_pet_scale(self.pet_scale);
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
        if !["deepseek", "custom"].contains(&self.chat_provider.as_str())
            || (self.chat_provider == "deepseek" && !crate::chat::is_deepseek_endpoint(&self.chat_endpoint))
        {
            // Older installs (or a hand-edited URL) keep their endpoint and show as 自定义.
            self.chat_provider = "custom".into();
        }
        self.voice_name = self
            .voice_name
            .trim()
            .chars()
            .filter(|c| !c.is_control() && *c != '"' && *c != '\\')
            .take(60)
            .collect();
        self.voice_rate = if self.voice_rate.is_finite() { (self.voice_rate.clamp(0.5, 2.0) * 100.0).round() / 100.0 } else { 1.1 };
        self.voice_silence_ms = self.voice_silence_ms.clamp(600, 4000);
        if !["pet", "desktop"].contains(&self.display_mode.as_str()) {
            self.display_mode = "pet".into();
        }
        if !["sonoma", "poster", "sea", "slogan"].contains(&self.desktop_style.as_str()) {
            self.desktop_style = "sonoma".into();
        }
        self.desktop_slogan = self.desktop_slogan.chars().filter(|c| !c.is_control()).take(40).collect();
        self.screensaver_idle_mins = self.screensaver_idle_mins.min(240);
        let mut folders: Vec<String> = Vec::new();
        for f in self.desktop_folders.iter() {
            let f = f.trim().trim_end_matches('/').to_string();
            if f.starts_with('/') && f.len() > 1 && f.chars().count() <= 500 && !f.chars().any(|c| c.is_control()) && !folders.contains(&f) {
                folders.push(f);
            }
        }
        folders.truncate(8);
        self.desktop_folders = folders;
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

#[cfg(test)]
mod settings_tests {
    use super::*;

    #[test]
    fn pet_scale_is_clamped() {
        assert_eq!(clamp_pet_scale(1.0), 1.0);
        assert_eq!(clamp_pet_scale(0.1), PET_SCALE_MIN);
        assert_eq!(clamp_pet_scale(99.0), PET_SCALE_MAX);
        assert_eq!(clamp_pet_scale(f64::NAN), 1.0);
        assert_eq!(clamp_pet_scale(f64::INFINITY), 1.0);
        assert_eq!(clamp_pet_scale(1.234), 1.23);
        let s = AppSettings { pet_scale: 2.2, ..Default::default() }.sanitized();
        assert_eq!(s.pet_scale, 2.2);
    }

    #[test]
    fn deepseek_is_the_default_preset() {
        let s = AppSettings::default().sanitized();
        assert_eq!(s.chat_provider, "deepseek");
        assert_eq!(s.chat_endpoint, "https://api.deepseek.com");
        assert_eq!(s.chat_model, "deepseek-flash");
        // an older install that saved an OpenAI URL shows up as 自定义
        let old: AppSettings = serde_json::from_str(r#"{"chatEndpoint":"https://api.openai.com/v1","chatModel":"gpt-4o-mini"}"#).unwrap();
        let old = old.sanitized();
        assert_eq!(old.chat_provider, "custom");
        assert_eq!(old.chat_endpoint, "https://api.openai.com/v1");
        let bad = AppSettings { chat_provider: "evil".into(), ..Default::default() }.sanitized();
        assert_eq!(bad.chat_provider, "custom");
    }
}
