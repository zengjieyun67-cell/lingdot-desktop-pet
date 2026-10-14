//! Executes engine effects inside the Tauri app.

use crate::AppState;
use pet_core::model::{now_ms, NotificationRecord};
use pet_core::Effect;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

pub fn apply(app: &AppHandle, effects: Vec<Effect>) {
    let settings = app.state::<AppState>().engine.db().get_settings().unwrap_or_default();
    for fx in effects {
        match fx {
            Effect::TasksChanged => {
                let _ = app.emit("tasks-changed", ());
            }
            Effect::ConnectionChanged(status) => {
                let _ = app.emit("connection-changed", status);
            }
            Effect::Notify(rec) => {
                if settings.notifications_enabled {
                    show_os_notification(app, &rec, settings.sound_enabled);
                }
                // Pet bubble (in-character line) + panel list refresh. Sound is played by
                // the macOS notification itself; the webview chime is only for browser preview.
                let _ = app.emit("notification", serde_json::json!({ "record": rec, "sound": false }));
            }
        }
    }
    refresh_mood(app);
}

pub fn show_os_notification(app: &AppHandle, rec: &NotificationRecord, sound: bool) {
    // Clicks ("tap") are reported to the handler registered in `register_click_handler`
    // (tauri-plugin-notification >= 2.6 on macOS/Windows, "as far as the notification
    // server reports it"). Fallbacks that always work: the panel's recent-notification
    // list ("打开" button) and the clickable bubble above the pet.
    let mut b = app
        .notification()
        .builder()
        .title(&rec.title)
        .body(&rec.body)
        .extra("notificationId", rec.id.clone());
    if sound {
        b = b.sound("default");
    }
    let _ = b.show();
}

/// Clicking a system notification opens the task URL (or the panel's notification list).
pub fn register_click_handler(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.notification().on_action(move |performed| {
        if performed.action_id() != "tap" {
            return;
        }
        let id = performed
            .notification()
            .and_then(|n| n.extra().get("notificationId"))
            .and_then(|v| v.as_str())
            .map(String::from);
        let h = handle.clone();
        // Hop to the main thread for window / opener calls.
        let _ = handle.run_on_main_thread(move || match id {
            Some(id) => crate::commands::open_notification_by_id(&h, &id),
            None => crate::windows::show_panel_tab(&h, "notifications"),
        });
    });
}

/// Recompute the aggregated pet mood and emit it when it changes.
pub fn refresh_mood(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Ok(mood) = state.engine.pet_mood(now_ms()) else { return };
    let mut last = state.last_mood.lock().unwrap();
    if *last != mood {
        *last = mood;
        let _ = app.emit_to("pet", "pet-mood", mood);
        let _ = app.emit_to("panel", "pet-mood", mood);
    }
}
