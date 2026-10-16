//! Polls what the user is doing (every ~4 s, cheap command-line probes, macOS only):
//! music playback (pmset audio assertions → app; track via AppleScript for Music/Spotify,
//! window title for QQ音乐) and HID idle time (打盹 / 伸懒腰).
//!
//! Emits `pet-activity` (ActivitySnapshot, on change) and `pet-activity-event`
//! (ActivityEvent: music_started / track_changed / music_stopped / nap_started / woke).

use crate::AppState;
use pet_core::activity::{ActivitySnapshot, ActivityTracker, MusicInfo, TrackerConfig};
use pet_core::model::now_ms;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

pub const POLL: Duration = Duration::from_secs(4);

#[derive(Default)]
pub struct ActivityState {
    pub snapshot: Mutex<ActivitySnapshot>,
}

#[tauri::command]
pub fn get_activity(st: State<'_, ActivityState>) -> ActivitySnapshot {
    st.snapshot.lock().unwrap().clone()
}

pub fn spawn(app: AppHandle) {
    std::thread::Builder::new()
        .name("activity".into())
        .spawn(move || {
            let mut tracker = ActivityTracker::new(TrackerConfig::default());
            let mut probe = Probe::default();
            // Auto 屏保: fire once when idle crosses the threshold, re-arm after activity.
            let mut saver_armed = true;
            loop {
                std::thread::sleep(POLL);
                let s = app.state::<AppState>().engine.db().get_settings().unwrap_or_default();
                let music = if s.music_detection { probe.music(s.music_include_browsers) } else { None };
                let raw_idle = if s.idle_states || s.screensaver_idle_mins > 0 { probe.idle_secs() } else { Some(0) };
                let idle = if s.idle_states { raw_idle } else { Some(0) };
                if s.screensaver_idle_mins > 0 {
                    let secs = raw_idle.unwrap_or(0);
                    if secs >= u64::from(s.screensaver_idle_mins) * 60 {
                        if saver_armed && !crate::windows::screensaver_open(&app) {
                            crate::windows::show_screensaver(&app);
                        }
                        saver_armed = false;
                    } else {
                        saver_armed = true;
                    }
                }
                let (snap, events) = tracker.update(now_ms(), idle, music);
                let changed = {
                    let st = app.state::<ActivityState>();
                    let mut cur = st.snapshot.lock().unwrap();
                    // idle seconds tick every poll; only kind / music changes are news
                    let changed = cur.kind != snap.kind || cur.music != snap.music;
                    *cur = snap.clone();
                    changed
                };
                if changed {
                    let _ = app.emit("pet-activity", &snap);
                }
                for ev in events {
                    let _ = app.emit("pet-activity-event", &ev);
                }
            }
        })
        .ok();
}

#[derive(Default)]
struct Probe {
    /// (app id, title, when fetched) — titles are re-read at most every ~8 s.
    title_cache: Option<(String, Option<(String, Option<String>)>, i64)>,
}

impl Probe {
    #[cfg(target_os = "macos")]
    fn music(&mut self, include_browsers: bool) -> Option<MusicInfo> {
        use crate::sys::run_with_timeout;
        use pet_core::activity::*;
        let t = Duration::from_secs(3);
        let out = run_with_timeout("/usr/bin/pmset", &["-g", "assertions"], t)?;
        let pids = audio_playing_pids(&parse_pmset_assertions(&out), Some(std::process::id()));
        if pids.is_empty() {
            return None;
        }
        let list = pids.iter().map(|p| p.to_string()).collect::<Vec<_>>().join(",");
        let ps = run_with_timeout("/bin/ps", &["-o", "pid=,comm=", "-p", &list], t)?;
        let app = pick_media_app(&pids, &parse_ps_comm(&ps), include_browsers)?;
        let now = now_ms();
        let fresh = matches!(&self.title_cache, Some((id, _, at)) if id == app.id && now - at < 8_000);
        if !fresh {
            let track = match app.id {
                // AppleScript only for apps that are running AND playing (never launches them).
                "music" => run_with_timeout("/usr/bin/osascript", &["-e", &track_script("Music")], t).and_then(|o| parse_track_output(&o)),
                "spotify" => run_with_timeout("/usr/bin/osascript", &["-e", &track_script("Spotify")], t).and_then(|o| parse_track_output(&o)),
                "qqmusic" | "netease" | "kugou" | "kuwo" => {
                    let owners: &[&str] = match app.id {
                        "qqmusic" => &["QQ音乐", "QQMusic"],
                        "netease" => &["网易云音乐", "NeteaseMusic"],
                        "kugou" => &["酷狗音乐", "KugouMusic"],
                        _ => &["酷我音乐", "KuwoMusic"],
                    };
                    run_with_timeout("/usr/bin/osascript", &["-l", "JavaScript", "-e", WINDOW_TITLES_JXA], t)
                        .and_then(|o| parse_window_titles(&o, owners))
                        .map(|title| (title, None))
                }
                _ => None,
            };
            self.title_cache = Some((app.id.to_string(), track, now));
        }
        let track = self.title_cache.as_ref().and_then(|(_, t, _)| t.clone());
        Some(MusicInfo {
            app_id: app.id.to_string(),
            app: app.display,
            title: track.as_ref().map(|t| t.0.clone()),
            artist: track.and_then(|t| t.1),
        })
    }

    #[cfg(not(target_os = "macos"))]
    fn music(&mut self, _include_browsers: bool) -> Option<MusicInfo> {
        let _ = &self.title_cache;
        None
    }

    #[cfg(target_os = "macos")]
    fn idle_secs(&mut self) -> Option<u64> {
        let out = crate::sys::run_with_timeout("/usr/sbin/ioreg", &["-r", "-c", "IOHIDSystem", "-d", "1"], Duration::from_secs(3))?;
        pet_core::activity::parse_hid_idle_secs(&out)
    }

    #[cfg(not(target_os = "macos"))]
    fn idle_secs(&mut self) -> Option<u64> {
        None
    }
}
