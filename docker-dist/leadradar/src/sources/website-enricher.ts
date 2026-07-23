import type { CanonicalLead } from "../domain/types.js";
import type { FetchLike } from "./source.js";

export interface WebsiteEnricherOptions {
  /** Injectable fetch for tests; defaults to global fetch. */
  fetch?: FetchLike;
  /** Max concurrent page fetches (default 5). */
  concurrency?: number;
  /** Request timeout in ms (default 10000). */
  timeoutMs?: number;
}

function clean(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/** Normalize a website string into an absolute http(s) URL, or null. */
export function toAbsoluteUrl(website: string | null | undefined): string | null {
  const raw = clean(website);
  if (!raw) return null;
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).toString();
    return new URL(`https://${raw}`).toString();
  } catch {
    return null;
  }
}

/** Extract the first mailto: address from HTML (ignores query params). */
export function extractMailto(html: string): string | null {
  const match = html.match(/mailto:([^\s"'?>]+)/i);
  if (!match) return null;
  const addr = decodeURIComponent(match[1].split("?")[0] ?? "").trim();
  if (!addr || !addr.includes("@")) return null;
  return addr;
}

/** Extract <title> text from HTML. */
export function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const title = match[1].replace(/\s+/g, " ").trim();
  return title.length > 0 ? title : null;
}

async function enrichOne(
  lead: CanonicalLead,
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<CanonicalLead> {
  // Already has email — leave alone
  if (lead.email) return { ...lead };

  const url = toAbsoluteUrl(lead.website);
  if (!url) return { ...lead };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "LeadRadar/0.1 (+website-enricher)",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) return { ...lead };

    const html = await res.text();
    const email = extractMailto(html);
    const title = extractTitle(html);

    return {
      ...lead,
      email: email ?? lead.email,
      // Prefer existing company; fall back to page title if company empty
      company:
        lead.company && lead.company.trim().length > 0
          ? lead.company
          : title ?? lead.company,
    };
  } catch {
    // Network / abort / parse failures: return lead unchanged
    return { ...lead };
  }
}

/**
 * Post-process leads: fetch each website and fill email from mailto: when missing.
 * Not a discovery Source — run after merge (or before validateAggregate).
 */
export async function enrichLeadsFromWebsites(
  leads: CanonicalLead[],
  options: WebsiteEnricherOptions = {}
): Promise<CanonicalLead[]> {
  const fetchImpl = options.fetch ?? fetch;
  const concurrency = options.concurrency ?? 5;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const out: CanonicalLead[] = new Array(leads.length);
  let index = 0;

  async function worker() {
    while (index < leads.length) {
      const i = index++;
      out[i] = await enrichOne(leads[i], fetchImpl, timeoutMs);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(leads.length, 1)) },
    () => worker()
  );
  await Promise.all(workers);
  return out;
}
