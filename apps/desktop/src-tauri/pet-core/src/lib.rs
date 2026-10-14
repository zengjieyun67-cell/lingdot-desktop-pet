//! pet-core: everything testable without Tauri.
//!
//! - `state_machine` — authoritative task state machine
//! - `protocol`      — strict validation of extension messages
//! - `db`            — SQLite store with migrations
//! - `engine`        — applies messages to the store, emits effects
//! - `server`        — 127.0.0.1-only HTTP endpoint for the extension
//! - `security`      — token generation / constant-time compare / origin policy

pub mod chat;
pub mod db;
pub mod engine;
pub mod model;
pub mod persona;
pub mod protocol;
pub mod security;
pub mod server;
pub mod state_machine;

pub use db::{Db, DbError};
pub use engine::{Effect, Engine, Outcome};
