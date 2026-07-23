import { openDatabase } from "../db/database.js";
import { getProject } from "../projects/projects.repo.js";
import { HermesScorer } from "../scoring/hermes-scorer.js";
import { MockScorer } from "../scoring/mock-scorer.js";
import { runScoring } from "../scoring/run-scoring.js";
import type { Scorer } from "../scoring/scorer.js";

// Usage: npm run score -- <projectId> [--mock]
async function main() {
  const args = process.argv.slice(2);
  const projectIdArg = args.find((a) => !a.startsWith("--"));
  const useMock = args.includes("--mock");

  if (!projectIdArg) {
    console.error("Usage: npm run score -- <projectId> [--mock]");
    process.exit(1);
  }

  const projectId = Number(projectIdArg);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    console.error("projectId must be a positive number");
    process.exit(1);
  }

  const dbPath = process.env.LEADRADAR_DB ?? "leadradar.db";
  const db = openDatabase(dbPath);
  const project = getProject(db, projectId);
  if (!project) {
    console.error(`Project ${projectId} not found`);
    db.close();
    process.exit(1);
  }

  const scorer: Scorer = useMock ? new MockScorer() : new HermesScorer();
  console.log(
    `Scoring project ${projectId} (${project.name}) with ${useMock ? "MockScorer" : "HermesScorer"}…`
  );

  const summary = await runScoring(db, projectId, scorer);
  console.log(`Scored: ${summary.scored}, Skipped: ${summary.skipped}, Errors: ${summary.errors}`);
  if (summary.errorMessages.length) {
    for (const msg of summary.errorMessages) {
      console.error(`  - ${msg}`);
    }
  }
  db.close();

  if (summary.errors > 0 && summary.scored === 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
