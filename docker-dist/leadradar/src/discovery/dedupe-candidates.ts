import { isBlockedHost } from "./noise-filter.js";
import type { DiscoveredCompanyCandidate } from "./types.js";

function normalizeCompanyKey(company: string): string {
  return company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|ltd|co|corp|company|labs?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function websitePreferenceScore(candidate: DiscoveredCompanyCandidate): number {
  let score = candidate.confidence;
  if (candidate.website && candidate.domain && !isBlockedHost(candidate.domain)) {
    score += 1;
  }
  if (candidate.website && !/\/(from-listing|profile|biz)\b/i.test(candidate.website)) {
    score += 0.1;
  }
  // Prefer shorter, cleaner homepage-like URLs
  if (candidate.website) {
    try {
      const path = new URL(
        /^https?:\/\//i.test(candidate.website)
          ? candidate.website
          : `https://${candidate.website}`
      ).pathname;
      if (path === "/" || path === "") score += 0.2;
    } catch {
      /* ignore */
    }
  }
  return score;
}

function mergeCandidates(
  a: DiscoveredCompanyCandidate,
  b: DiscoveredCompanyCandidate
): DiscoveredCompanyCandidate {
  const preferred =
    websitePreferenceScore(a) >= websitePreferenceScore(b) ? a : b;
  const other = preferred === a ? b : a;
  const sources = new Set(
    [...preferred.source.split(","), ...other.source.split(",")]
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const sourceUrls = [preferred.sourceUrl, other.sourceUrl].filter(
    (u): u is string => Boolean(u)
  );

  return {
    ...preferred,
    source: [...sources].join(","),
    sourceUrl: sourceUrls[0] ?? null,
    confidence: Math.max(preferred.confidence, other.confidence),
    rawPayload: {
      merged: true,
      primary: preferred.rawPayload,
      secondary: other.rawPayload,
    },
  };
}

export interface DedupeResult {
  kept: DiscoveredCompanyCandidate[];
  duplicates: number;
}

export function dedupeCandidates(
  candidates: DiscoveredCompanyCandidate[]
): DedupeResult {
  const byKey = new Map<string, DiscoveredCompanyCandidate>();
  let duplicates = 0;

  for (const candidate of candidates) {
    const domainKey = candidate.domain?.trim().toLowerCase() || null;
    const companyKey = normalizeCompanyKey(candidate.company);
    const key = domainKey ? `domain:${domainKey}` : `company:${companyKey}`;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }
    duplicates += 1;
    byKey.set(key, mergeCandidates(existing, candidate));
  }

  return { kept: [...byKey.values()], duplicates };
}
