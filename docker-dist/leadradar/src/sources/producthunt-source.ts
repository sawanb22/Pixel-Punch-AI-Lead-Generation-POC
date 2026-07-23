import type { CanonicalLead } from "../domain/types.js";
import type { FetchLike, Source } from "./source.js";

const GRAPHQL_URL = "https://api.producthunt.com/v2/api/graphql";

const POSTS_QUERY = `
query Posts($first: Int!) {
  posts(first: $first) {
    edges {
      node {
        id
        name
        tagline
        url
        website
        votesCount
      }
    }
  }
}
`.trim();

export interface ProductHuntSourceOptions {
  /** Product Hunt developer / OAuth access token. */
  token: string;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetch?: FetchLike;
  /** How many posts to request (default 20). */
  first?: number;
}

interface PhPostNode {
  id?: string;
  name?: string | null;
  tagline?: string | null;
  url?: string | null;
  website?: string | null;
  votesCount?: number | null;
}

interface PhGraphQLResponse {
  data?: {
    posts?: {
      edges?: Array<{ node?: PhPostNode | null } | null> | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

function clean(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function isProductHuntUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    return host === "producthunt.com" || host.endsWith(".producthunt.com");
  } catch {
    return /producthunt\.com/i.test(url);
  }
}

/** Prefer a real product homepage over Product Hunt post/redirect URLs. */
export function preferProductWebsite(
  website: string | null | undefined,
  url: string | null | undefined
): string | null {
  const w = clean(website);
  const u = clean(url);
  if (w && !isProductHuntUrl(w)) return w;
  if (u && !isProductHuntUrl(u)) return u;
  return w ?? u;
}

export function mapProductHuntPosts(nodes: PhPostNode[]): CanonicalLead[] {
  const leads: CanonicalLead[] = [];
  for (const node of nodes) {
    const company = clean(node.name);
    if (!company) continue;
    const votes =
      typeof node.votesCount === "number" && Number.isFinite(node.votesCount)
        ? node.votesCount
        : null;
    leads.push({
      company,
      website: preferProductWebsite(node.website, node.url),
      email: null,
      votes,
      source: "producthunt",
    });
  }
  return leads;
}

export class ProductHuntSource implements Source {
  readonly name = "producthunt";
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly first: number;

  constructor(options: ProductHuntSourceOptions) {
    if (!options.token || !options.token.trim()) {
      throw new Error(
        "ProductHuntSource requires a token (set PRODUCTHUNT_TOKEN)"
      );
    }
    this.token = options.token.trim();
    this.fetchImpl = options.fetch ?? fetch;
    this.first = options.first ?? 20;
  }

  async fetch(): Promise<CanonicalLead[]> {
    const res = await this.fetchImpl(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        query: POSTS_QUERY,
        variables: { first: this.first },
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Product Hunt API HTTP ${res.status}: ${await res.text()}`
      );
    }

    const body = (await res.json()) as PhGraphQLResponse;
    if (body.errors?.length) {
      const msg = body.errors.map((e) => e.message ?? "unknown").join("; ");
      throw new Error(`Product Hunt GraphQL errors: ${msg}`);
    }

    const edges = body.data?.posts?.edges ?? [];
    const nodes: PhPostNode[] = [];
    for (const edge of edges) {
      if (edge?.node) nodes.push(edge.node);
    }
    return mapProductHuntPosts(nodes);
  }
}
