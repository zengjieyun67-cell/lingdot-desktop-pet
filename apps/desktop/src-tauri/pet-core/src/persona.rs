//! 小喵's long-term memory (local SQLite only).
//!
//! Derived ONLY from app usage: interactions with the pet, launcher sites opened,
//! times the app is used. Never page content. Pure update rules live here so they
//! are unit-testable; persistence is in `db.rs` (`persona_memory` table).
//! Local day/hour are supplied by the caller (the webview knows the user's timezone).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PersonaMemory {
    /// 好感度 0..100
    pub affinity: f64,
    /// 熟悉度 0..100
    pub familiarity: f64,
    /// neutral | happy | shy | angry | sleepy
    pub today_mood: String,
    /// YYYY-MM-DD (local) the daily counters belong to
    pub today: String,
    pub last_interaction_at: Option<i64>,
    pub streak_days: i64,
    pub last_active_day: Option<String>,
    /// 24 buckets, interactions per local hour
    pub active_hours: Vec<i64>,
    /// siteId -> launches
    pub site_usage: BTreeMap<String, i64>,
    pub late_night_count: i64,
    pub last_late_night_day: Option<String>,
    pub pats_today: i64,
    pub interactions_today: i64,
    pub total_interactions: i64,
}

impl Default for PersonaMemory {
    fn default() -> Self {
        Self {
            affinity: 30.0,
            familiarity: 0.0,
            today_mood: "neutral".into(),
            today: String::new(),
            last_interaction_at: None,
            streak_days: 0,
            last_active_day: None,
            active_hours: vec![0; 24],
            site_usage: BTreeMap::new(),
            late_night_count: 0,
            last_late_night_day: None,
            pats_today: 0,
            interactions_today: 0,
            total_interactions: 0,
        }
    }
}

pub const INTERACTION_KINDS: [&str; 8] = ["click", "pat", "drag", "chat", "launch_site", "task_completed", "ignored", "open"];
pub const EMOTIONS: [&str; 5] = ["neutral", "happy", "shy", "angry", "sleepy"];

const MAX_PATS_COUNTED: i64 = 5;
const MAX_FAMILIARITY_INTERACTIONS_PER_DAY: i64 = 25; // 25 * 0.2 = +5/day

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Parse YYYY-MM-DD into a day number.
pub fn parse_day(s: &str) -> Option<i64> {
    let mut it = s.split('-');
    let y: i64 = it.next()?.parse().ok()?;
    let m: i64 = it.next()?.parse().ok()?;
    let d: i64 = it.next()?.parse().ok()?;
    if it.next().is_some() || !(1..=12).contains(&m) || !(1..=31).contains(&d) || !(1970..=9999).contains(&y) {
        return None;
    }
    Some(days_from_civil(y, m, d))
}

pub fn is_late_night(hour: u32) -> bool {
    hour >= 23 || hour < 5
}

fn clamp100(v: f64) -> f64 {
    (v.clamp(0.0, 100.0) * 10.0).round() / 10.0
}

/// Roll daily counters when the local day changes (streak, familiarity, daily visit bonus).
fn roll_day(m: &mut PersonaMemory, day: &str) {
    if m.today == day {
        return;
    }
    let today_n = parse_day(day);
    let last_n = m.last_active_day.as_deref().and_then(parse_day);
    m.streak_days = match (today_n, last_n) {
        (Some(t), Some(l)) if t - l == 1 => m.streak_days + 1,
        (Some(t), Some(l)) if t == l => m.streak_days.max(1),
        _ => 1,
    };
    m.familiarity = clamp100(m.familiarity + 2.0);
    m.affinity = clamp100(m.affinity + 1.0);
    m.today = day.to_string();
    m.today_mood = "neutral".into();
    m.pats_today = 0;
    m.interactions_today = 0;
    m.last_active_day = Some(day.to_string());
}

/// Apply one interaction. Returns false (and changes nothing) for invalid input.
pub fn apply_interaction(
    m: &mut PersonaMemory,
    kind: &str,
    site_id: Option<&str>,
    day: &str,
    hour: u32,
    now: i64,
) -> bool {
    if !INTERACTION_KINDS.contains(&kind) || hour > 23 || parse_day(day).is_none() {
        return false;
    }
    if m.active_hours.len() != 24 {
        m.active_hours = vec![0; 24];
    }
    if kind == "ignored" {
        // Being ignored doesn't count as activity; it only costs a little affinity.
        m.affinity = clamp100(m.affinity - 2.0);
        return true;
    }
    roll_day(m, day);
    match kind {
        "click" => m.affinity = clamp100(m.affinity + 0.5),
        "pat" => {
            if m.pats_today < MAX_PATS_COUNTED {
                m.affinity = clamp100(m.affinity + 3.0);
            }
            m.pats_today += 1;
        }
        "chat" => m.affinity = clamp100(m.affinity + 1.0),
        "task_completed" => m.affinity = clamp100(m.affinity + 0.5),
        "launch_site" => {
            if let Some(id) = site_id.filter(|s| !s.is_empty() && s.len() <= 64) {
                *m.site_usage.entry(id.to_string()).or_insert(0) += 1;
            }
        }
        _ => {}
    }
    if kind != "open" {
        if m.interactions_today < MAX_FAMILIARITY_INTERACTIONS_PER_DAY {
            m.familiarity = clamp100(m.familiarity + 0.2);
        }
        m.interactions_today += 1;
        m.total_interactions += 1;
    }
    m.active_hours[hour as usize] += 1;
    if is_late_night(hour) && m.last_late_night_day.as_deref() != Some(day) {
        m.late_night_count += 1;
        m.last_late_night_day = Some(day.to_string());
    }
    m.last_interaction_at = Some(now);
    true
}

pub fn set_today_mood(m: &mut PersonaMemory, mood: &str, day: &str) -> bool {
    if !EMOTIONS.contains(&mood) || parse_day(day).is_none() {
        return false;
    }
    roll_day(m, day);
    m.today_mood = mood.to_string();
    true
}

/// Top-N most launched site ids.
pub fn top_sites(m: &PersonaMemory, n: usize) -> Vec<(String, i64)> {
    let mut v: Vec<_> = m.site_usage.iter().map(|(k, c)| (k.clone(), *c)).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v.truncate(n);
    v
}

/// Up to 3 most active hours, e.g. "21点、22点".
pub fn peak_hours(m: &PersonaMemory) -> Vec<usize> {
    let mut v: Vec<(usize, i64)> = m.active_hours.iter().copied().enumerate().filter(|(_, c)| *c > 0).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v.into_iter().take(3).map(|(h, _)| h).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_math() {
        assert_eq!(parse_day("1970-01-01"), Some(0));
        assert_eq!(parse_day("2026-03-01").unwrap() - parse_day("2026-02-28").unwrap(), 1);
        assert_eq!(parse_day("2024-03-01").unwrap() - parse_day("2024-02-28").unwrap(), 2); // leap year
        assert_eq!(parse_day("2027-01-01").unwrap() - parse_day("2026-12-31").unwrap(), 1);
        assert!(parse_day("2026-13-01").is_none());
        assert!(parse_day("nope").is_none());
    }

    #[test]
    fn streak_and_familiarity_by_day() {
        let mut m = PersonaMemory::default();
        assert!(apply_interaction(&mut m, "open", None, "2026-10-12", 9, 1));
        assert_eq!(m.streak_days, 1);
        assert_eq!(m.familiarity, 2.0);
        assert_eq!(m.affinity, 31.0);
        apply_interaction(&mut m, "click", None, "2026-10-13", 9, 2);
        assert_eq!(m.streak_days, 2);
        apply_interaction(&mut m, "click", None, "2026-10-13", 10, 3);
        assert_eq!(m.streak_days, 2);
        apply_interaction(&mut m, "click", None, "2026-10-16", 10, 4); // gap
        assert_eq!(m.streak_days, 1);
    }

    #[test]
    fn pats_are_capped_per_day() {
        let mut m = PersonaMemory::default();
        for i in 0..10 {
            apply_interaction(&mut m, "pat", None, "2026-10-14", 15, i);
        }
        // +1 daily visit + 5 * 3 pats, familiarity +2 day + 10 * 0.2
        assert_eq!(m.affinity, 46.0);
        assert_eq!(m.pats_today, 10);
        assert_eq!(m.familiarity, 4.0);
    }

    #[test]
    fn familiarity_gain_capped_per_day_and_clamped() {
        let mut m = PersonaMemory::default();
        for i in 0..200 {
            apply_interaction(&mut m, "click", None, "2026-10-14", 15, i);
        }
        assert_eq!(m.familiarity, 7.0); // 2 + 25*0.2
        assert_eq!(m.affinity, 100.0); // clamped
        assert_eq!(m.total_interactions, 200);
        assert_eq!(m.active_hours[15], 200);
    }

    #[test]
    fn ignored_lowers_affinity_without_activity() {
        let mut m = PersonaMemory::default();
        apply_interaction(&mut m, "ignored", None, "2026-10-14", 15, 99);
        assert_eq!(m.affinity, 28.0);
        assert_eq!(m.last_interaction_at, None);
        assert_eq!(m.total_interactions, 0);
        m.affinity = 1.0;
        apply_interaction(&mut m, "ignored", None, "2026-10-14", 15, 99);
        assert_eq!(m.affinity, 0.0);
    }

    #[test]
    fn site_usage_and_late_night_habits() {
        let mut m = PersonaMemory::default();
        apply_interaction(&mut m, "launch_site", Some("chatgpt"), "2026-10-14", 23, 1);
        apply_interaction(&mut m, "launch_site", Some("chatgpt"), "2026-10-14", 23, 2);
        apply_interaction(&mut m, "launch_site", Some("bili"), "2026-10-14", 2, 3);
        assert_eq!(m.late_night_count, 1); // once per day
        apply_interaction(&mut m, "click", None, "2026-10-15", 1, 4);
        assert_eq!(m.late_night_count, 2);
        assert_eq!(top_sites(&m, 5), vec![("chatgpt".to_string(), 2), ("bili".to_string(), 1)]);
        assert_eq!(peak_hours(&m)[0], 23);
    }

    #[test]
    fn rejects_bad_input() {
        let mut m = PersonaMemory::default();
        let before = m.clone();
        assert!(!apply_interaction(&mut m, "exec", None, "2026-10-14", 1, 1));
        assert!(!apply_interaction(&mut m, "click", None, "bad", 1, 1));
        assert!(!apply_interaction(&mut m, "click", None, "2026-10-14", 24, 1));
        assert!(!set_today_mood(&mut m, "furious", "2026-10-14"));
        assert_eq!(m, before);
        assert!(set_today_mood(&mut m, "shy", "2026-10-14"));
        assert_eq!(m.today_mood, "shy");
    }
}
