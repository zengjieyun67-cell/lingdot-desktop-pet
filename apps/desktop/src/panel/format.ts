import { STATUS_LABEL_ZH, type TaskStatus } from "@desktop-pet/shared";

export function relTime(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return "—";
  const d = Math.max(0, now - ts);
  if (d < 45_000) return "刚刚";
  if (d < 3_600_000) return `${Math.round(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} 小时前`;
  if (d < 7 * 86_400_000) return `${Math.round(d / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

export function fullTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

export const statusLabel = (s: TaskStatus) => STATUS_LABEL_ZH[s];

/** Confidence is shown as a qualitative label — never as a progress percentage. */
export function confidenceLabel(c: number): string {
  if (c >= 0.85) return "高";
  if (c >= 0.5) return "中";
  return "低";
}

export const DETECTION_LABEL: Record<string, string> = {
  manual: "手动",
  extension: "浏览器扩展",
  timeout: "超时判定",
  system: "系统",
};

export const EVENT_KIND_LABEL: Record<string, string> = {
  created: "创建",
  auto_created: "自动创建",
  manual_status: "手动修改状态",
  timeout: "长时间无信号",
  "task.observed": "观察",
  "task.status_changed": "状态变化",
  "task.completed": "完成信号",
  "task.failed": "错误信号",
  "task.needs_attention": "需要处理信号",
};

export const ADAPTER_LABEL: Record<string, string> = {
  generic: "通用（仅标题/可见性）",
  chatgpt: "ChatGPT",
  hark: "Hark（待实现）",
  bilibili: "哔哩哔哩（待实现）",
  capcut: "CapCut（待实现）",
};

export function isImageIcon(icon: string): boolean {
  return icon.startsWith("data:image/") || icon.startsWith("https://");
}
