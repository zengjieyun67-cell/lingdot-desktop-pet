# 验收测试清单

共 12 项核心验收 + 4 项「小喵」性格验收（P1–P4）。每项给出 **自动化测试映射** 与 **手动步骤**（需在 Mac 上用打包后的应用 + Chrome 验证）。

```bash
pnpm install
pnpm -r test          # packages/shared、apps/browser-extension、apps/desktop（vitest）
pnpm test:rust        # pet-core（cargo test -p pet-core）
```

> 自动化测试覆盖逻辑、协议、安全边界与性格规则；窗口透明度、托盘、系统通知横幅、真实 ChatGPT 页面、钥匙串弹窗等只能手动验收。

---

## AT-01 桌宠窗口：透明、置顶、可拖动、记住位置

- 自动化：`pet-core db::tests::settings_roundtrip_and_sanitize`
- 手动：启动 → 右下角出现透明背景猫娘，不在 Dock；切换其他窗口仍置顶；拖到左上 → 退出重开仍在左上；设置 → “重置位置”回到右下；“大小”改为大 → 窗口变大。

## AT-02 面板与托盘

- 手动：单击猫娘弹出约 380×560 圆角半透明面板，再单击/Esc 关闭；右键直接打开“设置”；托盘“显示/隐藏桌宠 / 打开面板 / 重置位置 / 开关动画 / 退出”均生效。

## AT-03 任务状态动画

- 自动化：`apps/desktop renderer.test.ts › SvgCatgirlRenderer …`；`pet-core engine::tests::pet_mood_aggregation`
- 手动：idle 呼吸/眨眼/耳朵抖动/尾巴摆动/视线跟随鼠标（窗口外也跟随）；手动把任务标记为进行中 → 笔记本 + 打字 + 星星；已完成 → 跳跃 + ^ ^ + 爱心（约 12 秒）；需要处理 → 竖耳 + “!” 气泡；关闭动画 → 全部静止。

## AT-04 Live2D 与回退

- 自动化：`renderer.test.ts › createRenderer …`、`Live2D motion mapping …`
- 手动：未放 Core/模型时为 SVG，渲染方式选 Live2D → 设置页显示原因且猫娘正常；放置 Core 与模型后切换为 Live2D，跟随鼠标，状态/情绪播放映射动作/表情；路径错误 → 自动回退并显示原因。

## AT-05 启动器

- 自动化：`pet-core db::tests::migrations_and_seed`、`site_crud_and_reorder`、`site_validation`、`reopen_is_idempotent`
- 手动：默认 ChatGPT / Hark / 哔哩哔哩 / CapCut；增删改、换图标（emoji/上传/favicon）、拖动或 ↑↓ 排序（重启保持）；指定浏览器 `Google Chrome` 用 `open -a` 打开；`javascript:` 网址被拒。

## AT-06 任务管理

- 自动化：`pet-core db::tests::manual_tasks_and_filters`、`cleanup_removes_old_finished`；`format.test.ts › never renders confidence as a percentage`
- 手动：新建/编辑/标记/删除；按网站/状态筛选；详情有轮次与历史；“判定可信度”显示 高/中/低 且无进度条；清理/清空生效。

## AT-07 扩展配对与令牌

- 自动化：`pet-core server::tests::rejects_missing_or_wrong_token`、`token_rotation_invalidates_old_token`、`security::tests::*`；扩展 `lib.test.ts › pairing / backoff`
- 手动：粘贴配对码 → 已连接；重新生成令牌 → 扩展显示配对码无效；退出桌宠 → 扩展显示未运行并退避重试。

## AT-08 网站授权与动态注入

- 自动化：扩展 `lib.test.ts › origin patterns`
- 手动：安装后无任何网站权限；弹窗授权 ChatGPT → `chrome.scripting.getRegisteredContentScripts()` 只含 `https://chatgpt.com/*`；未授权站点不注入；撤销后移除。

## AT-09 ChatGPT：进行中 → 完成，只通知一次

- 自动化：扩展 `adapters.test.ts › stop button => running; then completion requires stability`、`privacy …`；`pet-core engine::tests::running_then_completed_notifies_once`、`new_run_after_completion_notifies_again`、`rekey_from_previous_task_key`；`state_machine::tests::shared_vectors`（与 TS 同一份向量）
- 手动（先按 ADAPTERS.md 核对选择器）：提问 → 自动出现“进行中”任务；回答结束约 2 秒 → “已完成”+ 一条系统通知 + 小喵气泡（傲娇台词）+ 开心跳跃；刷新页面不重复通知；同一对话再问 → 第 2 轮，完成后再通知一次。

## AT-10 失败 / 需要处理 / 冲突 / 超时

- 自动化：共享状态机向量（双端）；`random_walk_invariants` 与 TS invariants；`engine::tests::timeout_moves_running_to_unknown_without_notification`、`unknown_or_completed_alone_never_creates_task`；扩展 `explicit error => failed`、`login wall => needs_attention`、`no known signal => unknown`、`error while generating => unknown with conflict`、`stop button vanishing … NOT completion`、`Generic adapter … never completes`
- 手动：退出 ChatGPT 登录 → 需要处理；制造错误 → 失败并通知一次；生成中关闭标签页 → 10 分钟后“状态未知”，不通知。

## AT-11 本地服务安全

- 自动化（`pet-core server::tests`）：`binds_only_to_loopback`、`end_to_end_over_real_socket`、`rejects_web_origins_and_missing_origin`、`pinned_extension_id`、`rejects_bad_host_header`、`rejects_oversize_body`、`rejects_invalid_schema`、`rejects_non_json_content_type_and_unknown_routes`、`sites_endpoint_lists_only_monitored`；`protocol::tests::shared_protocol_vectors`
- 手动：`lsof -nP -iTCP:17321 -sTCP:LISTEN` 只有 `127.0.0.1`；`curl` 无 Origin → 403；网页 Origin → 403；错误令牌 → 401。

## AT-12 通知

- 自动化：`pet-core db::tests::notification_dedupe_and_clear`、`engine::tests::cleared_notifications_never_refire`、`heartbeat_connection_lifecycle`
- 手动：首次引导说明通知权限 → 允许后收到测试通知；关闭系统通知 → 只有面板记录和气泡；关闭提示音 → 无声；“通知”页“打开”与气泡点击打开任务页面；点击系统通知横幅尽力打开（依赖通知中心）；退出 Chrome 约 75 秒 → 一次“扩展已断开”，小喵闹别扭；重开 Chrome → 小喵说重连台词。

---

## P1 小喵台词与气泡

- 自动化：`packages/shared test/persona.test.ts › line library`（每个触发 × 情绪 × 熟悉度都有台词；不含辱骂词；包含 本猫/哼/切/才不是/笨蛋/真拿你没办法/勉强/不要误会哦；喵类口癖占比 < 20%；不立即重复；`{name}/{user}/{task}/{site}` 填充）；`apps/desktop src/pet/persona.test.ts`（深夜每小时最多一次、饭点每餐一次、冷落 45 分钟后提醒并冷却、多任务提醒冷却、闲聊限频、关闭气泡时不说话、久别归来问候）
- 手动：启动时问候；单击、拖动、头上来回摸 → 不同台词；设置 → 对你的称呼改为「前辈」→ 台词中称呼随之改变；23 点后出现“哼，前辈又熬夜了？”类提醒；关闭“对话气泡”后不再说话（任务提醒气泡仍在）。

## P2 情绪状态机与表情

- 自动化：`persona.test.ts › emotion state machine`（完成→开心并回落、失败/断开/冷落→闹别扭、摸头随好感度变化且连摸→开心、连戳 5 下→生气、拖动随好感度、深夜→困并持续、饭点不打断闹别扭）；`renderer.test.ts`
- 手动：摸头 → 脸红/耳朵耷拉（害羞）；连戳 → 鼓脸 + 💢 + 耳朵后压；深夜 → 半睁眼 + zZ；任务完成 → 开心 + 小爱心。Live2D 模型如有 `shy/angry/sleepy` 等表情会被调用。

## P3 长期记忆

- 自动化：`pet-core persona::tests::*`（连续天数、每日熟悉度上限、摸头好感上限、冷落扣分不计活跃、常用网站与深夜统计、非法输入拒绝）、`db::tests::persona_memory_roundtrip_and_reset`、`chat::tests::system_prompt_includes_name_and_memory`
- 手动：设置 → 记忆 显示好感度、熟悉度、今天心情、连续天数、深夜天数、常用网站、24 小时活跃图；摸头后好感度上升；“重置”清零；关闭“记忆功能”后互动不再改变数值。确认数据库中无网页内容：`sqlite3 ~/Library/Application\ Support/com.desktoppet.app/desktop-pet.sqlite 'select data from persona_memory'`。

## P4 可选聊天与钥匙串

- 自动化：`pet-core chat::tests::*`（接口地址校验：https 或本机 http、拒绝带账号密码/非 http；人设文件包含关键设定与 `{name}`/`{user}`；系统提示词含名字、称呼和记忆摘要；关闭记忆时不含摘要；请求最多 12 条历史、丢弃注入的 system 角色、截断长消息；响应/错误解析）
- 手动：默认“聊天”页提示未开启，离线台词照常；开启并填写接口/模型 → 保存 API Key → 弹出钥匙串授权 → 钥匙串访问 App 中出现 `com.desktoppet.app / chat-api-key`；数据库与 `settings` 中搜不到 Key；对话中小喵用设定称呼、保持傲娇语气；删除 Key 后发送提示需先保存 Key；编辑 `~/Library/Application Support/com.desktoppet.app/persona/xiaomiao.md` 后新对话生效。

## P5 语音对话（macOS 自带语音识别 + 系统语音）

- 自动化：`pet-core voice::tests::*`（停顿判定一句话结束、回声 / 打断判定、`speech_text` 去掉 markdown/链接/emoji/（动作）、`say -v '?'` 解析与中文声音挑选、语速映射）、`db` 新设置读写与旧设置兼容；前端 `lib/voice.test.ts`。
- 手动（真机）：
  1. 设置 → 语音 打开；第一次长按桌宠 → 弹出「麦克风」「语音识别」权限 → 允许。
  2. 长按桌宠说「你好」→ 桌宠下方显示「🎙️ 你好」→ 松手 →「想一想…」→ 小喵用系统中文声音回答，嘴巴在动；回答出现在「聊天」记录里。
  3. 聊天页勾选「实时对话」→ 连续说两三句，每句停顿后她都会回答；关闭面板后仍能对话；取消勾选后停止。
  4. 她说话时开口 → 她停下来听（「可以打断她」开启时）；关闭后不打断。
  5. 拒绝权限后再试 → 显示中文错误提示，不崩溃。
  6. 声音、语速、「说完停顿」修改后立即生效；「听听看」可试听。

## P6 听歌与更多状态

- 自动化：`pet-core activity::tests::*`（`pmset` 输出解析、忽略只开麦克风的断言和本应用、进程 → 应用识别、音乐应用优先于浏览器、AppleScript 输出解析、QQ音乐窗口标题解析、`ioreg` HIDIdleTime、去抖、打盹 / 伸懒腰、显示状态优先级）、shared `states.test.ts`。
- 手动（真机）：
  1. QQ音乐播放 → 几秒内小喵戴耳机、摇头、飘 ♪，冒一句台词；暂停 → 恢复原状。
  2. 给「屏幕录制」权限后显示「♪ 正在听：歌名」，不给时显示「QQ音乐」。
  3. Apple 音乐 / Spotify：弹「自动化」权限，允许后显示歌名；不会自动打开这两个 App。
  4. 浏览器放视频：默认不算听歌；打开「包括浏览器播放」后算。
  5. 10 分钟不动鼠标键盘 → 闭眼打盹 + zZ；动一下 → 伸懒腰约 6 秒后回到发呆。
  6. 有任务「需要处理」时听歌 → 显示需要处理（优先级更高）。
  7. Live2D 模型：有 Music/Dance 等动作时播放动作，没有时显示 ♪ / 💤 角标；说话时 `ParamMouthOpenY` 张合；`renderOrders` 兼容补丁仍生效、无每帧报错。

## P7 桌面模式

- 手动（真机）：
  1. 菜单栏 →「切换到桌面模式」→ 黄色房间铺满当前屏幕，所有普通窗口都在它上面；桌面图标被遮住属正常。
  2. 房间里显示大时钟、日期星期、今天的任务；任务变化后卡片更新。
  3. 小喵在靠垫上，听歌 / 打盹 / 说话等状态和桌宠模式一致；切换 Space 时房间仍在。
  4. 「桌面可以点」关闭时点击穿到桌面；打开后可以点小喵（打开面板）、长按说话。
  5. 菜单栏 →「切换到桌宠模式」→ 房间消失，浮动桌宠回来；重启应用后保持上次的模式。
  6. Bundle ID 仍为 `com.desktoppet.app`，已有设置、记忆和钥匙串里的 Key 不丢。
