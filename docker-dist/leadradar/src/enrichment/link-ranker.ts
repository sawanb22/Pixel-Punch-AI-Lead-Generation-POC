import type { CompanyPageType } from "./types.js";

const PAGE_RULES: Array<{ type: CompanyPageType; pattern: RegExp; rank: number }> = [
  { type: "about", pattern: /\/(about|about-us|company|who-we-are)(\/|$)/i, rank: 100 },
  { type: "contact", pattern: /\/(contact|contact-us|get-in-touch)(\/|$)/i, rank: 90 },
  { type: "team", pattern: /\/(team|people|leadership)(\/|$)/i, rank: 80 },
  { type: "pricing", pattern: /\/(pricing|plans)(\/|$)/i, rank: 70 },
  { type: "careers", pattern: /\/(careers?|jobs?|join-us)(\/|$)/i, rank: 60 },
  { type: "press", pattern: /\/(press|newsroom|media)(\/|$)/i, rank: 50 },
  { type: "blog", pattern: /\/(blog|articles|resources)(\/|$)/i, rank: 40 },
];

export function classifyPageType(url: string): CompanyPageType {
  try {
    const path = new URL(url).pathname;
    if (path === "/" || path === "") return "homepage";
    for (const rule of PAGE_RULES) {
      if (rule.pattern.test(path)) return rule.type;
    }
  } catch {
    /* ignore */
  }
  return "other";
}

function rankForUrl(url: string): number {
  const type = classifyPageType(url);
  if (type === "homepage") return 110;
  const rule = PAGE_RULES.find((r) => r.type === type);
  return rule?.rank ?? 0;
}

/** Rank useful same-domain links; drops unranked "other" paths. */
export function rankPageLinks(urls: string[], limit = 20): string[] {
  const scored = urls
    .map((url) => ({ url, score: rankForUrl(url) }))
    .filter((x) => x.score > 0 && classifyPageType(x.url) !== "homepage")
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of scored) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item.url);
    if (out.length >= limit) break;
  }
  return out;
}
