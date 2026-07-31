import { describe, it, expect } from "vitest";
import { BENCHMARK_ICPS } from "../../src/eval/benchmark-dataset.js";
import { evaluatePlannerOutput } from "../../src/eval/evaluators/planner-evaluator.js";
import { evaluateEnrichmentOutputs } from "../../src/eval/evaluators/enrichment-evaluator.js";
import { evaluateContactOutputs } from "../../src/eval/evaluators/contact-evaluator.js";
import { evaluateScorerOutputs } from "../../src/eval/evaluators/scorer-evaluator.js";

describe("agent evaluators", () => {
  it("evaluates planner output against benchmark ICP", () => {
    const icp = BENCHMARK_ICPS[0];
    const report = evaluatePlannerOutput(icp, {
      jobs: [
        { actorId: "apify/google-maps-scraper", input: { searchStrings: ["plumber in Austin"] } },
      ],
    });
    expect(report.icpId).toBe("icp_local_services");
    expect(report.passed).toBe(true);
    expect(report.keywordAlignmentScore).toBeGreaterThan(0);
  });

  it("evaluates enrichment outputs across company profiles", () => {
    const report = evaluateEnrichmentOutputs([
      {
        domain: "acme.com",
        description: "Acme Corp provides commercial plumbing services.",
        emailCandidates: ["contact@acme.com"],
        socialLinks: { linkedin: "https://linkedin.com/company/acme" },
        locationHints: ["Austin, TX"],
        confidence: 0.8,
      },
    ]);
    expect(report.totalProfilesEvaluated).toBe(1);
    expect(report.averageYieldRate).toBeGreaterThanOrEqual(0.5);
    expect(report.passed).toBe(true);
  });

  it("evaluates contact outputs for seniority and valid URLs", () => {
    const report = evaluateContactOutputs([
      { title: "CEO", linkedinUrl: "https://linkedin.com/in/ceo", email: "ceo@acme.com" },
    ]);
    expect(report.totalContactsEvaluated).toBe(1);
    expect(report.overallDecisionMakerRatio).toBe(1.0);
    expect(report.passed).toBe(true);
  });

  it("evaluates scorer output distribution", () => {
    const report = evaluateScorerOutputs([85, 60, 40, 20]);
    expect(report.totalLeadsScored).toBe(4);
    expect(report.scoreSpread.max - report.scoreSpread.min).toBe(65);
    expect(report.passed).toBe(true);
  });
});
