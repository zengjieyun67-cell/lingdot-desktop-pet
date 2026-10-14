//! Strict protocol validation (security boundary).
//! Mirrors `packages/shared/src/protocol-validation.ts`; both are tested against
//! `packages/shared/test-vectors/protocol.json`.

use crate::model::ObservedState;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub const PROTOCOL_VERSION: i64 = 1;
pub const MAX_BODY_BYTES: usize = 16 * 1024;
const MAX_URL: usize = 2048;
const MAX_TITLE: usize = 300;
const MAX_SIGNALS: usize = 32;
const MAX_EVIDENCE: usize = 16;
const MAX_TS: f64 = 10_000_000_000_000.0;

#[derive(Debug, Clone, PartialEq)]
pub enum MessageType {
    MonitorConnected,
    MonitorDisconnected,
    MonitorHeartbeat,
    TaskObserved,
    TaskStatusChanged,
    TaskCompleted,
    TaskFailed,
    TaskNeedsAttention,
}

impl MessageType {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "monitor.connected" => Self::MonitorConnected,
            "monitor.disconnected" => Self::MonitorDisconnected,
            "monitor.heartbeat" => Self::MonitorHeartbeat,
            "task.observed" => Self::TaskObserved,
            "task.status_changed" => Self::TaskStatusChanged,
            "task.completed" => Self::TaskCompleted,
            "task.failed" => Self::TaskFailed,
            "task.needs_attention" => Self::TaskNeedsAttention,
            _ => return None,
        })
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::MonitorConnected => "monitor.connected",
            Self::MonitorDisconnected => "monitor.disconnected",
            Self::MonitorHeartbeat => "monitor.heartbeat",
            Self::TaskObserved => "task.observed",
            Self::TaskStatusChanged => "task.status_changed",
            Self::TaskCompleted => "task.completed",
            Self::TaskFailed => "task.failed",
            Self::TaskNeedsAttention => "task.needs_attention",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SignalValue {
    Bool(bool),
    Num(f64),
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaskObservation {
    pub task_key: String,
    pub previous_task_key: Option<String>,
    pub adapter: String,
    pub url: String,
    pub title: String,
    pub observed: ObservedState,
    pub signals: BTreeMap<String, SignalValue>,
    pub evidence: Vec<String>,
    pub confidence: f64,
    pub visible: bool,
    pub conflict: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Payload {
    Connected { extension_version: String, browser: Option<String> },
    Disconnected { reason: Option<String> },
    Heartbeat { active_tabs: i64 },
    Task(TaskObservation),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Envelope {
    pub id: String,
    pub msg_type: MessageType,
    pub ts: i64,
    pub client_id: String,
    pub payload: Payload,
}

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ProtocolError {
    #[error("body too large")]
    TooLarge,
    #[error("invalid JSON")]
    InvalidJson,
    #[error("{0}")]
    Schema(String),
}

fn err<T>(msg: impl Into<String>) -> Result<T, ProtocolError> {
    Err(ProtocolError::Schema(msg.into()))
}

fn is_id(s: &str) -> bool {
    (8..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn is_task_key(s: &str) -> bool {
    (1..=256).contains(&s.len()) && s.bytes().all(|b| (0x21..=0x7e).contains(&b))
}
fn is_signal_key(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 48
        && b[0].is_ascii_alphabetic()
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_')
}
fn is_evidence(s: &str) -> bool {
    (1..=64).contains(&s.len())
        && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_:.-".contains(&b))
}
fn is_version(s: &str) -> bool {
    (1..=32).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"._+-".contains(&b))
}
fn is_http_url(s: &str) -> bool {
    if s.len() > MAX_URL {
        return false;
    }
    let lower = s.get(..8).unwrap_or(s).to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return false;
    }
    match url::Url::parse(s) {
        Ok(u) => (u.scheme() == "http" || u.scheme() == "https") && u.host_str().map_or(false, |h| !h.is_empty()),
        Err(_) => false,
    }
}

/// JS `string.length` counts UTF-16 code units; mirror that for max-length rules.
fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn check_keys(obj: &Map<String, Value>, allowed: &[&str], ctx: &str) -> Result<(), ProtocolError> {
    for k in obj.keys() {
        if !allowed.contains(&k.as_str()) {
            return err(format!("{ctx}: unrecognized key '{k}'"));
        }
    }
    Ok(())
}

fn req_str<'a>(obj: &'a Map<String, Value>, key: &str, ctx: &str) -> Result<&'a str, ProtocolError> {
    match obj.get(key) {
        Some(Value::String(s)) => Ok(s),
        _ => err(format!("{ctx}.{key}: expected string")),
    }
}
fn opt_str<'a>(obj: &'a Map<String, Value>, key: &str, ctx: &str) -> Result<Option<&'a str>, ProtocolError> {
    match obj.get(key) {
        None => Ok(None),
        Some(Value::String(s)) => Ok(Some(s)),
        _ => err(format!("{ctx}.{key}: expected string")),
    }
}
fn is_integer(n: &serde_json::Number) -> Option<i64> {
    if let Some(i) = n.as_i64() {
        return Some(i);
    }
    n.as_f64().filter(|f| f.fract() == 0.0 && f.abs() < 9.0e15).map(|f| f as i64)
}

fn parse_task(p: &Map<String, Value>) -> Result<TaskObservation, ProtocolError> {
    let ctx = "payload";
    check_keys(
        p,
        &["taskKey", "previousTaskKey", "adapter", "url", "title", "observed", "signals", "evidence", "confidence", "visible", "conflict"],
        ctx,
    )?;
    let task_key = req_str(p, "taskKey", ctx)?;
    if !is_task_key(task_key) {
        return err("payload.taskKey: invalid");
    }
    let previous_task_key = opt_str(p, "previousTaskKey", ctx)?;
    if let Some(k) = previous_task_key {
        if !is_task_key(k) {
            return err("payload.previousTaskKey: invalid");
        }
    }
    let adapter = req_str(p, "adapter", ctx)?;
    if !crate::model::ADAPTER_TYPES.contains(&adapter) {
        return err("payload.adapter: invalid enum value");
    }
    let url = req_str(p, "url", ctx)?;
    if !is_http_url(url) {
        return err("payload.url: must be an absolute http(s) URL");
    }
    let title = req_str(p, "title", ctx)?;
    if js_len(title) > MAX_TITLE {
        return err("payload.title: too long");
    }
    let observed = ObservedState::parse(req_str(p, "observed", ctx)?).ok_or_else(|| ProtocolError::Schema("payload.observed: invalid enum value".into()))?;
    let signals_obj = match p.get("signals") {
        Some(Value::Object(o)) => o,
        _ => return err("payload.signals: expected object"),
    };
    if signals_obj.len() > MAX_SIGNALS {
        return err("payload.signals: too many");
    }
    let mut signals = BTreeMap::new();
    for (k, v) in signals_obj {
        if !is_signal_key(k) {
            return err("payload.signals: invalid signal key");
        }
        let sv = match v {
            Value::Bool(b) => SignalValue::Bool(*b),
            Value::Number(n) => match n.as_f64() {
                Some(f) if f.is_finite() => SignalValue::Num(f),
                _ => return err("payload.signals: non-finite number"),
            },
            _ => return err(format!("payload.signals.{k}: expected boolean or number")),
        };
        signals.insert(k.clone(), sv);
    }
    let evidence = match p.get("evidence") {
        Some(Value::Array(a)) => {
            if a.len() > MAX_EVIDENCE {
                return err("payload.evidence: too many");
            }
            let mut out = Vec::with_capacity(a.len());
            for e in a {
                match e {
                    Value::String(s) if is_evidence(s) => out.push(s.clone()),
                    _ => return err("payload.evidence: invalid code"),
                }
            }
            out
        }
        _ => return err("payload.evidence: expected array"),
    };
    let confidence = match p.get("confidence") {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(-1.0),
        _ => return err("payload.confidence: expected number"),
    };
    if !(0.0..=1.0).contains(&confidence) {
        return err("payload.confidence: out of range");
    }
    let visible = match p.get("visible") {
        Some(Value::Bool(b)) => *b,
        _ => return err("payload.visible: expected boolean"),
    };
    let conflict = match p.get("conflict") {
        None => false,
        Some(Value::Bool(b)) => *b,
        _ => return err("payload.conflict: expected boolean"),
    };
    Ok(TaskObservation {
        task_key: task_key.into(),
        previous_task_key: previous_task_key.map(String::from),
        adapter: adapter.into(),
        url: url.into(),
        title: title.chars().filter(|c| !c.is_control()).collect(),
        observed,
        signals,
        evidence,
        confidence,
        visible,
        conflict,
    })
}

/// Validate an already parsed JSON value.
pub fn validate_value(v: &Value) -> Result<Envelope, ProtocolError> {
    let obj = match v {
        Value::Object(o) => o,
        _ => return err("message: expected object"),
    };
    check_keys(obj, &["v", "id", "type", "ts", "clientId", "payload"], "message")?;
    match obj.get("v") {
        Some(Value::Number(n)) if is_integer(n) == Some(PROTOCOL_VERSION) => {}
        _ => return err("v: unsupported protocol version"),
    }
    let id = req_str(obj, "id", "message")?;
    if !is_id(id) {
        return err("id: invalid");
    }
    let msg_type = MessageType::parse(req_str(obj, "type", "message")?).ok_or_else(|| ProtocolError::Schema("type: invalid enum value".into()))?;
    let ts = match obj.get("ts") {
        Some(Value::Number(n)) => match is_integer(n) {
            Some(i) if i > 0 && (i as f64) <= MAX_TS => i,
            _ => return err("ts: expected positive integer"),
        },
        _ => return err("ts: expected number"),
    };
    let client_id = req_str(obj, "clientId", "message")?;
    if !is_id(client_id) {
        return err("clientId: invalid");
    }
    let p = match obj.get("payload") {
        Some(Value::Object(o)) => o,
        _ => return err("payload: expected object"),
    };
    let payload = match msg_type {
        MessageType::MonitorConnected => {
            check_keys(p, &["extensionVersion", "browser"], "payload")?;
            let ver = req_str(p, "extensionVersion", "payload")?;
            if !is_version(ver) {
                return err("payload.extensionVersion: invalid");
            }
            let browser = opt_str(p, "browser", "payload")?;
            if browser.map_or(false, |b| js_len(b) > 64) {
                return err("payload.browser: too long");
            }
            Payload::Connected { extension_version: ver.into(), browser: browser.map(String::from) }
        }
        MessageType::MonitorDisconnected => {
            check_keys(p, &["reason"], "payload")?;
            let reason = opt_str(p, "reason", "payload")?;
            if reason.map_or(false, |r| js_len(r) > 128) {
                return err("payload.reason: too long");
            }
            Payload::Disconnected { reason: reason.map(String::from) }
        }
        MessageType::MonitorHeartbeat => {
            check_keys(p, &["activeTabs"], "payload")?;
            let tabs = match p.get("activeTabs") {
                Some(Value::Number(n)) => match is_integer(n) {
                    Some(i) if (0..=1000).contains(&i) => i,
                    _ => return err("payload.activeTabs: out of range"),
                },
                _ => return err("payload.activeTabs: expected number"),
            };
            Payload::Heartbeat { active_tabs: tabs }
        }
        _ => {
            let t = parse_task(p)?;
            let required = match msg_type {
                MessageType::TaskCompleted => Some(ObservedState::Completed),
                MessageType::TaskFailed => Some(ObservedState::Failed),
                MessageType::TaskNeedsAttention => Some(ObservedState::NeedsAttention),
                _ => None,
            };
            if let Some(r) = required {
                if t.observed != r {
                    return err(format!("payload.observed: does not match {}", msg_type.as_str()));
                }
            }
            Payload::Task(t)
        }
    };
    Ok(Envelope { id: id.into(), msg_type, ts, client_id: client_id.into(), payload })
}

/// Validate a raw body: size, JSON, schema.
pub fn validate_bytes(body: &[u8]) -> Result<Envelope, ProtocolError> {
    if body.len() > MAX_BODY_BYTES {
        return Err(ProtocolError::TooLarge);
    }
    let v: Value = serde_json::from_slice(body).map_err(|_| ProtocolError::InvalidJson)?;
    validate_value(&v)
}

#[cfg(test)]
mod tests {
    use super::*;
    const VECTORS: &str = include_str!("../../../../../packages/shared/test-vectors/protocol.json");

    #[test]
    fn shared_protocol_vectors() {
        let v: Value = serde_json::from_str(VECTORS).unwrap();
        let cases = v["cases"].as_array().unwrap();
        assert!(cases.len() >= 30);
        for c in cases {
            let name = c["name"].as_str().unwrap();
            let expected = c["valid"].as_bool().unwrap();
            let r = validate_value(&c["message"]);
            assert_eq!(r.is_ok(), expected, "{name}: {:?}", r.err());
        }
    }

    #[test]
    fn oversize_and_bad_json() {
        let big = vec![b' '; MAX_BODY_BYTES + 1];
        assert_eq!(validate_bytes(&big), Err(ProtocolError::TooLarge));
        assert_eq!(validate_bytes(b"{nope"), Err(ProtocolError::InvalidJson));
    }

    #[test]
    fn title_control_chars_stripped() {
        let v: Value = serde_json::json!({"v":1,"id":"abcdefgh","type":"task.observed","ts":1,"clientId":"abcdefgh",
            "payload":{"taskKey":"k","adapter":"generic","url":"https://a.com","title":"a\u{0007}b","observed":"unknown","signals":{},"evidence":[],"confidence":0,"visible":true}});
        match validate_value(&v).unwrap().payload {
            Payload::Task(t) => assert_eq!(t.title, "ab"),
            _ => panic!(),
        }
    }
}
