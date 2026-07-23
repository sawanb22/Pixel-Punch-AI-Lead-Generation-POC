import type { CanonicalLead } from "../domain/types.js";
import { dedup, type DedupedLead } from "./dedup.js";
import { checkEmail, type MxResolver } from "./email-check.js";
import { qualityGate, type QualityGateResult } from "./quality-gate.js";

/** Runs ONCE on the merged aggregate of all sources. */
export async function validateAggregate(
  leads: CanonicalLead[],
  resolver?: MxResolver
): Promise<QualityGateResult> {
  const deduped: DedupedLead[] = dedup(leads);

  for (const lead of deduped) {
    if (lead.email) {
      const result = await checkEmail(lead.email, resolver);
      if (!result.valid) lead.email = null; // keep the lead, drop the bad email
    }
  }

  return qualityGate(deduped);
}
