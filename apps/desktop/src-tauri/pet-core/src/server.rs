//! Local event server for the Chrome extension.
//!
//! Security properties (each covered by tests below):
//!  - binds ONLY to 127.0.0.1 (never 0.0.0.0 / ::)
//!  - `Host` must be 127.0.0.1:<port> or localhost:<port> (DNS-rebinding guard)
//!  - `Origin` must be chrome-extension://<id> (optionally a pinned id); web origins rejected
//!  - `Authorization: Bearer <token>` compared in constant time; token is rotatable
//!  - body limit 16 KiB, strict JSON schema
//!  - only three endpoints; no command execution, no file access

use crate::engine::{Effect, Engine};
use crate::model::now_ms;
use crate::protocol::{validate_bytes, ProtocolError, MAX_BODY_BYTES};
use crate::security::{bearer, host_allowed, origin_allowed, token_eq};
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, RwLock};
use tokio::net::TcpListener;

pub const BIND_ADDR: Ipv4Addr = Ipv4Addr::LOCALHOST;

/// Mutable auth configuration shared with the app (token rotation, pinned extension id).
#[derive(Default)]
pub struct AuthConfig {
    token: RwLock<String>,
    extension_id: RwLock<String>,
}

impl AuthConfig {
    pub fn new(token: String, extension_id: String) -> Self {
        Self { token: RwLock::new(token), extension_id: RwLock::new(extension_id) }
    }
    pub fn token(&self) -> String {
        self.token.read().map(|t| t.clone()).unwrap_or_default()
    }
    pub fn set_token(&self, t: String) {
        if let Ok(mut w) = self.token.write() {
            *w = t;
        }
    }
    pub fn extension_id(&self) -> String {
        self.extension_id.read().map(|t| t.clone()).unwrap_or_default()
    }
    pub fn set_extension_id(&self, id: String) {
        if let Ok(mut w) = self.extension_id.write() {
            *w = id;
        }
    }
}

pub type EffectSink = Arc<dyn Fn(Vec<Effect>) + Send + Sync>;

#[derive(Clone)]
pub struct ServerState {
    pub engine: Arc<Engine>,
    pub auth: Arc<AuthConfig>,
    pub port: u16,
    pub sink: EffectSink,
}

/// Bind to 127.0.0.1:<preferred>, falling back to a random free loopback port.
pub async fn bind_loopback(preferred: u16) -> std::io::Result<TcpListener> {
    match TcpListener::bind(SocketAddr::from((BIND_ADDR, preferred))).await {
        Ok(l) => Ok(l),
        Err(_) => TcpListener::bind(SocketAddr::from((BIND_ADDR, 0))).await,
    }
}

pub fn router(state: ServerState) -> Router {
    Router::new()
        .route("/v1/health", get(health).options(preflight))
        .route("/v1/sites", get(sites).options(preflight))
        .route("/v1/events", post(events).options(preflight))
        .fallback(not_found)
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(state)
}

pub async fn serve(listener: TcpListener, state: ServerState) -> std::io::Result<()> {
    let addr = listener.local_addr()?;
    assert!(addr.ip().is_loopback(), "server must only bind to loopback");
    axum::serve(listener, router(state)).await
}

fn json_err(status: StatusCode, msg: &str, origin: Option<&str>) -> Response {
    let mut r = (status, Json(json!({ "ok": false, "error": msg }))).into_response();
    if let Some(o) = origin {
        add_cors(r.headers_mut(), o);
    }
    r
}

fn add_cors(h: &mut HeaderMap, origin: &str) {
    if let Ok(v) = HeaderValue::from_str(origin) {
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, v);
        h.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
}

fn header_str<'a>(h: &'a HeaderMap, name: header::HeaderName) -> Option<&'a str> {
    h.get(name).and_then(|v| v.to_str().ok())
}

/// Host + Origin checks. Returns the allowed origin.
fn check_origin(st: &ServerState, h: &HeaderMap) -> Result<String, Response> {
    if !host_allowed(header_str(h, header::HOST), st.port) {
        return Err(json_err(StatusCode::FORBIDDEN, "forbidden host", None));
    }
    let origin = header_str(h, header::ORIGIN);
    if !origin_allowed(origin, &st.auth.extension_id()) {
        return Err(json_err(StatusCode::FORBIDDEN, "forbidden origin", None));
    }
    Ok(origin.unwrap_or_default().to_string())
}

/// Host + Origin + Bearer token.
fn guard(st: &ServerState, h: &HeaderMap) -> Result<String, Response> {
    let origin = check_origin(st, h)?;
    let token = bearer(header_str(h, header::AUTHORIZATION));
    match token {
        Some(t) if token_eq(t, &st.auth.token()) => Ok(origin),
        _ => Err(json_err(StatusCode::UNAUTHORIZED, "unauthorized", Some(&origin))),
    }
}

async fn preflight(State(st): State<ServerState>, h: HeaderMap) -> Response {
    let origin = match check_origin(&st, &h) {
        Ok(o) => o,
        Err(r) => return r,
    };
    let mut r = StatusCode::NO_CONTENT.into_response();
    let hm = r.headers_mut();
    add_cors(hm, &origin);
    hm.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, OPTIONS"));
    hm.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("authorization, content-type"));
    hm.insert(header::ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("600"));
    r
}

async fn not_found(method: Method) -> Response {
    let _ = method;
    json_err(StatusCode::NOT_FOUND, "not found", None)
}

async fn health(State(st): State<ServerState>, h: HeaderMap) -> Response {
    let origin = match guard(&st, &h) {
        Ok(o) => o,
        Err(r) => return r,
    };
    let mut r = Json(json!({ "ok": true, "app": "desktop-pet", "version": env!("CARGO_PKG_VERSION"), "protocol": 1 }))
        .into_response();
    add_cors(r.headers_mut(), &origin);
    r
}

async fn sites(State(st): State<ServerState>, h: HeaderMap) -> Response {
    let origin = match guard(&st, &h) {
        Ok(o) => o,
        Err(r) => return r,
    };
    let list = {
        let db = st.engine.db();
        let settings = db.get_settings().ok();
        let global = settings.map_or(true, |s| s.monitor_enabled);
        db.list_sites()
            .unwrap_or_default()
            .into_iter()
            .filter(|s| global && s.enabled && s.monitor_enabled)
            .filter_map(|s| {
                let u = url::Url::parse(&s.url).ok()?;
                let origin = u.origin().ascii_serialization();
                Some(json!({ "id": s.id, "name": s.name, "url": s.url, "origin": origin, "adapterType": s.adapter_type }))
            })
            .collect::<Vec<_>>()
    };
    let mut r = Json(json!({ "ok": true, "sites": list })).into_response();
    add_cors(r.headers_mut(), &origin);
    r
}

async fn events(State(st): State<ServerState>, h: HeaderMap, body: Bytes) -> Response {
    let origin = match guard(&st, &h) {
        Ok(o) => o,
        Err(r) => return r,
    };
    let ct_ok = header_str(&h, header::CONTENT_TYPE).map_or(false, |c| c.starts_with("application/json"));
    if !ct_ok {
        return json_err(StatusCode::UNSUPPORTED_MEDIA_TYPE, "content-type must be application/json", Some(&origin));
    }
    let env = match validate_bytes(&body) {
        Ok(e) => e,
        Err(ProtocolError::TooLarge) => return json_err(StatusCode::PAYLOAD_TOO_LARGE, "body too large", Some(&origin)),
        Err(e) => return json_err(StatusCode::BAD_REQUEST, &e.to_string(), Some(&origin)),
    };
    let engine = st.engine.clone();
    let result = tokio::task::spawn_blocking(move || engine.handle(&env, now_ms())).await;
    match result {
        Ok(Ok((outcome, effects))) => {
            if !effects.is_empty() {
                (st.sink)(effects);
            }
            let mut r = Json(json!({ "ok": true, "result": outcome.as_str() })).into_response();
            add_cors(r.headers_mut(), &origin);
            r
        }
        _ => json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal error", Some(&origin)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use std::sync::Mutex;
    use tower::ServiceExt;

    const EXT: &str = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const TOKEN: &str = "test-token-0123456789";
    const PORT: u16 = 17321;

    fn state() -> (ServerState, Arc<Mutex<Vec<Effect>>>) {
        let collected = Arc::new(Mutex::new(vec![]));
        let c2 = collected.clone();
        let st = ServerState {
            engine: Arc::new(Engine::new(Db::open_in_memory().unwrap())),
            auth: Arc::new(AuthConfig::new(TOKEN.into(), String::new())),
            port: PORT,
            sink: Arc::new(move |fx| c2.lock().unwrap().extend(fx)),
        };
        (st, collected)
    }

    fn valid_body(id: &str) -> String {
        json!({"v":1,"id":id,"type":"task.status_changed","ts":1,"clientId":"client_0001",
            "payload":{"taskKey":"chatgpt:c:1","adapter":"chatgpt","url":"https://chatgpt.com/c/1","title":"t",
              "observed":"running","signals":{"executing":true},"evidence":["execution_indicator"],"confidence":0.9,"visible":true}})
        .to_string()
    }

    fn req(method: &str, path: &str, origin: Option<&str>, token: Option<&str>, body: String) -> Request<Body> {
        let mut b = Request::builder()
            .method(method)
            .uri(path)
            .header(header::HOST, format!("127.0.0.1:{PORT}"))
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(o) = origin {
            b = b.header(header::ORIGIN, o);
        }
        if let Some(t) = token {
            b = b.header(header::AUTHORIZATION, format!("Bearer {t}"));
        }
        b.body(Body::from(body)).unwrap()
    }

    async fn send(st: &ServerState, r: Request<Body>) -> (StatusCode, serde_json::Value, HeaderMap) {
        let resp = router(st.clone()).oneshot(r).await.unwrap();
        let status = resp.status();
        let headers = resp.headers().clone();
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let v = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
        (status, v, headers)
    }

    #[tokio::test]
    async fn binds_only_to_loopback() {
        let l = bind_loopback(0).await.unwrap();
        let addr = l.local_addr().unwrap();
        assert_eq!(addr.ip(), std::net::IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert!(addr.ip().is_loopback());
        assert_ne!(addr.ip(), std::net::IpAddr::V4(Ipv4Addr::UNSPECIFIED));
        assert_eq!(BIND_ADDR, Ipv4Addr::new(127, 0, 0, 1));
        // Preferred port busy -> falls back to another loopback port.
        let l2 = bind_loopback(addr.port()).await.unwrap();
        assert_ne!(l2.local_addr().unwrap().port(), addr.port());
        assert!(l2.local_addr().unwrap().ip().is_loopback());
    }

    #[tokio::test]
    async fn end_to_end_over_real_socket() {
        let (st, collected) = state();
        let l = bind_loopback(0).await.unwrap();
        let port = l.local_addr().unwrap().port();
        let st = ServerState { port, ..st };
        tokio::spawn(serve(l, st));
        // raw HTTP/1.1 over TCP to the loopback socket
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let body = valid_body("sock_0001");
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let reqs = format!(
            "POST /v1/events HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {EXT}\r\nAuthorization: Bearer {TOKEN}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        s.write_all(reqs.as_bytes()).await.unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).await.unwrap();
        assert!(out.starts_with("HTTP/1.1 200"), "{out}");
        assert!(out.contains("\"accepted\""));
        assert!(!collected.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn accepts_valid_event() {
        let (st, collected) = state();
        let (s, v, h) = send(&st, req("POST", "/v1/events", Some(EXT), Some(TOKEN), valid_body("ok_000001"))).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["result"], "accepted");
        assert_eq!(h.get(header::ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(), EXT);
        assert!(collected.lock().unwrap().iter().any(|e| matches!(e, Effect::TasksChanged)));
        let (_, v, _) = send(&st, req("POST", "/v1/events", Some(EXT), Some(TOKEN), valid_body("ok_000001"))).await;
        assert_eq!(v["result"], "duplicate");
    }

    #[tokio::test]
    async fn rejects_missing_or_wrong_token() {
        let (st, _) = state();
        let (s, _, _) = send(&st, req("POST", "/v1/events", Some(EXT), None, valid_body("a0000001"))).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
        let (s, _, _) = send(&st, req("POST", "/v1/events", Some(EXT), Some("wrong"), valid_body("a0000002"))).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
        let (s, _, _) = send(&st, req("GET", "/v1/health", Some(EXT), Some("wrong"), String::new())).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn token_rotation_invalidates_old_token() {
        let (st, _) = state();
        st.auth.set_token("new-token-abcdefghijkl".into());
        let (s, _, _) = send(&st, req("GET", "/v1/health", Some(EXT), Some(TOKEN), String::new())).await;
        assert_eq!(s, StatusCode::UNAUTHORIZED);
        let (s, v, _) = send(&st, req("GET", "/v1/health", Some(EXT), Some("new-token-abcdefghijkl"), String::new())).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(v["ok"], true);
    }

    #[tokio::test]
    async fn rejects_web_origins_and_missing_origin() {
        let (st, _) = state();
        for o in [Some("https://evil.com"), Some("http://localhost:3000"), Some("null"), None] {
            let (s, _, h) = send(&st, req("POST", "/v1/events", o, Some(TOKEN), valid_body("o0000001"))).await;
            assert_eq!(s, StatusCode::FORBIDDEN, "{o:?}");
            assert!(h.get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
        }
        // preflight from a web origin is rejected too
        let (s, _, _) = send(&st, req("OPTIONS", "/v1/events", Some("https://evil.com"), None, String::new())).await;
        assert_eq!(s, StatusCode::FORBIDDEN);
        let (s, _, h) = send(&st, req("OPTIONS", "/v1/events", Some(EXT), None, String::new())).await;
        assert_eq!(s, StatusCode::NO_CONTENT);
        assert!(h.get(header::ACCESS_CONTROL_ALLOW_HEADERS).is_some());
    }

    #[tokio::test]
    async fn pinned_extension_id() {
        let (st, _) = state();
        st.auth.set_extension_id("pppppppppppppppppppppppppppppppp".into());
        let (s, _, _) = send(&st, req("GET", "/v1/health", Some(EXT), Some(TOKEN), String::new())).await;
        assert_eq!(s, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn rejects_bad_host_header() {
        let (st, _) = state();
        let r = Request::builder()
            .method("GET")
            .uri("/v1/health")
            .header(header::HOST, "attacker.example:17321")
            .header(header::ORIGIN, EXT)
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
            .body(Body::empty())
            .unwrap();
        let (s, _, _) = send(&st, r).await;
        assert_eq!(s, StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn rejects_oversize_body() {
        let (st, _) = state();
        let big = format!("{{\"pad\":\"{}\"}}", "x".repeat(MAX_BODY_BYTES + 10));
        let (s, _, _) = send(&st, req("POST", "/v1/events", Some(EXT), Some(TOKEN), big)).await;
        assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn rejects_invalid_schema() {
        let (st, _) = state();
        let bad = [
            "{nope".to_string(),
            json!({"v":1,"id":"x0000001","type":"system.exec","ts":1,"clientId":"client_0001","payload":{}}).to_string(),
            json!({"v":1,"id":"x0000002","type":"task.status_changed","ts":1,"clientId":"client_0001","payload":{"cmd":"rm -rf /"}}).to_string(),
            json!({"v":1,"id":"x0000003","type":"monitor.heartbeat","ts":1,"clientId":"client_0001","payload":{"activeTabs":1},"extra":true}).to_string(),
        ];
        for b in bad {
            let (s, v, _) = send(&st, req("POST", "/v1/events", Some(EXT), Some(TOKEN), b.clone())).await;
            assert_eq!(s, StatusCode::BAD_REQUEST, "{b}");
            assert_eq!(v["ok"], false);
        }
    }

    #[tokio::test]
    async fn rejects_non_json_content_type_and_unknown_routes() {
        let (st, _) = state();
        let r = Request::builder()
            .method("POST")
            .uri("/v1/events")
            .header(header::HOST, format!("127.0.0.1:{PORT}"))
            .header(header::ORIGIN, EXT)
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
            .header(header::CONTENT_TYPE, "text/plain")
            .body(Body::from(valid_body("ct000001")))
            .unwrap();
        let (s, _, _) = send(&st, r).await;
        assert_eq!(s, StatusCode::UNSUPPORTED_MEDIA_TYPE);
        let (s, _, _) = send(&st, req("GET", "/v1/exec", Some(EXT), Some(TOKEN), String::new())).await;
        assert_eq!(s, StatusCode::NOT_FOUND);
        let (s, _, _) = send(&st, req("GET", "/etc/passwd", Some(EXT), Some(TOKEN), String::new())).await;
        assert_eq!(s, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn sites_endpoint_lists_only_monitored() {
        let (st, _) = state();
        let (s, v, _) = send(&st, req("GET", "/v1/sites", Some(EXT), Some(TOKEN), String::new())).await;
        assert_eq!(s, StatusCode::OK);
        let sites = v["sites"].as_array().unwrap();
        assert_eq!(sites.len(), 1);
        assert_eq!(sites[0]["origin"], "https://chatgpt.com");
    }
}
