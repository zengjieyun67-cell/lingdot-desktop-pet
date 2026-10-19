//! Chat providers: every preset speaks the OpenAI-compatible `/chat/completions` API.
//! Pure helpers only (presets, base-URL resolution, per-provider keychain slots,
//! legacy-key migration, readable error messages). The HTTP call and the real
//! keychain live in the Tauri crate. Keep in sync with `src/lib/chatPresets.ts`.

/// One provider preset. Picking it in 设置 → 聊天 fills `base_url` + `default_model`;
/// both stay editable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChatPreset {
    pub id: &'static str,
    pub label: &'static str,
    pub base_url: &'static str,
    pub default_model: &'static str,
    /// No API key needed (local servers such as Ollama).
    pub key_optional: bool,
}

pub const CUSTOM: &str = "custom";

pub const PRESETS: &[ChatPreset] = &[
    ChatPreset { id: "deepseek", label: "DeepSeek", base_url: "https://api.deepseek.com", default_model: "deepseek-flash", key_optional: false },
    ChatPreset { id: "openai", label: "OpenAI", base_url: "https://api.openai.com/v1", default_model: "gpt-4o-mini", key_optional: false },
    ChatPreset { id: "moonshot", label: "Moonshot / Kimi", base_url: "https://api.moonshot.cn/v1", default_model: "moonshot-v1-8k", key_optional: false },
    ChatPreset {
        id: "dashscope",
        label: "通义千问 DashScope",
        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        default_model: "qwen-plus",
        key_optional: false,
    },
    ChatPreset { id: "zhipu", label: "智谱 GLM", base_url: "https://open.bigmodel.cn/api/paas/v4", default_model: "glm-4-flash", key_optional: false },
    ChatPreset {
        id: "siliconflow",
        label: "硅基流动 SiliconFlow",
        base_url: "https://api.siliconflow.cn/v1",
        default_model: "Qwen/Qwen2.5-7B-Instruct",
        key_optional: false,
    },
    ChatPreset { id: "openrouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1", default_model: "openai/gpt-4o-mini", key_optional: false },
    ChatPreset {
        id: "gemini",
        label: "Google Gemini",
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        default_model: "gemini-2.5-flash",
        key_optional: false,
    },
    ChatPreset { id: "anthropic", label: "Anthropic Claude", base_url: "https://api.anthropic.com/v1", default_model: "claude-haiku-4-5", key_optional: false },
    ChatPreset { id: "ollama", label: "Ollama（本机）", base_url: "http://localhost:11434/v1", default_model: "qwen2.5", key_optional: true },
    ChatPreset { id: CUSTOM, label: "自定义 OpenAI 兼容", base_url: "", default_model: "", key_optional: false },
];

pub fn preset(id: &str) -> Option<&'static ChatPreset> {
    PRESETS.iter().find(|p| p.id == id)
}

pub fn is_known_provider(id: &str) -> bool {
    preset(id).is_some()
}

/// Unknown ids fall back to 自定义.
pub fn normalize_provider(id: &str) -> &'static str {
    preset(id.trim()).map(|p| p.id).unwrap_or(CUSTOM)
}

fn parse(endpoint: &str) -> Result<url::Url, String> {
    let u = url::Url::parse(endpoint.trim()).map_err(|_| "接口地址（Base URL）不是有效的网址".to_string())?;
    let host = u.host_str().unwrap_or("");
    let local = is_local_host(host);
    match u.scheme() {
        "https" => {}
        "http" if local => {}
        _ => return Err("接口地址必须是 https（本机 localhost 可用 http）".into()),
    }
    if host.is_empty() {
        return Err("接口地址缺少域名".into());
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err("接口地址中不能包含账号密码".into());
    }
    Ok(u)
}

fn is_local_host(host: &str) -> bool {
    let h = host.trim_matches(|c| c == '[' || c == ']').to_ascii_lowercase();
    h == "localhost" || h == "127.0.0.1" || h == "::1"
}

/// http(s)://localhost / 127.0.0.1 / ::1 — no key required there.
pub fn is_local_endpoint(endpoint: &str) -> bool {
    url::Url::parse(endpoint.trim()).ok().and_then(|u| u.host_str().map(is_local_host)).unwrap_or(false)
}

/// The API path to use when the user typed only the host (e.g. `https://api.openai.com`).
fn default_api_path(host: &str) -> &'static str {
    match host.to_ascii_lowercase().as_str() {
        // DeepSeek documents base_url without /v1 (the /v1 form also works).
        "api.deepseek.com" => "",
        "dashscope.aliyuncs.com" | "dashscope-intl.aliyuncs.com" => "/compatible-mode/v1",
        "open.bigmodel.cn" => "/api/paas/v4",
        "generativelanguage.googleapis.com" => "/v1beta/openai",
        "openrouter.ai" => "/api/v1",
        _ => "/v1",
    }
}

/// Normalized base URL (no trailing slash, no `/chat/completions`):
/// - `https://host` (no path) → the provider's API path (mostly `/v1`)
/// - `…/v1/`, `…/v1/chat/completions` → `…/v1`
/// - Gemini `…/v1beta` → `…/v1beta/openai`
pub fn resolve_base_url(endpoint: &str) -> Result<String, String> {
    let u = parse(endpoint)?;
    let host = u.host_str().unwrap_or("").to_ascii_lowercase();
    let mut path = u.path().trim_end_matches('/').to_string();
    if let Some(p) = path.strip_suffix("/chat/completions") {
        path = p.trim_end_matches('/').to_string();
    }
    if path.is_empty() {
        path = default_api_path(&host).to_string();
    } else if host == "generativelanguage.googleapis.com" && (path == "/v1beta" || path == "/v1") {
        path.push_str("/openai");
    }
    let mut origin = u.origin().ascii_serialization();
    if origin == "null" {
        return Err("接口地址不是有效的网址".into());
    }
    origin.push_str(&path);
    if let Some(q) = u.query() {
        origin.push('?');
        origin.push_str(q);
    }
    Ok(origin)
}

/// Full URL the request is POSTed to.
pub fn completions_url(endpoint: &str) -> Result<String, String> {
    let base = resolve_base_url(endpoint)?;
    Ok(match base.split_once('?') {
        Some((b, q)) => format!("{b}/chat/completions?{q}"),
        None => format!("{base}/chat/completions"),
    })
}

/// A key is required unless the preset is key-optional or the endpoint is on this machine.
pub fn key_required(provider: &str, endpoint: &str) -> bool {
    let optional = preset(provider).map(|p| p.key_optional).unwrap_or(false);
    !(optional || is_local_endpoint(endpoint))
}

// ------------------------------------------------------------------ keychain slots

/// Keychain account used before build-13 (one key for whatever provider was configured).
pub const LEGACY_KEY_USER: &str = "chat-api-key";

/// One keychain entry per provider: `chat-api-key:<provider>`.
pub fn key_user(provider: &str) -> String {
    format!("{LEGACY_KEY_USER}:{}", normalize_provider(provider))
}

/// Minimal keychain interface so migration is testable without the OS keychain.
pub trait KeyStore {
    fn get(&self, user: &str) -> Option<String>;
    fn set(&self, user: &str, secret: &str) -> Result<(), String>;
    fn delete(&self, user: &str) -> Result<(), String>;
}

/// Move the pre-build-13 single key into the slot of the provider it was used with
/// (the currently configured one). Never overwrites an existing per-provider key.
/// Returns true when a legacy key was found and handled.
pub fn migrate_legacy_key(store: &dyn KeyStore, current_provider: &str) -> Result<bool, String> {
    let Some(old) = store.get(LEGACY_KEY_USER).filter(|k| !k.trim().is_empty()) else {
        return Ok(false);
    };
    let slot = key_user(current_provider);
    if store.get(&slot).is_none() {
        store.set(&slot, &old)?;
    }
    store.delete(LEGACY_KEY_USER)?;
    Ok(true)
}

/// Basic API key sanity check (no whitespace / control chars, sane length).
pub fn validate_key(key: &str) -> Result<&str, String> {
    let key = key.trim();
    if key.is_empty() || key.len() > 512 || key.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("API Key 格式不正确".into());
    }
    Ok(key)
}

// ------------------------------------------------------------------ error messages

/// Readable message for an HTTP error status (`api_msg` = provider's `error.message`).
pub fn describe_http_error(code: u16, api_msg: Option<&str>, model: &str) -> String {
    let base = match code {
        401 => "API Key 无效或已失效（HTTP 401）：请确认 Key 粘贴完整，并且属于当前选择的服务商".to_string(),
        403 => "没有权限（HTTP 403）：这个 Key 不能使用该模型，或所在地区不可用".to_string(),
        402 => "账户余额不足（HTTP 402）".to_string(),
        404 => format!("找不到模型「{}」或接口地址不对（HTTP 404）：请核对模型名和 Base URL", model.trim()),
        408 => "请求超时（HTTP 408），稍后再试".to_string(),
        429 => "请求太频繁或额度用完（HTTP 429）".to_string(),
        500..=599 => format!("服务商暂时出错（HTTP {code}），稍后再试"),
        _ => format!("接口返回 HTTP {code}"),
    };
    match api_msg.map(str::trim).filter(|m| !m.is_empty()) {
        Some(m) => format!("{base}。服务商说明：{}", m.chars().take(200).collect::<String>()),
        None => base,
    }
}

/// Network-level failure kinds (mapped from the HTTP client in the Tauri crate).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetError {
    Dns,
    Refused,
    Timeout,
    Other(String),
}

pub fn describe_net_error(err: &NetError, endpoint: &str) -> String {
    let host = url::Url::parse(endpoint.trim())
        .ok()
        .map(|u| match (u.host_str(), u.port()) {
            (Some(h), Some(p)) => format!("{h}:{p}"),
            (Some(h), None) => h.to_string(),
            _ => String::new(),
        })
        .unwrap_or_default();
    let local = is_local_endpoint(endpoint);
    match err {
        NetError::Dns => format!("网络错误：找不到服务器 {host}，请检查网络或 Base URL 是否拼写正确"),
        NetError::Refused if local => format!("连不上本机服务 {host}：请确认 Ollama 等已经启动（ollama serve）且端口正确"),
        NetError::Refused => format!("网络错误：无法连接 {host}，请检查网络或代理设置"),
        NetError::Timeout => format!("请求超时：{host} 没有响应，请检查网络或稍后再试"),
        NetError::Other(m) => format!("网络错误：{}", m.chars().take(200).collect::<String>()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    #[test]
    fn presets_are_valid_and_unique() {
        let mut ids: Vec<&str> = PRESETS.iter().map(|p| p.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), PRESETS.len());
        for p in PRESETS.iter().filter(|p| p.id != CUSTOM) {
            assert!(!p.default_model.is_empty(), "{} has no model", p.id);
            // the preset URL resolves to itself (already normalized)
            assert_eq!(resolve_base_url(p.base_url).unwrap(), p.base_url, "{}", p.id);
        }
        for id in ["deepseek", "openai", "moonshot", "dashscope", "zhipu", "siliconflow", "openrouter", "gemini", "anthropic", "ollama", "custom"] {
            assert!(is_known_provider(id), "missing preset {id}");
        }
        assert_eq!(normalize_provider("evil"), "custom");
        assert_eq!(normalize_provider(" openai "), "openai");
    }

    #[test]
    fn preset_completion_urls() {
        let url = |id: &str| completions_url(preset(id).unwrap().base_url).unwrap();
        assert_eq!(url("deepseek"), "https://api.deepseek.com/chat/completions");
        assert_eq!(url("openai"), "https://api.openai.com/v1/chat/completions");
        assert_eq!(url("dashscope"), "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
        assert_eq!(url("zhipu"), "https://open.bigmodel.cn/api/paas/v4/chat/completions");
        assert_eq!(url("openrouter"), "https://openrouter.ai/api/v1/chat/completions");
        assert_eq!(url("gemini"), "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
        assert_eq!(url("anthropic"), "https://api.anthropic.com/v1/chat/completions");
        assert_eq!(url("ollama"), "http://localhost:11434/v1/chat/completions");
    }

    #[test]
    fn url_joining_with_and_without_v1() {
        let r = |s: &str| resolve_base_url(s).unwrap();
        assert_eq!(r("https://api.openai.com"), "https://api.openai.com/v1");
        assert_eq!(r("https://api.openai.com/"), "https://api.openai.com/v1");
        assert_eq!(r("https://api.openai.com/v1/"), "https://api.openai.com/v1");
        assert_eq!(r(" https://api.openai.com/v1/chat/completions/ "), "https://api.openai.com/v1");
        assert_eq!(r("https://api.deepseek.com"), "https://api.deepseek.com");
        assert_eq!(r("https://api.deepseek.com/v1"), "https://api.deepseek.com/v1");
        assert_eq!(r("http://localhost:11434"), "http://localhost:11434/v1");
        assert_eq!(r("http://127.0.0.1:1234/v1"), "http://127.0.0.1:1234/v1");
        assert_eq!(r("https://dashscope.aliyuncs.com"), "https://dashscope.aliyuncs.com/compatible-mode/v1");
        assert_eq!(r("https://open.bigmodel.cn"), "https://open.bigmodel.cn/api/paas/v4");
        assert_eq!(r("https://openrouter.ai"), "https://openrouter.ai/api/v1");
        assert_eq!(r("https://generativelanguage.googleapis.com/v1beta"), "https://generativelanguage.googleapis.com/v1beta/openai");
        assert_eq!(r("https://generativelanguage.googleapis.com/v1beta/openai/"), "https://generativelanguage.googleapis.com/v1beta/openai");
        assert_eq!(r("https://my-proxy.example.com/openai/v1"), "https://my-proxy.example.com/openai/v1");
        assert_eq!(r("https://API.OpenAI.com/v1"), "https://api.openai.com/v1");
        assert_eq!(completions_url("https://x.example/v1?api-version=1").unwrap(), "https://x.example/v1/chat/completions?api-version=1");
        // rejected
        assert!(resolve_base_url("http://evil.com/v1").is_err());
        assert!(resolve_base_url("https://user:pw@x.com/v1").is_err());
        assert!(resolve_base_url("file:///etc/passwd").is_err());
        assert!(resolve_base_url("").is_err());
        assert!(resolve_base_url("nonsense").is_err());
    }

    #[test]
    fn key_requirements() {
        assert!(key_required("openai", "https://api.openai.com/v1"));
        assert!(key_required("deepseek", "https://api.deepseek.com"));
        assert!(!key_required("ollama", "http://localhost:11434/v1"));
        assert!(!key_required("ollama", "https://ollama.my-lan.example/v1"));
        assert!(!key_required("custom", "http://127.0.0.1:1234/v1"));
        assert!(!key_required("custom", "http://[::1]:8080/v1"));
        assert!(key_required("custom", "https://api.example.com/v1"));
        assert_eq!(key_user("openai"), "chat-api-key:openai");
        assert_eq!(key_user("bogus"), "chat-api-key:custom");
        assert!(validate_key(" sk-abc ").is_ok());
        assert!(validate_key("sk abc").is_err());
        assert!(validate_key("").is_err());
    }

    #[derive(Default)]
    struct Mem(RefCell<HashMap<String, String>>);
    impl KeyStore for Mem {
        fn get(&self, user: &str) -> Option<String> {
            self.0.borrow().get(user).cloned()
        }
        fn set(&self, user: &str, secret: &str) -> Result<(), String> {
            self.0.borrow_mut().insert(user.into(), secret.into());
            Ok(())
        }
        fn delete(&self, user: &str) -> Result<(), String> {
            self.0.borrow_mut().remove(user);
            Ok(())
        }
    }

    #[test]
    fn legacy_key_migrates_to_current_provider() {
        let s = Mem::default();
        s.set(LEGACY_KEY_USER, "sk-old").unwrap();
        assert!(migrate_legacy_key(&s, "deepseek").unwrap());
        assert_eq!(s.get("chat-api-key:deepseek").as_deref(), Some("sk-old"));
        assert!(s.get(LEGACY_KEY_USER).is_none());
        // idempotent
        assert!(!migrate_legacy_key(&s, "deepseek").unwrap());
        assert_eq!(s.get("chat-api-key:deepseek").as_deref(), Some("sk-old"));

        // an old 自定义 setup keeps its key under custom
        let s = Mem::default();
        s.set(LEGACY_KEY_USER, "sk-custom").unwrap();
        migrate_legacy_key(&s, "custom").unwrap();
        assert_eq!(s.get("chat-api-key:custom").as_deref(), Some("sk-custom"));

        // never overwrites a newer per-provider key
        let s = Mem::default();
        s.set(LEGACY_KEY_USER, "sk-old").unwrap();
        s.set("chat-api-key:openai", "sk-new").unwrap();
        migrate_legacy_key(&s, "openai").unwrap();
        assert_eq!(s.get("chat-api-key:openai").as_deref(), Some("sk-new"));
        assert!(s.get(LEGACY_KEY_USER).is_none());

        // nothing to do
        assert!(!migrate_legacy_key(&Mem::default(), "openai").unwrap());
    }

    #[test]
    fn readable_errors() {
        assert!(describe_http_error(401, None, "m").contains("API Key 无效"));
        let e404 = describe_http_error(404, Some("model not found"), "gpt-x");
        assert!(e404.contains("gpt-x") && e404.contains("model not found"));
        assert!(describe_http_error(503, None, "m").contains("稍后再试"));
        assert!(describe_http_error(418, Some("  "), "m").ends_with("HTTP 418"));
        assert!(describe_net_error(&NetError::Refused, "http://localhost:11434/v1").contains("ollama serve"));
        assert!(describe_net_error(&NetError::Refused, "https://api.openai.com/v1").contains("api.openai.com"));
        assert!(describe_net_error(&NetError::Dns, "https://api.openai.con/v1").contains("找不到服务器 api.openai.con"));
        assert!(describe_net_error(&NetError::Timeout, "https://x.io").contains("超时"));
    }
}
