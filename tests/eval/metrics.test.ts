import { describe, it, expect } from "vitest";
import {
  evaluateEnrichmentFidelity,
  evaluateContactSeniority,
  evaluatePlannerPrecision,
  computeSpearmanRankCorrelation,
} from "../../src/eval/metrics.js";

describe("metrics", () => {
  it("evaluateEnrichmentFidelity returns high yield for complete profile", () => {
    const res = evaluateEnrichmentFidelity({
      domain: "acme.com",
      description: "Acme Corp provides top tier B2B SaaS software.",
      emailCandidates: ["info@acme.com"],
      socialLinks: { linkedin: "https://linkedin.com/company/acme" },
      locationHints: ["Austin, TX"],
      confidence: 0.85,
    });
    expect(res.yieldRate).toBe(1.0);
    expect(res.hasDescription).toBe(true);
    expect(res.emailCount).toBe(1);
    expect(res.socialCount).toBe(1);
    expect(res.hallucinatedEmails.length).toBe(0);
  });

  it("evaluateEnrichmentFidelity detects hallucinated email domains", () => {
    const res = evaluateEnrichmentFidelity({
      domain: "acme.com",
      description: "Acme Corp",
      emailCandidates: ["contact@fakeotherdomain.org"],
    });
    expect(res.hallucinatedEmails).toContain("contact@fakeotherdomain.org");
  });

  it("evaluateContactSeniority calculates decision maker ratio correctly", () => {
    const res = evaluateContactSeniority([
      { title: "Co-Founder & CEO", linkedinUrl: "https://linkedin.com/in/john", email: "john@acme.com" },
      { title: "Software Engineer", linkedinUrl: "https://linkedin.com/in/jane", email: "jane@acme.com" },
    ]);
    expect(res.totalContacts).toBe(2);
    expect(res.decisionMakerCount).toBe(1);
    expect(res.decisionMakerRatio).toBe(0.5);
    expect(res.validLinkedinCount).toBe(2);
    expect(res.validEmailCount).toBe(2);
  });

  it("evaluatePlannerPrecision scores strategic payload jobs", () => {
    const res = evaluatePlannerPrecision({
      jobs: [
        { actorId: "apify/google-maps-scraper", input: { searchStrings: ["plumbers in Austin"] } },
        { actorId: "apify/contact-info-scraper", input: {} },
      ],
    });
    expect(res.totalJobs).toBe(2);
    expect(res.validJobs).toBe(2);
    expect(res.precision).toBe(1.0);
  });

  it("computeSpearmanRankCorrelation handles perfect agreement", () => {
    const rho = computeSpearmanRankCorrelation([1, 2, 3], [1, 2, 3]);
    expect(rho).toBe(1.0);
  });
});
