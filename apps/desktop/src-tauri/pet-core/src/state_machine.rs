//! AUTHORITATIVE task state machine.
//!
//! The TypeScript mirror (`packages/shared/src/state-machine.ts`) follows the same
//! rules; both are tested against `packages/shared/test-vectors/state-machine.json`.
//! See that TS file's header for the rule list.

use crate::model::{ObservedState, TaskStatus};
use std::collections::{HashSet, VecDeque};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    Observed(ObservedState),
    Timeout,
}

#[derive(Debug, Clone)]
pub struct MachineEvent {
    pub event_id: String,
    pub kind: EventKind,
    pub conflict: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunAction {
    None,
    Start,
    End,
}

impl RunAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            RunAction::None => "none",
            RunAction::Start => "start",
            RunAction::End => "end",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NotifyKind {
    Completed,
    Failed,
    NeedsAttention,
}

impl NotifyKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            NotifyKind::Completed => "completed",
            NotifyKind::Failed => "failed",
            NotifyKind::NeedsAttention => "needs_attention",
        }
    }
}

pub const SEEN_EVENT_CAP: usize = 256;

#[derive(Debug, Clone)]
pub struct MachineState {
    pub status: TaskStatus,
    pub active_run_no: Option<i64>,
    pub run_count: i64,
    pub seen_event_ids: VecDeque<String>,
    pub notified_keys: HashSet<String>,
}

impl MachineState {
    pub fn new(status: TaskStatus, active_run_no: Option<i64>, run_count: i64) -> Self {
        Self {
            status,
            active_run_no,
            run_count,
            seen_event_ids: VecDeque::new(),
            notified_keys: HashSet::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Transition {
    pub from: TaskStatus,
    pub to: TaskStatus,
    pub changed: bool,
    pub ignored: bool,
    pub reason: &'static str,
    pub run_action: RunAction,
    pub run_no: Option<i64>,
    pub notify: Option<NotifyKind>,
}

pub fn notify_key(run_no: Option<i64>, kind: NotifyKind) -> String {
    format!("{}:{}", run_no.unwrap_or(0), kind.as_str())
}

/// Apply one event; mutates `s` and returns the transition.
pub fn apply_event(s: &mut MachineState, ev: &MachineEvent) -> Transition {
    let from = s.status;
    let keep = |s: &MachineState, reason: &'static str, ignored: bool| Transition {
        from,
        to: s.status,
        changed: false,
        ignored,
        reason,
        run_action: RunAction::None,
        run_no: s.active_run_no,
        notify: None,
    };

    if s.seen_event_ids.iter().any(|e| e == &ev.event_id) {
        return keep(s, "duplicate_event", true);
    }
    s.seen_event_ids.push_back(ev.event_id.clone());
    while s.seen_event_ids.len() > SEEN_EVENT_CAP {
        s.seen_event_ids.pop_front();
    }

    fn mv(
        s: &mut MachineState,
        from: TaskStatus,
        to: TaskStatus,
        reason: &'static str,
        action: RunAction,
        notify_kind: Option<NotifyKind>,
    ) -> Transition {
        if action == RunAction::Start {
            s.run_count += 1;
            s.active_run_no = Some(s.run_count);
        }
        let run_no = s.active_run_no;
        s.status = to;
        let mut notify = None;
        if let Some(k) = notify_kind {
            let key = notify_key(run_no, k);
            if s.notified_keys.insert(key) {
                notify = Some(k);
            }
        }
        if action == RunAction::End {
            s.active_run_no = None;
        }
        Transition {
            from,
            to,
            changed: from != to,
            ignored: false,
            reason,
            run_action: action,
            run_no,
            notify,
        }
    }

    use ObservedState as O;
    use TaskStatus as T;
    match ev.kind {
        EventKind::Observed(O::Running) => match s.status {
            T::Running => keep(s, "already_running", false),
            T::Completed | T::Failed => mv(s, from, T::Running, "new_run_after_terminal", RunAction::Start, None),
            _ if s.active_run_no.is_none() => mv(s, from, T::Running, "run_started", RunAction::Start, None),
            _ => mv(s, from, T::Running, "run_resumed", RunAction::None, None),
        },
        EventKind::Observed(O::Completed) => {
            if s.status == T::Completed {
                keep(s, "already_completed", false)
            } else if s.active_run_no.is_none() {
                keep(s, "completed_without_active_run", true)
            } else {
                mv(s, from, T::Completed, "explicit_success", RunAction::End, Some(NotifyKind::Completed))
            }
        }
        EventKind::Observed(O::Failed) => match s.status {
            T::Failed => keep(s, "already_failed", false),
            T::Completed => keep(s, "terminal_completed", true),
            _ => {
                let action = if s.active_run_no.is_some() { RunAction::End } else { RunAction::None };
                mv(s, from, T::Failed, "explicit_error", action, Some(NotifyKind::Failed))
            }
        },
        EventKind::Observed(O::NeedsAttention) => match s.status {
            T::NeedsAttention => keep(s, "already_needs_attention", false),
            T::Completed => keep(s, "terminal_completed", true),
            _ => mv(
                s,
                from,
                T::NeedsAttention,
                "attention_required",
                RunAction::None,
                Some(NotifyKind::NeedsAttention),
            ),
        },
        EventKind::Observed(O::Unknown) => {
            if !ev.conflict {
                keep(s, "no_signal", false)
            } else if s.status.is_terminal() {
                keep(s, "conflict_after_terminal", true)
            } else if s.status == T::Unknown {
                keep(s, "already_unknown", false)
            } else {
                mv(s, from, T::Unknown, "conflicting_signals", RunAction::None, None)
            }
        }
        EventKind::Timeout => {
            if s.status != T::Running {
                keep(s, "timeout_not_running", true)
            } else {
                mv(s, from, T::Unknown, "observation_timeout", RunAction::None, None)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const VECTORS: &str = include_str!("../../../../../packages/shared/test-vectors/state-machine.json");

    fn kind_of(s: &str) -> EventKind {
        if s == "timeout" {
            EventKind::Timeout
        } else {
            EventKind::Observed(ObservedState::parse(s).expect("kind"))
        }
    }

    #[test]
    fn shared_vectors() {
        let v: Value = serde_json::from_str(VECTORS).unwrap();
        let cases = v["cases"].as_array().unwrap();
        assert!(cases.len() >= 15);
        for c in cases {
            let name = c["name"].as_str().unwrap();
            let init = &c["initial"];
            let mut st = MachineState::new(
                TaskStatus::parse(init["status"].as_str().unwrap()).unwrap(),
                init["activeRunNo"].as_i64(),
                init["runCount"].as_i64().unwrap(),
            );
            for (i, step) in c["steps"].as_array().unwrap().iter().enumerate() {
                let e = &step["event"];
                let ev = MachineEvent {
                    event_id: e["eventId"].as_str().unwrap().into(),
                    kind: kind_of(e["kind"].as_str().unwrap()),
                    conflict: e["conflict"].as_bool().unwrap_or(false),
                };
                let t = apply_event(&mut st, &ev);
                let x = &step["expect"];
                let ctx = format!("{name} / step {i}");
                if let Some(s) = x.get("status") {
                    assert_eq!(t.to.as_str(), s.as_str().unwrap(), "{ctx} status");
                }
                if let Some(n) = x.get("notify") {
                    assert_eq!(t.notify.map(|k| k.as_str()), n.as_str(), "{ctx} notify");
                }
                if let Some(a) = x.get("runAction") {
                    assert_eq!(t.run_action.as_str(), a.as_str().unwrap(), "{ctx} runAction");
                }
                if let Some(r) = x.get("runNo") {
                    assert_eq!(t.run_no, r.as_i64(), "{ctx} runNo");
                }
                if let Some(ig) = x.get("ignored") {
                    assert_eq!(t.ignored, ig.as_bool().unwrap(), "{ctx} ignored");
                }
                if let Some(r) = x.get("reason") {
                    assert_eq!(t.reason, r.as_str().unwrap(), "{ctx} reason");
                }
            }
        }
    }

    #[test]
    fn random_walk_invariants() {
        let kinds = ["running", "completed", "failed", "needs_attention", "unknown", "timeout"];
        let mut seed: u64 = 99;
        let mut rnd = move || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 33) as usize
        };
        for walk in 0..300 {
            let mut st = MachineState::new(TaskStatus::Pending, None, 0);
            let mut fired = HashSet::new();
            for i in 0..60 {
                let k = kinds[rnd() % kinds.len()];
                let ev = MachineEvent { event_id: format!("{walk}-{i}"), kind: kind_of(k), conflict: rnd() % 2 == 0 };
                let t = apply_event(&mut st, &ev);
                if k == "unknown" || k == "timeout" {
                    assert!(t.notify.is_none());
                    if t.changed {
                        assert!(!t.to.is_terminal());
                    }
                }
                if t.changed && t.to == TaskStatus::Completed {
                    assert_eq!(k, "completed");
                }
                if t.changed && t.to == TaskStatus::Failed {
                    assert_eq!(k, "failed");
                }
                if t.changed && t.to == TaskStatus::Running {
                    assert_eq!(k, "running");
                }
                if let Some(n) = t.notify {
                    assert!(fired.insert(notify_key(t.run_no, n)), "double notify");
                }
            }
        }
    }

    #[test]
    fn seen_ids_capped() {
        let mut st = MachineState::new(TaskStatus::Pending, None, 0);
        for i in 0..1000 {
            apply_event(
                &mut st,
                &MachineEvent { event_id: format!("x{i}"), kind: EventKind::Observed(ObservedState::Unknown), conflict: false },
            );
        }
        assert_eq!(st.seen_event_ids.len(), SEEN_EVENT_CAP);
    }
}
