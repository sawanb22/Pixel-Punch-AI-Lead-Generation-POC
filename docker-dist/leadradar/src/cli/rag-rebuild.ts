import { openDatabase } from "../db/database.js";
import { getProject } from "../projects/projects.repo.js";
import { FileFeedbackRag } from "../rag/file-feedback-rag.js";
import { rebuildProjectRag } from "../rag/sync-feedback.js";

// Usage: npm run rag:rebuild -- <projectId>
function main() {
  const args = process.argv.slice(2);
  const projectIdArg = args.find((a) => !a.startsWith("--"));

  if (!projectIdArg) {
    console.error("Usage: npm run rag:rebuild -- <projectId>");
    process.exit(1);
  }

  const projectId = Number(projectIdArg);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    console.error("projectId must be a positive number");
    process.exit(1);
  }

  const dbPath = process.env.LEADRADAR_DB ?? "leadradar.db";
  const ragDir = process.env.RAG_DIR ?? "data/rag";
  const db = openDatabase(dbPath);
  const project = getProject(db, projectId);
  if (!project) {
    console.error(`Project ${projectId} not found`);
    db.close();
    process.exit(1);
  }

  const rag = new FileFeedbackRag(ragDir);
  console.log(`Rebuilding RAG for project ${projectId} (${project.name}) → ${ragDir}/project_${projectId}/`);
  rebuildProjectRag(db, rag, projectId);
  const docs = rag.similar(projectId, project.name, 1000);
  console.log(`Done. ${docs.length} feedback document(s) in corpus.`);
  db.close();
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
