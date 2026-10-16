//! 一键导入我的 Live2D: find the user's model + Cubism Core on this Mac, copy them into
//! `<appData>/live2d/` (inside the asset-protocol scope) and point the settings at them.
//! The scanning/copy logic lives in `pet_core::live2d_scan` (unit tested).

use crate::AppState;
use pet_core::live2d_scan::{self, ImportOutcome, ScanRoots};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

static IMPORT_LOCK: Mutex<()> = Mutex::new(());

fn roots(app: &AppHandle, folder: Option<PathBuf>) -> Result<ScanRoots, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let app_live2d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("live2d");
    Ok(match folder {
        Some(f) => ScanRoots::folder(home, app_live2d, f),
        None => ScanRoots::standard(home, app_live2d),
    })
}

fn bundled(app: &AppHandle) -> impl Fn(&str) -> bool + '_ {
    move |p: &str| app.asset_resolver().get(p.to_string()).is_some()
}

/// Run an import and, when it found something, save it into the settings + notify all windows.
fn run_import(app: &AppHandle, folder: Option<PathBuf>, force: bool) -> Result<ImportOutcome, String> {
    let _guard = IMPORT_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let r = roots(app, folder)?;
    let state = app.state::<AppState>();
    let current = state.engine.db().get_settings().map_err(|e| e.to_string())?;
    let out = live2d_scan::scan_and_import(&r, Some(current.live2d_model_path.as_str()), force);
    if out.model_path.is_some() || out.core_path.is_some() {
        let new = {
            let db = state.engine.db();
            let mut s = db.get_settings().map_err(|e| e.to_string())?;
            if let Some(m) = &out.model_path {
                s.live2d_model_path = m.clone();
            }
            if let Some(c) = &out.core_path {
                s.live2d_core_path = c.clone();
            }
            if out.complete() {
                s.renderer_mode = "live2d".into();
            }
            db.save_settings(&s).map_err(|e| e.to_string())?
        };
        if new != current {
            let _ = app.emit("settings-changed", new);
        }
    }
    let _ = app.emit("live2d-import", out.clone());
    Ok(out)
}

/// 一键导入: scan 下载 / 桌面 / 文稿 / ~/Live2D / old source checkouts. `force` rescans even
/// when a model is already imported.
#[tauri::command]
pub async fn scan_and_import_live2d(app: AppHandle, force: Option<bool>) -> Result<ImportOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || run_import(&app, None, force.unwrap_or(true)))
        .await
        .map_err(|e| e.to_string())?
}

/// Import from a folder the user chose (any model in it, samples included).
#[tauri::command]
pub async fn import_live2d_folder(app: AppHandle, path: String) -> Result<ImportOutcome, String> {
    let p = PathBuf::from(path.trim());
    let dir = if p.is_file() { p.parent().map(|d| d.to_path_buf()).unwrap_or(p) } else { p };
    if !dir.is_dir() {
        return Err("找不到这个文件夹".into());
    }
    tauri::async_runtime::spawn_blocking(move || run_import(&app, Some(dir), true))
        .await
        .map_err(|e| e.to_string())?
}

/// 选择模型文件夹: native macOS folder picker (osascript, no extra plugin). None = cancelled.
#[tauri::command]
pub async fn pick_live2d_folder() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let out = tauri::async_runtime::spawn_blocking(|| {
            std::process::Command::new("/usr/bin/osascript")
                .args([
                    "-e",
                    "POSIX path of (choose folder with prompt \"选择包含 .model3.json 的 Live2D 模型文件夹（也可以选放着 CubismSdkForWeb zip 的文件夹）\")",
                ])
                .output()
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Ok(None); // user cancelled
        }
        let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
        Ok(if p.is_empty() { None } else { Some(p) })
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("文件夹选择器仅支持 macOS，请在下方输入文件夹路径".into())
    }
}

/// Startup: when Live2D is wanted (auto / live2d) but the configured model or Core does not
/// resolve (e.g. the CI-built dmg has no bundled /live2d/models), find + import it in the background.
pub fn auto_import_on_startup(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        let Ok(s) = handle.state::<AppState>().engine.db().get_settings() else { return };
        let check = bundled(&handle);
        if !live2d_scan::needs_import(&s.renderer_mode, &s.live2d_model_path, &s.live2d_core_path, &check) {
            return;
        }
        let _ = run_import(&handle, None, false);
    });
}
