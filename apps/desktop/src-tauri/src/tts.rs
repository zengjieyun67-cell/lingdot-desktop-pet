//! Text-to-speech with the free system voice:
//! - macOS: `/usr/bin/say` (unchanged);
//! - Windows: SAPI through PowerShell `System.Speech` (Huihui / Yaoyao …), no window.
//! The text always goes through stdin (never parsed as options / script); stopping kills the process.

#[allow(unused_imports)]
use pet_core::voice::{chinese_voices, parse_sapi_voices, parse_say_voices, pick_default_voice, sapi_rate, say_rate_wpm, SystemVoice};
use std::process::Child;

pub fn supported() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows"))
}

#[cfg(target_os = "windows")]
const PS_LIST: &str = "Add-Type -AssemblyName System.Speech; [Console]::OutputEncoding=[Text.Encoding]::UTF8; \
(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }";

/// Installed Chinese voices (婷婷、美佳 … / Huihui、Yaoyao …).
pub fn list_voices() -> Vec<SystemVoice> {
    #[cfg(target_os = "macos")]
    {
        let out = crate::sys::run_with_timeout("/usr/bin/say", &["-v", "?"], std::time::Duration::from_secs(5)).unwrap_or_default();
        chinese_voices(parse_say_voices(&out))
    }
    #[cfg(target_os = "windows")]
    {
        let out = crate::sys::run_with_timeout("powershell.exe", &["-NoProfile", "-NonInteractive", "-Command", PS_LIST], std::time::Duration::from_secs(8)).unwrap_or_default();
        chinese_voices(parse_sapi_voices(&out))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (chinese_voices as fn(_) -> _, parse_say_voices as fn(&str) -> _, parse_sapi_voices as fn(&str) -> _);
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

/// Start speaking; returns the running `say` / `powershell` process.
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
    #[cfg(target_os = "windows")]
    {
        use std::io::Write;
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // The voice name is an installed-voice name we listed ourselves; quote it for PowerShell anyway.
        let select = voice.map(|v| format!("try {{ $s.SelectVoice('{}') }} catch {{}}; ", v.replace('\'', "''"))).unwrap_or_default();
        let script = format!(
            "Add-Type -AssemblyName System.Speech; [Console]::InputEncoding=[Text.Encoding]::UTF8; \
             $t=[Console]::In.ReadToEnd(); $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; {select}$s.Rate={}; $s.Speak($t)",
            sapi_rate(rate)
        );
        let mut child = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("无法启动系统语音：{e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(text.as_bytes());
        }
        Ok(child)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (text, voice, say_rate_wpm(rate), sapi_rate(rate));
        Err("系统语音仅支持 macOS / Windows".into())
    }
}
