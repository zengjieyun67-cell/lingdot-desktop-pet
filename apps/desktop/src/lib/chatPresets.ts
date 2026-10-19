/**
 * Chat provider presets. Every provider speaks the OpenAI-compatible `/chat/completions`
 * API; the request itself is built and sent by Rust (pet-core `chat_provider`).
 * Keep ids, URLs and default models in sync with `chat_provider.rs`.
 */
export type ChatProvider =
  | "deepseek"
  | "openai"
  | "moonshot"
  | "dashscope"
  | "zhipu"
  | "siliconflow"
  | "openrouter"
  | "gemini"
  | "anthropic"
  | "ollama"
  | "custom";

export interface ChatPreset {
  id: ChatProvider;
  label: string;
  /** Base URL filled in when the preset is picked ("" for 自定义). */
  baseUrl: string;
  defaultModel: string;
  /** A few model names offered as suggestions (the field stays free text). */
  models: readonly string[];
  /** Where to create an API key (shown as a link). */
  keysUrl?: string;
  /** No API key needed (local servers). */
  keyOptional?: boolean;
  /** One-line hint under the provider picker. */
  hint?: string;
}

export const CHAT_PRESETS: readonly ChatPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-flash",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    keysUrl: "https://platform.deepseek.com/api_keys",
    hint: "使用非思考模式，回复更快",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o"],
    keysUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "moonshot",
    label: "Moonshot / Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    models: ["moonshot-v1-8k", "moonshot-v1-32k"],
    keysUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  {
    id: "dashscope",
    label: "通义千问 DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    models: ["qwen-plus", "qwen-turbo", "qwen-max"],
    keysUrl: "https://bailian.console.aliyun.com/?apiKey=1",
    hint: "阿里云百炼 compatible-mode 接口",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    models: ["glm-4-flash", "glm-4-plus"],
    keysUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  {
    id: "siliconflow",
    label: "硅基流动 SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-7B-Instruct",
    models: ["Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V3"],
    keysUrl: "https://cloud.siliconflow.cn/account/ak",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    models: ["openai/gpt-4o-mini", "deepseek/deepseek-chat", "google/gemini-2.5-flash"],
    keysUrl: "https://openrouter.ai/keys",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    keysUrl: "https://aistudio.google.com/apikey",
    hint: "Gemini 的 OpenAI 兼容接口",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-haiku-4-5",
    models: ["claude-haiku-4-5", "claude-sonnet-4-5"],
    keysUrl: "https://console.anthropic.com/settings/keys",
    hint: "Claude 的 OpenAI 兼容层（部分参数会被忽略）",
  },
  {
    id: "ollama",
    label: "Ollama（本机）",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "qwen2.5",
    models: ["qwen2.5", "llama3.2", "gemma3"],
    keyOptional: true,
    hint: "先运行 ollama serve，并 ollama pull 对应模型；不需要 Key",
  },
  {
    id: "custom",
    label: "自定义 OpenAI 兼容",
    baseUrl: "",
    defaultModel: "",
    models: [],
    hint: "填写服务商给的 Base URL（通常以 /v1 结尾）和模型名",
  },
];

/** Back-compat aliases (DeepSeek was the only preset before build-13). */
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const CHAT_PROVIDERS: ReadonlyArray<{ id: ChatProvider; label: string }> = CHAT_PRESETS.map(({ id, label }) => ({ id, label }));

export function getPreset(id: string | undefined): ChatPreset {
  return CHAT_PRESETS.find((p) => p.id === id) ?? CHAT_PRESETS.find((p) => p.id === "custom")!;
}

/** Unknown / missing ids show as 自定义 (mirrors Rust `normalize_provider`). */
export function detectProvider(s: { chatProvider?: string }): ChatProvider {
  return getPreset(s.chatProvider?.trim()).id;
}

export function isDeepSeekEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint.trim()).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
}

function isLocalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

export function isLocalEndpoint(endpoint: string): boolean {
  try {
    return isLocalHost(new URL(endpoint.trim()).hostname);
  } catch {
    return false;
  }
}

/** Mirrors Rust `key_required`: Ollama and anything on localhost work without a key. */
export function keyRequired(provider: ChatProvider, endpoint: string): boolean {
  return !(getPreset(provider).keyOptional || isLocalEndpoint(endpoint));
}

/**
 * Fields to write when the user picks a preset: its base URL + default model
 * (a model from the preset's own suggestion list is kept).
 * 自定义 keeps what is currently typed so a hand-entered endpoint is not lost.
 */
export function applyPreset(
  provider: ChatProvider,
  current: { chatEndpoint: string; chatModel: string },
): { chatProvider: ChatProvider; chatEndpoint: string; chatModel: string } {
  const p = getPreset(provider);
  if (p.id === "custom") return { chatProvider: "custom", chatEndpoint: current.chatEndpoint, chatModel: current.chatModel };
  const keepModel = p.models.includes(current.chatModel);
  return { chatProvider: p.id, chatEndpoint: p.baseUrl, chatModel: keepModel ? current.chatModel : p.defaultModel };
}

/** API path used when only the host is typed (mirrors Rust `default_api_path`). */
function defaultApiPath(host: string): string {
  switch (host.toLowerCase()) {
    case "api.deepseek.com":
      return "";
    case "dashscope.aliyuncs.com":
    case "dashscope-intl.aliyuncs.com":
      return "/compatible-mode/v1";
    case "open.bigmodel.cn":
      return "/api/paas/v4";
    case "generativelanguage.googleapis.com":
      return "/v1beta/openai";
    case "openrouter.ai":
      return "/api/v1";
    default:
      return "/v1";
  }
}

/** Normalized base URL, or null when Rust would reject it (display only; Rust decides). */
export function resolveBaseUrl(endpoint: string): string | null {
  let u: URL;
  try {
    u = new URL(endpoint.trim());
  } catch {
    return null;
  }
  const local = isLocalHost(u.hostname);
  if (!(u.protocol === "https:" || (u.protocol === "http:" && local)) || u.username || u.password || !u.hostname) return null;
  let path = u.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions")) path = path.slice(0, -"/chat/completions".length).replace(/\/+$/, "");
  const host = u.hostname.toLowerCase();
  if (!path) path = defaultApiPath(host);
  else if (host === "generativelanguage.googleapis.com" && (path === "/v1beta" || path === "/v1")) path += "/openai";
  return `${u.origin}${path}${u.search}`;
}

/** The URL Rust will POST to (mirrors pet-core `completions_url`; display only). */
export function chatCompletionsUrl(endpoint: string): string {
  const base = resolveBaseUrl(endpoint);
  if (base === null) return "—";
  const [b, q] = base.split("?");
  return q ? `${b}/chat/completions?${q}` : `${b}/chat/completions`;
}
