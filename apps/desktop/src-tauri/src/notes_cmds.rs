//! 便签: IPC commands, floating note windows (`#/note/<id>`), geometry persistence
//! and reminders (pet bubble + macOS notification).

use crate::AppState;
use pet_core::model::{now_ms, NotificationRecord};
use pet_core::notes::{clamp_note_size, parse_note_command, Note, NoteInput, NotePatch};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow};

type CmdResult<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

pub const NOTE_PREFIX: &str = "note-";

pub fn note_label(id: &str) -> String {
    format!("{NOTE_PREFIX}{id}")
}

fn changed(app: &AppHandle) {
    let _ = app.emit("notes-changed", ());
}

/// Seconds east of UTC for the Mac's current zone (used by voice 「记一下」; chat passes its own).
pub fn local_tz_offset_secs() -> i64 {
    #[cfg(unix)]
    {
        if let Some(out) = crate::sys::run_with_timeout("/bin/date", &["+%z"], std::time::Duration::from_secs(2)) {
            let t = out.trim();
            if t.len() == 5 {
                let sign = if t.starts_with('-') { -1 } else { 1 };
                let h: i64 = t[1..3].parse().unwrap_or(0);
                let m: i64 = t[3..5].parse().unwrap_or(0);
                return sign * (h * 3600 + m * 60);
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(out) = crate::sys::run_with_timeout(
            "powershell.exe",
            &["-NoProfile", "-NonInteractive", "-Command", "[int][System.TimeZoneInfo]::Local.GetUtcOffset([DateTime]::Now).TotalSeconds"],
            std::time::Duration::from_secs(4),
        ) {
            if let Ok(v) = out.trim().parse::<i64>() {
                return v;
            }
        }
    }
    0
}

// ------------------------------------------------------------------ commands

#[tauri::command]
pub fn list_notes(state: State<'_, AppState>) -> CmdResult<Vec<Note>> {
    state.engine.db().list_notes().map_err(e)
}

#[tauri::command]
pub fn create_note(app: AppHandle, state: State<'_, AppState>, input: NoteInput, pop_out: Option<bool>) -> CmdResult<Note> {
    let n = state.engine.db().create_note(&input).map_err(e)?;
    changed(&app);
    if pop_out.unwrap_or(false) {
        open_note_window(&app, &n.id);
    }
    Ok(n)
}

#[tauri::command]
pub fn update_note(app: AppHandle, state: State<'_, AppState>, id: String, patch: NotePatch) -> CmdResult<Note> {
    let n = state.engine.db().update_note(&id, &patch).map_err(e)?;
    if patch.pinned.is_some() {
        if let Some(w) = app.get_webview_window(&note_label(&id)) {
            let _ = w.set_always_on_top(n.pinned);
        }
    }
    changed(&app);
    Ok(n)
}

#[tauri::command]
pub fn delete_note(app: AppHandle, state: State<'_, AppState>, id: String) -> CmdResult<Note> {
    let n = state.engine.db().delete_note(&id).map_err(e)?;
    if let Some(w) = app.get_webview_window(&note_label(&id)) {
        let _ = w.destroy();
    }
    changed(&app);
    Ok(n)
}

#[tauri::command]
pub fn restore_note(app: AppHandle, state: State<'_, AppState>, note: Note) -> CmdResult<Note> {
    let n = state.engine.db().restore_note(&note).map_err(e)?;
    changed(&app);
    Ok(n)
}

#[tauri::command]
pub fn pop_out_note(app: AppHandle, id: String) -> CmdResult<()> {
    app.state::<AppState>().engine.db().get_note(&id).map_err(e)?;
    open_note_window(&app, &id);
    Ok(())
}

#[tauri::command]
pub fn close_note_window(app: AppHandle, id: String) -> CmdResult<()> {
    let _ = app.state::<AppState>().engine.db().set_note_popped(&id, false);
    if let Some(w) = app.get_webview_window(&note_label(&id)) {
        let _ = w.destroy();
    }
    changed(&app);
    Ok(())
}

/// 「记一下…」 from the typed chat: returns the created note, or null when the text is not a note request.
#[tauri::command]
pub fn note_from_text(app: AppHandle, state: State<'_, AppState>, text: String, tz_offset_min: Option<i64>) -> CmdResult<Option<Note>> {
    let tz = tz_offset_min.map(|m| m * 60).unwrap_or_else(local_tz_offset_secs);
    let Some(cmd) = parse_note_command(&text, now_ms(), tz) else { return Ok(None) };
    let n = state
        .engine
        .db()
        .create_note(&NoteInput { content: cmd.content, remind_at: cmd.remind_at, ..Default::default() })
        .map_err(e)?;
    changed(&app);
    Ok(Some(n))
}

/// Tray 「新建便签」 / ⌘⇧N / radial 「便签」: a fresh note, straight into its own window.
pub fn new_quick_note(app: &AppHandle) {
    let n = app.state::<AppState>().engine.db().create_note(&NoteInput::default());
    if let Ok(n) = n {
        changed(app);
        open_note_window(app, &n.id);
    }
}

#[tauri::command]
pub fn new_quick_note_cmd(app: AppHandle) {
    new_quick_note(&app);
}

// ------------------------------------------------------------------ windows

/// Show (or create) the borderless frosted-glass window for one note.
pub fn open_note_window(app: &AppHandle, id: &str) {
    let label = note_label(id);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let Ok(n) = app.state::<AppState>().engine.db().get_note(id) else { return };
    let (w, h) = clamp_note_size(n.w, n.h);
    let effects = tauri::window::EffectsBuilder::new()
        .effect(tauri::window::Effect::Popover) // macOS vibrancy
        .effect(tauri::window::Effect::Acrylic) // Windows 10/11 (each OS picks the first effect it supports)
        .state(tauri::window::EffectState::Active)
        .radius(16.0)
        .build();
    let built = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App(format!("index.html#/note/{id}").into()))
        .title("便签")
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .resizable(true)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .always_on_top(n.pinned)
        .visible(false)
        .accept_first_mouse(true)
        .inner_size(w as f64, h as f64)
        .min_inner_size(pet_core::notes::NOTE_MIN_W as f64, pet_core::notes::NOTE_MIN_H as f64)
        .effects(effects)
        .build();
    let Ok(win) = built else { return };
    match (n.x, n.y) {
        (Some(x), Some(y)) if on_screen(&win, x as i32, y as i32) => {
            let _ = win.set_position(PhysicalPosition::new(x as i32, y as i32));
        }
        _ => place_new(app, &win),
    }
    let _ = win.show();
    let _ = win.set_focus();
    let _ = app.state::<AppState>().engine.db().set_note_popped(id, true);
    changed(app);
}

fn on_screen(w: &WebviewWindow, x: i32, y: i32) -> bool {
    match w.available_monitors() {
        Ok(ms) if !ms.is_empty() => ms.iter().any(|m| {
            let p = m.position();
            let s = m.size();
            x >= p.x - 40 && y >= p.y - 10 && x < p.x + s.width as i32 - 40 && y < p.y + s.height as i32 - 40
        }),
        _ => true,
    }
}

/// New notes cascade from the top-right corner of the pet's screen.
fn place_new(app: &AppHandle, win: &WebviewWindow) {
    let anchor = app.get_webview_window("pet");
    let monitor = anchor
        .as_ref()
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| win.primary_monitor().ok().flatten());
    let Some(m) = monitor else { return };
    let sf = m.scale_factor();
    let open = app.webview_windows().keys().filter(|l| l.starts_with(NOTE_PREFIX)).count() as i32;
    let size = win.outer_size().unwrap_or_default();
    let step = (28.0 * sf) as i32 * (open - 1).clamp(0, 8);
    let x = m.position().x + m.size().width as i32 - size.width as i32 - (60.0 * sf) as i32 - step;
    let y = m.position().y + (80.0 * sf) as i32 + step;
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

/// Reopen the notes that were floating when the app last quit.
pub fn restore_popped(app: &AppHandle) {
    let notes = app.state::<AppState>().engine.db().list_notes().unwrap_or_default();
    for n in notes.iter().filter(|n| n.popped) {
        open_note_window(app, &n.id);
    }
}

/// Window moved / resized (from `on_window_event`): remember it, flushed by the 1s ticker.
pub fn note_geometry_event(win: &tauri::Window, pos: Option<(i32, i32)>, size: Option<(u32, u32)>) {
    let Some(id) = win.label().strip_prefix(NOTE_PREFIX).map(String::from) else { return };
    let state = win.state::<AppState>();
    let mut map = state.pending_note_geom.lock().unwrap();
    let entry = map.entry(id).or_insert((None, None));
    if let Some((x, y)) = pos {
        entry.0 = Some((x as i64, y as i64));
    }
    if let Some((w, h)) = size {
        let sf = win.scale_factor().unwrap_or(1.0);
        entry.1 = Some(((w as f64 / sf).round() as i64, (h as f64 / sf).round() as i64));
    }
}

pub fn flush_note_geometry(app: &AppHandle) {
    let state = app.state::<AppState>();
    let pending: Vec<_> = state.pending_note_geom.lock().unwrap().drain().collect();
    if pending.is_empty() {
        return;
    }
    let db = state.engine.db();
    for (id, (pos, size)) in pending {
        let _ = db.set_note_geometry(&id, pos, size);
    }
}

/// The user closed a note window with ⌘W: it is no longer floating.
pub fn note_window_closed(win: &tauri::Window) {
    if let Some(id) = win.label().strip_prefix(NOTE_PREFIX) {
        let _ = win.state::<AppState>().engine.db().set_note_popped(id, false);
        let _ = win.app_handle().emit("notes-changed", ());
    }
}

// ------------------------------------------------------------------ reminders

pub fn first_line(content: &str) -> String {
    let line = content
        .lines()
        .map(|l| l.trim().trim_start_matches("- [ ]").trim_start_matches("- [x]").trim_start_matches('#').trim())
        .find(|l| !l.is_empty())
        .unwrap_or("便签");
    let mut s: String = line.chars().take(40).collect();
    if line.chars().count() > 40 {
        s.push('…');
    }
    s
}

/// Called from the housekeeping ticker: fire due reminders once each.
pub fn check_reminders(app: &AppHandle) {
    let state = app.state::<AppState>();
    let due = match state.engine.db().take_due_reminders(now_ms()) {
        Ok(d) if !d.is_empty() => d,
        _ => return,
    };
    let settings = state.engine.db().get_settings().unwrap_or_default();
    for n in due {
        let _ = app.emit("note-reminder", &n);
        if settings.notifications_enabled {
            let rec = NotificationRecord {
                id: format!("note:{}", n.id),
                task_id: None,
                kind: "note_reminder".into(),
                title: format!("{}：便签提醒", settings.pet_name),
                body: first_line(&n.content),
                url: None,
                created_at: now_ms(),
                read: false,
            };
            crate::effects::show_os_notification(app, &rec, settings.sound_enabled);
        }
    }
    changed(app);
}
