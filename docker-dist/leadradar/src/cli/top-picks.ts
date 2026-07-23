import { openDatabase } from "../db/database.js";
import { getProject } from "../projects/projects.repo.js";
import { selectTopPicks, formatClarifyMessage } from "../telegram/top-picks.js";

// Usage: npm run top-picks -- <projectId> [--limit 5]
async function main() {
  const args = process.argv.slice(2);
  const projectIdArg = args.find((a) => !a.startsWith("--"));
  const limitIdx = args.indexOf("--limit");
  const limit =
    limitIdx >= 0 && args[limitIdx + 1] ? Number(args[limitIdx + 1]) : 5;

  if (!projectIdArg) {
    console.error("Usage: npm run top-picks -- <projectId> [--limit 5]");
    process.exit(1);
  }

  const projectId = Number(projectIdArg);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    console.error("projectId must be a positive number");
    process.exit(1);
  }
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    console.error("limit must be a positive integer");
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

  const picks = selectTopPicks(db, projectId, limit);
  if (picks.length === 0) {
    console.log(`No scored leads awaiting feedback for project ${projectId} (${project.name}).`);
    db.close();
    return;
  }

  console.log(
    `Top ${picks.length} pick(s) for project ${projectId} (${project.name}):\n`
  );
  for (const [i, lead] of picks.entries()) {
    const clarify = formatClarifyMessage(lead, project);
    console.log(`--- Pick ${i + 1} (lead #${clarify.leadId}) ---`);
    console.log(clarify.text);
    console.log(`Choices: ${clarify.choices.join(" / ")}`);
    console.log(
      `After tap → record_feedback({ project_id: ${projectId}, lead_id: ${clarify.leadId}, good: true|false, source: "telegram" })\n`
    );
  }

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
