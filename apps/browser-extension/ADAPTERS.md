# 网站适配器开发指南

适配器负责把网页上**可见的界面信号**转换成任务状态。它运行在内容脚本中，只在用户授权过的网站上注入。

## 接口

```ts
// src/adapters/types.ts
interface SiteAdapter {
  readonly type: AdapterType;               // "generic" | "chatgpt" | "hark" | "bilibili" | "capcut"
  matches(url: URL): boolean;               // 该适配器是否负责这个页面
  observe(cb: () => void): void;            // 启动 MutationObserver，DOM 变化时（节流）回调
  getCurrentSignals(): PageSignals;         // 读取当前可见信号
  classifyState(now?: number): Classification; // 交给共享分类器（packages/shared/src/classifier.ts）
  taskKey(): string;                        // 当前页面对应任务的稳定 key
  transmittableSignals(sig): Record<string, boolean | number>; // 允许发送的信号（只能是布尔/数字）
  dispose(): void;
}
```

大多数适配器只需继承 `DomAdapter` 并实现 `matches()` 与 `getCurrentSignals()`。

### PageSignals 含义

| 字段 | 含义 | 必须是“显式”信号 |
|---|---|---|
| `executing` | 明确的“正在执行”指示（如“停止生成”按钮可见） | ✅ |
| `streaming` | 流式输出标记 | ✅ |
| `composerReady` | 输入框重新可用 | |
| `resultPresent` | 页面上存在结果消息 | |
| `resultFingerprint` | 最后一条结果的**本地**指纹（长度/节点数哈希，不发送） | |
| `error` | 明确的错误界面 | ✅ |
| `loginWall` | 登录墙 / 登录页 | ✅ |
| `confirmRequired` | 明确的确认 / 授权弹窗 | ✅ |

### 分类规则（共享分类器，保守）

- `running`：`executing || streaming`
- `completed`：本页会话中**先看到过执行**，然后执行指示消失 **且** 输入框恢复 **且** 有结果 **且** 结果指纹稳定 ≥ 2 秒
- `failed`：`error`
- `needs_attention`：`loginWall || confirmRequired`
- 互相矛盾（如错误 + 正在执行）→ `unknown` + `conflict: true`
- 识别不到任何信号 → `unknown`（桌面端保持原状态，**绝不**据此判定完成/失败）
- 元素消失、长时间无变化、超时 —— 都**不是**完成信号

## 隐私红线

- 只能判断元素是否存在 / 可见 / 被禁用；可以在本地计算长度指纹。
- **不得**发送页面正文、对话内容、输入框内容、Cookie、localStorage、密码。
- `transmittableSignals()` 只能返回布尔或数字；协议校验（TS 与 Rust 两侧）会拒绝字符串信号与未知字段。

## 新增一个适配器

1. 在 `src/adapters/` 新建文件，继承 `DomAdapter`（或从 `stubs.ts` 中的桩开始）。
2. 选择器集中放在一个 `xxx.selectors.ts` 常量对象里，并写明 `verifiedAt`。
3. 在 `src/adapters/index.ts` 的注册表中加入（在 generic 之前）。
4. 若是新类型，在 `packages/shared/src/task-types.ts` 的 `ADAPTER_TYPES` 与 Rust `pet-core/src/model.rs` 的 `ADAPTER_TYPES` 中同时加入（协议校验会拒绝未知适配器）。
5. 在 `test/adapters.test.ts` 用合成 HTML 写测试：运行中、完成（含稳定期）、错误、登录墙、无信号、冲突。
6. 在真实页面上验证选择器（见下）。

## 现有适配器状态

| 适配器 | 状态 | 说明 |
|---|---|---|
| `chatgpt` | 已实现，**选择器未在真实页面验证** | 见 `chatgpt.selectors.ts` |
| `generic` | 已实现（弱） | 只把 `aria-busy="true"` / `role="progressbar"` 视为执行；永不判定完成/失败 |
| `hark` | 桩 | TODO：识别“代理执行中 / 完成 / 需要批准”界面 |
| `bilibili` | 桩 | TODO：创作中心投稿上传 / 转码进度 |
| `capcut` | 桩 | TODO：导出/渲染进度弹窗与“导出完成”提示 |

## 验证 ChatGPT 选择器

在已登录的 https://chatgpt.com 打开 DevTools Console：

```js
// 1) 发送一条较长的问题，在生成过程中执行：
document.querySelector('button[data-testid="stop-button"]')       // 应返回按钮
document.querySelector('[data-message-author-role="assistant"]')  // 应返回消息
// 2) 生成结束后执行：
document.querySelector('button[data-testid="stop-button"]')       // 应为 null
document.querySelector('#prompt-textarea')                        // 应返回输入框
document.querySelector('button[data-testid="send-button"]') ||
  document.querySelector('button[data-testid="composer-speech-button"]') // 至少一个存在
// 3) 退出登录后访问首页：
document.querySelector('button[data-testid="login-button"]')      // 应返回按钮
```

不匹配时，只修改 `chatgpt.selectors.ts`，把 `verifiedAt` 改为验证日期，然后 `pnpm --filter @desktop-pet/browser-extension build` 并在 `chrome://extensions` 点“重新加载”。

调试：在页面 Console 中，内容脚本的状态不会打印（避免泄露）。可在扩展 Service Worker 的 DevTools 中观察发往 `127.0.0.1` 的请求。
