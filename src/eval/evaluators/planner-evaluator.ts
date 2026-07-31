import { BENCHMARK_ICPS, type BenchmarkICP } from "../benchmark-dataset.js";
import { evaluatePlannerPrecision, type PlannerPrecisionResult } from "../metrics.js";

export interface PlannerEvalReport {
  icpId: string;
  icpName: string;
  precisionResult: PlannerPrecisionResult;
  keywordAlignmentScore: number;
  actorMatchScore: number;
  passed: boolean;
}

export function evaluatePlannerOutput(
  icp: BenchmarkICP,
  strategicPayload: { jobs?: Array<{ actorId?: string; input?: Record<string, unknown> }> }
): PlannerEvalReport {
  const precisionResult = evaluatePlannerPrecision(strategicPayload);
  const jobs = strategicPayload.jobs ?? [];

  // Check keyword alignment in search strings/queries
  let matchedKeywords = 0;
  const payloadStr = JSON.stringify(strategicPayload).toLowerCase();
  for (const kw of icp.expectedKeywords) {
    if (payloadStr.includes(kw.toLowerCase())) {
      matchedKeywords++;
    }
  }
  const keywordAlignmentScore = icp.expectedKeywords.length
    ? Number((matchedKeywords / icp.expectedKeywords.length).toFixed(2))
    : 1.0;

  // Check expected actors
  let matchedActors = 0;
  for (const actor of icp.expectedActors) {
    if (jobs.some((j) => (j.actorId ?? "").includes(actor))) {
      matchedActors++;
    }
  }
  const actorMatchScore = icp.expectedActors.length
    ? Number((matchedActors / icp.expectedActors.length).toFixed(2))
    : 1.0;

  const passed =
    precisionResult.precision >= 0.8 &&
    keywordAlignmentScore >= 0.3 &&
    actorMatchScore >= 0.5;

  return {
    icpId: icp.id,
    icpName: icp.name,
    precisionResult,
    keywordAlignmentScore,
    actorMatchScore,
    passed,
  };
}
