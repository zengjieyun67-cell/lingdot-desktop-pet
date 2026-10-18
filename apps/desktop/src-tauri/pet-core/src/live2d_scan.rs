//! Find the user's own Live2D model + Cubism Core on disk and import them into
//! `<appData>/live2d/` (the folder the webview's asset scope allows).
//!
//! Licensing: neither Cubism Core nor third-party models ship with the app. This
//! module only copies files the user already has on *their* Mac (e.g. an old
//! source checkout's `apps/desktop/public/live2d`, a BOOTH model in 下载, the
//! Cubism SDK for Web zip they downloaded).
//!
//! Pure std + the system `unzip` / `ditto` tools, so it is unit-testable on any OS.

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

pub const CORE_FILE: &str = "live2dcubismcore.min.js";
/// Webview path of a Core bundled into the app (only present in local builds).
pub const BUNDLED_CORE_URL: &str = "/live2d/live2dcubismcore.min.js";

/// Official Cubism sample models: never picked automatically (they are not "my" model).
const SAMPLE_NAMES: &[&str] = &[
    "haru", "haru_greeter_t03", "hiyori", "hiyori_pro_t11", "hiyori_free_t08", "mark", "mark_free_t04", "natori",
    "natori_pro_t06", "rice", "rice_pro_t03", "mao", "mao_pro_t02", "wanko", "wanko_touch_t02", "ren", "ren_pro_t02",
    "miara", "epsilon", "koharu", "haruto", "simple", "tororo", "hijiki", "izumi", "shizuku", "nito", "unitychan",
];
const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "Library", "Applications", "Music", "Movies", "Pictures", "Public", ".Trash", "venv",
    "__pycache__", "Pods", "DerivedData",
];
const MAX_MODEL_DIR_BYTES: u64 = 1_500 * 1024 * 1024;
const MAX_ZIP_BYTES: u64 = 800 * 1024 * 1024;

#[derive(Debug, Clone, Default)]
pub struct ScanRoots {
    pub home: PathBuf,
    /// `<appData>/live2d`
    pub app_live2d: PathBuf,
    /// Extra folders to scan deeply (e.g. a folder the user picked).
    pub extra: Vec<PathBuf>,
    /// Scan the standard folders (下载/桌面/文稿/~/Live2D + old checkouts). False = only `extra`.
    pub standard: bool,
    /// Folders whose models win over ones found elsewhere (the folder next to the app's exe,
    /// a model pack embedded in the exe). Also scanned deeply.
    pub preferred: Vec<PathBuf>,
}

impl ScanRoots {
    pub fn standard(home: impl Into<PathBuf>, app_live2d: impl Into<PathBuf>) -> Self {
        Self { home: home.into(), app_live2d: app_live2d.into(), extra: vec![], standard: true, preferred: vec![] }
    }
    pub fn folder(home: impl Into<PathBuf>, app_live2d: impl Into<PathBuf>, folder: impl Into<PathBuf>) -> Self {
        Self { home: home.into(), app_live2d: app_live2d.into(), extra: vec![folder.into()], standard: false, preferred: vec![] }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelCandidate {
    pub model_json: PathBuf,
    pub score: i64,
    pub mtime: u64,
}

#[derive(Debug, Default)]
pub struct ScanResult {
    pub models: Vec<ModelCandidate>,
    pub cores: Vec<(PathBuf, u64)>,
    pub sdk_zips: Vec<(PathBuf, u64)>,
    pub model_zips: Vec<(PathBuf, u64)>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    /// Absolute path of the imported `.model3.json` (inside `<appData>/live2d`), if any.
    pub model_path: Option<String>,
    /// Absolute path of the imported Core (inside `<appData>/live2d`), if any.
    pub core_path: Option<String>,
    pub model_name: Option<String>,
    /// Where the model was found (shown to the user).
    pub model_source: Option<String>,
    pub core_source: Option<String>,
    /// The model was already in `<appData>/live2d`; nothing copied.
    pub already_imported: bool,
    /// Friendly Chinese status line.
    pub message: String,
}

impl ImportOutcome {
    pub fn complete(&self) -> bool {
        self.model_path.is_some() && self.core_path.is_some()
    }
}

fn mtime(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn skip_dir(name: &str) -> bool {
    name.starts_with('.')
        || SKIP_DIRS.contains(&name)
        || name.ends_with(".app")
        || name.ends_with(".photoslibrary")
        || name.ends_with(".musiclibrary")
        || name.ends_with(".xcodeproj")
}

/// Bounded depth-first walk; calls `visit` for every regular file. `budget` caps visited entries.
fn walk(root: &Path, max_depth: usize, budget: &mut usize, visit: &mut dyn FnMut(&Path, usize)) {
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for ent in rd.flatten() {
            if *budget == 0 {
                return;
            }
            *budget -= 1;
            let Ok(ft) = ent.file_type() else { continue };
            let p = ent.path();
            if ft.is_dir() {
                let name = ent.file_name().to_string_lossy().into_owned();
                if depth < max_depth && !skip_dir(&name) {
                    stack.push((p, depth + 1));
                }
            } else if ft.is_file() {
                visit(&p, depth);
            }
        }
    }
}

fn path_has(p: &Path, needle: &str) -> bool {
    p.to_string_lossy().replace('\\', "/").contains(needle)
}

fn is_inside(p: &Path, dir: &Path) -> bool {
    !dir.as_os_str().is_empty() && p.starts_with(dir)
}

/// The moc3 and at least the first texture referenced by a `.model3.json` exist.
pub fn model_is_valid(model_json: &Path) -> bool {
    let Ok(text) = fs::read_to_string(model_json) else { return false };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text.trim_start_matches('\u{feff}')) else { return false };
    let refs = &v["FileReferences"];
    let base = model_json.parent().unwrap_or(Path::new("."));
    let Some(moc) = refs["Moc"].as_str() else { return false };
    if !base.join(moc).is_file() {
        return false;
    }
    match refs["Textures"].as_array() {
        Some(t) if !t.is_empty() => t.iter().filter_map(|x| x.as_str()).all(|x| base.join(x).is_file()),
        _ => false,
    }
}

fn model_stem(p: &Path) -> String {
    p.file_name()
        .map(|f| f.to_string_lossy().trim_end_matches(".model3.json").to_lowercase())
        .unwrap_or_default()
}

pub fn is_sample_model(p: &Path) -> bool {
    let stem = model_stem(p);
    let dir = p.parent().and_then(|d| d.file_name()).map(|d| d.to_string_lossy().to_lowercase()).unwrap_or_default();
    SAMPLE_NAMES.contains(&stem.as_str())
        || SAMPLE_NAMES.contains(&dir.as_str())
        || path_has(p, "CubismSdkForWeb")
        || path_has(p, "/Samples/Resources/")
}

/// Rank a model: the one the user set up before (old checkout / already imported /
/// matching the configured path) wins, official samples lose.
pub fn score_model(p: &Path, roots: &ScanRoots, hint: Option<&str>) -> i64 {
    let mut score = 0;
    if path_has(p, "/apps/desktop/public/live2d/") {
        score += 100;
    } else if path_has(p, "/apps/desktop/dist/live2d/") {
        score += 90;
    }
    if is_inside(p, &roots.app_live2d) {
        score += 150;
    }
    if roots.preferred.iter().any(|d| is_inside(p, d)) {
        score += 120;
    }
    if let Some(h) = hint.map(|h| h.trim().trim_start_matches('/')).filter(|h| h.ends_with(".model3.json")) {
        let tail = h.strip_prefix("live2d/").unwrap_or(h);
        if path_has(p, tail) {
            score += 300;
        } else if Path::new(h).file_name() == p.file_name() {
            score += 200;
        }
    }
    if is_sample_model(p) {
        score -= 1000;
    }
    score
}

fn is_sdk_zip(p: &Path) -> bool {
    let n = p.file_name().map(|f| f.to_string_lossy().to_lowercase()).unwrap_or_default();
    n.ends_with(".zip") && (n.starts_with("cubismsdkforweb") || n.starts_with("cubism-sdk-for-web") || n.contains("cubismsdk"))
}

/// Old source checkouts of this project under `home` (…/apps/desktop/public/live2d).
pub fn find_old_checkouts(home: &Path, max_depth: usize, budget: &mut usize) -> Vec<PathBuf> {
    let mut out = vec![];
    let mut stack = vec![(home.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        for sub in ["apps/desktop/public/live2d", "apps/desktop/dist/live2d"] {
            let c = dir.join(sub);
            if c.is_dir() {
                out.push(c);
            }
        }
        if depth >= max_depth {
            continue;
        }
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for ent in rd.flatten() {
            if *budget == 0 {
                return out;
            }
            *budget -= 1;
            if ent.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let name = ent.file_name().to_string_lossy().into_owned();
                if !skip_dir(&name) && name != "apps" {
                    stack.push((ent.path(), depth + 1));
                }
            }
        }
    }
    out
}

/// Scan for `.model3.json`, Cubism Core and zips. `hint` = currently configured model path.
pub fn scan(roots: &ScanRoots, hint: Option<&str>) -> ScanResult {
    let mut res = ScanResult::default();
    let mut budget = 120_000usize;
    let mut deep: Vec<(PathBuf, usize)> = vec![];
    if !roots.app_live2d.as_os_str().is_empty() {
        deep.push((roots.app_live2d.clone(), 4));
    }
    for e in roots.preferred.iter().chain(roots.extra.iter()) {
        deep.push((e.clone(), 6));
    }
    if roots.standard {
        let h = &roots.home;
        for (sub, d) in [("Live2D", 6), ("Documents/Live2D", 6), ("Downloads", 5), ("Desktop", 5), ("Documents", 4)] {
            deep.push((h.join(sub), d));
        }
        let mut b2 = 40_000usize;
        for c in find_old_checkouts(h, 4, &mut b2) {
            deep.push((c, 4));
        }
    }
    let mut seen = std::collections::HashSet::new();
    for (root, depth) in deep {
        if !root.is_dir() {
            continue;
        }
        let mut visit = |p: &Path, d: usize| {
            let name = p.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
            let key = fs::canonicalize(p).unwrap_or(p.to_path_buf());
            if !seen.insert(key) {
                return;
            }
            if name.ends_with(".model3.json") {
                if model_is_valid(p) {
                    res.models.push(ModelCandidate { model_json: p.to_path_buf(), score: score_model(p, roots, hint), mtime: mtime(p) });
                }
            } else if name == CORE_FILE {
                if fs::metadata(p).map(|m| m.len() > 10_000).unwrap_or(false) {
                    res.cores.push((p.to_path_buf(), mtime(p)));
                }
            } else if name.to_lowercase().ends_with(".zip") && d <= 2 {
                let size = fs::metadata(p).map(|m| m.len()).unwrap_or(0);
                if is_sdk_zip(p) {
                    res.sdk_zips.push((p.to_path_buf(), mtime(p)));
                } else if size <= MAX_ZIP_BYTES && zip_entries(p).iter().any(|e| e.ends_with(".model3.json")) {
                    res.model_zips.push((p.to_path_buf(), mtime(p)));
                }
            }
        };
        walk(&root, depth, &mut budget, &mut visit);
    }
    res.models.sort_by(|a, b| b.score.cmp(&a.score).then(b.mtime.cmp(&a.mtime)));
    // Prefer Core from an old checkout / app data, then newest.
    let rank = |p: &Path| -> i64 {
        (if is_inside(p, &roots.app_live2d) { 2 } else { 0 }) + (if path_has(p, "/apps/desktop/public/live2d/") { 1 } else { 0 })
    };
    res.cores.sort_by(|a, b| rank(&b.0).cmp(&rank(&a.0)).then(b.1.cmp(&a.1)));
    res.sdk_zips.sort_by(|a, b| b.1.cmp(&a.1));
    res.model_zips.sort_by(|a, b| b.1.cmp(&a.1));
    res
}

/// List entries of a zip with the system `unzip` (empty when unavailable).
pub fn zip_entries(zip: &Path) -> Vec<String> {
    let lines = |o: std::process::Output| -> Vec<String> {
        String::from_utf8_lossy(&o.stdout).lines().map(|l| l.trim_end_matches('\r').to_string()).collect()
    };
    match tool("unzip").arg("-Z1").arg(zip).output() {
        Ok(o) if o.status.success() => lines(o),
        // Windows 10+ has no unzip, but its bundled bsdtar (`tar.exe`) reads zips.
        _ => match tool("tar").arg("-tf").arg(zip).output() {
            Ok(o) if o.status.success() => lines(o),
            _ => vec![],
        },
    }
}

/// A command for a helper tool; on Windows without the flashing console window.
fn tool(name: &str) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(name);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

/// Extract `Core/live2dcubismcore.min.js` from a Cubism SDK for Web zip into `dest`.
pub fn extract_core_from_sdk_zip(zip: &Path, dest: &Path) -> Result<(), String> {
    let entry = zip_entries(zip)
        .into_iter()
        .filter(|e| e.ends_with(&format!("Core/{CORE_FILE}")))
        .min_by_key(|e| e.len())
        .ok_or_else(|| "SDK 压缩包里没有 Core/live2dcubismcore.min.js".to_string())?;
    let out = match tool("unzip").arg("-p").arg(zip).arg(&entry).output() {
        Ok(o) if o.status.success() => o,
        _ => tool("tar").arg("-xOf").arg(zip).arg(&entry).output().map_err(|e| format!("无法解压 SDK：{e}"))?,
    };
    if !out.status.success() || out.stdout.len() < 10_000 {
        return Err("解压 Cubism Core 失败".into());
    }
    if let Some(d) = dest.parent() {
        fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    fs::write(dest, &out.stdout).map_err(|e| e.to_string())
}

/// Extract a whole zip into `dest` (macOS `ditto` handles non-UTF-8 names best).
fn extract_zip(zip: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let ditto = Path::new("/usr/bin/ditto");
    let ok = if ditto.exists() {
        tool("/usr/bin/ditto").args(["-x", "-k"]).arg(zip).arg(dest).status().map(|s| s.success()).unwrap_or(false)
    } else {
        false
    };
    if ok {
        return Ok(());
    }
    if tool("unzip").args(["-q", "-o"]).arg(zip).arg("-d").arg(dest).status().map(|s| s.success()).unwrap_or(false) {
        return Ok(());
    }
    let st = tool("tar").arg("-xf").arg(zip).arg("-C").arg(dest).status().map_err(|e| format!("无法解压：{e}"))?;
    if st.success() { Ok(()) } else { Err("解压模型压缩包失败".into()) }
}

fn dir_size(p: &Path, limit: u64) -> u64 {
    let mut total = 0u64;
    let mut budget = 50_000usize;
    walk(p, 8, &mut budget, &mut |f, _| total += fs::metadata(f).map(|m| m.len()).unwrap_or(0));
    total.min(limit + 1)
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for ent in fs::read_dir(src)? {
        let ent = ent?;
        let name = ent.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let ft = ent.file_type()?;
        let to = dst.join(&name);
        if ft.is_dir() {
            copy_dir(&ent.path(), &to)?;
        } else if ft.is_file() {
            fs::copy(ent.path(), &to)?;
        }
    }
    Ok(())
}

/// A path as the webview should see it: Windows verbatim prefixes (`\\?\C:\…`, `\\?\UNC\…`, from
/// `canonicalize`) are stripped — the frontend's asset-URL builder and the asset protocol scope
/// both expect a plain `C:\…` path.
pub fn plain_path(p: &Path) -> String {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        if rest.len() >= 2 && rest.as_bytes()[1] == b':' {
            return rest.to_string();
        }
    }
    s.into_owned()
}

/// Folder name used under `<appData>/live2d/models/`.
pub fn safe_dir_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c == '/' || c == '\\' || c == ':' || c.is_control() { '_' } else { c })
        .collect();
    let s = s.trim().trim_matches('.').to_string();
    if s.is_empty() { "model".into() } else { s.chars().take(80).collect() }
}

/// Copy the model's folder into `<appData>/live2d/models/<dir>/` and return the new `.model3.json`.
pub fn import_model(model_json: &Path, app_live2d: &Path) -> Result<PathBuf, String> {
    // `<app>/.staging` is a scratch folder (zip extraction) deleted right after import: copy out of it.
    if is_inside(model_json, app_live2d) && !is_inside(model_json, &app_live2d.join(".staging")) {
        return Ok(model_json.to_path_buf());
    }
    let src_dir = model_json.parent().ok_or("模型路径无效")?;
    if src_dir.parent().is_none() || src_dir.components().filter(|c| matches!(c, Component::Normal(_))).count() < 2 {
        return Err("模型文件不能直接放在根目录".into());
    }
    if dir_size(src_dir, MAX_MODEL_DIR_BYTES) > MAX_MODEL_DIR_BYTES {
        return Err("模型文件夹太大（超过 1.5GB），请把模型单独放进一个文件夹".into());
    }
    let dir_name = safe_dir_name(&src_dir.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default());
    let models = app_live2d.join("models");
    fs::create_dir_all(&models).map_err(|e| e.to_string())?;
    let tmp = models.join(format!(".{dir_name}.importing"));
    let _ = fs::remove_dir_all(&tmp);
    copy_dir(src_dir, &tmp).map_err(|e| format!("复制模型失败：{e}"))?;
    let dest = models.join(&dir_name);
    let _ = fs::remove_dir_all(&dest);
    fs::rename(&tmp, &dest).map_err(|e| format!("复制模型失败：{e}"))?;
    Ok(dest.join(model_json.file_name().ok_or("模型路径无效")?))
}

/// A model + core already imported into `<appData>/live2d` (newest model wins, `prefer` first).
pub fn existing_import(app_live2d: &Path, prefer: Option<&str>) -> (Option<PathBuf>, Option<PathBuf>) {
    let core = app_live2d.join(CORE_FILE);
    let core = core.is_file().then_some(core);
    if let Some(p) = prefer.map(PathBuf::from).filter(|p| is_inside(p, app_live2d) && p.is_file() && model_is_valid(p)) {
        return (Some(p), core);
    }
    let mut models = vec![];
    let mut budget = 20_000usize;
    walk(app_live2d, 4, &mut budget, &mut |p, _| {
        if p.to_string_lossy().ends_with(".model3.json") && model_is_valid(p) && !is_sample_model(p) {
            models.push((p.to_path_buf(), mtime(p)));
        }
    });
    models.sort_by(|a, b| b.1.cmp(&a.1));
    (models.into_iter().next().map(|m| m.0), core)
}

/// Does a configured path resolve? `/live2d/…` is inside the app bundle (checked via `bundled`).
pub fn path_resolves(path: &str, bundled: &dyn Fn(&str) -> bool) -> bool {
    let p = path.trim();
    if p.is_empty() {
        return false;
    }
    if p.starts_with("http://") || p.starts_with("https://") {
        return true;
    }
    if p.starts_with("/live2d/") {
        return bundled(p);
    }
    Path::new(p).is_file()
}

/// Should startup try to find/import the user's model? (renderer auto/live2d and model or core missing.)
pub fn needs_import(renderer_mode: &str, model_path: &str, core_path: &str, bundled: &dyn Fn(&str) -> bool) -> bool {
    if renderer_mode == "svg" {
        return false;
    }
    let core_ok = if core_path.trim().is_empty() { bundled(BUNDLED_CORE_URL) } else { path_resolves(core_path, bundled) };
    !path_resolves(model_path, bundled) || !core_ok
}

/// Full import: reuse what is already in `<appData>/live2d` (unless `force`), otherwise
/// scan, copy the best model folder and the Core (extracting it from the SDK zip if needed).
pub fn scan_and_import(roots: &ScanRoots, hint: Option<&str>, force: bool) -> ImportOutcome {
    let app = &roots.app_live2d;
    let _ = fs::create_dir_all(app);
    let mut out = ImportOutcome::default();
    let core_dest = app.join(CORE_FILE);

    if !force && roots.standard {
        let (m, c) = existing_import(app, hint);
        if let (Some(m), Some(c)) = (&m, &c) {
            out.model_name = Some(model_stem(m));
            out.model_path = Some(plain_path(&m));
            out.core_path = Some(plain_path(&c));
            out.already_imported = true;
            out.message = format!("已在使用导入的 Live2D 模型「{}」", out.model_name.clone().unwrap_or_default());
            return out;
        }
    }

    let res = scan(roots, hint);
    let allow_samples = !roots.standard; // a folder the user picked: take whatever is in it
    let best = res.models.iter().find(|m| allow_samples || m.score >= 0).cloned();
    let mut errors: Vec<String> = vec![];

    // ---- model
    match best {
        Some(c) => match import_model(&c.model_json, app) {
            Ok(p) => {
                out.model_source = Some(c.model_json.parent().unwrap_or(&c.model_json).to_string_lossy().into_owned());
                out.model_name = Some(model_stem(&p));
                out.already_imported = is_inside(&c.model_json, app);
                out.model_path = Some(plain_path(&p));
            }
            Err(e) => errors.push(e),
        },
        None => {
            // A model only inside a zip (e.g. a BOOTH download): extract and retry.
            for (zip, _) in res.model_zips.iter().take(3) {
                let staging = app.join(".staging").join(safe_dir_name(&zip.file_stem().unwrap_or_default().to_string_lossy()));
                let _ = fs::remove_dir_all(&staging);
                if let Err(e) = extract_zip(zip, &staging) {
                    errors.push(e);
                    continue;
                }
                let sub = ScanRoots { home: roots.home.clone(), app_live2d: PathBuf::new(), extra: vec![staging.clone()], standard: false, preferred: vec![] };
                let found = scan(&sub, hint);
                if let Some(m) = found.models.iter().find(|m| allow_samples || !is_sample_model(&m.model_json)) {
                    match import_model(&m.model_json, app) {
                        Ok(p) => {
                            out.model_source = Some(zip.to_string_lossy().into_owned());
                            out.model_name = Some(model_stem(&p));
                            out.model_path = Some(plain_path(&p));
                        }
                        Err(e) => errors.push(e),
                    }
                }
                let _ = fs::remove_dir_all(app.join(".staging"));
                if out.model_path.is_some() {
                    break;
                }
            }
            if out.model_path.is_none() {
                // Fall back to anything already imported.
                if let (Some(m), _) = existing_import(app, hint) {
                    out.model_name = Some(model_stem(&m));
                    out.model_path = Some(plain_path(&m));
                    out.already_imported = true;
                }
            }
        }
    }

    // ---- core
    if let Some((c, _)) = res.cores.iter().find(|(c, _)| *c != core_dest) {
        if !force && core_dest.is_file() {
            out.core_path = Some(plain_path(&core_dest));
        } else {
            match fs::copy(c, &core_dest) {
                Ok(_) => {
                    out.core_source = Some(c.to_string_lossy().into_owned());
                    out.core_path = Some(plain_path(&core_dest));
                }
                Err(e) => errors.push(format!("复制 Cubism Core 失败：{e}")),
            }
        }
    }
    if out.core_path.is_none() && core_dest.is_file() {
        out.core_path = Some(plain_path(&core_dest));
    }
    if out.core_path.is_none() {
        for (zip, _) in &res.sdk_zips {
            match extract_core_from_sdk_zip(zip, &core_dest) {
                Ok(()) => {
                    out.core_source = Some(zip.to_string_lossy().into_owned());
                    out.core_path = Some(plain_path(&core_dest));
                    break;
                }
                Err(e) => errors.push(e),
            }
        }
    }

    out.message = match (&out.model_path, &out.core_path) {
        (Some(_), Some(_)) => format!("已导入 Live2D 模型「{}」", out.model_name.clone().unwrap_or_default()),
        (Some(_), None) => "找到了模型，但还缺 Cubism Core：把官网下载的 CubismSdkForWeb-*.zip 放进「下载」文件夹，再点一键导入".into(),
        (None, Some(_)) => "找到了 Cubism Core，但没找到模型：把含 .model3.json 的模型文件夹（或模型 zip）放进「下载」文件夹，再点一键导入".into(),
        (None, None) => "没找到 Live2D 模型和 Cubism Core：把模型文件夹和 CubismSdkForWeb zip 放进「下载」文件夹，再点一键导入".into(),
    };
    if !errors.is_empty() && !out.complete() {
        out.message.push_str(&format!("（{}）", errors.join("；")));
    }
    out
}

// ---------------------------------------------------------------------------------------
// Model pack embedded in the app's own executable (portable single-exe builds).
//
// A personal build can carry the user's own model + Cubism Core *inside* the exe: the files
// are appended after the PE/Mach-O image (the OS loader ignores trailing data), followed by
// a JSON index and a fixed trailer. Public builds never contain a pack. Layout at EOF:
//   [file bytes …][index json][u64 LE index_len][u64 LE data_start][8 bytes PACK_MAGIC]
// index json = {"files":[{"path":"xiaomiao-live2d/free1/free1.moc3","offset":0,"size":123},…]}
// (offsets relative to data_start; paths use '/').
// ---------------------------------------------------------------------------------------

pub const PACK_MAGIC: &[u8; 8] = b"LDPACK01";
const PACK_TRAILER: u64 = 24;
const MAX_PACK_BYTES: u64 = 1_500 * 1024 * 1024;

#[derive(serde::Deserialize, serde::Serialize)]
struct PackIndex {
    files: Vec<PackEntry>,
}
#[derive(serde::Deserialize, serde::Serialize)]
struct PackEntry {
    path: String,
    offset: u64,
    size: u64,
}

/// Append a pack of `files` (relative path, bytes) to `exe` — used by the private packaging
/// script's Rust twin and by tests.
pub fn append_pack(exe: &Path, files: &[(String, Vec<u8>)]) -> std::io::Result<()> {
    use std::io::Write;
    let start = fs::metadata(exe)?.len();
    let mut f = fs::OpenOptions::new().append(true).open(exe)?;
    let mut idx = PackIndex { files: vec![] };
    let mut off = 0u64;
    for (p, b) in files {
        f.write_all(b)?;
        idx.files.push(PackEntry { path: p.clone(), offset: off, size: b.len() as u64 });
        off += b.len() as u64;
    }
    let j = serde_json::to_vec(&idx).map_err(std::io::Error::other)?;
    f.write_all(&j)?;
    f.write_all(&(j.len() as u64).to_le_bytes())?;
    f.write_all(&start.to_le_bytes())?;
    f.write_all(PACK_MAGIC)?;
    Ok(())
}

fn safe_rel(p: &str) -> Option<PathBuf> {
    let p = p.replace('\\', "/");
    let mut out = PathBuf::new();
    for c in p.split('/') {
        if c.is_empty() || c == "." {
            continue;
        }
        if c == ".." || c.contains(':') {
            return None;
        }
        out.push(c);
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

/// If `exe` carries an embedded model pack, extract it into `dest` (once; a stamp file skips
/// re-extraction on later launches) and return `dest`. `Ok(None)` = no pack (public builds).
pub fn unpack_embedded(exe: &Path, dest: &Path) -> Result<Option<PathBuf>, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = fs::File::open(exe).map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    if len < PACK_TRAILER {
        return Ok(None);
    }
    let mut t = [0u8; 24];
    f.seek(SeekFrom::Start(len - PACK_TRAILER)).map_err(|e| e.to_string())?;
    f.read_exact(&mut t).map_err(|e| e.to_string())?;
    if &t[16..24] != PACK_MAGIC {
        return Ok(None);
    }
    let idx_len = u64::from_le_bytes(t[0..8].try_into().unwrap());
    let start = u64::from_le_bytes(t[8..16].try_into().unwrap());
    let idx_at = len.checked_sub(PACK_TRAILER + idx_len).ok_or("内置模型包损坏")?;
    if start > idx_at || idx_len > 16 * 1024 * 1024 || idx_at - start > MAX_PACK_BYTES {
        return Err("内置模型包损坏".into());
    }
    let stamp_val = format!("{len}-{idx_len}-{start}");
    let stamp = dest.join(".pack-stamp");
    if fs::read_to_string(&stamp).map(|s| s == stamp_val).unwrap_or(false) {
        return Ok(Some(dest.to_path_buf()));
    }
    let mut j = vec![0u8; idx_len as usize];
    f.seek(SeekFrom::Start(idx_at)).map_err(|e| e.to_string())?;
    f.read_exact(&mut j).map_err(|e| e.to_string())?;
    let idx: PackIndex = serde_json::from_slice(&j).map_err(|_| "内置模型包损坏".to_string())?;
    let _ = fs::remove_dir_all(dest);
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for e in &idx.files {
        let rel = safe_rel(&e.path).ok_or("内置模型包里有无效路径")?;
        if e.offset.checked_add(e.size).map(|end| end > idx_at - start).unwrap_or(true) {
            return Err("内置模型包损坏".into());
        }
        let out = dest.join(rel);
        if let Some(d) = out.parent() {
            fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        f.seek(SeekFrom::Start(start + e.offset)).map_err(|e| e.to_string())?;
        let mut w = fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut (&mut f).take(e.size), &mut w).map_err(|e| e.to_string())?;
    }
    fs::write(&stamp, stamp_val).map_err(|e| e.to_string())?;
    Ok(Some(dest.to_path_buf()))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!("l2d-{tag}-{}-{}", std::process::id(), uuid::Uuid::new_v4()));
            fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn make_model(dir: &Path, name: &str) -> PathBuf {
        fs::create_dir_all(dir.join(format!("{name}.4096"))).unwrap();
        fs::write(dir.join(format!("{name}.moc3")), b"MOC3").unwrap();
        fs::write(dir.join(format!("{name}.4096/texture_00.png")), b"png").unwrap();
        let j = dir.join(format!("{name}.model3.json"));
        fs::write(
            &j,
            format!(r#"{{"Version":3,"FileReferences":{{"Moc":"{name}.moc3","Textures":["{name}.4096/texture_00.png"]}}}}"#),
        )
        .unwrap();
        j
    }
    fn make_core(p: &Path) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, vec![b'x'; 20_000]).unwrap();
    }

    #[test]
    fn needs_import_logic() {
        let none = |_: &str| false;
        let all = |_: &str| true;
        assert!(!needs_import("svg", "", "", &none));
        assert!(needs_import("auto", "", "", &none));
        assert!(needs_import("live2d", "/live2d/models/a/a.model3.json", "", &none), "bundled model missing in CI dmg");
        assert!(!needs_import("live2d", "/live2d/models/a/a.model3.json", "", &all), "local build with bundled assets");
        assert!(needs_import("auto", "/definitely/missing/a.model3.json", "/missing/core.js", &all));
        let t = Tmp::new("ni");
        let m = make_model(&t.0, "neko");
        let c = t.0.join(CORE_FILE);
        make_core(&c);
        assert!(!needs_import("auto", m.to_str().unwrap(), c.to_str().unwrap(), &none));
        assert!(needs_import("auto", m.to_str().unwrap(), "", &none), "core missing");
    }

    #[test]
    fn validates_model_files() {
        let t = Tmp::new("valid");
        let m = make_model(&t.0.join("a"), "a");
        assert!(model_is_valid(&m));
        fs::remove_file(t.0.join("a/a.moc3")).unwrap();
        assert!(!model_is_valid(&m));
    }

    #[test]
    fn samples_are_not_auto_picked() {
        assert!(is_sample_model(Path::new("/x/CubismSdkForWeb-5-r.4/Samples/Resources/Haru/Haru.model3.json")));
        assert!(is_sample_model(Path::new("/x/hiyori/hiyori_free_t08.model3.json")));
        assert!(!is_sample_model(Path::new("/x/女仆猫娘/maid_neko.model3.json")));
    }

    #[test]
    fn imports_model_from_old_checkout_and_core_from_sdk_zip() {
        let home = Tmp::new("home");
        let h = &home.0;
        let app = h.join("Library/Application Support/com.desktoppet.app/live2d");
        // old checkout with the user's model; a sample model in Downloads that must lose
        let proj = h.join("Desktop/lingdot-desktop-pet/apps/desktop/public/live2d/models/女仆猫娘");
        make_model(&proj, "maid");
        make_model(&h.join("Downloads/CubismSdkForWeb-5-r.4/Samples/Resources/Haru"), "Haru");
        // SDK zip with Core inside
        let sdk_src = Tmp::new("sdk");
        make_core(&sdk_src.0.join("CubismSdkForWeb-5-r.4/Core").join(CORE_FILE));
        let zip = h.join("Downloads/CubismSdkForWeb-5-r.4.zip");
        let zipped = Command::new("zip")
            .current_dir(&sdk_src.0)
            .args(["-qr"])
            .arg(&zip)
            .arg("CubismSdkForWeb-5-r.4")
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        let roots = ScanRoots::standard(h, &app);
        let out = scan_and_import(&roots, Some("/live2d/models/女仆猫娘/maid.model3.json"), false);
        let mp = PathBuf::from(out.model_path.clone().expect("model imported"));
        assert!(mp.starts_with(&app), "copied into app data: {mp:?}");
        assert!(mp.ends_with("models/女仆猫娘/maid.model3.json"));
        assert!(model_is_valid(&mp));
        if zipped {
            assert!(out.complete(), "{}", out.message);
            assert!(app.join(CORE_FILE).is_file());
            assert!(out.core_source.unwrap().ends_with(".zip"));
            // second run reuses the import without scanning
            let again = scan_and_import(&roots, Some(mp.to_str().unwrap()), false);
            assert!(again.already_imported);
            assert_eq!(again.model_path, out.model_path);
        }
    }

    #[test]
    fn nothing_found_gives_friendly_message() {
        let home = Tmp::new("empty");
        let app = home.0.join("appdata/live2d");
        let out = scan_and_import(&ScanRoots::standard(&home.0, &app), None, false);
        assert!(out.model_path.is_none() && out.core_path.is_none());
        assert!(out.message.contains("下载"));
    }

    #[test]
    fn picked_folder_imports_even_core_next_to_model() {
        let home = Tmp::new("pick");
        let folder = home.0.join("somewhere/MyCat");
        make_model(&folder, "cat");
        make_core(&folder.join(CORE_FILE));
        let app = home.0.join("appdata/live2d");
        let out = scan_and_import(&ScanRoots::folder(&home.0, &app, &folder), None, true);
        assert!(out.complete(), "{}", out.message);
        assert!(PathBuf::from(out.model_path.unwrap()).starts_with(&app));
    }

    #[test]
    fn safe_names() {
        assert_eq!(safe_dir_name("a/b:c"), "a_b_c");
        assert_eq!(safe_dir_name(".."), "model");
        assert_eq!(safe_dir_name("女仆猫娘"), "女仆猫娘");
    }

    #[test]
    fn model_zip_is_copied_out_of_staging() {
        let home = Tmp::new("zipmodel");
        let h = &home.0;
        let app = h.join("appdata/live2d");
        let src = Tmp::new("zipsrc");
        make_model(&src.0.join("BOOTH-maid/free1"), "free1");
        fs::create_dir_all(h.join("Downloads")).unwrap();
        let zip = h.join("Downloads/BOOTH-maid.zip");
        let zipped = Command::new("zip").current_dir(&src.0).args(["-qr"]).arg(&zip).arg("BOOTH-maid").status().map(|s| s.success()).unwrap_or(false);
        if !zipped {
            return;
        }
        let out = scan_and_import(&ScanRoots::standard(h, &app), None, false);
        let mp = PathBuf::from(out.model_path.expect("model from zip"));
        assert!(mp.is_file(), "imported model must survive staging cleanup: {mp:?}");
        assert!(!mp.to_string_lossy().contains(".staging"));
        assert!(model_is_valid(&mp));
    }

    #[test]
    fn exe_dir_model_and_core_import_and_win() {
        // Portable layout: <dir>/LingdotPet.exe + <dir>/xiaomiao-live2d/{free1/…, live2dcubismcore.min.js}
        let home = Tmp::new("exedir");
        let h = &home.0;
        let app = h.join("appdata/live2d");
        let exe_dir = h.join("D/灵点桌宠");
        make_model(&exe_dir.join("xiaomiao-live2d/free1"), "free1");
        make_core(&exe_dir.join("xiaomiao-live2d").join(CORE_FILE));
        make_model(&h.join("Downloads/other"), "other"); // newer elsewhere, must lose
        let mut roots = ScanRoots::standard(h, &app);
        roots.preferred.push(exe_dir.clone());
        let out = scan_and_import(&roots, None, false);
        assert!(out.complete(), "{}", out.message);
        let mp = PathBuf::from(out.model_path.unwrap());
        assert!(mp.starts_with(&app) && mp.ends_with("models/free1/free1.model3.json"), "{mp:?}");
        assert!(app.join(CORE_FILE).is_file());
    }

    #[test]
    fn embedded_pack_roundtrip() {
        let d = Tmp::new("pack");
        let exe = d.0.join("LingdotPet.exe");
        fs::write(&exe, b"MZ fake exe body").unwrap();
        assert_eq!(unpack_embedded(&exe, &d.0.join("out")).unwrap(), None, "no pack in public builds");
        let model = r#"{"Version":3,"FileReferences":{"Moc":"free1.moc3","Textures":["free1.4096/texture_00.png"]}}"#;
        append_pack(
            &exe,
            &[
                ("xiaomiao-live2d/free1/free1.model3.json".into(), model.as_bytes().to_vec()),
                ("xiaomiao-live2d/free1/free1.moc3".into(), b"MOC3".to_vec()),
                ("xiaomiao-live2d/free1/free1.4096/texture_00.png".into(), b"png".to_vec()),
                (format!("xiaomiao-live2d/{CORE_FILE}"), vec![b'x'; 20_000]),
            ],
        )
        .unwrap();
        assert!(fs::read(&exe).unwrap().starts_with(b"MZ fake exe body"));
        let out = d.0.join("out");
        assert_eq!(unpack_embedded(&exe, &out).unwrap(), Some(out.clone()));
        assert!(model_is_valid(&out.join("xiaomiao-live2d/free1/free1.model3.json")));
        assert_eq!(fs::read(out.join("xiaomiao-live2d/free1/free1.moc3")).unwrap(), b"MOC3");
        // second launch: stamp hit, files untouched
        fs::write(out.join("marker"), b"1").unwrap();
        unpack_embedded(&exe, &out).unwrap();
        assert!(out.join("marker").is_file());
        // and the scanner imports it
        let app = d.0.join("appdata/live2d");
        let mut roots = ScanRoots::standard(d.0.join("home"), &app);
        roots.preferred.push(out.clone());
        assert!(scan_and_import(&roots, None, false).complete());
    }

    #[test]
    fn pack_rejects_path_traversal() {
        let d = Tmp::new("packbad");
        let exe = d.0.join("x.exe");
        fs::write(&exe, b"MZ").unwrap();
        append_pack(&exe, &[("../../evil.txt".into(), b"no".to_vec())]).unwrap();
        assert!(unpack_embedded(&exe, &d.0.join("out")).is_err());
        assert!(!d.0.join("evil.txt").exists());
    }

    #[test]
    fn plain_path_strips_windows_verbatim_prefix() {
        assert_eq!(plain_path(Path::new(r"\\?\C:\Users\张三\AppData\Roaming\x\a.model3.json")), r"C:\Users\张三\AppData\Roaming\x\a.model3.json");
        assert_eq!(plain_path(Path::new(r"\\?\UNC\server\share\m.model3.json")), r"\\server\share\m.model3.json");
        assert_eq!(plain_path(Path::new("/Users/d/Library/Application Support/x/m.model3.json")), "/Users/d/Library/Application Support/x/m.model3.json");
        // a verbatim path that is not a drive path is left alone
        assert_eq!(plain_path(Path::new(r"\\?\Volume{abc}\m")), r"\\?\Volume{abc}\m");
    }

    #[test]
    fn unicode_and_space_paths_import_from_embedded_pack() {
        // A user profile / exe folder with CJK + spaces (e.g. C:\Users\张 三\下载\灵点桌宠 免安装\).
        let d = Tmp::new("uni");
        let base = d.0.join("张 三/下载/灵点桌宠 免安装");
        fs::create_dir_all(&base).unwrap();
        let exe = base.join("LingdotPet.exe");
        fs::write(&exe, b"MZ").unwrap();
        let model = r#"{"Version":3,"FileReferences":{"Moc":"free1.moc3","Textures":["free1.4096/texture_00.png"]}}"#;
        append_pack(
            &exe,
            &[
                ("xiaomiao-live2d/free1/free1.model3.json".into(), model.as_bytes().to_vec()),
                ("xiaomiao-live2d/free1/free1.moc3".into(), b"MOC3".to_vec()),
                ("xiaomiao-live2d/free1/free1.4096/texture_00.png".into(), b"png".to_vec()),
                (format!("xiaomiao-live2d/{CORE_FILE}"), vec![b'x'; 20_000]),
            ],
        )
        .unwrap();
        let data = d.0.join("张 三/AppData/Roaming/com.desktoppet.app");
        let unpacked = unpack_embedded(&exe, &data.join("embedded-pack")).unwrap().expect("pack");
        let app = data.join("live2d");
        let mut roots = ScanRoots::standard(d.0.join("张 三"), &app);
        roots.preferred.push(unpacked);
        roots.preferred.push(base.clone());
        let out = scan_and_import(&roots, None, false);
        assert!(out.complete(), "{}", out.message);
        let mp = PathBuf::from(out.model_path.clone().unwrap());
        assert!(mp.starts_with(&app), "{mp:?}");
        // every file the model references resolves next to the imported model3.json
        assert!(mp.parent().unwrap().join("free1.moc3").is_file());
        assert!(mp.parent().unwrap().join("free1.4096/texture_00.png").is_file());
        // second launch reuses the import without rescanning
        let again = scan_and_import(&roots, out.model_path.as_deref(), false);
        assert!(again.already_imported && again.model_path == out.model_path);
    }
}
