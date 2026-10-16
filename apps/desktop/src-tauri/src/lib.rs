//! Tauri shell for the desktop pet. All business logic lives in `pet-core`;
//! this crate wires it to windows, tray, notifications and IPC commands.

mod live2d_cmds;
mod activity_probe;
mod commands;
mod effects;
mod persona_cmds;
mod stt;
mod sys;
mod tts;
mod voice;
mod windows;

use pet_core::model::{now_ms, PetMood};
use pet_core::security::generate_token;
use pet_core::server::{bind_loopback, serve, AuthConfig, ServerState};
use pet_core::{Db, Engine};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WindowEvent};

pub struct AppState {
    pub engine: Arc<Engine>,
    pub auth: Arc<AuthConfig>,
    pub port: Mutex<u16>,
    pub server_error: Mutex<Option<String>>,
    pub last_mood: Mutex<PetMood>,
    pub pending_pet_pos: Mutex<Option<(i32, i32)>>,
    pub pending_panel_pos: Mutex<Option<(i32, i32)>>,
    /// When we last moved the panel ourselves (its Moved events are not user drags).
    pub panel_placed_at: Mutex<Option<std::time::Instant>>,
}

const TOKEN_KEY: &str = "session_token";

/// Tray item that toggles 桌宠模式 / 桌面模式 (its label follows the current mode).
#[derive(Default)]
pub struct TrayModeItem(pub Mutex<Option<MenuItem<tauri::Wry>>>);

fn tray_mode_text(mode: &str) -> &'static str {
    if mode == "desktop" {
        "切换到桌宠模式"
    } else {
        "切换到桌面模式"
    }
}

/// Update the tray's mode-toggle label (called by `windows::apply_display_mode`).
pub fn update_tray_mode(app: &AppHandle, mode: &str) {
    let Some(st) = app.try_state::<TrayModeItem>() else { return };
    let item = st.0.lock().unwrap().clone();
    if let Some(item) = item {
        let _ = item.set_text(tray_mode_text(mode));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(voice::VoiceRuntime::default())
        .manage(activity_probe::ActivityState::default())
        .manage(TrayModeItem::default())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // ---- storage
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            std::fs::create_dir_all(dir.join("live2d")).ok();
            let db = Db::open(&dir.join("desktop-pet.sqlite")).map_err(|e| e.to_string())?;
            let settings = db.get_settings().map_err(|e| e.to_string())?;

            // ---- session token (persisted; optionally rotated on each start)
            let token = match db.get_setting_raw(TOKEN_KEY).ok().flatten() {
                Some(t) if !settings.rotate_token_on_startup && t.len() == 64 => t,
                _ => {
                    let t = generate_token();
                    db.set_setting_raw(TOKEN_KEY, &t).map_err(|e| e.to_string())?;
                    t
                }
            };
            let engine = Arc::new(Engine::new(db));
            let auth = Arc::new(AuthConfig::new(token, settings.allowed_extension_id.clone()));
            app.manage(AppState {
                engine: engine.clone(),
                auth: auth.clone(),
                port: Mutex::new(0),
                server_error: Mutex::new(None),
                last_mood: Mutex::new(PetMood::Idle),
                pending_pet_pos: Mutex::new(None),
                pending_panel_pos: Mutex::new(None),
                panel_placed_at: Mutex::new(None),
            });

            // ---- Live2D: find + import the user's own model when the configured one is missing
            live2d_cmds::auto_import_on_startup(app.handle());

            // ---- local server (127.0.0.1 only)
            let handle = app.handle().clone();
            let preferred = settings.server_port;
            tauri::async_runtime::spawn(async move {
                match bind_loopback(preferred).await {
                    Ok(listener) => {
                        let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
                        let state = handle.state::<AppState>();
                        *state.port.lock().unwrap() = port;
                        let sink_handle = handle.clone();
                        let st = ServerState {
                            engine: state.engine.clone(),
                            auth: state.auth.clone(),
                            port,
                            sink: Arc::new(move |fx| effects::apply(&sink_handle, fx)),
                        };
                        if let Err(e) = serve(listener, st).await {
                            *handle.state::<AppState>().server_error.lock().unwrap() = Some(e.to_string());
                        }
                    }
                    Err(e) => {
                        *handle.state::<AppState>().server_error.lock().unwrap() = Some(e.to_string());
                    }
                }
            });

            // ---- tray
            let mode_item =
                MenuItem::with_id(app, "toggle_mode", tray_mode_text(&settings.display_mode), true, None::<&str>)?;
            *app.state::<TrayModeItem>().0.lock().unwrap() = Some(mode_item.clone());
            let toggle = MenuItem::with_id(app, "toggle_pet", "显示 / 隐藏桌宠", true, None::<&str>)?;
            let panel = MenuItem::with_id(app, "open_panel", "打开面板", true, None::<&str>)?;
            let saver = MenuItem::with_id(app, "screensaver", "进入屏保", true, None::<&str>)?;
            let reset = MenuItem::with_id(app, "reset_position", "重置桌宠位置", true, None::<&str>)?;
            let anim = MenuItem::with_id(app, "toggle_animations", "开关动画", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &mode_item, &saver, &panel, &reset, &anim, &sep, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("lingdot-desktop-pet")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle_pet" => windows::toggle_pet(app),
                    "toggle_mode" => commands::toggle_display_mode(app),
                    "open_panel" => windows::show_panel(app),
                    "screensaver" => windows::show_screensaver(app),
                    "reset_position" => windows::reset_pet_position(app),
                    "toggle_animations" => commands::toggle_animations(app),
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            #[cfg(target_os = "macos")]
            {
                tray = tray.icon_as_template(false);
            }
            tray.build(app)?;

            // ---- windows (after the tray so the mode label can be updated)
            windows::restore_pet(app.handle(), &settings);
            {
                use tauri::Emitter;
                let _ = app.handle().emit("display-mode", settings.display_mode.clone());
            }

            // ---- housekeeping ticker: heartbeat loss, timeouts, mood decay, position flush
            let h = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut iv = tokio::time::interval(Duration::from_secs(1));
                loop {
                    iv.tick().await;
                    let state = h.state::<AppState>();
                    if let Ok(fx) = state.engine.tick(now_ms()) {
                        if !fx.is_empty() {
                            effects::apply(&h, fx);
                        }
                    }
                    effects::refresh_mood(&h);
                    windows::flush_pet_position(&h);
                    windows::flush_panel_position(&h);
                }
            });

            // ---- 小喵's editable persona prompt (copied to app data on first run)
            persona_cmds::ensure_persona_file(app.handle());

            // ---- system notification clicks -> open task URL
            effects::register_click_handler(app.handle());

            // ---- cursor follow feed for the pet's eyes/head
            windows::spawn_cursor_feed(app.handle().clone());

            // ---- voice (实时对话 silence detection) + activity probe (music / idle)
            app.state::<voice::VoiceRuntime>().spawn_silence_watch(app.handle().clone());
            activity_probe::spawn(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                // Windows are never destroyed; quitting is via tray / settings.
                api.prevent_close();
                let _ = window.hide();
            }
            WindowEvent::Moved(pos) if window.label() == "pet" => {
                let state = window.state::<AppState>();
                *state.pending_pet_pos.lock().unwrap() = Some((pos.x, pos.y));
            }
            WindowEvent::Moved(pos) if window.label() == "panel" => {
                // Only remember positions the user chose by dragging (the panel is visible);
                // our own placement while hidden is not persisted.
                let state = window.state::<AppState>();
                let ours = state
                    .panel_placed_at
                    .lock()
                    .unwrap()
                    .map(|t| t.elapsed() < std::time::Duration::from_millis(600))
                    .unwrap_or(false);
                if !ours && window.is_visible().unwrap_or(false) {
                    *state.pending_panel_pos.lock().unwrap() = Some((pos.x, pos.y));
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bootstrap,
            commands::list_sites,
            commands::create_site,
            commands::update_site,
            commands::delete_site,
            commands::reorder_sites,
            commands::launch_site,
            commands::open_url,
            commands::list_tasks,
            commands::get_task_detail,
            commands::create_task,
            commands::update_task,
            commands::set_task_status,
            commands::delete_task,
            commands::open_task,
            commands::get_settings,
            commands::update_settings,
            commands::list_notifications,
            commands::mark_notifications_read,
            commands::clear_notifications,
            commands::open_notification,
            commands::get_connection_info,
            commands::rotate_token,
            commands::cleanup_data,
            commands::toggle_panel,
            commands::hide_panel,
            commands::show_panel,
            commands::set_pet_visible,
            commands::reset_pet_position,
            commands::set_pet_scale,
            commands::reset_panel_position,
            commands::get_pet_mood,
            commands::complete_first_run,
            commands::test_notification,
            commands::get_live2d_info,
            live2d_cmds::scan_and_import_live2d,
            live2d_cmds::import_live2d_folder,
            live2d_cmds::pick_live2d_folder,
            commands::quit_app,
            persona_cmds::get_persona_memory,
            persona_cmds::persona_interaction,
            persona_cmds::set_today_mood,
            persona_cmds::reset_persona_memory,
            persona_cmds::get_persona_prompt_path,
            persona_cmds::set_chat_api_key,
            persona_cmds::clear_chat_api_key,
            persona_cmds::has_chat_api_key,
            persona_cmds::chat_send,
            persona_cmds::chat_test,
            commands::set_display_mode,
            commands::start_screensaver,
            commands::exit_screensaver,
            voice::voice_status,
            voice::voice_ptt_start,
            voice::voice_ptt_stop,
            voice::voice_set_live,
            voice::voice_stop,
            voice::voice_stop_speaking,
            voice::voice_speak,
            voice::voice_list_voices,
            activity_probe::get_activity,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
