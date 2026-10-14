import type { SiteAdapter } from "./types";
import { ChatGPTAdapter } from "./chatgpt";
import { GenericAdapter } from "./generic";
import { BilibiliAdapter, CapCutAdapter, HarkAdapter } from "./stubs";

/** Ordered registry: first adapter whose matches() returns true wins; generic is the fallback. */
export function pickAdapter(href: string, doc: Document = document): SiteAdapter {
  const url = new URL(href);
  const candidates: SiteAdapter[] = [new ChatGPTAdapter(doc), new HarkAdapter(doc), new BilibiliAdapter(doc), new CapCutAdapter(doc)];
  return candidates.find((a) => a.matches(url)) ?? new GenericAdapter(doc);
}

export { ChatGPTAdapter, GenericAdapter, HarkAdapter, BilibiliAdapter, CapCutAdapter };
export type { SiteAdapter };
