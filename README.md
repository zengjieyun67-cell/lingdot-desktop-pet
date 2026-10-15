# lingdot-desktop-pet ·「小喵」桌宠

一只住在 macOS 桌面角落的傲娇猫娘「小喵」（名字和她对你的称呼都可以改，默认称你为「主人」）。她会在你**授权过的网站**上的 AI 任务（例如 ChatGPT 生成回答）**进行中 / 完成 / 失败 / 需要你处理**时做出反应并提醒你，深夜催你睡觉、饭点提醒吃饭，被冷落会闹别扭，也是一个小巧的网站启动器。

- 透明、无边框、始终置顶、不占 Dock 的小窗口，可拖动，记住位置；大小可在 60%–250% 之间自由调节
- 面板清爽可爱（奶油 / 蜜桃 / 草莓牛奶配色），按住顶部可拖动，会记住位置
- 内置精心绘制的分层 SVG 猫娘：呼吸、眨眼、耳朵抖动、尾巴摆动、眼睛/头跟随鼠标；任务状态动画（打字 / 开心跳跃 / 竖耳“!”）+ 情绪表情（脸红、鼓脸、半睁眼、耳朵耷拉/竖起/后压）
- 放入 Live2D Cubism Core 与你的 `.model3.json` 模型后自动切换为 Live2D（情绪/状态映射到模型表情与动作）
- **性格**：傲娇台词库（离线可用）× 情绪状态机 × 本地长期记忆（好感度、熟悉度、习惯）
- **可选聊天**：内置 DeepSeek 预设（只需粘贴 API Key），也可用任意 OpenAI 兼容接口；API Key 存在 macOS 钥匙串，只由 Rust 后台发送
- Chrome MV3 扩展只在你授权的网站注入脚本，只上报标题、网址和按钮状态信号
- 本地服务只监听 `127.0.0.1`，Bearer 令牌 + Origin/Host 校验 + 16KB 限制 + 严格 schema

> 系统要求：macOS 12+（Apple Silicon / Intel 均可），Chrome / Edge / Arc 等 Chromium 浏览器。

## 🚀 快速开始（普通用户看这里）

### 1. 下载并一键安装

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

1. Chrome 打开 `chrome://extensions` → 右上角打开 **开发者模式** → **加载已解压的扩展程序** → 选桌面「lingdot-desktop-pet/浏览器扩展」。
2. 小喵面板 → 任务页引导卡片（或 设置 → 扩展）→ **复制配对码**。
3. 点浏览器里的扩展图标 → 设置 → 粘贴 → **保存并连接**。
4. 在扩展弹窗里给 ChatGPT 点 **授权**。之后回答生成完、出错或需要你操作时，小喵会提醒你。

### 4. （可选）换成 Live2D 形象

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

设置 → 聊天：打开开关，「服务商」默认就是 **DeepSeek**，接口地址已自动填好：

```text
接口地址: https://api.deepseek.com
模型:     deepseek-flash（快，推荐；也可选 deepseek-v4-pro）
```

1. 到 [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) 创建一个 API Key，粘贴到「API Key」→ 保存。
2. 点 **测试连接**，看到「连接成功」就可以去「聊天」页和她聊天了；失败会直接显示原因（例如 Key 无效、余额不足）。
3. 小喵会以 DeepSeek 的**非思考模式**回复（更快）。想用别的服务，把「服务商」切到「自定义 OpenAI 兼容」，自己填接口地址和模型名。

API Key 只保存在 macOS 钥匙串里，不会写进数据库，也不会上传到别处。

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
- **桌面模式**：一间黄色的小房间铺满桌面（窗户、云、靠垫、植物、大时钟和今天的任务），小喵住在里面，其他窗口都在它上面。
- 切换：菜单栏图标 →「切换到桌面模式 / 切换到桌宠模式」，或 设置 → 通用 → 显示模式。
- 桌面模式里默认点击会穿到桌面图标；打开「桌面可以点」就能点小喵、长按说话。

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
│  │  ├─ src/lib/              纯逻辑：petSize.ts（大小钳制）、chatPresets.ts（DeepSeek 预设）
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

1. 设置 → 聊天：开启。服务商预设：**DeepSeek**（新安装默认；`https://api.deepseek.com` → POST `https://api.deepseek.com/chat/completions`，模型 `deepseek-flash` / `deepseek-v4-pro`，请求体带 `"thinking": {"type": "disabled"}` 使用非思考模式——该字段只在主机为 `api.deepseek.com` 时发送）或 **自定义 OpenAI 兼容**（例如 `https://api.openai.com/v1`，或本机 `http://localhost:11434/v1`）。地址可写到 `/v1` 或完整的 `/chat/completions`，两种都会正确拼接。「测试连接」用表单里当前的地址/模型发一条极短请求（命令 `chat_test`）。
2. 输入 API Key → 保存：Key **只存入 macOS 钥匙串**（keyring crate，服务名 `com.desktoppet.app`），不写入数据库/设置，界面也不会再显示它；请求只从 Rust 后台发出。
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
9. **钥匙串**：keyring 只启用了 `apple-native` 后端；在非 macOS 上（仅开发用）Key 存在内存 mock 中，重启后丢失。
10. 聊天质量取决于你选择的模型；小喵的离线台词不依赖网络。
11. **第二阶段的 macOS 部分只在 Linux 上编译检查过**：语音识别（objc2 调用 SFSpeechRecognizer / AVAudioEngine）、`say`、`pmset` / AppleScript / `ioreg` 探测、桌面层级窗口需要在真机上验证，见 ACCEPTANCE.md 的 P5–P7。
12. 听歌检测靠 `pmset -g assertions` 判断谁在放声音，QQ音乐歌名靠窗口标题（需要屏幕录制权限）；版本更新可能改变行为。

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

本项目源码以 [MIT License](LICENSE) 开源。

以下第三方内容**不包含**在本仓库中，也不适用 MIT 许可：

- **Live2D Cubism Core**（`live2dcubismcore.min.js`）：受 Live2D Proprietary Software License 约束，不可二次分发。请自行从 Live2D 官网下载 Cubism SDK for Web，再运行 `scripts/setup-live2d.sh`。
- **Live2D 模型**：版权归原作者所有，请遵守各模型的使用条款，不要把模型文件提交到仓库。
- 依赖库（Tauri、React、PixiJS、pixi-live2d-display 等）各自遵循其原有开源许可。
