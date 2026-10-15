/** Chat provider presets (OpenAI-compatible). The request itself is built and sent by Rust. */
export type ChatProvider = "deepseek" | "custom";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_KEYS_URL = "https://platform.deepseek.com/api_keys";
export const DEEPSEEK_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "deepseek-flash", label: "deepseek-flash（快，推荐）" },
  { id: "deepseek-v4-pro", label: "deepseek-v4-pro（更聪明）" },
];

export const CHAT_PROVIDERS: ReadonlyArray<{ id: ChatProvider; label: string }> = [
  { id: "deepseek", label: "DeepSeek" },
  { id: "custom", label: "自定义 OpenAI 兼容" },
];

export function isDeepSeekEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint.trim()).hostname.toLowerCase() === "api.deepseek.com";
  } catch {
    return false;
  }
}

/** Fields to write when the user picks a preset. Custom keeps what is typed (but drops the DeepSeek URL). */
export function applyPreset(
  provider: ChatProvider,
  current: { chatEndpoint: string; chatModel: string },
): { chatProvider: ChatProvider; chatEndpoint: string; chatModel: string } {
  if (provider === "deepseek") {
    const keepModel = DEEPSEEK_MODELS.some((m) => m.id === current.chatModel);
    return { chatProvider: "deepseek", chatEndpoint: DEEPSEEK_BASE_URL, chatModel: keepModel ? current.chatModel : DEEPSEEK_MODELS[0]!.id };
  }
  return {
    chatProvider: "custom",
    chatEndpoint: isDeepSeekEndpoint(current.chatEndpoint) ? "" : current.chatEndpoint,
    chatModel: isDeepSeekEndpoint(current.chatEndpoint) ? "" : current.chatModel,
  };
}

/** Which preset a saved configuration belongs to (mirrors the Rust sanitizer). */
export function detectProvider(s: { chatProvider?: string; chatEndpoint: string }): ChatProvider {
  if (s.chatProvider === "deepseek" && isDeepSeekEndpoint(s.chatEndpoint)) return "deepseek";
  return "custom";
}

/** The URL Rust will POST to (mirrors pet-core `validate_endpoint`; display only). */
export function chatCompletionsUrl(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}
