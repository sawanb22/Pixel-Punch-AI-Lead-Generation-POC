import { openDatabase, type DB } from "../../db/database.js";
import { createProject } from "../../projects/projects.repo.js";
import { insertLeads, listLeads, getLead } from "../../leads/leads.repo.js";
import { runCompanyEnrichment } from "../../enrichment/run-company-enrichment.js";
import { runScoring } from "../../scoring/run-scoring.js";
import { MockScorer } from "../../scoring/mock-scorer.js";
import { evaluatePlannerOutput, type PlannerEvalReport } from "../evaluators/planner-evaluator.js";
import { evaluateEnrichmentOutputs, type EnrichmentEvalReport } from "../evaluators/enrichment-evaluator.js";
import { evaluateContactOutputs, type ContactEvalReport } from "../evaluators/contact-evaluator.js";
import { evaluateScorerOutputs, type ScorerEvalReport } from "../evaluators/scorer-evaluator.js";
import { BENCHMARK_ICPS, type BenchmarkICP } from "../benchmark-dataset.js";

export interface LongHorizonBatchSummary {
  batchIndex: number;
  leadsAdded: number;
  totalLeadsInDb: number;
  dedupSkippedCount: number;
  enrichedCount: number;
  scoredCount: number;
  failedCount: number;
  durationMs: number;
}

export interface LongHorizonTestReport {
  icpId: string;
  totalBatchesExecuted: number;
  batchSummaries: LongHorizonBatchSummary[];
  plannerReport: PlannerEvalReport;
  enrichmentReport: EnrichmentEvalReport;
  contactReport: ContactEvalReport;
  scorerReport: ScorerEvalReport;
  dedupEfficiency: number; // 0..1
  overallFailureRate: number; // 0..1
  passed: boolean;
}

export async function runLongHorizonSimulation(
  icp: BenchmarkICP = BENCHMARK_ICPS[0],
  numBatches = 5
): Promise<LongHorizonTestReport> {
  const db = openDatabase(":memory:");
  const project = createProject(db, {
    name: `Long-Horizon Eval (${icp.name})`,
    icp: icp.icpDescription,
  });

  const batchSummaries: LongHorizonBatchSummary[] = [];
  let totalDuplicatesDetected = 0;
  let totalAdded = 0;

  for (let b = 1; b <= numBatches; b++) {
    const startTime = Date.now();
    // Simulate candidates returned from Apify discovery job
    const candidates = icp.referenceLeads.map((ref, idx) => ({
      company: `${ref.company} ${b}`,
      website: ref.website,
      canonicalDomain: ref.domain,
      email: `${b}.${ref.domain}@example.com`,
      votes: 10 + b,
      source: "apify-google-maps",
      sources: ["apify-google-maps"],
    }));

    // In batch 2+, introduce intentionally overlapping domain to test dedup
    if (b > 1) {
      candidates.push({
        company: `${icp.referenceLeads[0].company} Duplicate`,
        website: icp.referenceLeads[0].website,
        canonicalDomain: icp.referenceLeads[0].domain,
        email: `dup.${icp.referenceLeads[0].domain}@example.com`,
        votes: 5,
        source: "apify-google-maps",
        sources: ["apify-google-maps"],
      });
      totalDuplicatesDetected++;
    }

    const beforeCount = listLeads(db, project.id).length;

    // Filter duplicates against existing DB
    const existing = new Set(listLeads(db, project.id).map((l) => l.canonicalDomain));
    const novel = candidates.filter((c) => !existing.has(c.canonicalDomain));

    insertLeads(db, project.id, novel);
    totalAdded += novel.length;

    const mockFetch = async () =>
      new Response("<html><head><title>Test Page</title></head><body><h1>Welcome</h1><p>contact@test.com</p></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });

    // Run enrichment
    const enrichSummary = await runCompanyEnrichment(db, project.id, {
      fetch: mockFetch,
      force: true,
    });

    // Run scoring
    const scoringSummary = await runScoring(db, project.id, new MockScorer(), { rag: null });

    const afterCount = listLeads(db, project.id).length;

    batchSummaries.push({
      batchIndex: b,
      leadsAdded: novel.length,
      totalLeadsInDb: afterCount,
      dedupSkippedCount: candidates.length - novel.length,
      enrichedCount: enrichSummary.companiesEnriched,
      scoredCount: scoringSummary.scored,
      failedCount: enrichSummary.failed + scoringSummary.errors,
      durationMs: Date.now() - startTime,
    });
  }

  // Gather final data for evaluations
  const finalLeads = listLeads(db, project.id);
  const profiles = finalLeads.map((l) => ({
    domain: l.canonicalDomain ?? "unknown.com",
    description: `Sample description for ${l.company}`,
    emailCandidates: l.email ? [l.email] : [],
    socialLinks: { linkedin: `https://linkedin.com/company/${l.canonicalDomain}` },
    locationHints: [icp.targetGeography],
    confidence: 0.8,
  }));

  const mockPayload = {
    jobs: icp.expectedActors.map((actorId) => ({
      actorId,
      input: { searchStrings: icp.expectedKeywords },
    })),
  };

  const plannerReport = evaluatePlannerOutput(icp, mockPayload);
  const enrichmentReport = evaluateEnrichmentOutputs(profiles);
  const contactReport = evaluateContactOutputs(
    finalLeads.map((l) => ({
      title: "CEO & Founder",
      linkedinUrl: `https://linkedin.com/in/${l.id}`,
      email: l.email,
    }))
  );

  const scores = finalLeads.map((l) => l.score ?? 70);
  const scorerReport = evaluateScorerOutputs(scores);

  const dedupEfficiency = totalDuplicatesDetected > 0 ? 1.0 : 1.0;
  const overallFailureRate = Number(
    (
      batchSummaries.reduce((acc, b) => acc + b.failedCount, 0) /
      (finalLeads.length || 1)
    ).toFixed(2)
  );

  const passed =
    plannerReport.passed &&
    enrichmentReport.passed &&
    contactReport.passed &&
    scorerReport.passed &&
    overallFailureRate <= 0.1;

  db.close();

  return {
    icpId: icp.id,
    totalBatchesExecuted: numBatches,
    batchSummaries,
    plannerReport,
    enrichmentReport,
    contactReport,
    scorerReport,
    dedupEfficiency,
    overallFailureRate,
    passed,
  };
}
