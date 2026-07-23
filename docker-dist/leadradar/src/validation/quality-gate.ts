import type { DedupedLead } from "./dedup.js";

export interface RejectedLead {
  lead: DedupedLead;
  reason: string;
}

export interface QualityGateResult {
  kept: DedupedLead[];
  rejected: RejectedLead[];
}

export function qualityGate(leads: DedupedLead[]): QualityGateResult {
  const kept: DedupedLead[] = [];
  const rejected: RejectedLead[] = [];
  for (const lead of leads) {
    if (!lead.company || lead.company.trim().length === 0) {
      rejected.push({ lead, reason: "no-company" });
      continue;
    }
    // Website URL counts even when canonicalDomain is null (e.g. Product Hunt
    // redirect hosts are excluded from identity keys but remain contactable).
    const hasWebsite = !!(lead.website && lead.website.trim()) || !!lead.canonicalDomain;
    const hasEmail = !!lead.email;
    if (!hasWebsite && !hasEmail) {
      rejected.push({ lead, reason: "no-contactable-signal" });
      continue;
    }
    kept.push(lead);
  }
  return { kept, rejected };
}
