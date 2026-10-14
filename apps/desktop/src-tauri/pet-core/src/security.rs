//! Session token + origin policy helpers.

use subtle::ConstantTimeEq;

/// 64 hex chars (256 bits from two UUIDv4 = 244 random bits; uuid uses the OS CSPRNG).
pub fn generate_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

/// Constant-time token comparison (length mismatch returns false without early exit on content).
pub fn token_eq(provided: &str, expected: &str) -> bool {
    let a = provided.as_bytes();
    let b = expected.as_bytes();
    if a.len() != b.len() || b.is_empty() {
        // still do a dummy comparison to keep timing roughly uniform
        let _ = b.ct_eq(b);
        return false;
    }
    a.ct_eq(b).into()
}

/// Extract the token from an `Authorization: Bearer <token>` header value.
pub fn bearer(header: Option<&str>) -> Option<&str> {
    let h = header?.trim();
    let (scheme, rest) = h.split_once(' ')?;
    if scheme.eq_ignore_ascii_case("bearer") {
        Some(rest.trim())
    } else {
        None
    }
}

/// Only Chrome extension origins are allowed. If `allowed_id` is non-empty the
/// origin must be exactly `chrome-extension://<allowed_id>`.
/// Web origins (http/https), `null`, and missing origins are rejected.
pub fn origin_allowed(origin: Option<&str>, allowed_id: &str) -> bool {
    let Some(o) = origin else { return false };
    let Some(id) = o.strip_prefix("chrome-extension://") else {
        return false;
    };
    let id = id.trim_end_matches('/');
    // Chrome extension ids are 32 chars a-p.
    let valid_shape = id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b));
    if !valid_shape {
        return false;
    }
    allowed_id.is_empty() || id == allowed_id
}

/// DNS-rebinding protection: Host must be loopback with our port.
pub fn host_allowed(host: Option<&str>, port: u16) -> bool {
    match host {
        Some(h) => h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}"),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_shape_and_uniqueness() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), 64);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn token_compare() {
        assert!(token_eq("abc", "abc"));
        assert!(!token_eq("abd", "abc"));
        assert!(!token_eq("ab", "abc"));
        assert!(!token_eq("", ""));
    }

    #[test]
    fn bearer_parse() {
        assert_eq!(bearer(Some("Bearer xyz")), Some("xyz"));
        assert_eq!(bearer(Some("bearer  xyz ")), Some("xyz"));
        assert_eq!(bearer(Some("Basic xyz")), None);
        assert_eq!(bearer(None), None);
    }

    #[test]
    fn origins() {
        let id = "abcdefghijklmnopabcdefghijklmnop";
        let ext = format!("chrome-extension://{id}");
        assert!(origin_allowed(Some(&ext), ""));
        assert!(origin_allowed(Some(&ext), id));
        assert!(!origin_allowed(Some(&ext), "pppppppppppppppppppppppppppppppp"));
        assert!(!origin_allowed(Some("https://evil.com"), ""));
        assert!(!origin_allowed(Some("http://127.0.0.1:3000"), ""));
        assert!(!origin_allowed(Some("null"), ""));
        assert!(!origin_allowed(None, ""));
        assert!(!origin_allowed(Some("chrome-extension://short"), ""));
    }

    #[test]
    fn hosts() {
        assert!(host_allowed(Some("127.0.0.1:17321"), 17321));
        assert!(host_allowed(Some("localhost:17321"), 17321));
        assert!(!host_allowed(Some("evil.com:17321"), 17321));
        assert!(!host_allowed(Some("127.0.0.1:1"), 17321));
        assert!(!host_allowed(None, 17321));
    }
}
