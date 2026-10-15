//! Text-to-speech with the free macOS system voice (`/usr/bin/say`).
//! The text goes through stdin (never parsed as options); stopping kills the process.

use pet_core::voice::{chinese_voices, parse_say_voices, pick_default_voice, say_rate_wpm, SystemVoice};
use std::process::Child;

pub fn supported() -> bool {
    cfg!(target_os = "macos")
}

/// Installed Chinese voices (婷婷、美佳、善怡 …).
pub fn list_voices() -> Vec<SystemVoice> {
    #[cfg(target_os = "macos")]
    {
        let out = crate::sys::run_with_timeout("/usr/bin/say", &["-v", "?"], std::time::Duration::from_secs(5)).unwrap_or_default();
        chinese_voices(parse_say_voices(&out))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (chinese_voices as fn(_) -> _, parse_say_voices as fn(&str) -> _);
        Vec::new()
    }
}

/// Resolve the configured voice ("" = cute default) against what is installed.
pub fn resolve_voice(configured: &str) -> Option<String> {
    let voices = list_voices();
    if !configured.trim().is_empty() && voices.iter().any(|v| v.name == configured) {
        return Some(configured.to_string());
    }
    pick_default_voice(&voices)
}

/// Start speaking; returns the running `say` process.
pub fn spawn_say(text: &str, voice: Option<&str>, rate: f64) -> Result<Child, String> {
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut cmd = Command::new("/usr/bin/say");
        if let Some(v) = voice {
            cmd.arg("-v").arg(v);
        }
        cmd.arg("-r").arg(say_rate_wpm(rate).to_string());
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("无法启动系统语音：{e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(text.as_bytes());
        } // stdin dropped => EOF => say starts speaking
        Ok(child)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (text, voice, say_rate_wpm(rate));
        Err("系统语音仅支持 macOS".into())
    }
}
