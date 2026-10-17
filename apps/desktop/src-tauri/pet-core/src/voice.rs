//! Free voice chat: pure helpers for the conversation loop (the macOS speech
//! recognizer and the `say` voice are wired up in the Tauri crate).
//!
//! listen → (silence) → utterance → chat → speak → listen …

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VoicePhase {
    /// Not listening, not speaking.
    #[default]
    Idle,
    Listening,
    /// Waiting for the chat reply.
    Thinking,
    Speaking,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum VoiceMode {
    /// Nothing running.
    #[default]
    Off,
    /// Hold-to-talk: one utterance, then back to Off after the reply.
    PushToTalk,
    /// 「实时对话」: listen → reply → listen again until turned off.
    Live,
}

/// End-of-utterance detection from the recognizer's partial transcripts:
/// the user finished talking when the transcript has not changed for `silence_ms`.
#[derive(Debug, Clone)]
pub struct UtteranceDetector {
    pub silence_ms: i64,
    text: String,
    last_change: i64,
}

impl UtteranceDetector {
    pub fn new(silence_ms: i64) -> Self {
        Self { silence_ms, text: String::new(), last_change: 0 }
    }

    pub fn reset(&mut self, now: i64) {
        self.text.clear();
        self.last_change = now;
    }

    pub fn text(&self) -> &str {
        &self.text
    }

    /// Feed the latest (cumulative) transcript. Returns true when it changed.
    pub fn feed(&mut self, transcript: &str, now: i64) -> bool {
        let t = transcript.trim();
        if t == self.text {
            return false;
        }
        self.text = t.to_string();
        self.last_change = now;
        true
    }

    /// The finished utterance once the user has been quiet long enough (consumes it).
    pub fn poll(&mut self, now: i64) -> Option<String> {
        if meaningful_len(&self.text) >= 1 && now - self.last_change >= self.silence_ms {
            let t = std::mem::take(&mut self.text);
            self.last_change = now;
            return Some(t);
        }
        None
    }

    /// Recognizer said "final" (or push-to-talk released): take whatever we have.
    pub fn finish(&mut self, now: i64) -> Option<String> {
        self.last_change = now;
        let t = std::mem::take(&mut self.text);
        (meaningful_len(&t) >= 1).then_some(t)
    }
}

fn is_punct(c: char) -> bool {
    c.is_whitespace() || c.is_ascii_punctuation() || "，。！？、；：“”‘’（）《》…—～·「」".contains(c)
}

/// Characters that carry content (no punctuation / spaces).
pub fn meaningful_len(s: &str) -> usize {
    s.chars().filter(|c| !is_punct(*c)).count()
}

/// While 小喵 is speaking the microphone also hears her. A transcript is treated as
/// echo when most of its characters occur in what she is saying.
pub fn is_probable_echo(heard: &str, speaking: &str) -> bool {
    let heard: Vec<char> = heard.chars().filter(|c| !is_punct(*c)).collect();
    if heard.is_empty() {
        return true;
    }
    let spoken: std::collections::HashSet<char> = speaking.chars().filter(|c| !is_punct(*c)).collect();
    let hits = heard.iter().filter(|c| spoken.contains(c)).count();
    hits * 10 >= heard.len() * 7
}

/// Barge-in: the user really started talking over 小喵 (not echo, not a cough).
pub fn is_barge_in(heard: &str, speaking: &str) -> bool {
    meaningful_len(heard) >= 2 && !is_probable_echo(heard, speaking)
}

/// Make a chat reply suitable for TTS: drop markdown, links, emoji and short stage
/// directions like （脸红）, collapse whitespace, cap the length at a sentence end.
pub fn speech_text(reply: &str, max_chars: usize) -> String {
    let mut out = String::new();
    let mut chars = reply.chars().peekable();
    let mut paren: Option<(char, String)> = None;
    while let Some(c) = chars.next() {
        if let Some((close, buf)) = paren.as_mut() {
            if c == *close {
                let keep = buf.chars().count() > 12;
                let text = std::mem::take(buf);
                paren = None;
                if keep {
                    out.push_str(&text);
                }
            } else {
                buf.push(c);
            }
            continue;
        }
        match c {
            '（' => paren = Some(('）', String::new())),
            '(' => paren = Some((')', String::new())),
            '*' | '_' | '#' | '`' | '>' | '~' => {}
            'h' if reply_has_url_at(&mut chars) => {
                // skip the rest of the URL
                while let Some(n) = chars.peek() {
                    if n.is_whitespace() || "，。！？）)".contains(*n) {
                        break;
                    }
                    chars.next();
                }
            }
            c if is_emoji(c) => {}
            c if c.is_whitespace() => {
                if !out.ends_with(' ') && !out.is_empty() {
                    out.push(' ');
                }
            }
            c => out.push(c),
        }
    }
    if let Some((_, buf)) = paren {
        out.push_str(&buf);
    }
    let out = out.trim().to_string();
    if out.chars().count() <= max_chars {
        return out;
    }
    let cut: String = out.chars().take(max_chars).collect();
    match cut.rfind(['。', '！', '？', '!', '?', '…']) {
        Some(i) if i > cut.len() / 2 => cut[..i + cut[i..].chars().next().map(|c| c.len_utf8()).unwrap_or(1)].to_string(),
        _ => cut,
    }
}

fn reply_has_url_at(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> bool {
    let ahead: String = chars.clone().take(7).collect();
    ahead.starts_with("ttp://") || ahead.starts_with("ttps://")
}

fn is_emoji(c: char) -> bool {
    let u = c as u32;
    (0x1F000..=0x1FAFF).contains(&u) || (0x2600..=0x27BF).contains(&u) || (0xFE00..=0xFE0F).contains(&u) || u == 0x200D
}

// -------------------------------------------------------------- system voices

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemVoice {
    pub name: String,
    /// e.g. zh_CN, zh_TW, zh_HK
    pub locale: String,
    pub sample: String,
}

/// Parse `say -v '?'`:
/// `Tingting             zh_CN    # 你好！我叫婷婷。`
/// `Eddy (中文（中国大陆）) zh_CN    # 你好！我叫Eddy。`
pub fn parse_say_voices(output: &str) -> Vec<SystemVoice> {
    let mut v = Vec::new();
    for line in output.lines() {
        let (left, sample) = match line.split_once('#') {
            Some((l, s)) => (l, s.trim()),
            None => (line, ""),
        };
        let left = left.trim_end();
        let Some(idx) = left.rfind(char::is_whitespace) else { continue };
        let locale = left[idx..].trim();
        let name = left[..idx].trim();
        let loc_ok = locale.len() >= 4
            && locale.contains('_')
            && locale.split('_').next().map(|l| l.chars().all(|c| c.is_ascii_lowercase())).unwrap_or(false);
        if name.is_empty() || !loc_ok {
            continue;
        }
        v.push(SystemVoice { name: name.to_string(), locale: locale.to_string(), sample: sample.to_string() });
    }
    v
}

/// Chinese voices only (zh_CN first, then zh_TW / zh_HK).
pub fn chinese_voices(all: Vec<SystemVoice>) -> Vec<SystemVoice> {
    let mut zh: Vec<SystemVoice> = all.into_iter().filter(|v| v.locale.starts_with("zh")).collect();
    zh.sort_by_key(|v| match v.locale.as_str() {
        "zh_CN" => 0,
        "zh_TW" => 1,
        _ => 2,
    });
    zh
}

/// Cute default: 婷婷 (Tingting) > 美佳 (Meijia) > Lili > Yu-shu > any zh_CN > any zh.
pub fn pick_default_voice(voices: &[SystemVoice]) -> Option<String> {
    // macOS voices first (unchanged), then the Windows SAPI ones (Huihui / Yaoyao / Hanhan …)
    for pref in ["Tingting", "Meijia", "Lili", "Yu-shu", "Shasha", "Microsoft Xiaoxiao", "Microsoft Huihui", "Microsoft Yaoyao", "Microsoft Hanhan"] {
        if let Some(v) = voices.iter().find(|v| v.name == pref || v.name.starts_with(&format!("{pref} "))) {
            return Some(v.name.clone());
        }
    }
    voices.iter().find(|v| v.locale == "zh_CN").or_else(|| voices.first()).map(|v| v.name.clone())
}

/// `say -r` words per minute for a speed multiplier (1.0 ≈ the system default).
pub fn say_rate_wpm(multiplier: f64) -> u32 {
    let m = if multiplier.is_finite() { multiplier.clamp(0.5, 2.0) } else { 1.0 };
    (185.0 * m).round() as u32
}

/// Parse the PowerShell System.Speech listing used on Windows: one `Name|zh-CN` per line.
pub fn parse_sapi_voices(output: &str) -> Vec<SystemVoice> {
    output
        .lines()
        .filter_map(|l| {
            let (name, culture) = l.trim().split_once('|')?;
            let name = name.trim();
            let culture = culture.trim();
            if name.is_empty() || culture.len() < 2 {
                return None;
            }
            Some(SystemVoice { name: name.to_string(), locale: culture.replace('-', "_"), sample: String::new() })
        })
        .collect()
}

/// SAPI `SpeechSynthesizer.Rate` (-10..=10) for a speed multiplier (1.0 = 0).
pub fn sapi_rate(multiplier: f64) -> i32 {
    let m = if multiplier.is_finite() { multiplier.clamp(0.5, 2.0) } else { 1.0 };
    let r = if m >= 1.0 { (m - 1.0) * 10.0 } else { (m - 1.0) * 20.0 };
    (r.round() as i32).clamp(-10, 10)
}

/// Keep the voice-chat context short (last `keep` messages).
pub fn trim_history<T: Clone>(history: &[T], keep: usize) -> Vec<T> {
    let n = history.len();
    history[n.saturating_sub(keep)..].to_vec()
}

#[cfg(test)]
mod tests {
    #[test]
    fn sapi_voices_and_rate() {
        let v = parse_sapi_voices("Microsoft Huihui Desktop|zh-CN\r\nMicrosoft Zira Desktop|en-US\r\n\r\nbroken");
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].locale, "zh_CN");
        let zh = chinese_voices(v);
        assert_eq!(zh.len(), 1);
        assert_eq!(pick_default_voice(&zh).as_deref(), Some("Microsoft Huihui Desktop"));
        assert_eq!(sapi_rate(1.0), 0);
        assert_eq!(sapi_rate(2.0), 10);
        assert_eq!(sapi_rate(0.5), -10);
        assert_eq!(sapi_rate(f64::NAN), 0);
    }

    use super::*;

    #[test]
    fn utterance_ends_after_silence() {
        let mut d = UtteranceDetector::new(1200);
        d.reset(0);
        assert_eq!(d.poll(5000), None, "nothing said yet");
        assert!(d.feed("今天", 100));
        assert!(d.feed("今天天气", 600));
        assert!(!d.feed("今天天气 ", 900), "whitespace-only change is no change");
        assert_eq!(d.poll(1700), None);
        assert_eq!(d.poll(1800).as_deref(), Some("今天天气"));
        assert_eq!(d.poll(5000), None, "consumed");
    }

    #[test]
    fn punctuation_only_is_not_an_utterance() {
        let mut d = UtteranceDetector::new(500);
        d.feed("。", 0);
        assert_eq!(d.poll(2000), None);
        d.feed("嗯？", 2100);
        assert_eq!(d.finish(2200).as_deref(), Some("嗯？"));
        assert_eq!(d.finish(2300), None);
    }

    #[test]
    fn echo_and_barge_in() {
        let speaking = "哼，主人又熬夜了？笨蛋，熬夜会变丑的。";
        assert!(is_probable_echo("主人又熬夜了", speaking));
        assert!(is_probable_echo("", speaking));
        assert!(!is_probable_echo("帮我订个闹钟", speaking));
        assert!(is_barge_in("等一下停停", speaking));
        assert!(!is_barge_in("嗯", speaking));
        assert!(!is_barge_in("熬夜会变丑", speaking));
    }

    #[test]
    fn speech_text_cleans_reply() {
        assert_eq!(speech_text("**哼**，才不是（脸红）关心你呢😳", 300), "哼，才不是关心你呢");
        assert_eq!(speech_text("看这里 https://example.com/a?b=1 好吗", 300), "看这里 好吗");
        assert_eq!(speech_text("# 标题\n\n第一行\n第二行", 300), "标题 第一行 第二行");
        let long = "这是一句话。".repeat(20);
        let s = speech_text(&long, 50);
        assert!(s.chars().count() <= 50);
        assert!(s.ends_with('。'));
        // long parenthesised content is kept
        assert!(speech_text("（这是一段很长很长很长的括号里的内容哦）", 300).contains("很长"));
    }

    #[test]
    fn parses_say_voices() {
        let out = "Alex                en_US    # Most people recognize me by my voice.\nTingting            zh_CN    # 你好！我叫婷婷。\nMeijia              zh_TW    # 你好，我叫美佳。\nEddy (中文（中国大陆）) zh_CN    # 你好！我叫Eddy。\nSinji               zh_HK    # 你好！我叫善怡。\nbroken line\n";
        let all = parse_say_voices(out);
        assert_eq!(all.len(), 5);
        assert_eq!(all[3].name, "Eddy (中文（中国大陆）)");
        assert_eq!(all[3].locale, "zh_CN");
        let zh = chinese_voices(all);
        assert_eq!(zh.iter().map(|v| v.locale.as_str()).collect::<Vec<_>>(), vec!["zh_CN", "zh_CN", "zh_TW", "zh_HK"]);
        assert_eq!(pick_default_voice(&zh).as_deref(), Some("Tingting"));
        assert_eq!(pick_default_voice(&zh[2..]).as_deref(), Some("Meijia"));
        assert_eq!(pick_default_voice(&[]), None);
    }

    #[test]
    fn rate_and_history() {
        assert_eq!(say_rate_wpm(1.0), 185);
        assert_eq!(say_rate_wpm(9.0), 370);
        assert_eq!(say_rate_wpm(f64::NAN), 185);
        assert_eq!(trim_history(&[1, 2, 3, 4, 5], 3), vec![3, 4, 5]);
        assert_eq!(trim_history(&[1], 3), vec![1]);
    }
}
