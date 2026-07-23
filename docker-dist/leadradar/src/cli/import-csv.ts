import { readFileSync } from "node:fs";
import { openDatabase } from "../db/database.js";
import { createProject, getProject } from "../projects/projects.repo.js";
import { parseCsvSource, type ColumnMapping } from "../sources/csv-source.js";
import { runIngest } from "../ingest/run-ingest.js";
import type { Source } from "../sources/source.js";

// Usage: npm run import-csv -- <projectName> <csvPath>
async function main() {
  const [, , projectName, csvPath] = process.argv;
  if (!projectName || !csvPath) {
    console.error("Usage: npm run import-csv -- <projectName> <csvPath>");
    process.exit(1);
  }
  const db = openDatabase("leadradar.db");
  const project = createProject(db, { name: projectName });
  const csv = readFileSync(csvPath, "utf-8");

  const mapping: ColumnMapping = {
    company: "Company",
    website: "Website",
    email: "Email",
    votes: "Votes",
  };
  const csvSource: Source = {
    name: "csv",
    fetch: async () => parseCsvSource(csv, mapping),
  };

  const summary = await runIngest(db, project.id, [csvSource]);
  console.log(`Project ${project.id} (${getProject(db, project.id)?.name})`);
  console.log(`Fetched: ${summary.fetched}, Kept: ${summary.kept}, Rejected: ${summary.rejected}`);
  db.close();
}

main();
