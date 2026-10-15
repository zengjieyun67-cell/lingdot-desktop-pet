//! 小喵: long-term memory commands + optional LLM chat.
//!
//! - Memory lives in SQLite (`persona_memory`), local only, derived from app usage.
//! - The chat API key lives ONLY in the OS keychain (macOS Keychain via `keyring`);
//!   it is read here in Rust and attached to the outgoing request. It is never
//!   written to SQLite / settings JSON and never sent to the webview.

use crate::AppState;
use pet_core::chat::{
    apply_provider_options, build_request, build_system_prompt, build_test_request, memory_summary, parse_response, validate_endpoint,
    ChatMessage,
};
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
    chat_reply(&app, history).await
}

/// Is chat usable right now (enabled + key in the keychain)? Used by voice chat.
pub fn chat_ready(app: &AppHandle) -> CmdResult<()> {
    let enabled = app.state::<AppState>().engine.db().get_settings().map(|s| s.chat_enabled).unwrap_or(false);
    if !enabled {
        return Err("语音对话要用到聊天：请先在 设置 → 聊天 中开启并保存 API Key".into());
    }
    if !has_chat_api_key() {
        return Err("还没有保存 API Key：请到 设置 → 聊天 粘贴 DeepSeek 的 Key".into());
    }
    Ok(())
}

/// One reply from 小喵 for `history` (persona prompt + memory summary), used by the chat
/// tab and by voice chat.
pub async fn chat_reply(app: &AppHandle, history: Vec<ChatMessage>) -> CmdResult<String> {
    let state = app.state::<AppState>();
    let (settings, memory, sites) = {
        let db = state.engine.db();
        (db.get_settings().map_err(e)?, db.get_persona_memory().map_err(e)?, db.list_sites().map_err(e)?)
    };
    if !settings.chat_enabled {
        return Err("聊天功能未开启（设置 → 小喵 → 聊天）".into());
    }
    let url = validate_endpoint(&settings.chat_endpoint)?;
    let template = persona_prompt_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_PERSONA.to_string());
    let summary = settings.memory_enabled.then(|| {
        let names = |id: &str| sites.iter().find(|s| s.id == id).map(|s| s.name.clone());
        memory_summary(&memory, &names)
    });
    let system = build_system_prompt(&template, &settings.pet_name, &settings.user_title, summary.as_deref());
    let body = apply_provider_options(build_request(&settings.chat_model, &system, &history)?, &url);
    let key = stored_key()?;
    post_chat(url, key, body, 60).await
}

fn stored_key() -> CmdResult<String> {
    entry()?
        .get_password()
        .map_err(|_| "请先在设置中保存 API Key（保存在系统钥匙串中）".to_string())
}

/// POST an OpenAI-compatible chat request from Rust (the key never reaches the webview).
async fn post_chat(url: String, key: String, body: serde_json::Value, timeout_secs: u64) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(timeout_secs)).build();
        let resp = agent
            .post(&url)
            .set("Authorization", &format!("Bearer {key}"))
            .set("Content-Type", "application/json")
            .send_json(body);
        let json: serde_json::Value = match resp {
            Ok(r) => r.into_json().map_err(|_| "接口返回的不是 JSON".to_string())?,
            Err(ureq::Error::Status(code, r)) => {
                let v: serde_json::Value = r.into_json().unwrap_or_default();
                let hint = match code {
                    401 => "（API Key 无效或已失效）",
                    402 => "（账户余额不足）",
                    404 => "（接口地址或模型名不对）",
                    429 => "（请求太频繁或额度用完）",
                    _ => "",
                };
                return Err(match parse_response(&v).err() {
                    Some(msg) if msg != "接口返回格式无法识别" => format!("HTTP {code}{hint}：{msg}"),
                    _ => format!("接口返回 HTTP {code}{hint}"),
                });
            }
            Err(err) => return Err(format!("网络错误：{err}")),
        };
        parse_response(&json)
    })
    .await
    .map_err(e)?
}

/// 「测试连接」: tiny request with the endpoint/model currently typed in the form
/// (not necessarily saved yet) and the key from the keychain.
#[tauri::command]
pub async fn chat_test(endpoint: String, model: String) -> CmdResult<String> {
    let url = validate_endpoint(&endpoint)?;
    let body = apply_provider_options(build_test_request(&model)?, &url);
    let key = stored_key()?;
    let reply = post_chat(url.clone(), key, body, 20).await?;
    let preview: String = reply.chars().take(30).collect();
    Ok(format!("连接成功（{url}）：{preview}"))
}
