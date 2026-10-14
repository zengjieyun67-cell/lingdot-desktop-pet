//! 小喵: long-term memory commands + optional LLM chat.
//!
//! - Memory lives in SQLite (`persona_memory`), local only, derived from app usage.
//! - The chat API key lives ONLY in the OS keychain (macOS Keychain via `keyring`);
//!   it is read here in Rust and attached to the outgoing request. It is never
//!   written to SQLite / settings JSON and never sent to the webview.

use crate::AppState;
use pet_core::chat::{build_request, build_system_prompt, memory_summary, parse_response, validate_endpoint, ChatMessage};
use pet_core::model::now_ms;
use pet_core::persona::{apply_interaction, set_today_mood as set_mood, PersonaMemory};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

type CmdResult<T> = Result<T, String>;

const KEYRING_SERVICE: &str = "com.desktoppet.app";
const KEYRING_USER: &str = "chat-api-key";
pub const DEFAULT_PERSONA: &str = include_str!("../../../../persona/xiaomiao.md");

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

/// `<appData>/persona/xiaomiao.md` — user-editable copy of the persona prompt.
pub fn persona_prompt_path(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(app.path().app_data_dir().map_err(e)?.join("persona").join("xiaomiao.md"))
}

/// Copy the bundled persona prompt to app data on first run (never overwrites edits).
pub fn ensure_persona_file(app: &AppHandle) {
    if let Ok(p) = persona_prompt_path(app) {
        if !p.exists() {
            if let Some(dir) = p.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(&p, DEFAULT_PERSONA);
        }
    }
}

#[tauri::command]
pub fn get_persona_memory(state: State<'_, AppState>) -> CmdResult<PersonaMemory> {
    state.engine.db().get_persona_memory().map_err(e)
}

/// Record an interaction (click / pat / drag / chat / launch_site / task_completed / ignored / open).
/// `local_day` (YYYY-MM-DD) and `local_hour` come from the webview's clock (user's timezone).
#[tauri::command]
pub fn persona_interaction(
    app: AppHandle,
    state: State<'_, AppState>,
    kind: String,
    site_id: Option<String>,
    local_day: String,
    local_hour: u32,
) -> CmdResult<PersonaMemory> {
    let db = state.engine.db();
    let settings = db.get_settings().map_err(e)?;
    let mut m = db.get_persona_memory().map_err(e)?;
    if !settings.memory_enabled {
        return Ok(m); // memory off: nothing is recorded
    }
    if !apply_interaction(&mut m, &kind, site_id.as_deref(), &local_day, local_hour, now_ms()) {
        return Err(format!("无效的互动类型：{kind}"));
    }
    db.save_persona_memory(&m).map_err(e)?;
    drop(db);
    let _ = app.emit("persona-memory", m.clone());
    Ok(m)
}

#[tauri::command]
pub fn set_today_mood(state: State<'_, AppState>, mood: String, local_day: String) -> CmdResult<()> {
    let db = state.engine.db();
    if !db.get_settings().map_err(e)?.memory_enabled {
        return Ok(());
    }
    let mut m = db.get_persona_memory().map_err(e)?;
    if set_mood(&mut m, &mood, &local_day) {
        db.save_persona_memory(&m).map_err(e)?;
    }
    Ok(())
}

#[tauri::command]
pub fn reset_persona_memory(app: AppHandle, state: State<'_, AppState>) -> CmdResult<PersonaMemory> {
    let m = state.engine.db().reset_persona_memory().map_err(e)?;
    let _ = app.emit("persona-memory", m.clone());
    Ok(m)
}

#[tauri::command]
pub fn get_persona_prompt_path(app: AppHandle) -> CmdResult<String> {
    ensure_persona_file(&app);
    Ok(persona_prompt_path(&app)?.to_string_lossy().into_owned())
}

// ------------------------------------------------------------------ API key

fn entry() -> CmdResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|err| format!("无法访问钥匙串：{err}"))
}

#[tauri::command]
pub fn set_chat_api_key(key: String) -> CmdResult<()> {
    let key = key.trim();
    if key.is_empty() || key.len() > 512 || key.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("API Key 格式不正确".into());
    }
    entry()?.set_password(key).map_err(|err| format!("保存到钥匙串失败：{err}"))
}

#[tauri::command]
pub fn clear_chat_api_key() -> CmdResult<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("删除失败：{err}")),
    }
}

#[tauri::command]
pub fn has_chat_api_key() -> bool {
    entry().ok().and_then(|en| en.get_password().ok()).is_some()
}

// --------------------------------------------------------------------- chat

#[tauri::command]
pub async fn chat_send(app: AppHandle, history: Vec<ChatMessage>) -> CmdResult<String> {
    let state = app.state::<AppState>();
    let (settings, memory, sites) = {
        let db = state.engine.db();
        (db.get_settings().map_err(e)?, db.get_persona_memory().map_err(e)?, db.list_sites().map_err(e)?)
    };
    if !settings.chat_enabled {
        return Err("聊天功能未开启（设置 → 小喵 → 聊天）".into());
    }
    let url = validate_endpoint(&settings.chat_endpoint)?;
    let template = persona_prompt_path(&app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_PERSONA.to_string());
    let summary = settings.memory_enabled.then(|| {
        let names = |id: &str| sites.iter().find(|s| s.id == id).map(|s| s.name.clone());
        memory_summary(&memory, &names)
    });
    let system = build_system_prompt(&template, &settings.pet_name, &settings.user_title, summary.as_deref());
    let body = build_request(&settings.chat_model, &system, &history)?;
    let key = entry()?
        .get_password()
        .map_err(|_| "请先在设置中保存 API Key（保存在系统钥匙串中）".to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(60)).build();
        let resp = agent
            .post(&url)
            .set("Authorization", &format!("Bearer {key}"))
            .set("Content-Type", "application/json")
            .send_json(body);
        let json: serde_json::Value = match resp {
            Ok(r) => r.into_json().map_err(|_| "接口返回的不是 JSON".to_string())?,
            Err(ureq::Error::Status(code, r)) => {
                let v: serde_json::Value = r.into_json().unwrap_or_default();
                return Err(parse_response(&v).err().unwrap_or_else(|| format!("接口返回 HTTP {code}")));
            }
            Err(err) => return Err(format!("网络错误：{err}")),
        };
        parse_response(&json)
    })
    .await
    .map_err(e)?
}
