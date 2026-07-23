export interface ConfidenceInput {
  hasHomepage: boolean;
  hasDescription: boolean;
  pageTypes: string[];
  emailCount: number;
  socialCount: number;
  hasLocation: boolean;
}

export function scoreEnrichmentConfidence(input: ConfidenceInput): number {
  let score = 0;
  if (input.hasHomepage) score += 0.25;
  if (input.hasDescription) score += 0.2;
  const usefulPages = new Set(
    input.pageTypes.filter((t) => t !== "other" && t !== "homepage")
  );
  score += Math.min(0.25, usefulPages.size * 0.08);
  score += Math.min(0.15, input.emailCount * 0.07);
  score += Math.min(0.1, input.socialCount * 0.05);
  if (input.hasLocation) score += 0.05;
  return Math.max(0.05, Math.min(1, Number(score.toFixed(3))));
}
