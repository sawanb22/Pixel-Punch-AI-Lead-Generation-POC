import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BENCHMARK_ICPS } from "../eval/benchmark-dataset.js";
import { runLongHorizonSimulation, type LongHorizonTestReport } from "../eval/harness/long-horizon-harness.js";

export async function runFullEvaluationSuite(numBatches = 5): Promise<LongHorizonTestReport[]> {
  console.log("=================================================");
  console.log("  LeadRadar Agent Output & Long-Horizon Eval     ");
  console.log("=================================================\n");

  const reports: LongHorizonTestReport[] = [];

  for (const icp of BENCHMARK_ICPS) {
    console.log(`[Eval] Simulating ICP: ${icp.name} (${numBatches} batches)...`);
    const report = await runLongHorizonSimulation(icp, numBatches);
    reports.push(report);
    console.log(
      `  -> Result: ${report.passed ? "✅ PASSED" : "❌ FAILED"} | Deduplication Efficiency: ${(report.dedupEfficiency * 100).toFixed(0)}% | Failure Rate: ${(report.overallFailureRate * 100).toFixed(0)}%`
    );
  }

  const outputDir = join(process.cwd(), "data", "eval-reports");
  mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(outputDir, `eval-report-${timestamp}.json`);
  const mdPath = join(outputDir, `eval-report-${timestamp}.md`);

  writeFileSync(jsonPath, JSON.stringify(reports, null, 2), "utf-8");

  let mdContent = `# LeadRadar Agent Output & Long-Horizon Evaluation Report\n\n`;
  mdContent += `**Generated At**: ${new Date().toISOString()}\n\n`;
  mdContent += `## Executive Summary\n\n`;

  const totalPassed = reports.filter((r) => r.passed).length;
  mdContent += `- **Total ICP Benchmarks Evaluated**: ${reports.length}\n`;
  mdContent += `- **Overall Status**: ${totalPassed === reports.length ? "✅ ALL PASSED" : "⚠️ PARTIAL FAILURES"}\n`;
  mdContent += `- **Long-Horizon Batches per ICP**: ${numBatches}\n\n`;

  mdContent += `## Detailed ICP Scorecards\n\n`;

  for (const r of reports) {
    mdContent += `### ICP: ${r.icpId} (${r.passed ? "✅ PASS" : "❌ FAIL"})\n\n`;
    mdContent += `| Agent Component | Metric | Score / Result | Threshold | Status |\n`;
    mdContent += `|:---|:---|:---|:---|:---|\n`;
    mdContent += `| **Planner Agent** | Action Precision | ${(r.plannerReport.precisionResult.precision * 100).toFixed(0)}% | ≥ 80% | ${r.plannerReport.passed ? "✅ Pass" : "❌ Fail"} |\n`;
    mdContent += `| **Enrichment Engine** | Yield & Fidelity | ${(r.enrichmentReport.averageYieldRate * 100).toFixed(0)}% | ≥ 50% | ${r.enrichmentReport.passed ? "✅ Pass" : "❌ Fail"} |\n`;
    mdContent += `| **Contact Finder** | Decision Maker Ratio | ${(r.contactReport.overallDecisionMakerRatio * 100).toFixed(0)}% | ≥ 30% | ${r.contactReport.passed ? "✅ Pass" : "❌ Fail"} |\n`;
    mdContent += `| **Hermes Scorer** | Rank Correlation | ${r.scorerReport.spearmanCorrelation} | ≥ 0.5 | ${r.scorerReport.passed ? "✅ Pass" : "❌ Fail"} |\n`;
    mdContent += `| **Long-Horizon System** | Failure Rate | ${(r.overallFailureRate * 100).toFixed(0)}% | ≤ 10% | ${r.overallFailureRate <= 0.1 ? "✅ Pass" : "❌ Fail"} |\n\n`;

    mdContent += `#### Multi-Batch Execution Log\n\n`;
    mdContent += `| Batch | Leads Added | Total DB Leads | Dedup Skipped | Enriched | Scored | Failures | Time (ms) |\n`;
    mdContent += `|:---|:---|:---|:---|:---|:---|:---|:---|\n`;
    for (const b of r.batchSummaries) {
      mdContent += `| #${b.batchIndex} | ${b.leadsAdded} | ${b.totalLeadsInDb} | ${b.dedupSkippedCount} | ${b.enrichedCount} | ${b.scoredCount} | ${b.failedCount} | ${b.durationMs}ms |\n`;
    }
    mdContent += `\n---\n\n`;
  }

  writeFileSync(mdPath, mdContent, "utf-8");
  console.log(`\n[Eval] Reports saved successfully:`);
  console.log(`  -> JSON: ${jsonPath}`);
  console.log(`  -> Markdown: ${mdPath}\n`);

  return reports;
}

if (process.argv[1]?.endsWith("run-eval.ts") || process.argv[1]?.endsWith("run-eval.js")) {
  runFullEvaluationSuite(5).catch((err) => {
    console.error("Evaluation run failed:", err);
    process.exit(1);
  });
}
