/** Which desktop OS the app runs on (macOS unchanged; Windows gets its own wording / shortcuts). */
const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
export const IS_WINDOWS = /Windows/i.test(ua);
export const OS_NAME = IS_WINDOWS ? "Windows" : "macOS";
/** global shortcut for a new 便签 (Rust registers ⌘⇧N on macOS, Ctrl+Shift+N elsewhere) */
export const NEW_NOTE_KEY = IS_WINDOWS ? "Ctrl+Shift+N" : "⌘⇧N";
export const FILE_MANAGER = IS_WINDOWS ? "资源管理器" : "访达";
export const KEYCHAIN = IS_WINDOWS ? "Windows 凭据管理器" : "macOS 钥匙串";
export const DOCS_NAME = IS_WINDOWS ? "文档" : "文稿";
