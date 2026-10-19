# lingdot 灵点桌宠 · 详细说明 / Full guide (中文)

> 这里是原先 README 的完整版：使用细节、开发者文档、状态机、隐私设计与已知限制。简介和下载请看 [README](../README.md)。部分界面描述可能早于最新 build。


一只住在 macOS / Windows 桌面角落的傲娇猫娘「小喵」（名字和她对你的称呼都可以改，默认称你为「主人」）。她会在你**授权过的网站**上的 AI 任务（例如 ChatGPT 生成回答）**进行中 / 完成 / 失败 / 需要你处理**时做出反应并提醒你，深夜催你睡觉、饭点提醒吃饭，被冷落会闹别扭，也是一个小巧的网站启动器。

- 透明、无边框、始终置顶、不占 Dock 的小窗口，可拖动，记住位置；大小可在 60%–250% 之间自由调节
- 统一的苹果风磨砂玻璃界面（macOS Sonoma / visionOS 质感）：面板、便签、桌面小组件、文件夹、音乐卡片、快捷圆盘都是同一种材质；按住顶部可拖动，会记住位置
- 内置精心绘制的分层 SVG 猫娘：呼吸、眨眼、耳朵抖动、尾巴摆动、眼睛/头跟随鼠标；任务状态动画（打字 / 开心跳跃 / 竖耳“!”）+ 情绪表情（脸红、鼓脸、半睁眼、耳朵耷拉/竖起/后压）
- 放入 Live2D Cubism Core 与你的 `.model3.json` 模型后自动切换为 Live2D（情绪/状态映射到模型表情与动作）
- **性格**：傲娇台词库（离线可用）× 情绪状态机 × 本地长期记忆（好感度、熟悉度、习惯）
- **可选聊天**：支持任意 OpenAI 兼容服务（内置 DeepSeek、OpenAI、Kimi、通义千问、智谱 GLM、硅基流动、OpenRouter、Gemini、Claude、本机 Ollama 预设，也可自定义）；API Key 按服务商分别存在系统钥匙串 / 凭据管理器，只由 Rust 后台发送
- Chrome MV3 扩展只在你授权的网站注入脚本，只上报标题、网址和按钮状态信号
- 本地服务只监听 `127.0.0.1`，Bearer 令牌 + Origin/Host 校验 + 16KB 限制 + 严格 schema

> 系统要求：macOS 12+（Apple Silicon / Intel 均可）或 Windows 10 / 11（x64），Chrome / Edge / Arc 等 Chromium 浏览器。

## 🚀 快速开始（普通用户看这里）

### 0. 直接下载安装包（推荐）

在 [Releases](https://github.com/zengjieyun67-cell/lingdot-desktop-pet/releases) 里下载最新的 build：

| 系统 | 文件 |
| --- | --- |
| Mac（Apple Silicon，M1–M4） | `lingdot-desktop-pet_*_aarch64.dmg` |
| Mac（Intel） | `lingdot-desktop-pet_*_x64.dmg` |
| Windows 10 / 11（x64） | `lingdot-desktop-pet_*_x64-setup.exe`（推荐）、`*_x64_en-US.msi`，或免安装的 `lingdot-desktop-pet_x64-portable.exe`（双击即用） |

- **Mac**：打开 `.dmg`，把 lingdot-desktop-pet 拖进「应用程序」，第一次**右键 → 打开 → 打开**。
- **Windows**：双击 `-setup.exe`。安装包没有付费代码签名，Windows SmartScreen 会提示「Windows 已保护你的电脑」：点 **更多信息 → 仍要运行** 即可（这是未签名应用的正常提示）。缺 WebView2 时安装程序会自动下载。
  - 免安装版：把 `lingdot-desktop-pet_x64-portable.exe` 放进任意文件夹双击即可。想让她直接用你自己的 Live2D 模型，把模型文件夹（含 `.model3.json`）和 `live2dcubismcore.min.js` 放在 exe 旁边，首次启动会自动导入。若杀毒软件把 exe 删了，到 Windows 安全中心 →「保护历史记录」里还原 / 允许。
  - Windows 上：便签快捷键是 **Ctrl+Shift+N**；文件夹快捷方式用「资源管理器」打开（下载 / 文档 / 桌面 / 开始菜单）；小喵的语音用系统语音（慧慧 / 瑶瑶）朗读；**语音识别、听歌检测暂时只支持 macOS**；面板和浮动便签用 Windows 的亚克力（Acrylic）磨砂效果。

### 1. 或者：从源码一键构建（Mac）

1. 点本页右上角绿色 **Code → Download ZIP**，解压到任意位置（或 `git clone`）。
2. 双击 **`一键安装.command`**。
   - 第一次双击如果提示「无法打开」：右键 → 打开 → 打开。
   - 如果提示「没有权限」：打开「终端」，输入 `bash ` （后面有空格），把 `一键安装.command` 拖进终端窗口，回车。
   - 脚本会自动安装 Xcode 命令行工具、Rust、Node、pnpm，构建安装包。国内网络已内置 rsproxy / npmmirror 镜像。
   - 第一次大约需要 10–20 分钟，之后会快很多。
3. 完成后桌面会出现 **「lingdot-desktop-pet」** 文件夹，里面有 `.dmg` 安装包和 `浏览器扩展` 文件夹。
4. 打开 `.dmg`，把 **lingdot-desktop-pet** 拖进「应用程序」。
5. 首次打开：在「应用程序」里**右键 lingdot-desktop-pet → 打开 → 打开**（应用没有付费签名，这是正常提示）。

小喵会出现在桌面上；她是菜单栏应用，不在 Dock 里，菜单栏有她的图标。

### 2. 和小喵互动

| 操作 | 效果 |
|---|---|
| 单击 | 打开 / 关闭面板（任务、网站、聊天、通知、设置） |
| 拖动 | 把她挪到你喜欢的位置（会记住） |
| 鼠标放在她身上，按住 ⌘（或 Ctrl）滚动滚轮 / 触控板捏合 | 调大小（60%–250%，会记住）；也可在 设置 → 角色 → 大小 用滑块或「小 / 中 / 大」 |
| 按住面板顶部拖动 | 移动面板（会记住位置；设置 → 角色 →「面板归位」回到她旁边） |
| 鼠标在头上来回轻扫 | 摸头，她会害羞，好感度上升 |
| 右键 | 设置 |
| 菜单栏图标 | 显示/隐藏、重置位置、开关动画、退出 |

### 3. （可选）让她帮你盯 ChatGPT

网站监控需要 Chrome 扩展。没连上扩展时，面板「任务」页顶部会有一张「让小喵帮你盯 ChatGPT」的引导卡片，跟着三步做就行（配对码可以直接在卡片里复制）：

1. Chrome 打开 `chrome://extensions` → 右上角打开 **开发者模式** → **加载已解压的扩展程序** → 选解压好的扩展文件夹（从 [Releases](https://github.com/zengjieyun67-cell/lingdot-desktop-pet/releases/latest) 下载 `browser-extension.zip` 并解压到固定位置，文件夹里有 `manifest.json`）。
   以后扩展有更新：用新文件覆盖该文件夹，再在 `chrome://extensions` 的扩展卡片上点 ↻ 重新加载。
2. 小喵面板 → 任务页引导卡片（或 设置 → 扩展）→ **复制配对码**。
3. 点浏览器里的扩展图标 → 设置 → 粘贴 → **保存并连接**。
4. 在扩展弹窗里给 ChatGPT 点 **授权**。之后回答生成完、出错或需要你操作时，小喵会提醒你。

### 4. （可选）换成 Live2D 形象

**用下载好的 .dmg（推荐）**：把模型文件夹（含 `.model3.json`）和官网的 `CubismSdkForWeb-*.zip` 放进「下载」文件夹，打开应用即可——启动时会自动在 下载 / 桌面 / 文稿 / `~/Live2D` / 以前的源码目录（`apps/desktop/public/live2d`）里找到并复制到 `~/Library/Application Support/com.desktoppet.app/live2d/`。没找到时去 设置 → 角色 点「一键导入我的 Live2D」或「选择模型文件夹」。

Live2D 的 Core 和模型受版权保护，**本仓库不包含**，需要你自己下载：

1. 在 [Live2D 官网](https://www.live2d.com/en/sdk/download/web/) 同意许可后下载 **Cubism SDK for Web** 的 ZIP。
2. 找一个允许个人使用的 Live2D 模型（含 `.model3.json`、`.moc3`、贴图），例如 BOOTH 上的免费模型，**请遵守作者条款**。
3. 把 SDK 的 ZIP 和**解压后的**模型文件夹放进「下载」，在终端（项目目录里）运行：
   ```bash
   bash scripts/setup-live2d.sh --sdk ~/Downloads/CubismSdkForWeb-*.zip --model ~/Downloads/<解压后的模型文件夹>
   ```
   然后重新双击 `一键安装.command`。
4. 设置 → 角色 → 渲染方式选 **Live2D**，模型路径填 `/live2d/models/<名>/<名>.model3.json` → 应用。
5. 看不到形象？设置页「当前：」一行会显示模型尺寸、纹理和绘制错误；随时可以切回「内置猫娘」。

### 5. （可选）AI 聊天

设置 → 聊天：打开开关，在「服务商」里选一个预设，**Base URL** 和**模型名**会自动填好（都可以再改）：

| 服务商 | Base URL | 默认模型 |
| --- | --- | --- |
| DeepSeek（默认） | `https://api.deepseek.com` | `deepseek-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Moonshot / Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 通义千问 DashScope | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 硅基流动 SiliconFlow | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` |
| Google Gemini（OpenAI 兼容） | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| Anthropic Claude（OpenAI 兼容层） | `https://api.anthropic.com/v1` | `claude-haiku-4-5` |
| Ollama（本机，无需 Key） | `http://localhost:11434/v1` | `qwen2.5` |
| 自定义 | 任意 OpenAI 兼容地址 | 自己填 |

1. 到对应服务商的控制台创建 API Key（设置里有直达链接），粘贴到「API Key」→ 保存。每个服务商的 Key 分开保存，切换服务商不会丢。Ollama / 本机 localhost 地址可以不填 Key。
2. 点 **测试连接**，看到「连接成功」就可以去「聊天」页和她聊天了；失败会直接说明原因（Key 无效 401、模型名或地址不对 404、余额不足、网络连不上、本机 Ollama 没启动等）。
3. Base URL 写到 `/v1`、只写域名、或写完整的 `/chat/completions` 都可以，会自动拼成正确的请求地址。用 DeepSeek 时会以**非思考模式**回复（更快）。
4. 从旧版本升级：原来的 DeepSeek（或自定义）设置和 Key 会自动迁移，不用重新填。

API Key 只保存在系统钥匙串（macOS 钥匙串 / Windows 凭据管理器）里，不会写进数据库，也不会上传到别处。

### 6. （可选）语音聊天：和小喵说话

全部免费：用的是 **macOS 自带的语音识别**（SFSpeechRecognizer）和 **系统语音**（`say`），不走付费实时语音 API。

1. 先完成上面第 5 步（聊天要能用，她才能回答你）。
2. 设置 → 🎙️ 语音 → 打开「开启语音」。可以挑声音（婷婷 / 美嘉…）、调语速，点「听听看」试听。
3. 第一次说话时 macOS 会弹两个权限：**麦克风** 和 **语音识别**，都点「允许」。点错了：系统设置 → 隐私与安全性 → 麦克风 / 语音识别 → 打开 lingdot-desktop-pet。
4. 怎么说：
   - **按住说话**：长按桌宠（或「聊天」页的 🎙️ 按钮）说话，松手就发出去，她会用声音回答。
   - **实时对话**：在「聊天」页勾上「实时对话」，像打电话一样，你说完停一下她就回答，回答完继续听。面板关掉也能聊。
   - 她说话时你直接开口可以打断她（设置里可关）；常被打断就把「说完停顿」调长一点。
5. 想让打字聊天的回复也读出来：打开「朗读文字回复」。

### 7. 听歌、打盹和更多状态

- **听歌**：QQ音乐、Apple 音乐、Spotify、网易云、酷狗、酷我在放歌时，小喵会戴上耳机跟着摇头，飘出 ♪，偶尔说一句。
  - QQ音乐的**歌名**需要「屏幕录制」权限才能读到（系统设置 → 隐私与安全性 → 屏幕录制）；不给权限也能识别，只是显示「正在听：QQ音乐」。
  - Apple 音乐 / Spotify 第一次会弹「自动化」权限，允许后能显示歌名；只读歌名，不会控制播放。
  - 浏览器里放的音乐默认不算，可在 设置 → 通用 →「包括浏览器播放」打开。
- **打盹**：你 10 分钟不碰电脑她会闭眼打盹（zZ），回来时伸个懒腰。不想要可在 设置 → 通用 关掉「发呆和睡觉」。
- 优先级：需要处理 ＞ 任务完成 ＞ 进行中 ＞ 听歌 ＞ 伸懒腰 ＞ 打盹 ＞ 发呆。

### 8. 桌面模式 / 桌宠模式

- **桌宠模式**（默认）：小喵浮在所有窗口上面，可以拖来拖去。
- **桌面模式**：小喵和时钟铺满桌面当壁纸，右下角保留 任务 / 聊天 / 设置 / 屏保 几个入口，其他窗口都在它上面。
- **两种风格**（设置 → 通用 → 桌面风格）：
  - 🌌 **Sonoma 极光**：超大细体时钟 + 流动极光渐变，小喵站在玻璃光晕前。
  - 📰 **杂志海报**：大号衬线数字和标题排版 + 胶片颗粒，正在听的歌当海报副标题，小喵半身特写。
- **时间系统**：清晨 / 白天 / 黄昏 / 夜晚各一套配色，每分钟按当前时间平滑过渡（`src/desktop/timeOfDay.ts`）。
- **屏保模式**：菜单栏图标 →「进入屏保」，或 设置 → 通用 →「屏保模式 · 现在进入」；也可以设置闲置 N 分钟自动进入。只看不点、信息更少，动一下鼠标或按任意键就退出。
- 切换：菜单栏图标 →「切换到桌面模式 / 切换到桌宠模式」，或 设置 → 通用 → 显示模式。
- 桌面模式里默认点击会穿到桌面图标；打开「桌面可以点」就能点小喵和右下角的入口。
- 浏览器预览：`#/desktop` 或 `#/screensaver`，可加 `?style=poster&t=18:20&demo=music`。

### 常见问题

- **安装时报 `tls handshake eof` / 下载 Rust 失败**：网络问题，脚本已使用国内镜像；可以换个网络或开代理后重新双击。
- **小喵不见了**：菜单栏图标 → 重置位置。
- **Live2D 空白**：先切回内置猫娘，再看「当前：」那行的提示；确认模型文件齐全。
- **说话没反应**：检查 系统设置 → 隐私与安全性 → 麦克风 和 语音识别 是否都打开；聊天要先能用。
- **听歌没显示歌名**：QQ音乐需要「屏幕录制」权限；没给权限时只显示「QQ音乐」。
- **没有 Mac 编译环境？** Fork 本仓库后在 Actions 里运行 *Build macOS DMG*，可以直接下载 Apple Silicon / Intel 的 `.dmg`。

---

> 以下是开发者文档。

## 目录结构

```
lingdot-desktop-pet/
├─ apps/
│  ├─ desktop/                 Tauri 2 + React + TypeScript + Vite（CSS Modules）
│  │  ├─ src/pet/              桌宠窗口、PetRenderer 接口、SVG 猫娘、Live2D、persona.ts（性格控制器）
│  │  ├─ src/panel/            面板：任务 / 网站 / 聊天 / 通知 / 设置（角色 / 小喵 / 聊天 / 扩展 / 通用），扩展安装引导
│  │  ├─ src/lib/              纯逻辑：petSize.ts（大小钳制）、chatPresets.ts（聊天服务商预设）
│  │  ├─ src/api/              Tauri 命令封装（浏览器预览时使用 localStorage mock）
│  │  └─ src-tauri/            Rust：窗口、托盘、通知、命令、聊天（ureq）+ 钥匙串（keyring）
│  │     └─ pet-core/          纯 Rust 库（不依赖 Tauri）：状态机、协议、SQLite、本地服务、记忆、聊天提示词
│  └─ browser-extension/       Chrome MV3 扩展（TypeScript + esbuild → dist/）
├─ packages/shared/            共享类型、协议校验（zod）、状态机镜像、信号分类器、persona（台词库 + 情绪状态机）
├─ persona/xiaomiao.md         小喵的完整人设提示词（聊天用，可编辑）
├─ scripts/check-env.sh        macOS 环境检查（缺什么打印安装命令）
├─ scripts/setup-live2d.sh     Live2D 设置向导
└─ ACCEPTANCE.md               验收测试清单
```

### 任务状态机的“权威”

- **Rust（`pet-core/src/state_machine.rs`）是唯一权威**：决定持久化状态、执行轮次和通知。
- TS 镜像（`packages/shared/src/state-machine.ts`）与 Rust 跑同一份 `test-vectors/state-machine.json`；协议校验同理（`test-vectors/protocol.json`）。
- 扩展只做页面信号分类（`packages/shared/src/classifier.ts`），由 Rust 决定是否转换。

规则：只有显式“执行”信号才进入进行中；只有显式“成功”信号（停止按钮消失 **且** 输入框恢复 **且** 回复存在并稳定 2 秒）才算完成；只有显式错误才算失败；登录/确认/授权 → 需要处理；元素消失、无变化、超时**绝不**判定完成/失败；矛盾信号 → 状态未知并记录证据；按事件 ID + (任务, 轮次, 状态) 去重，通知只发一次；完成后再次执行开启新一轮。

---

## 小喵的性格、情绪与记忆

### 台词（离线，`packages/shared/src/persona/lines.ts`）

- 触发：启动问候、久别归来、任务完成 / 失败 / 需要处理、扩展断开 / 重连、被点击、被拖动、摸头、长时间被冷落、深夜（23:00–05:00）、饭点、同时很多任务。
- 维度：触发 × 情绪 × 熟悉度（低：疏远客气；中：典型傲娇；高：嘴硬但黏人）。
- 占位符：`{name}`（她的名字）、`{user}`（她对你的称呼，默认「主人」）、`{task}`、`{site}`。例如「哼，主人又熬夜了？笨蛋，熬夜会变丑的。」
- 不立即重复（最近 3 句不重复）；闲聊类台词有最短间隔；自动消失；设置里可关闭气泡。
- 自称「本猫」，「喵 / 呼噜呼噜」只偶尔出现；测试保证不含辱骂用语。

### 情绪状态机（`packages/shared/src/persona/emotion.ts`）

| 情绪 | 典型触发 | SVG 表情 | Live2D（按顺序取第一个存在的） |
|---|---|---|---|
| 开心 happy | 任务完成、重连、连续摸头、高好感问候 | 脸红、小爱心、耳朵竖起 | `happy/smile/joy` + 动作 `Happy/TapHead` |
| 害羞 shy | 摸头、被拖动（好感高）、久别归来（好感低） | 大脸红、眼神躲闪、耳朵耷拉、扭捏嘴 | `shy/blush/embarrassed` |
| 闹别扭 angry | 被冷落、连戳 5 下、扩展断开、任务失败（对网站生气） | 鼓脸、💢、耳朵后压、撇嘴、扭头 | `angry/pout` + `Angry/Shake` |
| 困 sleepy | 深夜、深夜启动 | 半睁眼、zZ、耳朵耷拉、呼吸变慢 | `sleepy/tired/eyes_closed` |
| 平静 neutral | 默认；其他情绪超时回落 | — | `normal/default` |

非平静情绪会随时间回落（深夜回落为困）。映射配置在 `EMOTION_EXPRESSIONS`，修改即可适配你的 Live2D 模型。

**摸头**：鼠标不按键，在小喵头部来回轻扫几下。

### 长期记忆（仅本机 SQLite）

- 好感度、熟悉度、今天的心情、最近互动时间、连续陪伴天数、24 小时活跃分布、常用网站（启动器打开次数）、深夜使用天数。
- **只来自桌宠自身的使用情况**（点击、摸头、拖动、聊天、启动器打开、任务完成提醒），从不读取网页内容。
- 好感度：摸头 +3（每天最多计 5 次）、点击 +0.5、聊天 +1、每天首次使用 +1、被冷落 −2；熟悉度：每个活跃日 +2，互动每次 +0.2（每天最多 +5）。
- 设置 → 小喵：查看全部数据、重置记忆、关闭记忆（关闭后不再记录）。

### 可选聊天（默认关闭）

1. 设置 → 聊天：开启。所有服务商都走 OpenAI 兼容的 `POST {Base URL}/chat/completions`；预设表在 `apps/desktop/src-tauri/pet-core/src/chat_provider.rs`（前端镜像 `apps/desktop/src/lib/chatPresets.ts`，有测试保证两边一致）：DeepSeek（新安装默认）、OpenAI、Moonshot/Kimi、通义千问 DashScope（compatible-mode）、智谱 GLM、硅基流动、OpenRouter、Gemini（OpenAI 兼容）、Anthropic（OpenAI 兼容层）、Ollama（`http://localhost:11434/v1`）和自定义。Base URL 规则：去掉结尾的 `/` 和 `/chat/completions`；只写域名时补上该服务商的 API 路径（大多数是 `/v1`，DeepSeek 不补，DashScope `/compatible-mode/v1`，智谱 `/api/paas/v4`，OpenRouter `/api/v1`，Gemini `/v1beta/openai`）。只允许 https，本机 localhost 可用 http。DeepSeek 主机会额外发送 `"thinking": {"type": "disabled"}` 使用非思考模式。「测试连接」用表单里当前的服务商/地址/模型发一条极短请求（命令 `chat_test`），错误会按 401 / 403 / 404（模型或地址）/ 429 / 5xx / DNS / 连接被拒（本机服务未启动）/ 超时给出提示。
2. 输入 API Key → 保存：Key **只存入系统钥匙串**（keyring crate，服务名 `com.desktoppet.app`，每个服务商一条，账户名 `chat-api-key:<服务商>`），不写入数据库/设置，界面也不会再显示它；请求只从 Rust 后台发出。Ollama / localhost 可不设 Key（不发送 Authorization 头）。旧版本的单个 Key（账户名 `chat-api-key`）会在第一次使用时自动迁移到当时选中的服务商下；旧设置（`chatConfigVersion` < 2）同样自动迁移。
3. 系统提示词 = `persona/xiaomiao.md`（首次运行复制到 `~/Library/Application Support/com.desktoppet.app/persona/xiaomiao.md`，可直接编辑）+ 一段简短的记忆摘要（好感度、熟悉度、心情、习惯；关闭记忆时不发送）。
4. 聊天记录只保存在本机面板（webview localStorage，最多 40 条），可一键清空。

> 气泡和聊天中的小喵保持角色；应用界面的标签和错误提示保持普通文字。系统通知横幅也保持普通文字。

---

## 在 Mac 上构建（.app / .dmg）

### 1. 准备环境

```bash
bash scripts/check-env.sh      # 检查并打印缺失项的安装命令
```

| 依赖 | 安装命令 |
|---|---|
| macOS 11+ | — |
| Xcode Command Line Tools | `xcode-select --install` |
| Rust（rustup） | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` 然后 `source "$HOME/.cargo/env"` |
| Node.js ≥ 20 | `brew install node@22`（或 nvm） |
| pnpm ≥ 9 | `corepack enable && corepack prepare pnpm@latest --activate` |

### 2. 安装依赖、测试、构建

```bash
pnpm install
pnpm -r test                                        # TS 单元测试（shared / extension / desktop）
pnpm test:rust                                      # Rust 单元测试（pet-core）
pnpm --filter @desktop-pet/browser-extension build  # 扩展 → apps/browser-extension/dist
pnpm --filter @desktop-pet/desktop tauri build      # 桌面应用
```

产物：

- `apps/desktop/src-tauri/target/release/bundle/macos/lingdot-desktop-pet.app`
- `apps/desktop/src-tauri/target/release/bundle/dmg/lingdot-desktop-pet_0.1.0_aarch64.dmg`（Intel Mac 为 `_x64.dmg`）

开发模式：`pnpm dev:desktop`。只看界面（不需要 Rust）：`pnpm --filter @desktop-pet/desktop dev`，浏览器打开 `http://localhost:1420/?skipFirstRun=1#/panel` 或 `#/pet`（mock 数据）。

### 3. 首次打开（未签名应用）

- 在“应用程序”里**右键 lingdot-desktop-pet.app → 打开 → 打开**；或 系统设置 → 隐私与安全性 → “仍要打开”；或 `xattr -dr com.apple.quarantine /Applications/lingdot-desktop-pet.app`
- 桌宠是菜单栏应用（不出现在 Dock），菜单栏有它的图标。
- 第一次保存聊天 API Key 时，macOS 可能询问是否允许访问钥匙串，选“始终允许”。

---

## 安装浏览器扩展（Chrome / Edge / Arc 等）

1. `pnpm --filter @desktop-pet/browser-extension build`
2. 打开 `chrome://extensions`，开启 **开发者模式**
3. **加载已解压的扩展程序** → 选择 `apps/browser-extension/dist`

### 配对

1. 面板 → **设置 → 浏览器扩展** → 「复制配对码」（`{"port":17321,"token":"…"}`）
2. 扩展 → **设置** → 粘贴 → **保存并连接**
3. 扩展弹窗“桌宠监控的网站”中点 **授权**（例如 ChatGPT）
4. 面板顶部显示“扩展已连接”
5. （可选）把扩展 ID 填到 设置 → “限定扩展 ID”

令牌默认持久保存；可随时“重新生成”（旧令牌立即失效），或开启“每次启动换新令牌”。

---

## Live2D 设置

```bash
bash scripts/setup-live2d.sh                    # 查看完整说明
bash scripts/setup-live2d.sh --sdk ~/Downloads/CubismSdkForWeb-5-r.x.zip
bash scripts/setup-live2d.sh --model ~/Downloads/MyCatgirl
```

- **Cubism Core 不能随项目分发**：请从 https://www.live2d.com/en/sdk/download/web/ 同意许可后下载。
- 打包方式：放在 `apps/desktop/public/live2d/` 后重新构建，模型路径填 `/live2d/models/<名>/<名>.model3.json`。
- 不重新打包：放到 `~/Library/Application Support/com.desktoppet.app/live2d/`，在 设置 → 角色（Live2D）填绝对路径。
- 状态映射：`apps/desktop/src/pet/renderer/Live2DRenderer.ts` 的 `LIVE2D_MOOD_MAP`；情绪映射：`packages/shared/src/persona/emotion.ts` 的 `EMOTION_EXPRESSIONS`。缺少动作时叠加 ✨/💖/❗ 徽标兜底；加载失败自动回退 SVG。

---

## 使用

- **单击**：打开/关闭面板（小喵会嘀咕一句）；**拖动**：移动；**头上来回摸**：摸头；**右键**：设置
- 托盘菜单：显示/隐藏桌宠、打开面板、重置位置、开关动画、退出
- **任务**：扩展检测到执行信号时自动创建，也可手动新建；筛选；详情含执行轮次和状态历史；“判定可信度”不代表进度
- **网站**：启动器一键打开；增删改、换图标、拖动排序、开关监控；默认浏览器或指定浏览器（`open -a`）
- **聊天**：开启后在面板“聊天”页和小喵对话
- **通知**：完成 / 失败 / 需要处理 / 扩展断开；可关闭系统通知或提示音；同一轮次同一状态只通知一次；点击通知、“通知”页“打开”或桌宠气泡都会跳到任务页面

---

## 已知限制

1. **ChatGPT 选择器未在真实页面验证**（无法登录）。全部集中在 `apps/browser-extension/src/adapters/chatgpt.selectors.ts`，请按 `apps/browser-extension/ADAPTERS.md` 核对。识别不到时返回“状态未知”，不会误报完成。
2. **Hark / 哔哩哔哩 / CapCut 适配器是桩**：不会判定完成/失败。
3. **通知点击**：已接入 tauri-plugin-notification 2.6 的 `on_action`，点击系统通知会尽力打开任务页面（取决于 macOS 通知中心是否回传；`tauri dev` 下通知以“终端”身份发出，点击不会回到应用）。兜底：面板“通知”页“打开”按钮 + 桌宠气泡。
4. **通知权限**：首次需允许；请用打包后的 .app 测试通知。
5. **未签名应用**：需右键打开；开机启动（LaunchAgent）在 macOS 13+ 可能在“登录项”中提示。
6. 透明窗口使用 `macOSPrivateApi`，不能上架 Mac App Store。
7. 拖动通过“移动超过 4px 后 `startDragging()`”实现，以区分单击。
8. 扩展只支持 Chromium 内核浏览器。
9. **钥匙串**：keyring 启用了 `apple-native`（macOS 钥匙串）和 `windows-native`（Windows 凭据管理器）后端；Linux（仅开发用）上 Key 存在内存 mock 中，重启后丢失。
10. 聊天质量取决于你选择的模型；小喵的离线台词不依赖网络。
11. **第二阶段的 macOS 部分只在 Linux 上编译检查过**：语音识别（objc2 调用 SFSpeechRecognizer / AVAudioEngine）、`say`、`pmset` / AppleScript / `ioreg` 探测、桌面层级窗口需要在真机上验证，见 ACCEPTANCE.md 的 P5–P7。
12. 听歌检测靠 `pmset -g assertions` 判断谁在放声音，QQ音乐歌名靠窗口标题（需要屏幕录制权限）；版本更新可能改变行为。
13. **Windows 版**（build-6 起）：只在 Linux 上 `cargo check --target x86_64-pc-windows-msvc` 并由 CI 打包，尚未在真机上验证。语音识别、听歌检测、桌面层级窗口（用「置底」近似）是 macOS 专有；Ctrl+Shift+N 会占用浏览器的「无痕窗口」快捷键。

## 路线图（第三阶段）

- Hark / 哔哩哔哩 / CapCut 真实适配器（接口与指南已就绪：`ADAPTERS.md`）
- 设置中的模型文件选择器与动作映射编辑器；台词库自定义导入
- 签名与公证、自动更新；Firefox / Safari 扩展

## 隐私与安全

- 扩展权限：`storage`、`scripting`、`alarms`、`http://127.0.0.1/*`；网站访问全部是 `optional_host_permissions`，逐个授权，只为已授权源注册内容脚本。
- 上报内容：标题、网址、布尔/数字信号、证据代码；**不**上报正文、对话、输入、Cookie、密码。TS 与 Rust 两侧严格 schema 拒绝字符串信号与未知字段。
- 本地服务：只绑定 `127.0.0.1`；校验 `Host`（防 DNS rebinding）、`Origin` 必须是 `chrome-extension://`（可锁定 ID）、Bearer 令牌常量时间比较、请求体 ≤ 16KB、只有 3 个端点，无命令执行或文件读取。
- 记忆只存本机 SQLite：`~/Library/Application Support/com.desktoppet.app/desktop-pet.sqlite`；聊天 API Key 只在钥匙串中。

## 许可证

本项目源码以 [MIT License](../LICENSE) 开源。

以下第三方内容**不包含**在本仓库中，也不适用 MIT 许可：

- **Live2D Cubism Core**（`live2dcubismcore.min.js`）：受 Live2D Proprietary Software License 约束，不可二次分发。请自行从 Live2D 官网下载 Cubism SDK for Web，再运行 `scripts/setup-live2d.sh`。
- **Live2D 模型**：版权归原作者所有，请遵守各模型的使用条款，不要把模型文件提交到仓库。
- 依赖库（Tauri、React、PixiJS、pixi-live2d-display 等）各自遵循其原有开源许可。
