//! Window / cursor geometry shared by the pet window and the 桌面模式 scene.
//!
//! Everything here is plain math so it can be unit-tested without a display:
//! the Tauri side reads physical pixels + scale factors from the OS and asks
//! these helpers for logical (CSS px) values.

/// A rectangle in logical points (macOS points / Windows DIPs / CSS px).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LogicalRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// A usable scale factor: anything non-finite or ≤ 0 counts as 1.0.
pub fn sane_scale(scale: f64) -> f64 {
    if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    }
}

/// The logical frame of a monitor from the physical position / size the OS reports.
///
/// The monitor's physical numbers were produced with the *monitor's* scale factor, so
/// they must be turned back into points with that same factor. (Handing the physical
/// size straight to a window makes the window convert it with *its own* factor; when the
/// two disagree — e.g. a fresh hidden window on a Retina screen — the 桌面模式 scene came
/// up at half the screen.)
pub fn monitor_logical_frame(pos: (i32, i32), size: (u32, u32), monitor_scale: f64) -> LogicalRect {
    let s = sane_scale(monitor_scale);
    LogicalRect { x: pos.0 as f64 / s, y: pos.1 as f64 / s, w: size.0 as f64 / s, h: size.1 as f64 / s }
}

/// Same, from a window's physical inner geometry and the window's own scale factor.
pub fn window_logical_frame(pos: (i32, i32), size: (u32, u32), window_scale: f64) -> LogicalRect {
    monitor_logical_frame(pos, size, window_scale)
}

/// Does a window frame differ from where it should be by more than `tol` points on any edge?
pub fn frame_mismatch(actual: LogicalRect, target: LogicalRect, tol: f64) -> bool {
    (actual.x - target.x).abs() > tol
        || (actual.y - target.y).abs() > tol
        || (actual.w - target.w).abs() > tol
        || (actual.h - target.h).abs() > tol
}

/// Global cursor (physical px) → position inside a window (logical px, origin = the
/// window's content top-left). This is what the webview's `clientX/clientY` would be.
pub fn window_local_cursor(cursor: (f64, f64), inner_pos: (i32, i32), window_scale: f64) -> (f64, f64) {
    let s = sane_scale(window_scale);
    ((cursor.0 - inner_pos.0 as f64) / s, (cursor.1 - inner_pos.1 as f64) / s)
}

/// 桌宠模式: cursor offset from the pet's head (centre-x, 38 % down), logical px.
pub fn pet_head_offset(cursor: (f64, f64), outer_pos: (i32, i32), outer_size: (u32, u32), window_scale: f64) -> (f64, f64) {
    let s = sane_scale(window_scale);
    let cx = outer_pos.0 as f64 + outer_size.0 as f64 / 2.0;
    let cy = outer_pos.1 as f64 + outer_size.1 as f64 * 0.38;
    (((cursor.0 - cx) / s).round(), ((cursor.1 - cy) / s).round())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retina_monitor_maps_to_points() {
        // 14" MacBook Pro default: 3024×1964 px at 2x = 1512×982 pt
        let f = monitor_logical_frame((0, 0), (3024, 1964), 2.0);
        assert_eq!(f, LogicalRect { x: 0.0, y: 0.0, w: 1512.0, h: 982.0 });
    }

    #[test]
    fn half_screen_bug_is_detected() {
        // what the old code produced: physical numbers converted with the wrong factor
        let target = monitor_logical_frame((0, 0), (2880, 1800), 2.0);
        let wrong = LogicalRect { x: 0.0, y: 0.0, w: 720.0, h: 450.0 };
        assert!(frame_mismatch(wrong, target, 2.0));
        assert!(!frame_mismatch(LogicalRect { x: 0.0, y: 0.0, w: 1440.5, h: 899.0 }, target, 2.0));
    }

    #[test]
    fn secondary_monitor_offset_and_scale() {
        // external 1x monitor to the right of a 2x laptop (Windows-style virtual desktop)
        let f = monitor_logical_frame((2880, 0), (2560, 1440), 1.0);
        assert_eq!((f.x, f.y, f.w, f.h), (2880.0, 0.0, 2560.0, 1440.0));
        // 150 % Windows monitor
        let f = monitor_logical_frame((-2880, -300), (2880, 1620), 1.5);
        assert_eq!((f.x, f.y, f.w, f.h), (-1920.0, -200.0, 1920.0, 1080.0));
    }

    #[test]
    fn bad_scale_falls_back_to_one() {
        assert_eq!(sane_scale(0.0), 1.0);
        assert_eq!(sane_scale(f64::NAN), 1.0);
        assert_eq!(monitor_logical_frame((0, 0), (800, 600), -2.0).w, 800.0);
    }

    #[test]
    fn cursor_inside_retina_window() {
        // window content at physical (100, 50) on a 2x screen; cursor at physical (1100, 650)
        let (x, y) = window_local_cursor((1100.0, 650.0), (100, 50), 2.0);
        assert_eq!((x, y), (500.0, 300.0));
    }

    #[test]
    fn cursor_on_other_monitor_can_be_negative() {
        let (x, y) = window_local_cursor((-400.0, 200.0), (0, 0), 1.0);
        assert_eq!((x, y), (-400.0, 200.0));
    }

    #[test]
    fn pet_head_offset_matches_old_math() {
        // 200×240 pt pet at 2x → 400×480 px, at physical (1000, 1000); head at (1200, 1182.4)
        let (dx, dy) = pet_head_offset((1200.0, 1182.0), (1000, 1000), (400, 480), 2.0);
        assert_eq!((dx, dy), (0.0, -0.0));
        let (dx, dy) = pet_head_offset((1400.0, 1000.0), (1000, 1000), (400, 480), 2.0);
        assert_eq!((dx, dy), (100.0, -91.0));
    }
}
