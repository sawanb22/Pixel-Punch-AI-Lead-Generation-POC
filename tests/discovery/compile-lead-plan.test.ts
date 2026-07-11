import { describe, it, expect } from "vitest";
import { defaultAgencyLeadPlan } from "../../src/discovery/lead-plan.js";
import { compileLeadPlanToApifyJobs } from "../../src/discovery/compile-lead-plan.js";

describe("compileLeadPlanToApifyJobs", () => {
  it("compiles agency plan into Apify-only source jobs", () => {
    const plan = defaultAgencyLeadPlan({
      name: "Pixel Punch",
      icp: "AI integrations and new websites for startups",
      geography: "Austin",
      volumeTarget: 100,
    });
    const { sources, maxCandidates } = compileLeadPlanToApifyJobs(plan);
    expect(maxCandidates).toBe(100);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((s) => s.type === "apify")).toBe(true);
    expect(sources.every((s) => Boolean(s.actorId))).toBe(true);
    expect(sources.some((s) => s.actorId?.includes("google-search"))).toBe(
      true
    );
  });

  it("scales job count and limits with higher volume", () => {
    const small = compileLeadPlanToApifyJobs(
      defaultAgencyLeadPlan({ name: "A", icp: "websites", volumeTarget: 50 })
    );
    const large = compileLeadPlanToApifyJobs(
      defaultAgencyLeadPlan({ name: "A", icp: "websites", volumeTarget: 2000 })
    );
    expect(large.maxCandidates).toBe(2000);
    expect(large.sources.length).toBeGreaterThanOrEqual(small.sources.length);
  });
});
