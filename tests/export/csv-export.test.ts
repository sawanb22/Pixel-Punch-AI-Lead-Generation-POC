import { describe, it, expect } from "vitest";
import { exportLeadsCsv } from "../../src/export/csv-export.js";
import type { Lead } from "../../src/domain/types.js";

function lead(partial: Partial<Lead> & Pick<Lead, "company">): Lead {
  return {
    id: 1,
    projectId: 1,
    leadListId: null,
    website: null,
    email: null,
    votes: null,
    source: "csv",
    sources: ["csv"],
    status: "scored",
    score: 70,
    reasons: null,
    canonicalDomain: null,
    createdAt: "2026-01-01",
    ...partial,
  };
}

describe("exportLeadsCsv", () => {
  it("exports all columns and escapes commas/quotes", () => {
    const csv = exportLeadsCsv(
      [
        lead({
          company: 'Acme, "Inc"',
          website: "https://acme.com",
          email: "a@acme.com",
          score: 90,
          status: "approved",
          sources: ["csv", "producthunt"],
          reasons: "Good fit, strong signal",
        }),
      ],
      "all"
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe("company,website,email,score,status,sources,reasons");
    expect(lines[1]).toContain('"Acme, ""Inc"""');
    expect(lines[1]).toContain('"Good fit, strong signal"');
    expect(lines[1]).toContain("csv;producthunt");
  });

  it("emails_only filters and uses slim columns", () => {
    const csv = exportLeadsCsv(
      [
        lead({ company: "With Email", email: "x@y.com", score: 80 }),
        lead({ company: "No Email", email: null, score: 50 }),
      ],
      "emails_only"
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe("company,email,score");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("With Email,x@y.com,80");
  });

  it("current uses same columns as all", () => {
    const csv = exportLeadsCsv(
      [lead({ company: "A", email: "a@a.com" })],
      "current"
    );
    expect(csv.startsWith("company,website,email,score,status,sources,reasons")).toBe(
      true
    );
  });
});
