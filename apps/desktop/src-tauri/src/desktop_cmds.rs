//! 桌面模式 widgets: folder shortcuts (open in Finder / Explorer), weather (IP location + open-meteo,
//! no key, cached), and cheap system stats (macOS: pmset + sysctl; Windows: Win32 power / system times; else hidden).

use crate::AppState;
use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

type CmdResult<T> = Result<T, String>;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopFolder {
    pub name: String,
    pub path: String,
    /// downloads | documents | desktop | applications | custom
    pub kind: &'static str,
    pub exists: bool,
}

fn home() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(std::path::PathBuf::from)
}

fn builtin_folders() -> Vec<(String, String, &'static str)> {
    let h = home().unwrap_or_default();
    let p = |s: &str| h.join(s).to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    {
        // 开始菜单 (the user's Start Menu programs) stands in for macOS 应用程序
        let start = std::env::var_os("APPDATA")
            .map(|a| std::path::PathBuf::from(a).join("Microsoft").join("Windows").join("Start Menu").join("Programs").to_string_lossy().to_string())
            .unwrap_or_default();
        let mut v = vec![
            ("下载".into(), p("Downloads"), "downloads"),
            ("文档".into(), p("Documents"), "documents"),
            ("桌面".into(), p("Desktop"), "desktop"),
        ];
        if !start.is_empty() {
            v.push(("开始菜单".into(), start, "applications"));
        }
        v
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![
            ("下载".into(), p("Downloads"), "downloads"),
            ("文稿".into(), p("Documents"), "documents"),
            ("桌面".into(), p("Desktop"), "desktop"),
            ("应用程序".into(), "/Applications".into(), "applications"),
        ]
    }
}

fn folder_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| path.to_string())
}

fn all_folders(state: &AppState) -> Vec<DesktopFolder> {
    let custom = state.engine.db().get_settings().map(|s| s.desktop_folders).unwrap_or_default();
    let mut out: Vec<DesktopFolder> = builtin_folders()
        .into_iter()
        .map(|(name, path, kind)| DesktopFolder { exists: std::path::Path::new(&path).is_dir(), name, path, kind })
        .collect();
    for p in custom {
        if out.iter().any(|f| f.path == p) {
            continue;
        }
        out.push(DesktopFolder { name: folder_name(&p), exists: std::path::Path::new(&p).is_dir(), path: p, kind: "custom" });
    }
    out
}

#[tauri::command]
pub fn list_desktop_folders(state: State<'_, AppState>) -> Vec<DesktopFolder> {
    all_folders(&state)
}

/// Open one of the listed folders in Finder / Explorer (only paths from the list are accepted).
#[tauri::command]
pub fn open_desktop_folder(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<()> {
    let known = all_folders(&state).into_iter().find(|f| f.path == path).ok_or("不在快捷文件夹列表里")?;
    if !known.exists {
        return Err(format!("文件夹不存在：{}", known.path));
    }
    app.opener().open_path(known.path, None::<&str>).map_err(|e| e.to_string())
}

fn save_custom(app: &AppHandle, f: impl FnOnce(&mut Vec<String>)) -> CmdResult<Vec<DesktopFolder>> {
    let state = app.state::<AppState>();
    let saved = {
        let db = state.engine.db();
        let mut s = db.get_settings().map_err(|e| e.to_string())?;
        f(&mut s.desktop_folders);
        db.save_settings(&s).map_err(|e| e.to_string())?
    };
    let _ = app.emit("settings-changed", saved);
    Ok(all_folders(&state))
}

#[tauri::command]
pub async fn add_desktop_folder(app: AppHandle, path: Option<String>) -> CmdResult<Vec<DesktopFolder>> {
    let path = match path {
        Some(p) => p,
        None => match crate::live2d_cmds::choose_folder("选择要放到桌面上的文件夹").await? {
            Some(p) => p,
            None => return Ok(all_folders(&app.state::<AppState>())),
        },
    };
    let p = path.trim().trim_end_matches(['/', '\\']).to_string();
    if !std::path::Path::new(&p).is_dir() {
        return Err(format!("不是文件夹：{p}"));
    }
    save_custom(&app, |v| {
        if !v.contains(&p) {
            v.push(p);
        }
    })
}

#[tauri::command]
pub fn remove_desktop_folder(app: AppHandle, path: String) -> CmdResult<Vec<DesktopFolder>> {
    save_custom(&app, |v| v.retain(|x| x != &path))
}

// ------------------------------------------------------------------ weather

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Weather {
    pub city: String,
    pub temp_c: f64,
    pub code: i64,
    pub hi_c: Option<f64>,
    pub lo_c: Option<f64>,
    pub fetched_at: i64,
}

static WEATHER: Mutex<Option<(Instant, Weather)>> = Mutex::new(None);
const WEATHER_TTL: Duration = Duration::from_secs(30 * 60);

fn fetch_weather() -> Result<Weather, String> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(8)).build();
    let loc: serde_json::Value = agent
        .get("https://ipapi.co/json/")
        .set("User-Agent", "lingdot-desktop-pet")
        .call()
        .map_err(|e| e.to_string())?
        .into_json()
        .map_err(|e| e.to_string())?;
    let lat = loc["latitude"].as_f64().ok_or("no location")?;
    let lon = loc["longitude"].as_f64().ok_or("no location")?;
    let city = loc["city"].as_str().unwrap_or("").to_string();
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat:.3}&longitude={lon:.3}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1"
    );
    let w: serde_json::Value = agent.get(&url).call().map_err(|e| e.to_string())?.into_json().map_err(|e| e.to_string())?;
    Ok(Weather {
        city,
        temp_c: w["current"]["temperature_2m"].as_f64().ok_or("no temperature")?,
        code: w["current"]["weather_code"].as_i64().unwrap_or(0),
        hi_c: w["daily"]["temperature_2m_max"][0].as_f64(),
        lo_c: w["daily"]["temperature_2m_min"][0].as_f64(),
        fetched_at: pet_core::model::now_ms(),
    })
}

/// Current weather for the desktop widget (null when off / offline).
#[tauri::command]
pub async fn get_weather(state: State<'_, AppState>) -> CmdResult<Option<Weather>> {
    if !state.engine.db().get_settings().map(|s| s.desktop_weather).unwrap_or(true) {
        return Ok(None);
    }
    if let Some((at, w)) = WEATHER.lock().unwrap().as_ref() {
        if at.elapsed() < WEATHER_TTL {
            return Ok(Some(w.clone()));
        }
    }
    let res = tauri::async_runtime::spawn_blocking(fetch_weather).await.map_err(|e| e.to_string())?;
    match res {
        Ok(w) => {
            *WEATHER.lock().unwrap() = Some((Instant::now(), w.clone()));
            Ok(Some(w))
        }
        Err(_) => Ok(WEATHER.lock().unwrap().as_ref().map(|(_, w)| w.clone())),
    }
}

// ------------------------------------------------------------------ system stats

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub battery: Option<u8>,
    pub charging: bool,
    /// 1-minute load average divided by the number of cores, 0..1+.
    pub cpu_load: Option<f64>,
}

#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
pub fn parse_pmset(out: &str) -> (Option<u8>, bool) {
    let pct = out
        .split(|c: char| c == '\t' || c == ';' || c == ' ')
        .find_map(|t| t.trim().strip_suffix('%').and_then(|n| n.parse::<u8>().ok()));
    let charging = out.contains("AC Power") || out.contains("; charging") || out.contains("charged");
    (pct, charging)
}

#[cfg_attr(not(any(test, target_os = "windows")), allow(dead_code))]
/// CPU busy fraction between two `GetSystemTimes` samples (idle, kernel+user), 0..1.
pub fn cpu_busy(prev: (u64, u64), now: (u64, u64)) -> Option<f64> {
    let total = now.1.checked_sub(prev.1)?;
    let idle = now.0.checked_sub(prev.0)?;
    if total == 0 {
        return None;
    }
    Some(((1.0 - idle as f64 / total as f64).clamp(0.0, 1.0) * 100.0).round() / 100.0)
}

/// Windows: battery from GetSystemPowerStatus (hidden on desktops without one), CPU from
/// GetSystemTimes deltas between widget refreshes (the first call has no CPU value yet).
#[cfg(target_os = "windows")]
fn win_stats() -> SystemStats {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows_sys::Win32::System::Threading::GetSystemTimes;
    static PREV: Mutex<Option<(u64, u64)>> = Mutex::new(None);
    // SAFETY: plain Win32 calls with zeroed out-structs.
    let mut ps: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
    let ok = unsafe { GetSystemPowerStatus(&mut ps) } != 0;
    let has_battery = ok && ps.BatteryFlag != 128 && ps.BatteryFlag != 255 && ps.BatteryLifePercent <= 100;
    let (battery, charging) = if has_battery { (Some(ps.BatteryLifePercent), ps.ACLineStatus == 1) } else { (None, false) };
    let ft = |f: &FILETIME| (u64::from(f.dwHighDateTime) << 32) | u64::from(f.dwLowDateTime);
    let mut idle: FILETIME = unsafe { std::mem::zeroed() };
    let mut kernel: FILETIME = unsafe { std::mem::zeroed() };
    let mut user: FILETIME = unsafe { std::mem::zeroed() };
    let cpu_load = if unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } != 0 {
        let now = (ft(&idle), ft(&kernel) + ft(&user)); // kernel time includes idle time
        let mut prev = PREV.lock().unwrap();
        let v = prev.and_then(|p| cpu_busy(p, now));
        *prev = Some(now);
        v
    } else {
        None
    };
    SystemStats { battery, charging, cpu_load }
}

#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
pub fn parse_loadavg(out: &str) -> Option<f64> {
    out.trim().trim_start_matches('{').split_whitespace().next()?.parse().ok()
}

#[tauri::command]
pub async fn get_system_stats() -> SystemStats {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "macos")]
        {
            let t = Duration::from_secs(2);
            let (battery, charging) =
                crate::sys::run_with_timeout("/usr/bin/pmset", &["-g", "batt"], t).map(|o| parse_pmset(&o)).unwrap_or((None, false));
            let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f64;
            let cpu_load = crate::sys::run_with_timeout("/usr/sbin/sysctl", &["-n", "vm.loadavg"], t)
                .and_then(|o| parse_loadavg(&o))
                .map(|l| (l / cores * 100.0).round() / 100.0);
            SystemStats { battery, charging, cpu_load }
        }
        #[cfg(target_os = "windows")]
        {
            win_stats()
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            SystemStats::default()
        }
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_pmset_and_loadavg() {
        let o = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t83%; discharging; 4:12 remaining present: true";
        assert_eq!(parse_pmset(o), (Some(83), false));
        let o = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining";
        assert_eq!(parse_pmset(o), (Some(100), true));
        assert_eq!(parse_pmset("Now drawing from 'AC Power'"), (None, true));
        assert_eq!(parse_loadavg("{ 2.41 2.10 1.98 }"), Some(2.41));
        assert_eq!(cpu_busy((100, 1000), (180, 1100)), Some(0.2));
        assert_eq!(cpu_busy((100, 1000), (100, 1000)), None);
        assert_eq!(cpu_busy((100, 1000), (90, 1100)), None);
    }
}
