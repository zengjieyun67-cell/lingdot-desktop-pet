//! 小喵: long-term memory commands + optional LLM chat.
//!
//! - Memory lives in SQLite (`persona_memory`), local only, derived from app usage.
//! - Chat works with any OpenAI-compatible `/chat/completions` provider (presets in
//!   `pet_core::chat_provider`). API keys live ONLY in the OS keychain (macOS Keychain /
//!   Windows Credential Manager via `keyring`), one entry per provider
//!   (`chat-api-key:<provider>`); they are read here in Rust and attached to the
//!   outgoing request, never written to SQLite / settings JSON or sent to the webview.

use crate::AppState;
use pet_core::chat::{
    apply_provider_options, build_request, build_system_prompt, build_test_request, memory_summary, parse_response, validate_endpoint,
    ChatMessage,
};
use pet_core::chat_provider::{
    describe_http_error, describe_net_error, key_required, key_user, migrate_legacy_key, normalize_provider, preset, validate_key, KeyStore,
    NetError,
};
use pet_core::model::now_ms;
use pet_core::persona::{apply_interaction, set_today_mood as set_mood, PersonaMemory};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

type CmdResult<T> = Result<T, String>;

const KEYRING_SERVICE: &str = "com.desktoppet.app";
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

/// The OS keychain, one account per provider (see `chat_provider::key_user`).
struct Keychain;

impl KeyStore for Keychain {
    fn get(&self, user: &str) -> Option<String> {
        keyring::Entry::new(KEYRING_SERVICE, user).ok()?.get_password().ok().filter(|k| !k.is_empty())
    }
    fn set(&self, user: &str, secret: &str) -> Result<(), String> {
        keyring::Entry::new(KEYRING_SERVICE, user)
            .map_err(|err| format!("无法访问钥匙串：{err}"))?
            .set_password(secret)
            .map_err(|err| format!("保存到钥匙串失败：{err}"))
    }
    fn delete(&self, user: &str) -> Result<(), String> {
        match keyring::Entry::new(KEYRING_SERVICE, user).map_err(|err| format!("无法访问钥匙串：{err}"))?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(format!("删除失败：{err}")),
        }
    }
}

fn current_provider(app: &AppHandle) -> String {
    app.state::<AppState>().engine.db().get_settings().map(|s| s.chat_provider).unwrap_or_else(|_| "deepseek".into())
}

/// Provider named by the UI, or the configured one.
fn provider_or_current(app: &AppHandle, provider: Option<String>) -> String {
    match provider {
        Some(p) if !p.trim().is_empty() => normalize_provider(&p).to_string(),
        _ => current_provider(app),
    }
}

/// Move a pre-build-13 single key into the configured provider's slot (idempotent).
pub fn migrate_chat_key(app: &AppHandle) {
    if let Err(err) = migrate_legacy_key(&Keychain, &current_provider(app)) {
        eprintln!("chat key migration failed: {err}");
    }
}

fn provider_label(provider: &str) -> &'static str {
    preset(provider).map(|p| p.label).unwrap_or("当前服务商")
}

#[tauri::command]
pub fn set_chat_api_key(app: AppHandle, key: String, provider: Option<String>) -> CmdResult<()> {
    migrate_chat_key(&app);
    let key = validate_key(&key)?;
    Keychain.set(&key_user(&provider_or_current(&app, provider)), key)
}

#[tauri::command]
pub fn clear_chat_api_key(app: AppHandle, provider: Option<String>) -> CmdResult<()> {
    migrate_chat_key(&app);
    Keychain.delete(&key_user(&provider_or_current(&app, provider)))
}

#[tauri::command]
pub fn has_chat_api_key(app: AppHandle, provider: Option<String>) -> bool {
    migrate_chat_key(&app);
    Keychain.get(&key_user(&provider_or_current(&app, provider))).is_some()
}

/// Key for `provider`, `None` when the endpoint needs none (Ollama / localhost) and none is saved.
fn key_for(provider: &str, endpoint: &str) -> CmdResult<Option<String>> {
    match Keychain.get(&key_user(provider)) {
        Some(k) => Ok(Some(k)),
        None if !key_required(provider, endpoint) => Ok(None),
        None => Err(format!("还没有保存 {} 的 API Key：请到 设置 → 聊天 粘贴后保存", provider_label(provider))),
    }
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
    migrate_chat_key(app);
    let s = app.state::<AppState>().engine.db().get_settings().map_err(e)?;
    key_for(&s.chat_provider, &s.chat_endpoint).map(|_| ())
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
    migrate_chat_key(app);
    let key = key_for(&settings.chat_provider, &settings.chat_endpoint)?;
    post_chat(url, key, body, settings.chat_model.clone(), 60).await
}

fn net_error(err: &ureq::Transport) -> NetError {
    let text = err.to_string();
    match err.kind() {
        ureq::ErrorKind::Dns => NetError::Dns,
        ureq::ErrorKind::ConnectionFailed if text.to_lowercase().contains("timed out") => NetError::Timeout,
        ureq::ErrorKind::ConnectionFailed => NetError::Refused,
        ureq::ErrorKind::Io if text.to_lowercase().contains("timed out") || text.contains("timeout") => NetError::Timeout,
        _ => NetError::Other(text),
    }
}

/// POST an OpenAI-compatible chat request from Rust (the key never reaches the webview).
/// `key = None` sends no Authorization header (local servers such as Ollama).
async fn post_chat(url: String, key: Option<String>, body: serde_json::Value, model: String, timeout_secs: u64) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(timeout_secs)).build();
        let mut req = agent.post(&url).set("Content-Type", "application/json");
        if let Some(k) = key.as_deref() {
            req = req.set("Authorization", &format!("Bearer {k}"));
        }
        if url.contains("openrouter.ai") {
            // optional attribution headers documented by OpenRouter
            req = req.set("HTTP-Referer", "https://github.com/zengjieyun67-cell/lingdot-desktop-pet").set("X-Title", "lingdot");
        }
        let json: serde_json::Value = match req.send_json(body) {
            Ok(r) => r
                .into_json()
                .map_err(|_| "接口返回的不是 JSON：Base URL 可能不对（通常以 /v1 结尾）".to_string())?,
            Err(ureq::Error::Status(code, r)) => {
                let v: serde_json::Value = r.into_json().unwrap_or_default();
                let api_msg = v
                    .pointer("/error/message")
                    .and_then(|m| m.as_str())
                    .or_else(|| v.get("message").and_then(|m| m.as_str()))
                    .or_else(|| v.get("error").and_then(|m| m.as_str()))
                    .map(str::to_string);
                return Err(describe_http_error(code, api_msg.as_deref(), &model));
            }
            Err(ureq::Error::Transport(t)) => return Err(describe_net_error(&net_error(&t), &url)),
        };
        parse_response(&json)
    })
    .await
    .map_err(e)?
}

/// 「测试连接」: tiny request with the provider/endpoint/model currently in the form
/// (not necessarily saved yet) and that provider's key from the keychain.
#[tauri::command]
pub async fn chat_test(app: AppHandle, endpoint: String, model: String, provider: Option<String>) -> CmdResult<String> {
    migrate_chat_key(&app);
    let provider = provider_or_current(&app, provider);
    let url = validate_endpoint(&endpoint)?;
    let body = apply_provider_options(build_test_request(&model)?, &url);
    let key = key_for(&provider, &endpoint)?;
    let reply = post_chat(url.clone(), key, body, model.trim().to_string(), 20).await?;
    let preview: String = reply.chars().take(30).collect();
    Ok(format!("连接成功（{url}，模型 {}）：{preview}", model.trim()))
}
