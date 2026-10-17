#![cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
//! Small helpers for running macOS / Windows command-line tools safely (no shell, with a timeout).

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Run `program args…` and return stdout when it exits successfully within `timeout`.
/// The child is killed on timeout (e.g. an AppleScript waiting on a permission prompt).
pub fn run_with_timeout(program: &str, args: &[&str], timeout: Duration) -> Option<String> {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash for powershell / wmic
    }
    let mut child = cmd
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                child.stdout.take()?.read_to_string(&mut out).ok()?;
                return status.success().then_some(out);
            }
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(30)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}
