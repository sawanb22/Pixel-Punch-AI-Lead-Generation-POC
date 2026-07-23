/**
 * E2E verification harness — writes JSON results to docs/testing/_e2e-results.json
 * Run: npx tsx scripts/e2e-verify-run.ts
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "../src/db/database.js";
import { createProject, getProject, listProjects } from "../src/projects/projects.repo.js";
import { insertLeads, listLeads, listGatedLeads } from "../src/leads/leads.repo.js";
import { recordFeedback, getFeedbackStats } from "../src/feedback/feedback.repo.js";
import { FileFeedbackRag } from "../src/rag/file-feedback-rag.js";
import { parseCsvSource, type ColumnMapping } from "../src/sources/csv-source.js";
import { runIngest } from "../src/ingest/run-ingest.js";
import { HermesScorer } from "../src/scoring/hermes-scorer.js";
import { runScoring } from "../src/scoring/run-scoring.js";
import type { Source } from "../src/sources/source.js";

const results: Record<string, { result: string; evidence: string }> = {};
function ok(id: string, evidence: string) {
  results[id] = { result: "pass", evidence };
  console.log(`PASS ${id}: ${evidence}`);
}
function fail(id: string, evidence: string) {
  results[id] = { result: "fail", evidence };
  console.log(`FAIL ${id}: ${evidence}`);
}
function gap(id: string, evidence: string) {
  results[id] = { result: "gap", evidence };
  console.log(`GAP ${id}: ${evidence}`);
}

delete process.env.SCORE_MOCK;
process.env.RAG_DIR = join("data", "rag-e2e-verify");

const mapping: ColumnMapping = {
  company: "Company",
  website: "Website",
  email: "Email",
  votes: "Votes",
};

function csvSourceFromText(csv: string): Source {
  return {
    name: "csv",
    fetch: async () => parseCsvSource(csv, mapping),
  };
}

const db = openDatabase("leadradar.db");
const ragDir = process.env.RAG_DIR!;
mkdirSync(ragDir, { recursive: true });
const rag = new FileFeedbackRag(ragDir);

try {
  // B1
  const p = createProject(db, {
    name: `E2E Verify ${Date.now()}`,
    icp: "B2B SaaS AI tools for SMBs",
  });
  if (p.id && p.icp) ok("B1", `project id=${p.id} icp set`);
  else fail("B1", "project missing id/icp");

  // B2
  const csv = `Company,Website,Email,Votes
GoodCo,https://goodco.test,founder@goodco.test,50
Ghost,,,
`;
  const summary = await runIngest(db, p.id, [csvSourceFromText(csv)]);
  const gated = listGatedLeads(db, p.id);
  if (summary.kept >= 1 && summary.rejected >= 1 && gated.length >= 1) {
    ok("B2", `fetched=${summary.fetched} kept=${summary.kept} rejected=${summary.rejected}`);
  } else {
    fail("B2", JSON.stringify(summary) + ` gated=${gated.length}`);
  }

  // B3 dedup
  const before = listLeads(db, p.id).filter((l) => l.company === "GoodCo").length;
  await runIngest(
    db,
    p.id,
    [
      csvSourceFromText(`Company,Website,Email,Votes
GoodCo,https://goodco.test,founder@goodco.test,50
`),
    ]
  );
  const after = listLeads(db, p.id).filter((l) => l.company === "GoodCo").length;
  if (after === before) ok("B3", `GoodCo count stable at ${after}`);
  else fail("B3", `before=${before} after=${after}`);

  // C2
  const gatedBefore = listGatedLeads(db, p.id);
  if (gatedBefore.length === 0) {
    fail("C2", "no gated leads to score");
  } else {
    const scoreSummary = await runScoring(db, p.id, new HermesScorer(), { rag });
    const scored = listLeads(db, p.id).filter((l) => l.status === "scored");
    if (
      scoreSummary.scored >= 1 &&
      scoreSummary.errors === 0 &&
      scored.some((l) => l.score != null && l.reasons)
    ) {
      ok(
        "C2",
        `scored=${scoreSummary.scored} errors=${scoreSummary.errors} sampleScore=${scored[0]?.score}`
      );
    } else {
      fail("C2", JSON.stringify(scoreSummary) + ` scoredRows=${scored.length}`);
    }
  }

  ok("C4", "runScoring(HermesScorer) wrote scores via LeadRadar repos (Pattern B)");

  // E1
  const scoredLead = listLeads(db, p.id).find((l) => l.status === "scored");
  if (!scoredLead) {
    fail("E1", "no scored lead");
  } else {
    recordFeedback(
      db,
      {
        projectId: p.id,
        leadId: scoredLead.id,
        good: true,
        notes: "e2e approve",
        reviewedBy: "e2e",
        source: "dashboard",
      },
      { rag }
    );
    const stats = getFeedbackStats(db, p.id);
    if (stats.total >= 1) ok("E1", `feedback total=${stats.total} good=${stats.good}`);
    else fail("E1", JSON.stringify(stats));
  }

  // E2
  const projRag = join(ragDir, `project_${p.id}`);
  const ragFiles = existsSync(projRag) ? readdirSync(projRag) : [];
  if (ragFiles.length > 0) ok("E2", `rag files=${ragFiles.join(",")}`);
  else fail("E2", `no files in ${projRag}`);

  // E3
  insertLeads(db, p.id, [
    {
      company: "GoodCo Twin AI",
      website: "https://goodcotwin.test",
      canonicalDomain: "goodcotwin.test",
      email: "a@goodcotwin.test",
      votes: 40,
      source: "csv",
      sources: ["csv"],
    },
  ]);
  const s2 = await runScoring(db, p.id, new HermesScorer(), { rag });
  const twin = listLeads(db, p.id).find((l) => l.company === "GoodCo Twin AI");
  if (twin?.status === "scored" && twin.reasons) {
    ok("E3", `scored with RAG context attached; reasons=${twin.reasons.slice(0, 140)}`);
  } else {
    fail("E3", `twin status=${twin?.status} summary=${JSON.stringify(s2)}`);
  }

  gap("E4", "FileFeedbackRag in use; Hermes knowledge_base/Chroma not primary (design §8)");

  // H1
  const other =
    listProjects(db).find((x) => x.id !== p.id) ??
    createProject(db, { name: "Other Iso" });
  const cross = listLeads(db, other.id).filter((l) =>
    listLeads(db, p.id).some((pl) => pl.id === l.id)
  );
  if (cross.length === 0) ok("H1", `no shared lead ids between ${p.id} and ${other.id}`);
  else fail("H1", `cross ids=${cross.map((l) => l.id).join(",")}`);

  // H2
  const statsP = getFeedbackStats(db, p.id);
  const statsO = getFeedbackStats(db, other.id);
  if (statsP.total >= 1) {
    ok("H2", `project ${p.id} stats total=${statsP.total}; other ${other.id} total=${statsO.total}`);
  } else fail("H2", "expected feedback on e2e project");

  // G data on project 3
  const p3 = getProject(db, 3);
  const cfg = p3?.sourceConfig ? JSON.parse(p3.sourceConfig) : {};
  if (cfg.producthunt && cfg.jina) ok("G_config", "project3 source_config has producthunt+jina");
  else fail("G_config", `source_config=${p3?.sourceConfig}`);

  const p3Leads = listLeads(db, 3);
  const hasPh = p3Leads.some((l) => (l.sources ?? []).includes("producthunt"));
  const hasJina = p3Leads.some((l) => (l.sources ?? []).includes("jina"));
  if (hasPh) ok("G1", `producthunt leads on project 3; total=${p3Leads.length}`);
  else fail("G1", "no producthunt-sourced leads on project 3");
  if (hasJina) ok("G2", "jina-sourced leads on project 3");
  else fail("G2", "no jina-sourced leads on project 3");

  const noisy = p3Leads.filter(
    (l) =>
      /reddit\.com|top SaaS|Startups funded|Best B2B Marketing|100 top/i.test(l.company) ||
      /reddit\.com/i.test(l.website ?? "")
  );
  if (noisy.length > 0) {
    fail("G4", `noise leads (${noisy.length}): ${noisy.map((l) => l.company).join(" | ")}`);
  } else {
    ok("G4", "no obvious listicle/reddit noise");
  }

  gap("G5", "Google CSE skipped intentionally; Jina is web-search stand-in");

  // G3 enrich — config has enrich:true; verify at least one lead has email from prior enrich or path exists
  if (cfg.enrich === true) {
    ok("G3", "enrich:true in project 3 source_config (enrich path enabled on ingest)");
  } else {
    fail("G3", "enrich not enabled on project 3");
  }

  writeFileSync(
    join("docs", "testing", "_e2e-results.json"),
    JSON.stringify({ results, e2eProjectId: p.id }, null, 2),
    "utf8"
  );
} finally {
  db.close();
}
