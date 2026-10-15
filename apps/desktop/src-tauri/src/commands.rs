//! IPC commands exposed to the React frontend. Every command validates input via
//! pet-core and returns `Result<T, String>` (Chinese error text for the UI).

use crate::{effects, windows, AppState, TOKEN_KEY};
use pet_core::db::validate_http_url;
use pet_core::model::*;
use pet_core::security::generate_token;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_opener::OpenerExt;

type CmdResult<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub status: ConnectionStatus,
    pub port: u16,
    pub token: String,
    pub allowed_extension_id: String,
    pub server_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bootstrap {
    pub settings: AppSettings,
    pub mood: PetMood,
    pub connection: ConnectionInfo,
    pub platform: &'static str,
}

fn connection_info(state: &AppState) -> ConnectionInfo {
    ConnectionInfo {
        status: state.engine.connection_status(),
        port: *state.port.lock().unwrap(),
        token: state.auth.token(),
        allowed_extension_id: state.auth.extension_id(),
        server_error: state.server_error.lock().unwrap().clone(),
    }
}

#[tauri::command]
pub fn get_bootstrap(state: State<'_, AppState>) -> CmdResult<Bootstrap> {
    let settings = state.engine.db().get_settings().map_err(e)?;
    Ok(Bootstrap {
        settings,
        mood: state.engine.pet_mood(now_ms()).map_err(e)?,
        connection: connection_info(&state),
        platform: std::env::consts::OS,
    })
}

// ------------------------------------------------------------------ sites

#[tauri::command]
pub fn list_sites(state: State<'_, AppState>) -> CmdResult<Vec<Site>> {
    state.engine.db().list_sites().map_err(e)
}

#[tauri::command]
pub fn create_site(app: AppHandle, state: State<'_, AppState>, input: SiteInput) -> CmdResult<Site> {
    let s = state.engine.db().create_site(&input).map_err(e)?;
    let _ = app.emit("sites-changed", ());
    Ok(s)
}

#[tauri::command]
pub fn update_site(app: AppHandle, state: State<'_, AppState>, id: String, input: SiteInput) -> CmdResult<Site> {
    let s = state.engine.db().update_site(&id, &input).map_err(e)?;
    let _ = app.emit("sites-changed", ());
    Ok(s)
}

#[tauri::command]
pub fn delete_site(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.engine.db().delete_site(&id).map_err(e)?;
    let _ = app.emit("sites-changed", ());
    Ok(())
}

#[tauri::command]
pub fn reorder_sites(app: AppHandle, state: State<'_, AppState>, ids: Vec<String>) -> CmdResult<Vec<Site>> {
    let s = state.engine.db().reorder_sites(&ids).map_err(e)?;
    let _ = app.emit("sites-changed", ());
    Ok(s)
}

/// Open a URL with the configured launch mode. Only http(s) URLs are accepted.
fn launch(app: &AppHandle, url: &str, settings: &AppSettings) -> CmdResult<()> {
    validate_http_url(url).map_err(e)?;
    if settings.launch_mode == "app" && !settings.launch_browser_app.trim().is_empty() {
        #[cfg(target_os = "macos")]
        {
            // `open -a "<App>" <url>`: args passed separately, no shell involved.
            let status = std::process::Command::new("/usr/bin/open")
                .arg("-a")
                .arg(settings.launch_browser_app.trim())
                .arg(url)
                .status()
                .map_err(e)?;
            if status.success() {
                return Ok(());
            }
            return Err(format!("无法用「{}」打开，请确认已安装该浏览器", settings.launch_browser_app));
        }
    }
    app.opener().open_url(url, None::<&str>).map_err(e)
}

#[tauri::command]
pub fn launch_site(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let (site, settings) = {
        let db = state.engine.db();
        (db.get_site(&id).map_err(e)?, db.get_settings().map_err(e)?)
    };
    if !site.enabled {
        return Err("该网站已停用".into());
    }
    launch(&app, &site.url, &settings)
}

#[tauri::command]
pub fn open_url(app: AppHandle, state: State<'_, AppState>, url: String) -> CmdResult<()> {
    let settings = state.engine.db().get_settings().map_err(e)?;
    launch(&app, &url, &settings)
}

// ------------------------------------------------------------------ tasks

#[tauri::command]
pub fn list_tasks(state: State<'_, AppState>, filter: Option<TaskFilter>) -> CmdResult<Vec<Task>> {
    state.engine.db().list_tasks(&filter.unwrap_or_default()).map_err(e)
}

#[tauri::command]
pub fn get_task_detail(state: State<'_, AppState>, id: String) -> CmdResult<TaskDetail> {
    state.engine.db().task_detail(&id).map_err(e)
}

#[tauri::command]
pub fn create_task(app: AppHandle, state: State<'_, AppState>, input: TaskInput) -> CmdResult<Task> {
    let t = state.engine.db().create_manual_task(&input).map_err(e)?;
    let _ = app.emit("tasks-changed", ());
    effects::refresh_mood(&app);
    Ok(t)
}

#[tauri::command]
pub fn update_task(app: AppHandle, state: State<'_, AppState>, id: String, input: TaskInput) -> CmdResult<Task> {
    let t = state.engine.db().update_manual_task(&id, &input).map_err(e)?;
    let _ = app.emit("tasks-changed", ());
    effects::refresh_mood(&app);
    Ok(t)
}

#[tauri::command]
pub fn set_task_status(app: AppHandle, state: State<'_, AppState>, id: String, status: TaskStatus) -> CmdResult<Task> {
    let t = state.engine.db().manual_set_status(&id, status).map_err(e)?;
    let _ = app.emit("tasks-changed", ());
    effects::refresh_mood(&app);
    Ok(t)
}

#[tauri::command]
pub fn delete_task(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.engine.db().delete_task(&id).map_err(e)?;
    let _ = app.emit("tasks-changed", ());
    effects::refresh_mood(&app);
    Ok(())
}

#[tauri::command]
pub fn open_task(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let (task, settings) = {
        let db = state.engine.db();
        (db.get_task(&id).map_err(e)?, db.get_settings().map_err(e)?)
    };
    if task.url.is_empty() {
        return Err("该任务没有链接".into());
    }
    launch(&app, &task.url, &settings)
}

// --------------------------------------------------------------- settings

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> CmdResult<AppSettings> {
    state.engine.db().get_settings().map_err(e)
}

#[tauri::command]
pub fn update_settings(app: AppHandle, state: State<'_, AppState>, settings: AppSettings) -> CmdResult<AppSettings> {
    let (old, new) = {
        let db = state.engine.db();
        let old = db.get_settings().map_err(e)?;
        let mut incoming = settings;
        // Position is owned by the window manager, not the settings form.
        incoming.pet_position = old.pet_position.clone();
        incoming.panel_position = old.panel_position.clone();
        (old, db.save_settings(&incoming).map_err(e)?)
    };
    if old.pet_visible != new.pet_visible {
        windows::set_pet_visible(&app, new.pet_visible);
    }
    if (old.pet_scale - new.pet_scale).abs() > f64::EPSILON {
        windows::apply_pet_scale(&app, new.pet_scale);
    }
    if old.allowed_extension_id != new.allowed_extension_id {
        state.auth.set_extension_id(new.allowed_extension_id.clone());
    }
    if old.autostart != new.autostart {
        let al = app.autolaunch();
        let r = if new.autostart { al.enable() } else { al.disable() };
        if let Err(err) = r {
            // Revert flag so the UI reflects reality.
            let db = state.engine.db();
            let mut s = new.clone();
            s.autostart = old.autostart;
            let _ = db.save_settings(&s);
            return Err(format!("开机启动设置失败: {err}"));
        }
    }
    if old.display_mode != new.display_mode || old.desktop_interactive != new.desktop_interactive {
        windows::apply_display_mode(&app, &new);
        let _ = app.emit("display-mode", new.display_mode.clone());
    }
    let _ = app.emit("settings-changed", new.clone());
    Ok(new)
}

/// Persist `display_mode`, switch windows + tray label, notify all windows.
pub fn switch_display_mode(app: &AppHandle, mode: &str) -> CmdResult<AppSettings> {
    if mode != "pet" && mode != "desktop" {
        return Err(format!("未知的显示模式: {mode}"));
    }
    let state = app.state::<AppState>();
    let new = {
        let db = state.engine.db();
        let mut s = db.get_settings().map_err(e)?;
        s.display_mode = mode.to_string();
        db.save_settings(&s).map_err(e)?
    };
    windows::apply_display_mode(app, &new);
    let _ = app.emit("display-mode", new.display_mode.clone());
    let _ = app.emit("settings-changed", new.clone());
    Ok(new)
}

#[tauri::command]
pub fn set_display_mode(app: AppHandle, mode: String) -> CmdResult<AppSettings> {
    switch_display_mode(&app, &mode)
}

/// Tray: flip between 桌宠模式 and 桌面模式.
pub fn toggle_display_mode(app: &AppHandle) {
    let cur = app.state::<AppState>().engine.db().get_settings().map(|s| s.display_mode).unwrap_or_default();
    let next = if cur == "desktop" { "pet" } else { "desktop" };
    let _ = switch_display_mode(app, next);
}

pub fn toggle_animations(app: &AppHandle) {
    let state = app.state::<AppState>();
    let new = {
        let db = state.engine.db();
        let Ok(mut s) = db.get_settings() else { return };
        s.animations_enabled = !s.animations_enabled;
        db.save_settings(&s).ok()
    };
    if let Some(s) = new {
        let _ = app.emit("settings-changed", s);
    }
}

#[tauri::command]
pub fn complete_first_run(app: AppHandle, state: State<'_, AppState>) -> CmdResult<AppSettings> {
    let s = {
        let db = state.engine.db();
        let mut s = db.get_settings().map_err(e)?;
        s.first_run_done = true;
        db.save_settings(&s).map_err(e)?
    };
    let _ = app.emit("settings-changed", s.clone());
    Ok(s)
}

// ---------------------------------------------------------- notifications

#[tauri::command]
pub fn list_notifications(state: State<'_, AppState>, limit: Option<i64>) -> CmdResult<Vec<NotificationRecord>> {
    state.engine.db().list_notifications(limit.unwrap_or(50)).map_err(e)
}

#[tauri::command]
pub fn mark_notifications_read(state: State<'_, AppState>) -> CmdResult<()> {
    state.engine.db().mark_notifications_read().map_err(e)
}

#[tauri::command]
pub fn clear_notifications(state: State<'_, AppState>) -> CmdResult<()> {
    state.engine.db().clear_notifications().map_err(e)
}

/// "Open" from the recent list / pet bubble / system notification click:
/// open the task URL if any, else the panel's notification list.
#[tauri::command]
pub fn open_notification(app: AppHandle, id: String) -> CmdResult<()> {
    let state = app.state::<AppState>();
    let (rec, settings) = {
        let db = state.engine.db();
        let list = db.list_notifications(500).map_err(e)?;
        (list.into_iter().find(|n| n.id == id), db.get_settings().map_err(e)?)
    };
    match rec.and_then(|r| r.url) {
        Some(url) => launch(&app, &url, &settings),
        None => {
            windows::show_panel_tab(&app, "notifications");
            Ok(())
        }
    }
}

pub fn open_notification_by_id(app: &AppHandle, id: &str) {
    if open_notification(app.clone(), id.to_string()).is_err() {
        windows::show_panel_tab(app, "notifications");
    }
}

#[tauri::command]
pub fn test_notification(app: AppHandle) -> CmdResult<()> {
    let rec = NotificationRecord {
        id: new_id(),
        task_id: None,
        kind: "completed".into(),
        title: "🐱 桌宠通知测试".into(),
        body: "如果你看到了这条通知，说明通知权限已开启。".into(),
        url: None,
        created_at: now_ms(),
        read: true,
    };
    let sound = app.state::<AppState>().engine.db().get_settings().map(|s| s.sound_enabled).unwrap_or(true);
    effects::show_os_notification(&app, &rec, sound);
    let _ = app.emit("notification", serde_json::json!({ "record": rec, "sound": false, "test": true }));
    Ok(())
}

// ------------------------------------------------------------- connection

#[tauri::command]
pub fn get_connection_info(state: State<'_, AppState>) -> CmdResult<ConnectionInfo> {
    Ok(connection_info(&state))
}

#[tauri::command]
pub fn rotate_token(state: State<'_, AppState>) -> CmdResult<ConnectionInfo> {
    let t = generate_token();
    state.engine.db().set_setting_raw(TOKEN_KEY, &t).map_err(e)?;
    state.auth.set_token(t);
    Ok(connection_info(&state))
}

// ---------------------------------------------------------------- cleanup

#[tauri::command]
pub fn cleanup_data(app: AppHandle, state: State<'_, AppState>, older_than_days: i64, all: bool) -> CmdResult<usize> {
    let n = state
        .engine
        .db()
        .cleanup(older_than_days.max(0) * 24 * 3600 * 1000, all)
        .map_err(e)?;
    let _ = app.emit("tasks-changed", ());
    effects::refresh_mood(&app);
    Ok(n)
}

// ---------------------------------------------------------------- windows

#[tauri::command]
pub fn toggle_panel(app: AppHandle) {
    windows::toggle_panel(&app)
}

#[tauri::command]
pub fn show_panel(app: AppHandle, tab: Option<String>) {
    match tab {
        Some(t) => windows::show_panel_tab(&app, &t),
        None => windows::show_panel(&app),
    }
}

#[tauri::command]
pub fn hide_panel(app: AppHandle) {
    windows::hide_panel(&app)
}

#[tauri::command]
pub fn set_pet_visible(app: AppHandle, visible: bool) {
    windows::set_pet_visible(&app, visible)
}

#[tauri::command]
pub fn reset_pet_position(app: AppHandle) {
    windows::reset_pet_position(&app)
}

/// Resize the pet (Cmd/Ctrl + scroll over the pet, or the size slider). Returns the clamped scale.
#[tauri::command]
pub fn set_pet_scale(app: AppHandle, state: State<'_, AppState>, scale: f64) -> CmdResult<f64> {
    let scale = pet_core::model::clamp_pet_scale(scale);
    let new = {
        let db = state.engine.db();
        let mut s = db.get_settings().map_err(e)?;
        if (s.pet_scale - scale).abs() < f64::EPSILON {
            return Ok(scale);
        }
        s.pet_scale = scale;
        db.save_settings(&s).map_err(e)?
    };
    windows::apply_pet_scale(&app, new.pet_scale);
    let _ = app.emit("settings-changed", new.clone());
    Ok(new.pet_scale)
}

#[tauri::command]
pub fn reset_panel_position(app: AppHandle) {
    windows::reset_panel_position(&app)
}

#[tauri::command]
pub fn get_pet_mood(state: State<'_, AppState>) -> CmdResult<PetMood> {
    state.engine.pet_mood(now_ms()).map_err(e)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Live2DInfo {
    /// App data dir where users may drop models (`<appData>/live2d`).
    pub models_dir: String,
}

#[tauri::command]
pub fn get_live2d_info(app: AppHandle) -> CmdResult<Live2DInfo> {
    let dir = app.path().app_data_dir().map_err(e)?.join("live2d");
    Ok(Live2DInfo { models_dir: dir.to_string_lossy().into_owned() })
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0)
}
