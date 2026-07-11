import { describe, it, expect } from "vitest";
import { MockScorer } from "../../src/scoring/mock-scorer.js";
import type { Lead, Project } from "../../src/domain/types.js";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 1,
    projectId: 1,
    company: "Acme SaaS",
    website: "acme.com",
    canonicalDomain: "acme.com",
    email: "a@acme.com",
    votes: 20,
    source: "csv",
    sources: ["csv"],
    status: "gated",
    score: null,
    reasons: null,
    createdAt: "2026-01-01",
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: "P1",
    website: null,
    description: null,
    icp: "saas b2b",
    sourceConfig: null,
    leadPlan: null,
    status: "active",
    createdAt: "2026-01-01",
    ...overrides,
  };
}

describe("MockScorer", () => {
  it("returns score in 0–100 with reasons", async () => {
    const scorer = new MockScorer();
    const result = await scorer.scoreLead(makeLead(), makeProject());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.reasons).toMatch(/votes=/);
  });

  it("mentions ICP keyword match when present", async () => {
    const scorer = new MockScorer();
    const result = await scorer.scoreLead(
      makeLead({ company: "Cool SaaS Co" }),
      makeProject({ icp: "saas tools" })
    );
    expect(result.reasons).toContain("ICP keyword match");
  });

  it("caps score at 100 for high votes", async () => {
    const scorer = new MockScorer();
    const result = await scorer.scoreLead(makeLead({ votes: 500 }), makeProject());
    expect(result.score).toBe(100);
  });

  it("boosts score by +10 when similar has a good doc", async () => {
    const scorer = new MockScorer();
    const lead = makeLead({ votes: 0 });
    const project = makeProject();
    const baseline = await scorer.scoreLead(lead, project);
    const boosted = await scorer.scoreLead(lead, project, {
      similar: [
        {
          projectId: 1,
          leadId: 99,
          company: "Acme Twin",
          website: "acme-twin.com",
          email: null,
          score: 90,
          good: true,
          notes: "approved twin",
          text: "Acme Twin approved",
        },
      ],
    });
    expect(boosted.score).toBe(Math.min(100, baseline.score + 10));
    expect(boosted.reasons).toMatch(/similar approved lead/i);
  });
});
