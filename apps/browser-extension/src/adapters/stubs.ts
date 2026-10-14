/**
 * Documented stubs for sites without a dedicated adapter yet.
 * They behave like the generic adapter (never claim completed/failed) until
 * someone implements real signals — see ../../ADAPTERS.md.
 */
import { GenericAdapter } from "./generic";

const hostIs = (url: URL, hosts: string[]) => hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));

/** Hark (https://hark.com). TODO: identify "agent working" / "done" / "needs approval" UI. */
export class HarkAdapter extends GenericAdapter {
  override readonly type = "hark" as const;
  override matches(url: URL): boolean {
    return hostIs(url, ["hark.com"]);
  }
}

/** 哔哩哔哩 (https://www.bilibili.com). TODO: e.g. upload/transcode progress in 创作中心 (member.bilibili.com). */
export class BilibiliAdapter extends GenericAdapter {
  override readonly type = "bilibili" as const;
  override matches(url: URL): boolean {
    return hostIs(url, ["bilibili.com"]);
  }
}

/** CapCut (https://www.capcut.com). TODO: export/render progress dialog + "export complete" toast. */
export class CapCutAdapter extends GenericAdapter {
  override readonly type = "capcut" as const;
  override matches(url: URL): boolean {
    return hostIs(url, ["capcut.com"]);
  }
}
