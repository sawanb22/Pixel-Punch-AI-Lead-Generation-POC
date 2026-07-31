import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../../src/db/database.js";
import { createProject } from "../../src/projects/projects.repo.js";
import { insertLeads, listLeads, listGatedLeads, saveScore } from "../../src/leads/leads.repo.js";
import { recordFeedback } from "../../src/feedback/feedback.repo.js";
import { MockScorer } from "../../src/scoring/mock-scorer.js";
import { runScoring } from "../../src/scoring/run-scoring.js";
import { FileFeedbackRag } from "../../src/rag/file-feedback-rag.js";
import type { Scorer } from "../../src/scoring/scorer.js";
import type { Lead, Project } from "../../src/domain/types.js";

describe("runScoring", () => {
  it("scores all gated leads with MockScorer", async () => {
    const db = openDatabase(":memory:");
    const p = createProject(db, { name: "P1", icp: "saas" });
    insertLeads(db, p.id, [
      { company: "A SaaS", website: "a.com", canonicalDomain: "a.com", email: "a@a.com", votes: 10, source: "csv", sources: ["csv"] },
      { company: "B Co", website: "b.com", canonicalDomain: "b.com", email: "b@b.com", votes: 4, source: "csv", sources: ["csv"] },
    ]);
    const summary = await runScoring(db, p.id, new MockScorer(), { rag: null });
    expect(summary.scored).toBe(2);
    expect(summary.errors).toBe(0);
    const leads = listLeads(db, p.id);
    expect(leads.every((l) => l.status === "scored")).toBe(true);
    expect(leads.every((l) => typeof l.score === "number")).toBe(true);
    db.close();
  });

  it("counts errors when scorer throws for one lead", async () => {
    const db = openDatabase(":memory:");
    const p = createProject(db, { name: "P1" });
    insertLeads(db, p.id, [
      { company: "A", website: "a.com", canonicalDomain: "a.com", email: "a@a.com", votes: 1, source: "csv", sources: ["csv"] },
      { company: "B", website: "b.com", canonicalDomain: "b.com", email: "b@b.com", votes: 1, source: "csv", sources: ["csv"] },
    ]);
    const flaky: Scorer = {
      async scoreLead(lead: Lead, _project: Project) {
        if (lead.company === "A") throw new Error("boom");
        return { score: 70, reasons: "ok" };
      },
    };
    const summary = await runScoring(db, p.id, flaky, { rag: null });
    expect(summary.scored).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.errorMessages.length).toBe(1);
    expect(summary.errorMessages[0]).toMatch(/boom/);
    db.close();
  });

  it("throws when project is missing", async () => {
    const db = openDatabase(":memory:");
    await expect(runScoring(db, 999, new MockScorer(), { rag: null })).rejects.toThrow(
      /project.*not found/i
    );
    db.close();
  });

  describe("with feedback RAG context", () => {
    let baseDir: string;
    let rag: FileFeedbackRag;

    beforeEach(() => {
      baseDir = mkdtempSync(join(tmpdir(), "leadradar-score-rag-"));
      rag = new FileFeedbackRag(baseDir);
    });

    afterEach(() => {
      rmSync(baseDir, { recursive: true, force: true });
    });

    it("increases MockScorer score when similar approved feedback exists", async () => {
      const db = openDatabase(":memory:");
      const p = createProject(db, { name: "P1", icp: "saas" });
      insertLeads(db, p.id, [
        {
          company: "Acme SaaS Platform",
          website: "acme-saas.com",
          canonicalDomain: "acme-saas.com",
          email: "a@acme.com",
          votes: 0,
          source: "csv",
          sources: ["csv"],
        },
        {
          company: "Acme SaaS Twin",
          website: "acme-twin.com",
          canonicalDomain: "acme-twin.com",
          email: "t@acme.com",
          votes: 0,
          source: "csv",
          sources: ["csv"],
        },
      ]);
      const leads = listGatedLeads(db, p.id);
      const prior = leads[0]!;
      const next = leads[1]!;

      saveScore(db, p.id, prior.id, 85, "prior");
      // saveScore flips to scored — re-insert path: record feedback on prior
      recordFeedback(
        db,
        {
          projectId: p.id,
          leadId: prior.id,
          good: true,
          notes: "Great SaaS fit",
          reviewedBy: "alice",
          source: "dashboard",
        },
        { rag }
      );

      // Baseline without RAG
      const baselineSummary = await runScoring(db, p.id, new MockScorer(), { rag: null });
      expect(baselineSummary.scored).toBe(1);
      const baselineLead = listLeads(db, p.id).find((l) => l.id === next.id)!;
      const baselineScore = baselineLead.score!;

      // Reset next lead to gated for re-score with RAG
      db.prepare(`UPDATE leads SET status = 'gated', score = NULL, reasons = NULL WHERE id = ?`).run(
        next.id
      );

      const withRag = await runScoring(db, p.id, new MockScorer(), { rag });
      expect(withRag.scored).toBe(1);
      const boosted = listLeads(db, p.id).find((l) => l.id === next.id)!;
      expect(boosted.score).toBe(Math.min(100, baselineScore + 10));
      expect(boosted.reasons).toMatch(/similar approved lead/i);
      db.close();
    });
  });
});
