import { canonicalDomain } from "../validation/canonicalize.js";
import type {
  DiscoveredCompanyCandidate,
  DiscoverySourceType,
} from "./types.js";

export interface ApifyResultMapping {
  companyField: string;
  websiteField: string;
  sourceUrlField?: string;
  locationField?: string;
  categoryField?: string;
}

export interface MapApifyItemOptions {
  sourceId: string;
  sourceType: DiscoverySourceType;
  mapping: ApifyResultMapping;
  discoveryQuery?: string | null;
  allowCompanyOnly?: boolean;
}

export function getNestedField(obj: unknown, path: string): unknown {
  if (!path.trim() || obj == null || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Apify google-search-scraper returns one dataset item per SERP page with
 * nested organicResults[]. Maps/actors that already emit flat rows pass through.
 */
export function expandApifyDatasetItems(items: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const organic = rec.organicResults;
    if (Array.isArray(organic) && organic.length > 0) {
      for (const row of organic) {
        if (!row || typeof row !== "object") continue;
        const organicRow = row as Record<string, unknown>;
        const link =
          asNonEmptyString(organicRow.url) ??
          asNonEmptyString(organicRow.link);
        out.push({
          ...organicRow,
          // Support both Maps-style (website) and Search-style (url) mappings.
          website: organicRow.website ?? link,
          url: organicRow.url ?? link,
          searchQuery: rec.searchQuery,
        });
      }
      continue;
    }
    out.push(item);
  }
  return out;
}

function companyFromSearchResult(
  title: string | null,
  website: string | null
): string | null {
  if (website) {
    try {
      const host = new URL(website).hostname.replace(/^www\./i, "");
      if (host && !host.includes("google.")) {
        const label = host.split(".")[0];
        if (label && label.length >= 2) {
          return label.charAt(0).toUpperCase() + label.slice(1);
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (!title) return null;
  const cleaned = title
    .split(/\s+[|\-–—:]\s+/)[0]
    ?.trim();
  return cleaned && cleaned.length > 0 ? cleaned : title;
}

function normalizeWebsite(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes(".") && !trimmed.includes(" ")) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function mapApifyItemToCandidate(
  item: unknown,
  options: MapApifyItemOptions
): DiscoveredCompanyCandidate | null {
  if (!item || typeof item !== "object") return null;

  const companyRaw = asNonEmptyString(
    getNestedField(item, options.mapping.companyField)
  );
  const website = normalizeWebsite(
    asNonEmptyString(getNestedField(item, options.mapping.websiteField))
  );
  const sourceUrl = options.mapping.sourceUrlField
    ? asNonEmptyString(getNestedField(item, options.mapping.sourceUrlField))
    : null;

  const rec = item as Record<string, unknown>;
  const looksLikeSerpOrganic =
    typeof rec.displayedUrl === "string" || rec.type === "organic";
  const company = looksLikeSerpOrganic
    ? companyFromSearchResult(companyRaw, website) ?? companyRaw
    : companyRaw;

  if (!company) return null;
  if (!website && !options.allowCompanyOnly) return null;

  const domain = canonicalDomain(website);

  return {
    company,
    website,
    domain,
    source: options.sourceId,
    sourceType: options.sourceType,
    sourceUrl,
    discoveryQuery: options.discoveryQuery ?? null,
    rawPayload: item,
    confidence: website && domain ? 0.8 : 0.4,
  };
}
