import { evaluateEnrichmentFidelity, type EnrichmentFidelityResult } from "../metrics.js";

export interface EnrichmentEvalReport {
  totalProfilesEvaluated: number;
  averageYieldRate: number;
  descriptionExtractionRate: number;
  emailDiscoveryRate: number;
  socialDiscoveryRate: number;
  locationDiscoveryRate: number;
  hallucinatedEmailCount: number;
  passed: boolean;
  profileReports: Array<{
    domain: string;
    fidelity: EnrichmentFidelityResult;
  }>;
}

export function evaluateEnrichmentOutputs(
  profiles: Array<{
    domain: string;
    description?: string | null;
    emailCandidates?: string[];
    socialLinks?: Record<string, string>;
    locationHints?: string[];
    confidence?: number;
  }>
): EnrichmentEvalReport {
  if (profiles.length === 0) {
    return {
      totalProfilesEvaluated: 0,
      averageYieldRate: 0,
      descriptionExtractionRate: 0,
      emailDiscoveryRate: 0,
      socialDiscoveryRate: 0,
      locationDiscoveryRate: 0,
      hallucinatedEmailCount: 0,
      passed: true,
      profileReports: [],
    };
  }

  let totalYield = 0;
  let hasDescCount = 0;
  let hasEmailCount = 0;
  let hasSocialCount = 0;
  let hasLocCount = 0;
  let totalHallucinatedEmails = 0;

  const profileReports = profiles.map((p) => {
    const fidelity = evaluateEnrichmentFidelity(p);
    totalYield += fidelity.yieldRate;
    if (fidelity.hasDescription) hasDescCount++;
    if (fidelity.emailCount > 0) hasEmailCount++;
    if (fidelity.socialCount > 0) hasSocialCount++;
    if (fidelity.hasLocation) hasLocCount++;
    totalHallucinatedEmails += fidelity.hallucinatedEmails.length;
    return { domain: p.domain, fidelity };
  });

  const count = profiles.length;
  const averageYieldRate = Number((totalYield / count).toFixed(2));
  const descriptionExtractionRate = Number((hasDescCount / count).toFixed(2));
  const emailDiscoveryRate = Number((hasEmailCount / count).toFixed(2));
  const socialDiscoveryRate = Number((hasSocialCount / count).toFixed(2));
  const locationDiscoveryRate = Number((hasLocCount / count).toFixed(2));

  const passed = averageYieldRate >= 0.5 && descriptionExtractionRate >= 0.7;

  return {
    totalProfilesEvaluated: count,
    averageYieldRate,
    descriptionExtractionRate,
    emailDiscoveryRate,
    socialDiscoveryRate,
    locationDiscoveryRate,
    hallucinatedEmailCount: totalHallucinatedEmails,
    passed,
    profileReports,
  };
}
