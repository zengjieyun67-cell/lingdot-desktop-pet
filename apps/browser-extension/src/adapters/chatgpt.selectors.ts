/**
 * ChatGPT DOM selectors — the ONLY place ChatGPT markup is referenced.
 *
 * ⚠️ UNVERIFIED against the live site: these were written from publicly known
 * markup (data-testid attributes) without a logged-in session. ChatGPT changes
 * its DOM frequently. Before relying on notifications, verify each list in
 * DevTools on https://chatgpt.com (see apps/browser-extension/ADAPTERS.md →
 * "Verifying ChatGPT selectors") and update `verifiedAt`.
 *
 * Each entry is a list; the first matching selector wins. When none match the
 * adapter reports `unknown` instead of guessing.
 */
export const CHATGPT_SELECTORS = {
  verifiedAt: null as string | null,

  /** Visible while a response is being generated (explicit execution signal). */
  stopButton: [
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label*="Stop generating" i]',
    'button[aria-label*="停止"]',
  ],
  /** Streaming markers on the assistant message. */
  streaming: ['.result-streaming', '[data-message-author-role="assistant"] .streaming-animation', '[data-is-streaming="true"]'],
  /** Composer input. */
  composer: ['#prompt-textarea', 'div[contenteditable="true"][id="prompt-textarea"]', 'textarea[data-id="root"]'],
  /** Send button (often disabled/hidden when the composer is empty). */
  sendButton: ['button[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label*="Send prompt" i]', 'button[aria-label*="发送"]'],
  /** Voice button that replaces "send" when the composer is empty. */
  idleComposerButtons: ['button[data-testid="composer-speech-button"]', 'button[aria-label*="voice" i]', 'button[aria-label*="语音"]'],
  /** Assistant messages. */
  assistantMessage: ['[data-message-author-role="assistant"]'],
  /** Explicit error UI. */
  error: ['[data-testid="error-message"]', '.text-token-text-error', '[data-testid="conversation-turn"] .text-red-500'],
  /** Error phrases searched ONLY inside elements matched by `errorContainers` (text never leaves the page). */
  errorContainers: ['[role="alert"]', '[data-testid="conversation-turn"] .border-red-500', '.text-token-text-error'],
  errorPhrases: ['Something went wrong', 'There was an error generating', 'Network error', 'An error occurred', '出错了', '生成回复时出错', '网络错误'],
  /** Login wall. */
  loginWall: ['button[data-testid="login-button"]', 'button[data-testid="welcome-login-button"]', 'a[href^="/auth/login"]', 'a[href*="auth.openai.com"]'],
  loginPaths: ['/auth/', '/login'],
  loginHosts: ['auth.openai.com', 'auth0.openai.com'],
  /** Explicit confirmation / authorization prompts. */
  confirm: ['[role="dialog"] button[data-testid*="confirm"]', '[role="dialog"][data-testid*="verification"]', 'iframe[src*="challenges.cloudflare.com"]'],
} as const;
