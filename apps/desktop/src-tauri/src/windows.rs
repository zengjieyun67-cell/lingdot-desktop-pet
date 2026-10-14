//! Pet + panel window management.

use crate::AppState;
use pet_core::model::{AppSettings, PetPosition};
use std::time::Duration;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

pub const PET_W: f64 = 200.0;
pub const PET_H: f64 = 240.0;
pub const PANEL_W: f64 = 380.0;
pub const PANEL_H: f64 = 560.0;

fn pet(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("pet")
}
fn panel(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("panel")
}

fn update_settings(app: &AppHandle, f: impl FnOnce(&mut AppSettings)) -> Option<AppSettings> {
    let state = app.state::<AppState>();
    let db = state.engine.db();
    let mut s = db.get_settings().ok()?;
    f(&mut s);
    db.save_settings(&s).ok()
}

pub fn apply_pet_scale(app: &AppHandle, scale: f64) {
    if let Some(w) = pet(app) {
        let _ = w.set_size(LogicalSize::new(PET_W * scale, PET_H * scale));
    }
}

pub fn restore_pet(app: &AppHandle, s: &AppSettings) {
    let Some(w) = pet(app) else { return };
    apply_pet_scale(app, s.pet_scale);
    let _ = w.set_always_on_top(true);
    let _ = w.set_skip_taskbar(true);
    match &s.pet_position {
        Some(p) if position_on_some_monitor(&w, p.x, p.y) => {
            let _ = w.set_position(PhysicalPosition::new(p.x, p.y));
        }
        _ => reset_pet_position(app),
    }
    if s.pet_visible {
        let _ = w.show();
    } else {
        let _ = w.hide();
    }
}

fn position_on_some_monitor(w: &WebviewWindow, x: i32, y: i32) -> bool {
    match w.available_monitors() {
        Ok(ms) if !ms.is_empty() => ms.iter().any(|m| {
            let p = m.position();
            let s = m.size();
            x >= p.x - 50 && y >= p.y - 50 && x < p.x + s.width as i32 - 20 && y < p.y + s.height as i32 - 20
        }),
        _ => true,
    }
}

pub fn reset_pet_position(app: &AppHandle) {
    let Some(w) = pet(app) else { return };
    let monitor = w.primary_monitor().ok().flatten().or_else(|| w.current_monitor().ok().flatten());
    if let Some(m) = monitor {
        let size = w.outer_size().unwrap_or_default();
        let mp = m.position();
        let ms = m.size();
        let margin = (40.0 * m.scale_factor()) as i32;
        let x = mp.x + ms.width as i32 - size.width as i32 - margin;
        let y = mp.y + ms.height as i32 - size.height as i32 - margin * 2;
        let _ = w.set_position(PhysicalPosition::new(x, y));
        update_settings(app, |s| s.pet_position = Some(PetPosition { x, y }));
    }
}

pub fn set_pet_visible(app: &AppHandle, visible: bool) {
    if let Some(w) = pet(app) {
        let _ = if visible { w.show() } else { w.hide() };
    }
    if !visible {
        hide_panel(app);
    }
    if let Some(s) = update_settings(app, |s| s.pet_visible = visible) {
        let _ = app.emit("settings-changed", s);
    }
}

pub fn toggle_pet(app: &AppHandle) {
    let visible = pet(app).and_then(|w| w.is_visible().ok()).unwrap_or(false);
    set_pet_visible(app, !visible);
}

/// Position the panel beside the pet (left if the pet is on the right half).
fn place_panel(app: &AppHandle) {
    let (Some(p), Some(pw)) = (panel(app), pet(app)) else { return };
    let Ok(pet_pos) = pw.outer_position() else { return };
    let pet_size = pw.outer_size().unwrap_or_default();
    let Some(m) = pw.current_monitor().ok().flatten() else { return };
    let sf = m.scale_factor();
    let w = (PANEL_W * sf) as i32;
    let h = (PANEL_H * sf) as i32;
    let mp = m.position();
    let ms = m.size();
    let gap = (8.0 * sf) as i32;
    let pet_center_x = pet_pos.x + pet_size.width as i32 / 2;
    let mut x = if pet_center_x > mp.x + ms.width as i32 / 2 {
        pet_pos.x - w - gap
    } else {
        pet_pos.x + pet_size.width as i32 + gap
    };
    let mut y = pet_pos.y + pet_size.height as i32 - h;
    x = x.clamp(mp.x + gap, mp.x + ms.width as i32 - w - gap);
    y = y.clamp(mp.y + (30.0 * sf) as i32, (mp.y + ms.height as i32 - h - gap).max(mp.y));
    let _ = p.set_size(LogicalSize::new(PANEL_W, PANEL_H));
    let _ = p.set_position(PhysicalPosition::new(x, y));
}

pub fn show_panel(app: &AppHandle) {
    if let Some(p) = panel(app) {
        place_panel(app);
        let _ = p.show();
        let _ = p.set_focus();
        let _ = app.emit_to("panel", "panel-shown", ());
    }
}

pub fn show_panel_tab(app: &AppHandle, tab: &str) {
    show_panel(app);
    let _ = app.emit_to("panel", "panel-tab", tab.to_string());
}

pub fn hide_panel(app: &AppHandle) {
    if let Some(p) = panel(app) {
        let _ = p.hide();
    }
}

pub fn toggle_panel(app: &AppHandle) {
    let visible = panel(app).and_then(|w| w.is_visible().ok()).unwrap_or(false);
    if visible {
        hide_panel(app)
    } else {
        show_panel(app)
    }
}

/// Persist the last pet position (throttled by the 1s ticker).
pub fn flush_pet_position(app: &AppHandle) {
    let state = app.state::<AppState>();
    let pending = state.pending_pet_pos.lock().unwrap().take();
    if let Some((x, y)) = pending {
        update_settings(app, |s| s.pet_position = Some(PetPosition { x, y }));
    }
}

/// Feed the pet webview with the global cursor position relative to the pet's
/// centre (logical px) so eyes/head can follow the cursor anywhere on screen.
pub fn spawn_cursor_feed(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = (f64::NAN, f64::NAN);
        loop {
            std::thread::sleep(Duration::from_millis(60));
            let Some(w) = app.get_webview_window("pet") else { continue };
            if !w.is_visible().unwrap_or(false) {
                continue;
            }
            let (Ok(c), Ok(pos), Ok(size), Ok(sf)) = (w.cursor_position(), w.outer_position(), w.outer_size(), w.scale_factor())
            else {
                continue;
            };
            let cx = pos.x as f64 + size.width as f64 / 2.0;
            let cy = pos.y as f64 + size.height as f64 * 0.38; // roughly the head
            let dx = ((c.x - cx) / sf).round();
            let dy = ((c.y - cy) / sf).round();
            if (dx - last.0).abs() >= 2.0 || (dy - last.1).abs() >= 2.0 || last.0.is_nan() {
                last = (dx, dy);
                let _ = app.emit_to("pet", "pet-cursor", serde_json::json!({ "dx": dx, "dy": dy }));
            }
        }
    });
}
