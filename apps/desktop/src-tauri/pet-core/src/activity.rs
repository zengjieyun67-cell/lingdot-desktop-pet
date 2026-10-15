//! What the user is doing right now (pure logic; the macOS probes live in the Tauri crate).
//!
//! - Music: parse `pmset -g assertions` (audio-out power assertions name the process
//!   that plays sound — works on recent macOS where MediaRemote is restricted), map PIDs
//!   to apps via `ps`, optionally read the track from AppleScript (Music / Spotify) or a
//!   window title (QQ音乐 via CGWindowList, only visible with Screen Recording permission).
//! - Idle: `ioreg` HIDIdleTime (nanoseconds since the last keyboard / mouse input).
//! - `ActivityTracker` turns these samples into a debounced activity + one-shot events.
//! - `resolve_display_state` merges the task mood with the activity by priority:
//!   needs_attention > completed > working > listening_music > stretching > napping > idle.

use crate::model::PetMood;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ------------------------------------------------------------------ pmset

/// One power assertion from `pmset -g assertions` ("Listed by owning process").
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Assertion {
    pub owner_pid: u32,
    pub owner_name: String,
    pub kind: String,
    pub name: String,
    /// "Created for PID: N." (coreaudiod creates audio assertions on behalf of apps)
    pub created_for_pid: Option<u32>,
    /// "Resources: audio-out BuiltInSpeakerDevice"
    pub resources: Vec<String>,
}

fn parse_owner_line(line: &str) -> Option<Assertion> {
    // "pid 377(coreaudiod): [0x0001234500019abc] 00:12:34 PreventUserIdleSystemSleep named: \"…\""
    let rest = line.trim_start().strip_prefix("pid ")?;
    let open = rest.find('(')?;
    let pid: u32 = rest[..open].trim().parse().ok()?;
    let close = rest.find("):")?;
    if close < open {
        return None;
    }
    let owner = rest[open + 1..close].to_string();
    let after = rest[close + 2..].trim_start();
    // skip "[0x…]" and the "hh:mm:ss" age
    let after = match after.strip_prefix('[') {
        Some(a) => a.split_once(']').map(|(_, r)| r.trim_start()).unwrap_or(a),
        None => after,
    };
    let mut parts = after.splitn(2, ' ');
    let first = parts.next().unwrap_or("");
    let after = if first.len() == 8 && first.chars().filter(|c| *c == ':').count() == 2 {
        parts.next().unwrap_or("").trim_start()
    } else {
        after
    };
    let (kind, name) = match after.split_once(" named: ") {
        Some((k, n)) => (k.trim().to_string(), n.trim().trim_matches('"').to_string()),
        None => (after.split_whitespace().next().unwrap_or("").to_string(), String::new()),
    };
    Some(Assertion { owner_pid: pid, owner_name: owner, kind, name, created_for_pid: None, resources: vec![] })
}

/// Parse the per-process assertion list of `pmset -g assertions`.
pub fn parse_pmset_assertions(output: &str) -> Vec<Assertion> {
    let mut out: Vec<Assertion> = Vec::new();
    let mut in_list = false;
    for line in output.lines() {
        let t = line.trim();
        if t.starts_with("Listed by owning process") {
            in_list = true;
            continue;
        }
        if t.starts_with("Kernel Assertions") || t.starts_with("Idle sleep preventers") {
            in_list = false;
            continue;
        }
        if !in_list {
            continue;
        }
        if t.starts_with("pid ") {
            if let Some(a) = parse_owner_line(t) {
                out.push(a);
            }
            continue;
        }
        let Some(cur) = out.last_mut() else { continue };
        if let Some(v) = t.strip_prefix("Created for PID:") {
            cur.created_for_pid = v.trim().trim_end_matches('.').trim().parse().ok();
        } else if let Some(v) = t.strip_prefix("Resources:") {
            cur.resources = v.split_whitespace().map(String::from).collect();
        }
    }
    out
}

/// PIDs that are currently playing audio (output, not microphone capture).
pub fn audio_playing_pids(assertions: &[Assertion], exclude_pid: Option<u32>) -> Vec<u32> {
    let mut pids: Vec<u32> = Vec::new();
    for a in assertions {
        let has_out = a.resources.iter().any(|r| r.eq_ignore_ascii_case("audio-out"));
        let only_in = !a.resources.is_empty() && !has_out;
        if only_in {
            continue; // microphone capture (e.g. our own speech recognition)
        }
        let audio_name = a.name.to_ascii_lowercase().contains("audio");
        let pid = if a.owner_name == "coreaudiod" {
            if !(has_out || (a.resources.is_empty() && audio_name)) {
                continue;
            }
            match a.created_for_pid {
                Some(p) => p,
                None => continue,
            }
        } else if has_out || (audio_name && a.kind.contains("Sleep")) {
            a.owner_pid
        } else {
            continue;
        };
        if Some(pid) != exclude_pid && !pids.contains(&pid) {
            pids.push(pid);
        }
    }
    pids
}

/// Parse `ps -o pid=,comm= -p 1,2,3` → pid → executable path.
pub fn parse_ps_comm(output: &str) -> HashMap<u32, String> {
    let mut m = HashMap::new();
    for line in output.lines() {
        let t = line.trim();
        let Some((pid, comm)) = t.split_once(char::is_whitespace) else { continue };
        if let Ok(p) = pid.parse::<u32>() {
            m.insert(p, comm.trim().to_string());
        }
    }
    m
}

/// Outermost `.app` bundle name of an executable path ("…/Google Chrome.app/…/Helper" → "Google Chrome").
pub fn app_name_from_path(path: &str) -> String {
    for comp in path.split('/') {
        if let Some(n) = comp.strip_suffix(".app") {
            if !n.is_empty() {
                return n.to_string();
            }
        }
    }
    if path.contains("com.apple.WebKit.GPU") || path.contains("com.apple.WebKit.WebContent") {
        return "Safari".into();
    }
    path.rsplit('/').next().unwrap_or(path).to_string()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaApp {
    /// stable id: qqmusic | music | spotify | netease | kugou | kuwo | browser
    pub id: &'static str,
    /// display name for bubbles (中文 where the app is Chinese)
    pub display: String,
    pub is_browser: bool,
}

/// Which known media app (if any) an app bundle name is.
pub fn classify_app(app: &str) -> Option<MediaApp> {
    let a = app.trim();
    let lower = a.to_ascii_lowercase();
    let m = |id: &'static str, display: &str| Some(MediaApp { id, display: display.into(), is_browser: false });
    match lower.as_str() {
        "qqmusic" | "qq音乐" => return m("qqmusic", "QQ音乐"),
        "music" | "itunes" | "音乐" => return m("music", "音乐"),
        "spotify" => return m("spotify", "Spotify"),
        "neteasemusic" | "网易云音乐" => return m("netease", "网易云音乐"),
        "kugoumusic" | "kugou" | "酷狗音乐" => return m("kugou", "酷狗音乐"),
        "kuwomusic" | "酷我音乐" => return m("kuwo", "酷我音乐"),
        _ => {}
    }
    const BROWSERS: [&str; 9] = ["google chrome", "safari", "microsoft edge", "arc", "firefox", "brave browser", "opera", "vivaldi", "chromium"];
    if BROWSERS.iter().any(|b| lower == *b || lower.starts_with(&format!("{b} "))) {
        return Some(MediaApp { id: "browser", display: a.to_string(), is_browser: true });
    }
    None
}

/// Pick the media app to report from the playing PIDs (music apps beat browsers).
pub fn pick_media_app(pids: &[u32], comm: &HashMap<u32, String>, include_browsers: bool) -> Option<MediaApp> {
    let apps: Vec<MediaApp> = pids
        .iter()
        .filter_map(|p| comm.get(p))
        .filter_map(|path| classify_app(&app_name_from_path(path)))
        .collect();
    apps.iter()
        .find(|a| !a.is_browser)
        .cloned()
        .or_else(|| if include_browsers { apps.into_iter().find(|a| a.is_browser) } else { None })
}

// ------------------------------------------------------------- track info

/// AppleScript for Music.app / Spotify that never launches the app and prints
/// `playing<TAB>title<TAB>artist` or `stopped`.
pub fn track_script(app_name: &str) -> String {
    format!(
        "if application \"{app_name}\" is running then\n\
         tell application \"{app_name}\"\n\
         if player state is playing then\n\
         return \"playing\" & tab & (name of current track) & tab & (artist of current track)\n\
         end if\n\
         end tell\n\
         end if\n\
         return \"stopped\""
    )
}

/// Parse the output of [`track_script`] → (title, artist).
pub fn parse_track_output(output: &str) -> Option<(String, Option<String>)> {
    let line = output.trim();
    let rest = line.strip_prefix("playing\t")?;
    let mut it = rest.splitn(2, '\t');
    let title = it.next().unwrap_or("").trim().to_string();
    if title.is_empty() || title == "missing value" {
        return None;
    }
    let artist = it.next().map(|s| s.trim().to_string()).filter(|s| !s.is_empty() && s != "missing value");
    Some((title, artist))
}

/// JXA that lists window owner + title (titles of other apps are only visible with
/// Screen Recording permission; without it the list is simply empty — no prompt).
pub const WINDOW_TITLES_JXA: &str = "ObjC.import('CoreGraphics');\
var a = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0, 0))) || [];\
var out = [];\
for (var i = 0; i < a.length; i++) { var w = a[i]; if (w.kCGWindowName && w.kCGWindowOwnerName) out.push(w.kCGWindowOwnerName + '\\t' + w.kCGWindowName); }\
out.join('\\n');";

/// Pick a song title from `owner<TAB>title` lines for one of `owners` (e.g. QQ音乐).
/// Generic titles (the app name itself, 桌面歌词, empty) are ignored; "歌名 - 歌手" wins.
pub fn parse_window_titles(output: &str, owners: &[&str]) -> Option<String> {
    let generic = |t: &str| {
        let l = t.to_ascii_lowercase();
        t.is_empty() || owners.iter().any(|o| l == o.to_ascii_lowercase()) || t.contains("桌面歌词") || l == "qq音乐" || l == "qqmusic"
    };
    let mut best: Option<String> = None;
    for line in output.lines() {
        let Some((owner, title)) = line.split_once('\t') else { continue };
        if !owners.iter().any(|o| owner.trim().eq_ignore_ascii_case(o)) {
            continue;
        }
        let title = title.trim();
        if generic(title) {
            continue;
        }
        if title.contains(" - ") || title.contains(" — ") {
            return Some(title.chars().take(60).collect());
        }
        if best.is_none() {
            best = Some(title.chars().take(60).collect());
        }
    }
    best
}

// --------------------------------------------------------------------- idle

/// Seconds since the last HID input, from `ioreg -c IOHIDSystem` (`"HIDIdleTime" = <ns>`).
pub fn parse_hid_idle_secs(output: &str) -> Option<u64> {
    for line in output.lines() {
        if let Some(idx) = line.find("\"HIDIdleTime\"") {
            let rest = &line[idx + "\"HIDIdleTime\"".len()..];
            let num: String = rest.chars().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(ns) = num.parse::<u64>() {
                return Some(ns / 1_000_000_000);
            }
        }
    }
    None
}

// ---------------------------------------------------------------- tracker

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicInfo {
    pub app_id: String,
    pub app: String,
    pub title: Option<String>,
    pub artist: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    #[default]
    None,
    ListeningMusic,
    Stretching,
    Napping,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySnapshot {
    pub kind: ActivityKind,
    pub music: Option<MusicInfo>,
    pub idle_secs: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ActivityEvent {
    MusicStarted { app: String, title: Option<String> },
    TrackChanged { app: String, title: Option<String> },
    MusicStopped,
    NapStarted,
    Woke,
}

#[derive(Debug, Clone)]
pub struct TrackerConfig {
    /// Idle time before 小喵 dozes off.
    pub nap_after_secs: u64,
    /// Below this idle time the user counts as "back".
    pub active_below_secs: u64,
    /// How long the stretch lasts after waking.
    pub stretch_ms: i64,
    /// Consecutive samples without audio before music counts as stopped (gaps between tracks).
    pub stop_after_misses: u32,
}

impl Default for TrackerConfig {
    fn default() -> Self {
        Self { nap_after_secs: 600, active_below_secs: 5, stretch_ms: 6_000, stop_after_misses: 2 }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ActivityTracker {
    pub cfg: TrackerConfig,
    napping: bool,
    stretch_until: i64,
    music: Option<MusicInfo>,
    misses: u32,
    idle_secs: u64,
}

impl ActivityTracker {
    pub fn new(cfg: TrackerConfig) -> Self {
        Self { cfg, ..Default::default() }
    }

    /// Feed one sample (`idle_secs` None = unknown, `music` None = nothing playing).
    pub fn update(&mut self, now_ms: i64, idle_secs: Option<u64>, music: Option<MusicInfo>) -> (ActivitySnapshot, Vec<ActivityEvent>) {
        let mut events = Vec::new();
        if let Some(idle) = idle_secs {
            self.idle_secs = idle;
            if !self.napping && idle >= self.cfg.nap_after_secs {
                self.napping = true;
                events.push(ActivityEvent::NapStarted);
            } else if self.napping && idle < self.cfg.active_below_secs {
                self.napping = false;
                self.stretch_until = now_ms + self.cfg.stretch_ms;
                events.push(ActivityEvent::Woke);
            }
        }
        match (music, self.music.clone()) {
            (Some(m), None) => {
                events.push(ActivityEvent::MusicStarted { app: m.app.clone(), title: m.title.clone() });
                self.music = Some(m);
                self.misses = 0;
            }
            (Some(m), Some(prev)) => {
                // A title that appears later for the same track is not a "change".
                if m.title.is_some() && m.title != prev.title {
                    events.push(ActivityEvent::TrackChanged { app: m.app.clone(), title: m.title.clone() });
                }
                let title = m.title.clone().or(if m.app_id == prev.app_id { prev.title } else { None });
                self.music = Some(MusicInfo { title, ..m });
                self.misses = 0;
            }
            (None, Some(_)) => {
                self.misses += 1;
                if self.misses >= self.cfg.stop_after_misses {
                    self.music = None;
                    self.misses = 0;
                    events.push(ActivityEvent::MusicStopped);
                }
            }
            (None, None) => {}
        }
        (self.snapshot(now_ms), events)
    }

    pub fn snapshot(&self, now_ms: i64) -> ActivitySnapshot {
        let kind = if self.music.is_some() {
            ActivityKind::ListeningMusic
        } else if now_ms < self.stretch_until {
            ActivityKind::Stretching
        } else if self.napping {
            ActivityKind::Napping
        } else {
            ActivityKind::None
        };
        ActivitySnapshot { kind, music: self.music.clone(), idle_secs: self.idle_secs }
    }
}

// ------------------------------------------------------------ display state

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DisplayState {
    NeedsAttention,
    Completed,
    Working,
    ListeningMusic,
    Stretching,
    Napping,
    Idle,
}

impl DisplayState {
    /// Higher wins. Mirrors `STATE_REGISTRY` in packages/shared/src/persona/states.ts.
    pub fn priority(self) -> u8 {
        match self {
            DisplayState::NeedsAttention => 100,
            DisplayState::Completed => 90,
            DisplayState::Working => 80,
            DisplayState::ListeningMusic => 60,
            DisplayState::Stretching => 50,
            DisplayState::Napping => 40,
            DisplayState::Idle => 0,
        }
    }
}

/// Merge the task mood with the current activity (task states always win).
pub fn resolve_display_state(mood: PetMood, activity: ActivityKind) -> DisplayState {
    let from_mood = match mood {
        PetMood::NeedsAttention => DisplayState::NeedsAttention,
        PetMood::Completed => DisplayState::Completed,
        PetMood::Working => DisplayState::Working,
        PetMood::Idle => DisplayState::Idle,
    };
    let from_activity = match activity {
        ActivityKind::ListeningMusic => DisplayState::ListeningMusic,
        ActivityKind::Stretching => DisplayState::Stretching,
        ActivityKind::Napping => DisplayState::Napping,
        ActivityKind::None => DisplayState::Idle,
    };
    if from_activity.priority() > from_mood.priority() {
        from_activity
    } else {
        from_mood
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PMSET: &str = r#"2026-10-14 10:00:00 +0800
Assertion status system-wide:
   BackgroundTask                 0
   PreventUserIdleSystemSleep     1
   UserIsActive                   1
Listed by owning process:
   pid 377(coreaudiod): [0x0001234500019abc] 00:12:34 PreventUserIdleSystemSleep named: "com.apple.audio.context1234.preventuseridlesleep" 
	Created for PID: 5678. 
	Resources: audio-out BuiltInSpeakerDevice 
   pid 377(coreaudiod): [0x0001234500019abd] 00:00:10 PreventUserIdleSystemSleep named: "com.apple.audio.context99.preventuseridlesleep" 
	Created for PID: 4242. 
	Resources: audio-in BuiltInMicrophoneDevice 
   pid 123(WindowServer): [0x0000000100000001] 00:00:01 UserIsActive named: "com.apple.iohideventsystem.queue.tickle serviceID:100000123 product:Magic Keyboard eventType:3" 
	Timeout will fire in 600 secs Action=TimeoutActionRelease
   pid 901(Spotify): [0x0000000200000002] 00:03:00 PreventUserIdleSystemSleep named: "Spotify is playing audio"
Kernel Assertions: 0x4=USB
   id=500  level=255 0x4=USB mod=2026/10/14 09:00 description=com.apple.usb.externaldevice.14100000 owner=AppleUSBXHCI
"#;

    #[test]
    fn parses_pmset_assertions() {
        let a = parse_pmset_assertions(PMSET);
        assert_eq!(a.len(), 4);
        assert_eq!(a[0].owner_name, "coreaudiod");
        assert_eq!(a[0].owner_pid, 377);
        assert_eq!(a[0].kind, "PreventUserIdleSystemSleep");
        assert_eq!(a[0].created_for_pid, Some(5678));
        assert_eq!(a[0].resources, vec!["audio-out", "BuiltInSpeakerDevice"]);
        assert_eq!(a[2].owner_name, "WindowServer");
        assert_eq!(a[3].name, "Spotify is playing audio");
    }

    #[test]
    fn audio_pids_skip_microphone_and_self() {
        let a = parse_pmset_assertions(PMSET);
        assert_eq!(audio_playing_pids(&a, None), vec![5678, 901]);
        assert_eq!(audio_playing_pids(&a, Some(5678)), vec![901]);
        assert!(audio_playing_pids(&parse_pmset_assertions("garbage\nno list"), None).is_empty());
    }

    #[test]
    fn parses_older_owner_format_without_age() {
        let a = parse_pmset_assertions("Listed by owning process:\n  pid 55(QQMusic): [0x01] NoIdleSleepAssertion named: \"QQMusic audio playing\"\n");
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].owner_name, "QQMusic");
        assert_eq!(a[0].kind, "NoIdleSleepAssertion");
        assert_eq!(audio_playing_pids(&a, None), vec![55]);
    }

    #[test]
    fn maps_pids_to_apps() {
        let ps = "  5678 /Applications/QQMusic.app/Contents/MacOS/QQMusic\n  901 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/1/Helpers/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper\n 77 /usr/bin/say\n";
        let m = parse_ps_comm(ps);
        assert_eq!(app_name_from_path(&m[&5678]), "QQMusic");
        assert_eq!(app_name_from_path(&m[&901]), "Google Chrome");
        assert_eq!(app_name_from_path(&m[&77]), "say");
        assert_eq!(app_name_from_path("/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.GPU.xpc/Contents/MacOS/com.apple.WebKit.GPU"), "Safari");

        let qq = pick_media_app(&[901, 5678], &m, true).unwrap();
        assert_eq!((qq.id, qq.display.as_str()), ("qqmusic", "QQ音乐"));
        assert_eq!(pick_media_app(&[901], &m, false), None);
        assert!(pick_media_app(&[901], &m, true).unwrap().is_browser);
        assert_eq!(pick_media_app(&[77], &m, true), None);
    }

    #[test]
    fn classifies_known_apps() {
        assert_eq!(classify_app("Music").unwrap().id, "music");
        assert_eq!(classify_app("Spotify").unwrap().id, "spotify");
        assert_eq!(classify_app("NeteaseMusic").unwrap().display, "网易云音乐");
        assert!(classify_app("Arc").unwrap().is_browser);
        assert_eq!(classify_app("Xcode"), None);
    }

    #[test]
    fn parses_osascript_track() {
        assert_eq!(
            parse_track_output("playing\t晴天\t周杰伦\n"),
            Some(("晴天".to_string(), Some("周杰伦".to_string())))
        );
        assert_eq!(parse_track_output("playing\tLofi Beats\tmissing value"), Some(("Lofi Beats".into(), None)));
        assert_eq!(parse_track_output("stopped"), None);
        assert_eq!(parse_track_output("playing\t\t"), None);
        assert!(track_script("Music").contains("if application \"Music\" is running"));
    }

    #[test]
    fn parses_window_titles() {
        let out = "QQ音乐\tQQ音乐\nQQ音乐\t桌面歌词\nFinder\t下载\nQQ音乐\t稻香 - 周杰伦\n";
        assert_eq!(parse_window_titles(out, &["QQ音乐", "QQMusic"]).as_deref(), Some("稻香 - 周杰伦"));
        assert_eq!(parse_window_titles("QQMusic\tQQMusic\n", &["QQ音乐", "QQMusic"]), None);
        assert_eq!(parse_window_titles("QQMusic\t七里香\n", &["QQ音乐", "QQMusic"]).as_deref(), Some("七里香"));
        assert_eq!(parse_window_titles("", &["QQ音乐"]), None);
    }

    #[test]
    fn parses_hid_idle_time() {
        let out = "    | |   \"HIDIdleTime\" = 615000000000\n    | |   \"HIDKeyboardModifier\" = 0\n";
        assert_eq!(parse_hid_idle_secs(out), Some(615));
        assert_eq!(parse_hid_idle_secs("nothing"), None);
    }

    fn qq(title: Option<&str>) -> Option<MusicInfo> {
        Some(MusicInfo { app_id: "qqmusic".into(), app: "QQ音乐".into(), title: title.map(String::from), artist: None })
    }

    #[test]
    fn tracker_music_events_are_debounced() {
        let mut t = ActivityTracker::new(TrackerConfig::default());
        let (s, e) = t.update(0, Some(1), qq(None));
        assert_eq!(s.kind, ActivityKind::ListeningMusic);
        assert_eq!(e, vec![ActivityEvent::MusicStarted { app: "QQ音乐".into(), title: None }]);
        // title appears later -> reported as a change once
        let (_, e) = t.update(4000, Some(1), qq(Some("晴天")));
        assert_eq!(e.len(), 1);
        // a sample without title keeps the known title
        let (s, e) = t.update(8000, Some(1), qq(None));
        assert!(e.is_empty());
        assert_eq!(s.music.unwrap().title.as_deref(), Some("晴天"));
        // one miss (gap between tracks) keeps listening; two misses stop
        let (s, e) = t.update(12000, Some(1), None);
        assert_eq!(s.kind, ActivityKind::ListeningMusic);
        assert!(e.is_empty());
        let (s, e) = t.update(16000, Some(1), None);
        assert_eq!(s.kind, ActivityKind::None);
        assert_eq!(e, vec![ActivityEvent::MusicStopped]);
    }

    #[test]
    fn tracker_naps_and_stretches_on_return() {
        let mut t = ActivityTracker::new(TrackerConfig::default());
        let (s, e) = t.update(0, Some(599), None);
        assert_eq!((s.kind, e.len()), (ActivityKind::None, 0));
        let (s, e) = t.update(4000, Some(600), None);
        assert_eq!(s.kind, ActivityKind::Napping);
        assert_eq!(e, vec![ActivityEvent::NapStarted]);
        // still idle: no repeated event
        assert!(t.update(8000, Some(700), None).1.is_empty());
        // user is back -> stretch for a few seconds, then normal
        let (s, e) = t.update(12000, Some(1), None);
        assert_eq!(s.kind, ActivityKind::Stretching);
        assert_eq!(e, vec![ActivityEvent::Woke]);
        assert_eq!(t.update(19000, Some(2), None).0.kind, ActivityKind::None);
        // unknown idle time changes nothing
        assert_eq!(t.update(20000, None, None).0.kind, ActivityKind::None);
    }

    #[test]
    fn music_beats_nap() {
        let mut t = ActivityTracker::new(TrackerConfig::default());
        let (s, _) = t.update(0, Some(900), qq(Some("夜曲")));
        assert_eq!(s.kind, ActivityKind::ListeningMusic);
    }

    #[test]
    fn display_state_priority() {
        use ActivityKind as A;
        use DisplayState as D;
        assert_eq!(resolve_display_state(PetMood::NeedsAttention, A::ListeningMusic), D::NeedsAttention);
        assert_eq!(resolve_display_state(PetMood::Completed, A::ListeningMusic), D::Completed);
        assert_eq!(resolve_display_state(PetMood::Working, A::ListeningMusic), D::Working);
        assert_eq!(resolve_display_state(PetMood::Idle, A::ListeningMusic), D::ListeningMusic);
        assert_eq!(resolve_display_state(PetMood::Idle, A::Napping), D::Napping);
        assert_eq!(resolve_display_state(PetMood::Working, A::Napping), D::Working);
        assert_eq!(resolve_display_state(PetMood::Idle, A::Stretching), D::Stretching);
        assert_eq!(resolve_display_state(PetMood::Idle, A::None), D::Idle);
        assert!(D::ListeningMusic.priority() > D::Napping.priority());
    }
}
