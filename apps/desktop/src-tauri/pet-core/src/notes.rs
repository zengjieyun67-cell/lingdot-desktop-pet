//! 便签 (sticky notes): SQLite CRUD, geometry for floating note windows, reminders,
//! and the 「记一下…」 quick-note parser used by chat and voice.

use crate::db::{Db, DbError, DbResult};
use crate::model::{new_id, now_ms};
use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

pub const NOTE_COLORS: &[&str] = &["yellow", "pink", "mint", "lavender", "sky"];
pub const NOTE_MAX_CHARS: usize = 4000;
pub const NOTE_MIN_W: i64 = 180;
pub const NOTE_MIN_H: i64 = 140;
pub const NOTE_MAX_W: i64 = 900;
pub const NOTE_MAX_H: i64 = 900;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub content: String,
    pub color: String,
    pub pinned: bool,
    /// Shown as its own floating window (restored on startup).
    pub popped: bool,
    pub x: Option<i64>,
    pub y: Option<i64>,
    /// Logical size of the floating window.
    pub w: i64,
    pub h: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub remind_at: Option<i64>,
    pub reminded: bool,
    pub done: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct NoteInput {
    pub content: String,
    pub color: Option<String>,
    pub pinned: bool,
    pub remind_at: Option<i64>,
}

/// Partial update: only the fields that are `Some` change. `remind_at: Some(None)` clears it.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct NotePatch {
    pub content: Option<String>,
    pub color: Option<String>,
    pub pinned: Option<bool>,
    pub done: Option<bool>,
    #[serde(with = "double_option")]
    pub remind_at: Option<Option<i64>>,
}

mod double_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    pub fn serialize<S: Serializer>(v: &Option<Option<i64>>, s: S) -> Result<S::Ok, S::Error> {
        match v {
            None => s.serialize_none(),
            Some(inner) => inner.serialize(s),
        }
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<i64>>, D::Error> {
        Ok(Some(Option::<i64>::deserialize(d)?))
    }
}

const NOTE_COLS: &str = "id,content,color,pinned,popped,x,y,w,h,created_at,updated_at,remind_at,reminded,done";

fn note_from_row(r: &Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: r.get(0)?,
        content: r.get(1)?,
        color: r.get(2)?,
        pinned: r.get::<_, i64>(3)? != 0,
        popped: r.get::<_, i64>(4)? != 0,
        x: r.get(5)?,
        y: r.get(6)?,
        w: r.get(7)?,
        h: r.get(8)?,
        created_at: r.get(9)?,
        updated_at: r.get(10)?,
        remind_at: r.get(11)?,
        reminded: r.get::<_, i64>(12)? != 0,
        done: r.get::<_, i64>(13)? != 0,
    })
}

fn clean_content(s: &str) -> DbResult<String> {
    let c: String = s.chars().filter(|c| !c.is_control() || *c == '\n' || *c == '\t').collect();
    if c.chars().count() > NOTE_MAX_CHARS {
        return Err(DbError::Invalid(format!("便签最多 {NOTE_MAX_CHARS} 个字")));
    }
    Ok(c)
}

fn clean_color(c: Option<&str>) -> String {
    match c {
        Some(c) if NOTE_COLORS.contains(&c) => c.to_string(),
        _ => "yellow".into(),
    }
}

pub fn clamp_note_size(w: i64, h: i64) -> (i64, i64) {
    (w.clamp(NOTE_MIN_W, NOTE_MAX_W), h.clamp(NOTE_MIN_H, NOTE_MAX_H))
}

impl Db {
    /// Pinned first, then most recently edited.
    pub fn list_notes(&self) -> DbResult<Vec<Note>> {
        let mut st = self
            .conn()
            .prepare(&format!("SELECT {NOTE_COLS} FROM notes ORDER BY pinned DESC, updated_at DESC"))?;
        let rows = st.query_map([], note_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn get_note(&self, id: &str) -> DbResult<Note> {
        self.conn()
            .query_row(&format!("SELECT {NOTE_COLS} FROM notes WHERE id=?1"), [id], note_from_row)
            .optional()?
            .ok_or(DbError::NotFound)
    }

    pub fn create_note(&self, input: &NoteInput) -> DbResult<Note> {
        let content = clean_content(&input.content)?;
        let color = clean_color(input.color.as_deref());
        let now = now_ms();
        let id = new_id();
        self.conn().execute(
            "INSERT INTO notes(id,content,color,pinned,created_at,updated_at,remind_at) VALUES(?1,?2,?3,?4,?5,?5,?6)",
            params![id, content, color, input.pinned as i64, now, input.remind_at],
        )?;
        self.get_note(&id)
    }

    pub fn update_note(&self, id: &str, p: &NotePatch) -> DbResult<Note> {
        let mut n = self.get_note(id)?;
        if let Some(c) = &p.content {
            n.content = clean_content(c)?;
        }
        if let Some(c) = &p.color {
            n.color = clean_color(Some(c));
        }
        if let Some(v) = p.pinned {
            n.pinned = v;
        }
        if let Some(v) = p.done {
            n.done = v;
        }
        if let Some(r) = p.remind_at {
            if r != n.remind_at {
                n.reminded = false;
            }
            n.remind_at = r;
        }
        n.updated_at = now_ms().max(n.updated_at);
        self.conn().execute(
            "UPDATE notes SET content=?2,color=?3,pinned=?4,done=?5,remind_at=?6,reminded=?7,updated_at=?8 WHERE id=?1",
            params![id, n.content, n.color, n.pinned as i64, n.done as i64, n.remind_at, n.reminded as i64, n.updated_at],
        )?;
        Ok(n)
    }

    /// Delete and return the note (the UI keeps it for 「撤销」).
    pub fn delete_note(&self, id: &str) -> DbResult<Note> {
        let n = self.get_note(id)?;
        self.conn().execute("DELETE FROM notes WHERE id=?1", [id])?;
        Ok(n)
    }

    /// Undo a delete: put the exact note back (same id, timestamps, geometry).
    pub fn restore_note(&self, n: &Note) -> DbResult<Note> {
        let content = clean_content(&n.content)?;
        let (w, h) = clamp_note_size(n.w, n.h);
        self.conn().execute(
            &format!("INSERT OR REPLACE INTO notes({NOTE_COLS}) VALUES(?1,?2,?3,?4,0,?5,?6,?7,?8,?9,?10,?11,?12,?13)"),
            params![
                n.id,
                content,
                clean_color(Some(&n.color)),
                n.pinned as i64,
                n.x,
                n.y,
                w,
                h,
                n.created_at,
                n.updated_at,
                n.remind_at,
                n.reminded as i64,
                n.done as i64
            ],
        )?;
        self.get_note(&n.id)
    }

    pub fn set_note_popped(&self, id: &str, popped: bool) -> DbResult<()> {
        let n = self.conn().execute("UPDATE notes SET popped=?2 WHERE id=?1", params![id, popped as i64])?;
        if n == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    /// Remember where the floating window is (physical px) and its logical size.
    pub fn set_note_geometry(&self, id: &str, pos: Option<(i64, i64)>, size: Option<(i64, i64)>) -> DbResult<()> {
        if let Some((x, y)) = pos {
            self.conn().execute("UPDATE notes SET x=?2, y=?3 WHERE id=?1", params![id, x, y])?;
        }
        if let Some((w, h)) = size {
            let (w, h) = clamp_note_size(w, h);
            self.conn().execute("UPDATE notes SET w=?2, h=?3 WHERE id=?1", params![id, w, h])?;
        }
        Ok(())
    }

    /// Notes whose reminder is due and not yet fired; marks them as reminded.
    pub fn take_due_reminders(&self, now: i64) -> DbResult<Vec<Note>> {
        let mut st = self.conn().prepare(&format!(
            "SELECT {NOTE_COLS} FROM notes WHERE remind_at IS NOT NULL AND remind_at <= ?1 AND reminded = 0 AND done = 0 ORDER BY remind_at"
        ))?;
        let due: Vec<Note> = st.query_map([now], note_from_row)?.collect::<Result<_, _>>()?;
        for n in &due {
            self.conn().execute("UPDATE notes SET reminded=1 WHERE id=?1", [&n.id])?;
        }
        Ok(due)
    }
}

// ------------------------------------------------------------------ 「记一下…」

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteCommand {
    pub content: String,
    pub remind_at: Option<i64>,
}

const TRIGGERS: &[&str] = &[
    "帮我记一下", "帮我记下", "帮我记个", "帮我记", "给我记一下", "记一下", "记下来", "记下", "记个便签", "记个", "备忘一下", "备忘", "便签",
];

/// Recognise 「记一下 …」 style requests. Returns the note text (trigger stripped) and, when the
/// text names a time (「10分钟后」「明天下午3点」「晚上8点半」「15:30」), the reminder instant.
/// `tz_offset_secs` = local time − UTC.
pub fn parse_note_command(text: &str, now: i64, tz_offset_secs: i64) -> Option<NoteCommand> {
    let t = text.trim().trim_start_matches(|c: char| c == '喵' || c == '，' || c == ',' || c.is_whitespace());
    let t = t.strip_prefix("小喵").unwrap_or(t).trim_start_matches(['，', ',', ' ', '、']);
    let rest = TRIGGERS.iter().find_map(|p| t.strip_prefix(p))?;
    let content: String = rest
        .trim_start_matches(|c: char| c.is_whitespace() || "：:，,、。.~～".contains(c))
        .trim_end()
        .to_string();
    if content.is_empty() {
        return None;
    }
    let remind_at = parse_remind_time(&content, now, tz_offset_secs);
    Some(NoteCommand { content, remind_at })
}

fn cn_digit(c: char) -> Option<i64> {
    Some(match c {
        '零' | '〇' => 0,
        '一' => 1,
        '二' | '两' => 2,
        '三' => 3,
        '四' => 4,
        '五' => 5,
        '六' => 6,
        '七' => 7,
        '八' => 8,
        '九' => 9,
        _ => return c.to_digit(10).map(|d| d as i64),
    })
}

/// Parse a leading number (arabic or 中文 up to 99) from `s`; returns (value, chars consumed).
fn take_number(s: &[char]) -> Option<(i64, usize)> {
    if s.first().map(|c| c.is_ascii_digit()).unwrap_or(false) {
        let n = s.iter().take_while(|c| c.is_ascii_digit()).count();
        let v: String = s[..n].iter().collect();
        return v.parse().ok().map(|v| (v, n));
    }
    let mut i = 0;
    let mut val: i64 = 0;
    let mut cur: Option<i64> = None;
    while i < s.len() {
        let c = s[i];
        if c == '十' {
            val += cur.unwrap_or(1) * 10;
            cur = None;
        } else if let Some(d) = cn_digit(c) {
            if cur.is_some() {
                break;
            }
            cur = Some(d);
        } else {
            break;
        }
        i += 1;
    }
    if i == 0 {
        return None;
    }
    Some((val + cur.unwrap_or(0), i))
}

const DAY_MS: i64 = 86_400_000;

pub fn parse_remind_time(text: &str, now: i64, tz: i64) -> Option<i64> {
    let cs: Vec<char> = text.chars().collect();
    // relative: N分钟后 / N小时后 / 半小时后
    if text.contains("半小时后") || text.contains("半个小时后") {
        return Some(now + 30 * 60_000);
    }
    for i in 0..cs.len() {
        if let Some((n, len)) = take_number(&cs[i..]) {
            let after: String = cs[i + len..].iter().take(4).collect();
            if after.starts_with("分钟后") || after.starts_with("分钟以后") {
                return Some(now + n * 60_000);
            }
            if after.starts_with("小时后") || after.starts_with("个小时后") {
                return Some(now + n * 3_600_000);
            }
        }
    }
    // absolute: [今天|明天|后天][早上|上午|中午|下午|晚上]H点[半|M分] or H:MM
    let day_add = if text.contains("后天") { Some(2) } else if text.contains("明天") || text.contains("明早") || text.contains("明晚") { Some(1) } else if text.contains("今天") || text.contains("今晚") { Some(0) } else { None };
    let pm = ["下午", "晚上", "今晚", "明晚", "傍晚"].iter().any(|k| text.contains(k));
    let noon = text.contains("中午");
    let mut hm: Option<(i64, i64)> = None;
    for i in 0..cs.len() {
        let Some((h, len)) = take_number(&cs[i..]) else { continue };
        let j = i + len;
        match cs.get(j) {
            Some('点') | Some('时') => {
                let mut m = 0;
                if cs.get(j + 1) == Some(&'半') {
                    m = 30;
                } else if let Some((mm, l2)) = take_number(&cs[j + 1..]) {
                    if cs.get(j + 1 + l2) == Some(&'分') || l2 > 0 {
                        m = mm;
                    }
                }
                hm = Some((h, m));
                break;
            }
            Some(':') | Some('：') if cs.get(j + 1).map(|c| c.is_ascii_digit()).unwrap_or(false) => {
                if let Some((mm, _)) = take_number(&cs[j + 1..]) {
                    hm = Some((h, mm));
                    break;
                }
            }
            _ => {}
        }
    }
    let (mut h, m) = hm?;
    if !(0..=24).contains(&h) || !(0..60).contains(&m) {
        return None;
    }
    if (pm && h < 12) || (noon && h < 6) {
        h += 12;
    }
    let local_now = now + tz * 1000;
    let day0 = local_now.div_euclid(DAY_MS) * DAY_MS;
    let mut target = day0 + day_add.unwrap_or(0) * DAY_MS + h * 3_600_000 + m * 60_000;
    if day_add.is_none() && target <= local_now {
        // 「3点」 already passed today: maybe 3pm, else tomorrow.
        if h < 12 && !pm && target + 12 * 3_600_000 > local_now {
            target += 12 * 3_600_000;
        } else {
            target += DAY_MS;
        }
    }
    Some(target - tz * 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crud_order_and_undo() {
        let db = Db::open_in_memory().unwrap();
        let a = db.create_note(&NoteInput { content: "买猫粮".into(), ..Default::default() }).unwrap();
        assert_eq!(a.color, "yellow");
        let b = db
            .create_note(&NoteInput { content: "- [ ] 周报".into(), color: Some("mint".into()), pinned: true, remind_at: None })
            .unwrap();
        let list = db.list_notes().unwrap();
        assert_eq!(list[0].id, b.id, "pinned first");
        let u = db
            .update_note(&a.id, &NotePatch { content: Some("买猫粮 x2".into()), color: Some("nope".into()), ..Default::default() })
            .unwrap();
        assert_eq!(u.content, "买猫粮 x2");
        assert_eq!(u.color, "yellow");
        let gone = db.delete_note(&a.id).unwrap();
        assert!(matches!(db.get_note(&a.id), Err(DbError::NotFound)));
        let back = db.restore_note(&gone).unwrap();
        assert_eq!(back.content, "买猫粮 x2");
        assert_eq!(back.created_at, gone.created_at);
    }

    #[test]
    fn geometry_popped_and_validation() {
        let db = Db::open_in_memory().unwrap();
        let n = db.create_note(&NoteInput::default()).unwrap();
        db.set_note_popped(&n.id, true).unwrap();
        db.set_note_geometry(&n.id, Some((120, 80)), Some((50, 5000))).unwrap();
        let g = db.get_note(&n.id).unwrap();
        assert!(g.popped);
        assert_eq!((g.x, g.y, g.w, g.h), (Some(120), Some(80), NOTE_MIN_W, NOTE_MAX_H));
        assert!(db.set_note_popped("missing", true).is_err());
        let long = "字".repeat(NOTE_MAX_CHARS + 1);
        assert!(db.create_note(&NoteInput { content: long, ..Default::default() }).is_err());
    }

    #[test]
    fn reminders_fire_once_and_reset_on_change() {
        let db = Db::open_in_memory().unwrap();
        let n = db.create_note(&NoteInput { content: "喝水".into(), remind_at: Some(1_000), ..Default::default() }).unwrap();
        assert!(db.take_due_reminders(500).unwrap().is_empty());
        assert_eq!(db.take_due_reminders(1_500).unwrap().len(), 1);
        assert!(db.take_due_reminders(2_000).unwrap().is_empty());
        db.update_note(&n.id, &NotePatch { remind_at: Some(Some(3_000)), ..Default::default() }).unwrap();
        assert_eq!(db.take_due_reminders(3_000).unwrap().len(), 1);
        db.update_note(&n.id, &NotePatch { remind_at: Some(Some(4_000)), done: Some(true), ..Default::default() }).unwrap();
        assert!(db.take_due_reminders(5_000).unwrap().is_empty(), "done notes stay quiet");
        let cleared = db.update_note(&n.id, &NotePatch { remind_at: Some(None), ..Default::default() }).unwrap();
        assert_eq!(cleared.remind_at, None);
        // JSON: absent field = unchanged, explicit null = clear
        let p: NotePatch = serde_json::from_str(r#"{"remindAt":null}"#).unwrap();
        assert_eq!(p.remind_at, Some(None));
        let p: NotePatch = serde_json::from_str(r#"{"pinned":true}"#).unwrap();
        assert_eq!(p.remind_at, None);
    }

    // 2026-10-16 10:00 in UTC+8 == 02:00 UTC
    const TZ: i64 = 8 * 3600;
    fn local(day: i64, h: i64, m: i64) -> i64 {
        // local midnight (UTC+8) of 2026-10-16: day 20742 since the epoch
        let midnight = 20_742 * DAY_MS - TZ * 1000;
        midnight + day * DAY_MS + h * 3_600_000 + m * 60_000
    }

    #[test]
    fn local_helper_sane() {
        let now = local(0, 10, 0);
        assert_eq!(parse_remind_time("今天10点", now - 60_000, TZ), Some(now));
    }

    #[test]
    fn parses_note_commands() {
        let now = local(0, 10, 0);
        assert_eq!(parse_note_command("今天天气不错", now, TZ), None);
        assert_eq!(parse_note_command("记一下", now, TZ), None);
        let c = parse_note_command("记一下：买猫粮", now, TZ).unwrap();
        assert_eq!(c, NoteCommand { content: "买猫粮".into(), remind_at: None });
        let c = parse_note_command("小喵，帮我记一下 10分钟后关火", now, TZ).unwrap();
        assert_eq!(c.content, "10分钟后关火");
        assert_eq!(c.remind_at, Some(now + 10 * 60_000));
        let c = parse_note_command("记下 明天下午3点开会", now, TZ).unwrap();
        assert_eq!(c.remind_at, Some(local(1, 15, 0)));
        let c = parse_note_command("记一下晚上八点半给妈妈打电话", now, TZ).unwrap();
        assert_eq!(c.remind_at, Some(local(0, 20, 30)));
        let c = parse_note_command("备忘 15:45 交作业", now, TZ).unwrap();
        assert_eq!(c.remind_at, Some(local(0, 15, 45)));
        let c = parse_note_command("记一下两小时后取快递", now, TZ).unwrap();
        assert_eq!(c.remind_at, Some(now + 2 * 3_600_000));
        let c = parse_note_command("记一下 半小时后喝水", now, TZ).unwrap();
        assert_eq!(c.remind_at, Some(now + 30 * 60_000));
    }

    #[test]
    fn past_times_roll_forward() {
        let now = local(0, 10, 0);
        // 9点 already passed -> 21:00 today
        assert_eq!(parse_remind_time("9点", now, TZ), Some(local(0, 21, 0)));
        // 9:00 morning explicitly with 下午? no: 下午2点 -> 14:00 today
        assert_eq!(parse_remind_time("下午2点", now, TZ), Some(local(0, 14, 0)));
        // 晚上9点 at 23:00 -> tomorrow 21:00
        assert_eq!(parse_remind_time("晚上9点", local(0, 23, 0), TZ), Some(local(1, 21, 0)));
        assert_eq!(parse_remind_time("十二点", now, TZ), Some(local(0, 12, 0)));
        assert_eq!(parse_remind_time("没有时间", now, TZ), None);
    }
}
