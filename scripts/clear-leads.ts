import { openDatabase } from "../src/db/database.js";

const db = openDatabase("leadradar.db");

const before = db
  .prepare("SELECT project_id, COUNT(*) AS n FROM leads GROUP BY project_id")
  .all();
console.log("BEFORE", JSON.stringify(before, null, 2));

const cfg = db
  .prepare("SELECT id, name, source_config FROM projects WHERE id = 1")
  .get() as { id: number; name: string; source_config: string | null } | undefined;
console.log("PIXEL_PUNCH_CONFIG", cfg?.source_config);

db.exec("BEGIN");
try {
  db.exec("DELETE FROM feedback");
  db.exec("DELETE FROM company_evidence");
  db.exec("DELETE FROM company_pages");
  db.exec("DELETE FROM company_profiles");
  db.exec("DELETE FROM company_enrichment_jobs");
  db.exec("DELETE FROM company_enrichment_runs");
  db.exec("DELETE FROM discovered_candidates");
  db.exec("DELETE FROM discovery_source_jobs");
  db.exec("DELETE FROM discovery_runs");
  db.exec("DELETE FROM page_fetch_cache");
  db.exec("DELETE FROM leads");
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

const after = db.prepare("SELECT COUNT(*) AS leads FROM leads").get();
console.log("AFTER", after);
db.close();
console.log("Cleared all leads + discovery/enrichment rows.");
