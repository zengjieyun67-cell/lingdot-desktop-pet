//! Pet + panel window management.

use crate::AppState;
use pet_core::model::{AppSettings, PetPosition};
use std::time::Duration;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

pub const PET_W: f64 = 200.0;
pub const PET_H: f64 = 240.0;
pub const PANEL_W: f64 = 420.0;
pub const PANEL_H: f64 = 620.0;

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
    let scale = pet_core::model::clamp_pet_scale(scale);
    if let Some(w) = pet(app) {
        // Keep the pet's feet where they were: grow/shrink around the bottom centre.
        let before = w.outer_position().ok().zip(w.outer_size().ok());
        let _ = w.set_size(LogicalSize::new(PET_W * scale, PET_H * scale));
        if let (Some((pos, old)), Ok(sf)) = (before, w.scale_factor()) {
            let nw = (PET_W * scale * sf).round() as i32;
            let nh = (PET_H * scale * sf).round() as i32;
            let x = pos.x + old.width as i32 / 2 - nw / 2;
            let y = pos.y + old.height as i32 - nh;
            if (nw - old.width as i32).abs() > 1 || (nh - old.height as i32).abs() > 1 {
                let _ = w.set_position(PhysicalPosition::new(x, y));
            }
        }
    }
}

pub fn restore_pet(app: &AppHandle, s: &AppSettings) {
    let Some(w) = pet(app) else { return };
    if s.display_mode == "desktop" {
        // Keep the pet window sized/positioned for when the user switches back.
        let _ = w.set_size(LogicalSize::new(PET_W * s.pet_scale, PET_H * s.pet_scale));
        if let Some(p) = &s.pet_position {
            let _ = w.set_position(PhysicalPosition::new(p.x, p.y));
        }
        let _ = w.hide();
        apply_display_mode(app, s);
        return;
    }
    let _ = w.set_size(LogicalSize::new(PET_W * s.pet_scale, PET_H * s.pet_scale));
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
    let desktop_mode = current_mode(app) == "desktop";
    let target = if desktop_mode { app.get_webview_window(DESKTOP_LABEL) } else { pet(app) };
    if let Some(w) = target {
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
    let target = if current_mode(app) == "desktop" { app.get_webview_window(DESKTOP_LABEL) } else { pet(app) };
    let visible = target.and_then(|w| w.is_visible().ok()).unwrap_or(false);
    set_pet_visible(app, !visible);
}

/// Position the panel: where the user last dragged it (if still on a screen),
/// otherwise beside the pet (left if the pet is on the right half).
fn place_panel(app: &AppHandle) {
    let (Some(p), Some(pw)) = (panel(app), pet(app)) else { return };
    *app.state::<AppState>().panel_placed_at.lock().unwrap() = Some(std::time::Instant::now());
    let saved = app.state::<AppState>().engine.db().get_settings().ok().and_then(|s| s.panel_position);
    if let Some(sp) = saved {
        if position_on_some_monitor(&p, sp.x, sp.y) {
            let _ = p.set_size(LogicalSize::new(PANEL_W, PANEL_H));
            let _ = p.set_position(PhysicalPosition::new(sp.x, sp.y));
            return;
        }
    }
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

/// Persist the panel position after the user dragged it (throttled by the 1s ticker).
pub fn flush_panel_position(app: &AppHandle) {
    let state = app.state::<AppState>();
    let pending = state.pending_panel_pos.lock().unwrap().take();
    if let Some((x, y)) = pending {
        update_settings(app, |s| s.panel_position = Some(PetPosition { x, y }));
    }
}

/// Forget the dragged panel position: it goes back to following the pet.
pub fn reset_panel_position(app: &AppHandle) {
    app.state::<AppState>().pending_panel_pos.lock().unwrap().take();
    update_settings(app, |s| s.panel_position = None);
    let visible = panel(app).and_then(|w| w.is_visible().ok()).unwrap_or(false);
    if visible {
        place_panel(app);
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

// ------------------------------------------------------------ 桌面模式 / 桌宠模式

pub const DESKTOP_LABEL: &str = "desktop";

fn current_mode(app: &AppHandle) -> String {
    app.state::<AppState>().engine.db().get_settings().map(|s| s.display_mode).unwrap_or_else(|_| "pet".into())
}

/// Switch between 桌宠模式 (small floating pet) and 桌面模式 (full-screen scene at
/// desktop level on the pet's current screen). Called on startup and on settings change.
pub fn apply_display_mode(app: &AppHandle, s: &AppSettings) {
    if s.display_mode == "desktop" {
        // the pet window is hidden once the scene is on screen (place_and_show_desktop)
        show_desktop(app, s);
    } else {
        // Keep the scene's webview alive (hidden): re-creating a full-screen WebView2 / WKWebView,
        // re-decoding the sea photos and re-loading Live2D took seconds on every switch.
        // A hidden page pauses its animation loops (visibilitychange).
        if let Some(d) = app.get_webview_window(DESKTOP_LABEL) {
            let _ = d.hide();
        }
        if let Some(w) = pet(app) {
            if s.pet_visible {
                let _ = w.show();
            }
        }
    }
    crate::update_tray_mode(app, &s.display_mode);
}

fn show_desktop(app: &AppHandle, s: &AppSettings) {
    // Fast path: the scene already exists (it is only hidden in 桌宠模式) — just place + show it.
    if let Some(w) = app.get_webview_window(DESKTOP_LABEL) {
        place_and_show_desktop(app, &w, s);
        return;
    }
    // Creating a webview window from the main thread (sync commands, tray / shortcut handlers)
    // blocks — and on Windows can deadlock — the event loop until WebView2 is up, freezing every
    // window. Build it on a worker thread instead (Tauri marshals the native part itself).
    let app = app.clone();
    let s = s.clone();
    spawn_window_job(move || {
        if app.get_webview_window(DESKTOP_LABEL).is_some() {
            return;
        }
        if let Some(w) = build_desktop(&app) {
            // the user may have switched back to 桌宠模式 while WebView2 was starting
            if current_mode(&app) == "desktop" {
                place_and_show_desktop(&app, &w, &s);
            }
        }
    });
}

/// Run window-creating work off the main thread (see `show_desktop`).
pub fn spawn_window_job(f: impl FnOnce() + Send + 'static) {
    std::thread::Builder::new().name("lingdot-window".into()).spawn(f).map(|_| ()).unwrap_or_else(|e| eprintln!("window job: {e}"));
}

fn build_desktop(app: &AppHandle) -> Option<WebviewWindow> {
    tauri::WebviewWindowBuilder::new(app, DESKTOP_LABEL, tauri::WebviewUrl::App("index.html#/desktop".into()))
        .title("小喵的桌面")
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .focused(false)
        .visible(false)
        .always_on_bottom(true)
        .accept_first_mouse(true)
        .build()
        .ok()
}

fn place_and_show_desktop(app: &AppHandle, win: &WebviewWindow, s: &AppSettings) {
    // The screen the pet is on (or the primary one).
    let anchor = pet(app);
    let monitor = anchor
        .as_ref()
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| anchor.as_ref().and_then(|w| w.primary_monitor().ok().flatten()));
    let (pos, size) = match &monitor {
        Some(m) => (*m.position(), *m.size()),
        None => (PhysicalPosition::new(0, 0), tauri::PhysicalSize::new(1440, 900)),
    };
    let _ = win.set_position(pos);
    let _ = win.set_size(size);
    set_desktop_level(app, win, s.desktop_interactive);
    if s.pet_visible {
        let _ = win.show();
    }
    if let Some(w) = pet(app) {
        let _ = w.hide();
    }
}

/// macOS: put the window just above the wallpaper (kCGDesktopWindowLevel + 1), or just
/// above the desktop icons when `interactive` (Finder's icon layer would otherwise take
/// the clicks), visible on every Space, not part of Exposé / ⌘` cycling.
#[cfg(target_os = "macos")]
fn set_desktop_level(app: &AppHandle, win: &WebviewWindow, interactive: bool) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowLevelForKey(key: i32) -> i32;
    }
    const K_CG_DESKTOP_WINDOW_LEVEL_KEY: i32 = 2;
    const K_CG_DESKTOP_ICON_WINDOW_LEVEL_KEY: i32 = 18;
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const STATIONARY: usize = 1 << 4;
    const IGNORES_CYCLE: usize = 1 << 6;
    let w = win;
    // Raw pointers are !Send: carry the address as usize into the main-thread closure.
    let Ok(raw) = w.ns_window() else { return };
    let addr = raw as usize;
    let _ = app.run_on_main_thread(move || {
        let ptr = addr as *mut std::ffi::c_void;
        if ptr.is_null() {
            return;
        }
        let key = if interactive { K_CG_DESKTOP_ICON_WINDOW_LEVEL_KEY } else { K_CG_DESKTOP_WINDOW_LEVEL_KEY };
        let level = unsafe { CGWindowLevelForKey(key) } as isize + 1;
        let behaviour: usize = CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE;
        // SAFETY: `ptr` is the live NSWindow of this webview window, used on the main thread.
        unsafe {
            let obj: &AnyObject = &*(ptr as *const AnyObject);
            let _: () = msg_send![obj, setLevel: level];
            let _: () = msg_send![obj, setCollectionBehavior: behaviour];
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn set_desktop_level(_app: &AppHandle, win: &WebviewWindow, _interactive: bool) {
    // Elsewhere: best effort via the cross-platform "always on bottom".
    let _ = win.set_always_on_bottom(true);
}

// ------------------------------------------------------------ 屏保模式

pub const SCREENSAVER_LABEL: &str = "screensaver";

/// Full-screen, top-most scene (`#/screensaver`) on the screen the pet / desktop scene is on.
/// Look only: the page calls `exit_screensaver` on the first mouse move / key press.
pub fn show_screensaver(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SCREENSAVER_LABEL) {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let anchor = app.get_webview_window(DESKTOP_LABEL).filter(|w| w.is_visible().unwrap_or(false)).or_else(|| pet(app));
    let monitor = anchor
        .as_ref()
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| anchor.as_ref().and_then(|w| w.primary_monitor().ok().flatten()));
    let (pos, size) = match &monitor {
        Some(m) => (*m.position(), *m.size()),
        None => (PhysicalPosition::new(0, 0), tauri::PhysicalSize::new(1440, 900)),
    };
    hide_panel(app);
    let app = app.clone();
    spawn_window_job(move || build_screensaver(&app, pos, size));
}

fn build_screensaver(app: &AppHandle, pos: PhysicalPosition<i32>, size: tauri::PhysicalSize<u32>) {
    if app.get_webview_window(SCREENSAVER_LABEL).is_some() {
        return;
    }
    let built = tauri::WebviewWindowBuilder::new(app, SCREENSAVER_LABEL, tauri::WebviewUrl::App("index.html#/screensaver".into()))
        .title("lingdot 屏保")
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .always_on_top(true)
        .visible(false)
        .focused(true)
        .accept_first_mouse(true)
        .build();
    let Ok(win) = built else { return };
    let _ = win.set_position(pos);
    let _ = win.set_size(size);
    set_screensaver_level(app, &win);
    let _ = win.show();
    let _ = win.set_focus();
    let _ = win.set_cursor_visible(false);
}

pub fn exit_screensaver(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SCREENSAVER_LABEL) {
        let _ = w.set_cursor_visible(true);
        let _ = w.destroy();
    }
}

pub fn screensaver_open(app: &AppHandle) -> bool {
    app.get_webview_window(SCREENSAVER_LABEL).is_some()
}

/// macOS: above the menu bar and Dock (NSScreenSaverWindowLevel = 1000), on every Space.
#[cfg(target_os = "macos")]
fn set_screensaver_level(app: &AppHandle, win: &WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    const NS_SCREEN_SAVER_WINDOW_LEVEL: isize = 1000;
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const STATIONARY: usize = 1 << 4;
    const IGNORES_CYCLE: usize = 1 << 6;
    let Ok(raw) = win.ns_window() else { return };
    let addr = raw as usize;
    let _ = app.run_on_main_thread(move || {
        let ptr = addr as *mut std::ffi::c_void;
        if ptr.is_null() {
            return;
        }
        let behaviour: usize = CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE;
        // SAFETY: `ptr` is the live NSWindow of this webview window, used on the main thread.
        unsafe {
            let obj: &AnyObject = &*(ptr as *const AnyObject);
            let _: () = msg_send![obj, setLevel: NS_SCREEN_SAVER_WINDOW_LEVEL];
            let _: () = msg_send![obj, setCollectionBehavior: behaviour];
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn set_screensaver_level(_app: &AppHandle, win: &WebviewWindow) {
    let _ = win.set_fullscreen(true);
}
