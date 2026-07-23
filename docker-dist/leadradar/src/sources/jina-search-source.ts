import type { CanonicalLead } from "../domain/types.js";
import type { FetchLike, Source } from "./source.js";
import { companyFromTitle } from "./google-search-source.js";

const JINA_SEARCH_URL = "https://s.jina.ai/";

export interface JinaSearchSourceOptions {
  /** Jina API key (JINA_API_KEY). */
  apiKey: string;
  /** Search query. */
  query: string;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetch?: FetchLike;
  /** Optional result count. */
  num?: number;
}

export interface JinaSearchItem {
  title?: string;
  url?: string;
  description?: string;
}

interface JinaSearchResponse {
  code?: number;
  status?: number;
  data?: JinaSearchItem[];
  message?: string;
}

const BLOCKED_HOST_SUFFIXES = [
  "reddit.com",
  "play.google.com",
  "apps.apple.com",
  "youtube.com",
  "youtu.be",
  "wikipedia.org",
  "linkedin.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "medium.com",
  "quora.com",
  "f6s.com",
  "dribbble.com",
  "behance.net",
  "icims.com",
  "greenhouse.io",
  "lever.co",
  "startupintros.com",
  "crunchbase.com",
  "pitchbook.com",
];

const LISTICLE_TITLE =
  /(?:^\d+\s+top\b)|(?:\bbest\b.+\bin\s+20\d{2}\b)|(?:\bstartups?\s+funded\b)|(?:\btop\s+startups?\b)|(?:\bcompanies\s+and\s+startups\b)|(?:\bfunding,?\s+team\b)|(?:\blanding\s+page\b)|(?:\bcareers?\b)|(?:\bjobs?\b)/i;

const NOISE_PATH =
  /\.pdf($|\?)|\/jobs?\/|\/careers?\/|\/library\/|\/blog\/|\/download-article\//i;

function clean(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function hostnameOf(url: string | null | undefined): string | null {
  const raw = clean(url);
  if (!raw) return null;
  try {
    return new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function companyFromHostname(url: string | null | undefined): string | null {
  return hostnameOf(url);
}

/** Prefer page title; fall back to registrable-looking hostname. */
export function companyFromJinaItem(item: JinaSearchItem): string | null {
  return companyFromTitle(item.title) ?? companyFromHostname(item.url);
}

export function isJinaNoise(item: JinaSearchItem, company: string): boolean {
  const host = hostnameOf(item.url);
  if (host) {
    for (const blocked of BLOCKED_HOST_SUFFIXES) {
      if (host === blocked || host.endsWith(`.${blocked}`)) return true;
    }
    // YC directory / industry list pages, not a single company
    if (host === "ycombinator.com" || host.endsWith(".ycombinator.com")) {
      return true;
    }
  }
  const title = clean(item.title) ?? company;
  if (LISTICLE_TITLE.test(title)) return true;
  const url = clean(item.url) ?? "";
  if (NOISE_PATH.test(url)) return true;
  // Company collapsed to bare hostname with no real brand title
  if (host && company.toLowerCase() === host) return true;
  return false;
}

export function mapJinaSearchItems(items: JinaSearchItem[]): CanonicalLead[] {
  const leads: CanonicalLead[] = [];
  for (const item of items) {
    const company = companyFromJinaItem(item);
    const website = clean(item.url);
    if (!company || !website) continue;
    if (isJinaNoise(item, company)) continue;
    leads.push({
      company,
      website,
      email: null,
      votes: null,
      source: "jina",
    });
  }
  return leads;
}

export class JinaSearchSource implements Source {
  readonly name = "jina";
  private readonly apiKey: string;
  private readonly query: string;
  private readonly fetchImpl: FetchLike;
  private readonly num: number;

  constructor(options: JinaSearchSourceOptions) {
    if (!options.apiKey?.trim()) {
      throw new Error("JinaSearchSource requires an API key (set JINA_API_KEY)");
    }
    if (!options.query?.trim()) {
      throw new Error("JinaSearchSource requires a non-empty query");
    }
    this.apiKey = options.apiKey.trim();
    this.query = options.query.trim();
    this.fetchImpl = options.fetch ?? fetch;
    this.num = options.num ?? 10;
  }

  async fetch(): Promise<CanonicalLead[]> {
    const res = await this.fetchImpl(JINA_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ q: this.query, num: this.num }),
    });

    if (!res.ok) {
      throw new Error(`Jina Search HTTP ${res.status}: ${await res.text()}`);
    }

    const body = (await res.json()) as JinaSearchResponse;
    if (typeof body.code === "number" && body.code >= 400) {
      throw new Error(
        `Jina Search error: ${body.message ?? `code ${body.code}`}`
      );
    }

    return mapJinaSearchItems(body.data ?? []);
  }
}
