import type { LeadFindingSourceConfig } from "./lead-finding-config.js";

export interface SourcePack {
  id: string;
  label: string;
  description: string;
  sources: LeadFindingSourceConfig[];
}

/**
 * Starter packs with example Apify actor/task templates.
 * Actors are examples — projects should override with verified Store actors/tasks.
 */
const PACKS: Record<string, SourcePack> = {
  local_business: {
    id: "local_business",
    label: "Local business",
    description: "Maps and local directory style discovery",
    sources: [
      {
        id: "google-maps-template",
        type: "apify",
        actorId: "compass/crawler-google-places",
        discoveryQuery: "{{category}} in {{city}}",
        input: {
          searchStringsArray: ["{{category}} in {{city}}"],
          maxCrawledPlacesPerSearch: 50,
        },
        mapping: {
          companyField: "title",
          websiteField: "website",
          sourceUrlField: "url",
          locationField: "address",
          categoryField: "categoryName",
        },
      },
    ],
  },
  saas_startup: {
    id: "saas_startup",
    label: "SaaS / startup",
    description: "Launch directories and niche search actors",
    sources: [
      {
        id: "producthunt-search-template",
        type: "apify",
        actorId: "curious_coder/producthunt-scraper",
        discoveryQuery: "{{niche}}",
        input: { query: "{{niche}}", maxItems: 50 },
        mapping: {
          companyField: "name",
          websiteField: "website",
          sourceUrlField: "url",
        },
      },
    ],
  },
  ecommerce: {
    id: "ecommerce",
    label: "Ecommerce / stores",
    description: "Store directory and niche shop search",
    sources: [
      {
        id: "shopify-store-template",
        type: "apify",
        actorId: "scraping.land/shopify-store-scraper",
        discoveryQuery: "{{niche}} shopify",
        input: { search: "{{niche}}", maxItems: 50 },
        mapping: {
          companyField: "title",
          websiteField: "url",
          sourceUrlField: "url",
        },
      },
    ],
  },
  b2b_general: {
    id: "b2b_general",
    label: "B2B general",
    description: "Broad search-result actors for B2B niches",
    sources: [
      {
        id: "web-search-template",
        type: "apify",
        actorId: "apify/google-search-scraper",
        discoveryQuery: "{{niche}} company website",
        input: {
          queries: "{{niche}} company website",
          maxPagesPerQuery: 3,
        },
        mapping: {
          companyField: "title",
          websiteField: "url",
          sourceUrlField: "url",
        },
      },
    ],
  },
  hiring_intent: {
    id: "hiring_intent",
    label: "Hiring / intent",
    description: "Public job board company discovery (not LinkedIn scraping)",
    sources: [
      {
        id: "greenhouse-board-template",
        type: "apify",
        actorId: "johnvc/greenhouse-job-board-api",
        discoveryQuery: "{{role}}",
        input: { titleKeywords: ["{{role}}"], maxJobs: 50 },
        mapping: {
          companyField: "companyName",
          websiteField: "companyUrl",
          sourceUrlField: "url",
        },
        allowCompanyOnly: true,
      },
    ],
  },
};

export function listSourcePackIds(): string[] {
  return Object.keys(PACKS);
}

export function getSourcePack(id: string): SourcePack {
  const pack = PACKS[id];
  if (!pack) {
    throw new Error(
      `Unknown source pack "${id}". Known: ${listSourcePackIds().join(", ")}`
    );
  }
  return pack;
}

export function applyQueryTemplates(
  sources: LeadFindingSourceConfig[],
  vars: Record<string, string>
): LeadFindingSourceConfig[] {
  const replace = (value: string): string =>
    value.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");

  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return replace(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v);
      return out;
    }
    return value;
  };

  return sources.map((source) => ({
    ...source,
    discoveryQuery: source.discoveryQuery
      ? replace(source.discoveryQuery)
      : source.discoveryQuery,
    input: source.input
      ? (walk(source.input) as Record<string, unknown>)
      : source.input,
  }));
}
