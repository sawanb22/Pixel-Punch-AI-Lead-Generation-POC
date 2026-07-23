import type { CanonicalLead } from "../domain/types.js";
import { canonicalDomain } from "./canonicalize.js";

/** A deduped lead carries its computed domain and the set of contributing sources. */
export interface DedupedLead extends CanonicalLead {
  canonicalDomain: string | null;
  sources: string[];
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Domains that must not be used as identity keys (aggregator / redirect hosts). */
const NON_IDENTITY_DOMAINS = new Set([
  "producthunt.com",
  "www.producthunt.com",
]);

export function leadIdentityKey(lead: {
  company: string;
  website?: string | null;
  canonicalDomain?: string | null;
}): string {
  const domain =
    lead.canonicalDomain ??
    (lead.website ? canonicalDomain(lead.website) : null);
  if (domain && !NON_IDENTITY_DOMAINS.has(domain)) {
    return `d:${domain}`;
  }
  return `n:${normalizeName(lead.company)}`;
}

function keyFor(lead: CanonicalLead): string {
  return leadIdentityKey(lead);
}

function preferNonNull<T>(a: T | null, b: T | null): T | null {
  return a !== null && a !== undefined ? a : b;
}

export function dedup(leads: CanonicalLead[]): DedupedLead[] {
  const map = new Map<string, DedupedLead>();
  for (const lead of leads) {
    const key = keyFor(lead);
    const domain = canonicalDomain(lead.website);
    const identityDomain =
      domain && !NON_IDENTITY_DOMAINS.has(domain) ? domain : null;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...lead,
        canonicalDomain: identityDomain,
        sources: [lead.source],
      });
    } else {
      existing.email = preferNonNull(existing.email, lead.email);
      existing.website = preferNonNull(existing.website, lead.website);
      existing.canonicalDomain = preferNonNull(
        existing.canonicalDomain,
        identityDomain
      );
      existing.votes = preferNonNull(existing.votes, lead.votes);
      if (!existing.sources.includes(lead.source)) {
        existing.sources.push(lead.source);
      }
    }
  }
  return [...map.values()];
}
