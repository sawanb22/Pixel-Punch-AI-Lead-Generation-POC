import { openDatabase } from "../db/database.js";
import { getProject } from "../projects/projects.repo.js";
import { createConfiguredSources } from "../sources/registry.js";
import { runIngest } from "../ingest/run-ingest.js";

// Usage: npm run ingest -- <projectId>
async function main() {
  const [, , projectIdRaw] = process.argv;
  if (!projectIdRaw) {
    console.error("Usage: npm run ingest -- <projectId>");
    process.exit(1);
  }
  const projectId = Number(projectIdRaw);
  if (!Number.isInteger(projectId) || projectId < 1) {
    console.error("projectId must be a positive integer");
    process.exit(1);
  }

  const db = openDatabase("leadradar.db");
  const project = getProject(db, projectId);
  if (!project) {
    console.error(`Project ${projectId} not found`);
    db.close();
    process.exit(1);
  }

  let configured;
  try {
    configured = createConfiguredSources(project);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    db.close();
    process.exit(1);
  }

  if (configured.sources.length === 0) {
    console.error(
      "No sources configured. Set project.source_config JSON (producthunt / google)."
    );
    db.close();
    process.exit(1);
  }

  const summary = await runIngest(db, project.id, configured.sources, {
    enrichWebsites: configured.enrich,
  });

  console.log(`Project ${project.id} (${project.name})`);
  console.log(
    `Sources: ${configured.sources.map((s) => s.name).join(", ")}` +
      (configured.enrich ? " (+ website enrich)" : "")
  );
  console.log(
    `Fetched: ${summary.fetched}, Kept: ${summary.kept}, Rejected: ${summary.rejected}` +
      (summary.skippedExisting
        ? `, Skipped existing: ${summary.skippedExisting}`
        : "")
  );
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
