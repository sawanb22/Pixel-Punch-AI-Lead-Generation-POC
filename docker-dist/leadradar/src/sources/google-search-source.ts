import type { CanonicalLead } from "../domain/types.js";
import type { FetchLike, Source } from "./source.js";

const CSE_URL = "https://www.googleapis.com/customsearch/v1";

export interface GoogleSearchSourceOptions {
  /** Google API key (GOOGLE_CSE_KEY). */
  apiKey: string;
  /** Custom Search Engine ID / cx (GOOGLE_CSE_ID). */
  cx: string;
  /** Search query. */
  query: string;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetch?: FetchLike;
  /** Optional result count (1–10; Google CSE max per request). */
  num?: number;
}

interface CseItem {
  title?: string;
  link?: string;
  snippet?: string;
  displayLink?: string;
}

interface CseResponse {
  items?: CseItem[];
  error?: { message?: string; code?: number };
}

function clean(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/** Prefer a readable company name from the result title (strip trailing site noise). */
export function companyFromTitle(title: string | null | undefined): string | null {
  const t = clean(title);
  if (!t) return null;
  // Common pattern: "Acme AI — Official Site" / "Acme AI | Home"
  const cut = t.split(/\s+[|\-–—]\s+/)[0]?.trim();
  return cut && cut.length > 0 ? cut : t;
}

export function mapGoogleSearchItems(items: CseItem[]): CanonicalLead[] {
  const leads: CanonicalLead[] = [];
  for (const item of items) {
    const company = companyFromTitle(item.title);
    if (!company) continue;
    leads.push({
      company,
      website: clean(item.link),
      email: null,
      votes: null,
      source: "google",
    });
  }
  return leads;
}

export class GoogleSearchSource implements Source {
  readonly name = "google";
  private readonly apiKey: string;
  private readonly cx: string;
  private readonly query: string;
  private readonly fetchImpl: FetchLike;
  private readonly num: number;

  constructor(options: GoogleSearchSourceOptions) {
    if (!options.apiKey?.trim()) {
      throw new Error(
        "GoogleSearchSource requires an API key (set GOOGLE_CSE_KEY)"
      );
    }
    if (!options.cx?.trim()) {
      throw new Error(
        "GoogleSearchSource requires a CSE id (set GOOGLE_CSE_ID)"
      );
    }
    if (!options.query?.trim()) {
      throw new Error("GoogleSearchSource requires a non-empty query");
    }
    this.apiKey = options.apiKey.trim();
    this.cx = options.cx.trim();
    this.query = options.query.trim();
    this.fetchImpl = options.fetch ?? fetch;
    this.num = options.num ?? 10;
  }

  async fetch(): Promise<CanonicalLead[]> {
    const url = new URL(CSE_URL);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("cx", this.cx);
    url.searchParams.set("q", this.query);
    url.searchParams.set("num", String(this.num));

    const res = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      throw new Error(
        `Google Custom Search HTTP ${res.status}: ${await res.text()}`
      );
    }

    const body = (await res.json()) as CseResponse;
    if (body.error) {
      throw new Error(
        `Google Custom Search error: ${body.error.message ?? "unknown"}`
      );
    }

    return mapGoogleSearchItems(body.items ?? []);
  }
}
