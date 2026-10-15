# Phase 2 – Rust ⇄ frontend API contract

All commands are called with `invoke(name, args)`; argument keys are **camelCase** on the JS side
(Tauri converts them to snake_case). Commands returning `Result` reject with a Chinese error string.
Events are emitted to **all windows** (`pet`, `panel`, `desktop`) unless noted.

## Windows

| label     | URL                    | notes |
|-----------|------------------------|-------|
| `pet`     | `index.html#/pet`      | small floating pet (桌宠模式) |
| `panel`   | `index.html#/panel`    | panel |
| `desktop` | `index.html#/desktop`  | created at runtime in 桌面模式: borderless, covers the pet's screen, sits at desktop level (just above the wallpaper; above the desktop icons when `desktopInteractive`), on all Spaces. Destroyed when switching back to 桌宠模式. Not transparent by default — draw the full scene. Same capability permissions as `pet`. |

## Settings fields (new in phase 2, part of `AppSettings`, camelCase)

| field | type | default | notes |
|---|---|---|---|
| `voiceEnabled` | bool | `false` | master switch for voice chat |
| `voiceName` | string | `""` | `say` voice name; `""` = auto (婷婷/美佳…) |
| `voiceRate` | number | `1.1` | clamped 0.5–2.0 on save |
| `voiceSilenceMs` | number | `1200` | clamped 600–4000 on save; silence ending an utterance in 实时对话 |
| `voiceReadReplies` | bool | `false` | frontend should call `voice_speak` for typed chat replies |
| `voiceOnDevice` | bool | `true` | prefer on-device recognition |
| `voiceBargeIn` | bool | `true` | talking over 小喵 stops her (live mode) |
| `musicDetection` | bool | `true` | |
| `musicIncludeBrowsers` | bool | `false` | |
| `idleStates` | bool | `true` | 打盹 / 伸懒腰 |
| `displayMode` | `"pet" \| "desktop"` | `"pet"` | anything else is saved as `"pet"` |
| `desktopInteractive` | bool | `false` | desktop scene above Finder icons so it receives clicks |

`update_settings` applies display mode immediately when `displayMode` or `desktopInteractive` changes.

## Commands

### Display mode
- `set_display_mode({ mode: "pet" | "desktop" })` → `AppSettings`
  Persists `displayMode`, switches windows, updates tray label, emits `settings-changed`.
  Rejects for any other mode string.

### Voice (macOS native STT + `say`)
`VoiceStatus`:
```ts
{
  mode: "off" | "push_to_talk" | "live",
  phase: "idle" | "listening" | "thinking" | "speaking",
  transcript: string,      // live transcript of what the user says
  speaking: string,        // what 小喵 is currently saying
  error: string | null,
  sttSupported: boolean,   // macOS only
  ttsSupported: boolean,   // macOS only
  permission: "authorized" | "denied" | "restricted" | "not_determined" | "unsupported"
}
```
`ChatMessage = { role: "user" | "assistant", content: string }`

| command | args | returns |
|---|---|---|
| `voice_status` | – | `VoiceStatus` |
| `voice_ptt_start` | `{ history?: ChatMessage[] }` (seed context, optional) | `Result<VoiceStatus>` (may wait for the permission prompt) |
| `voice_ptt_stop` | – | `VoiceStatus` (reply arrives via events) |
| `voice_set_live` | `{ enabled: boolean, history?: ChatMessage[] }` | `Result<VoiceStatus>` |
| `voice_stop` | – | `VoiceStatus` (stops listening + speaking, mode → off) |
| `voice_stop_speaking` | – | `VoiceStatus` (in live mode resumes listening) |
| `voice_speak` | `{ text: string }` (≤2000 chars used) | `Result<null>` – read aloud, no listening |
| `voice_list_voices` | – | `Result<{ name: string, locale: string, sample: string }[]>` (Chinese voices; `[]` off macOS) |

Errors (voice disabled, chat disabled / no API key, unsupported platform, permission denied) are
also put in `VoiceStatus.error` and emitted.

### Chat (unchanged signature)
- `chat_send({ history: ChatMessage[] })` → `Result<string>` (now shares code with voice).

### Activity
- `get_activity()` → `ActivitySnapshot`

```ts
ActivitySnapshot = {
  kind: "none" | "listening_music" | "stretching" | "napping",
  music: { appId: string, app: string, title: string | null, artist: string | null } | null,
  idleSecs: number
}
```

## Events

| event | payload | notes |
|---|---|---|
| `voice-state` | `VoiceStatus` | every state change |
| `voice-turn` | `{ role: "user" \| "assistant", content: string }` | a finished user utterance / 小喵's reply (append to chat log) |
| `pet-activity` | `ActivitySnapshot` | on kind / music change (polled every 4 s, macOS only) |
| `pet-activity-event` | `{ type: "music_started", app: string, title: string \| null } \| { type: "track_changed", app, title } \| { type: "music_stopped" } \| { type: "nap_started" } \| { type: "woke" }` | one-shot, for bubbles |
| `pet-mood` | `"idle" \| "working" \| "completed" \| "needs_attention"` | now sent to `pet`, `panel` **and `desktop`** |
| `pet-cursor` | `{ dx, dy }` logical px from the pet head | `pet` window only, as before |
| `settings-changed` | `AppSettings` | also after `set_display_mode` / tray toggle |
| `display-mode` | `"pet" \| "desktop"` | after every mode switch (tray, command, settings, startup) |

Existing events (`notification`, `tasks-changed`, `connection-changed`, `persona-memory`,
`sites-changed`) are broadcast to all windows, so the desktop window receives them too.

## Tray
New item 「切换到桌面模式」 (shown in 桌宠模式) / 「切换到桌宠模式」 (shown in 桌面模式), toggles `displayMode`.
In 桌面模式 「显示 / 隐藏桌宠」 shows/hides the desktop window.
