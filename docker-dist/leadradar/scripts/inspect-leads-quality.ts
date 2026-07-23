import { openDatabase } from "../src/db/database.js";
import { classifyDomainQuality } from "../src/discovery/hard-shield.js";

const db = openDatabase("./leadradar.db");

const cols = db.prepare(`PRAGMA table_info(leads)`).all();
console.log(
  "COLS",
  cols.map((c: { name: string }) => c.name)
);

const stats = db
  .prepare(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='gated' THEN 1 ELSE 0 END) AS gated,
      SUM(CASE WHEN status='provisional' THEN 1 ELSE 0 END) AS provisional,
      SUM(CASE WHEN status='scored' THEN 1 ELSE 0 END) AS scored,
      SUM(CASE WHEN email IS NOT NULL AND email!='' THEN 1 ELSE 0 END) AS withEmail,
      SUM(CASE WHEN website IS NOT NULL AND website!='' THEN 1 ELSE 0 END) AS withWebsite
     FROM leads`
  )
  .get();
console.log("STATS", stats);

const bySource = db
  .prepare(
    `SELECT sources, COUNT(*) AS c FROM leads GROUP BY sources ORDER BY c DESC LIMIT 20`
  )
  .all();
console.log("BY_SOURCE", bySource);

const runs = db
  .prepare(
    `SELECT id, status, fetched_count, kept_count, rejected_count, duplicate_count, validation_notes
     FROM discovery_runs ORDER BY id DESC LIMIT 3`
  )
  .all();
console.log("RUNS", runs);

const sample = db
  .prepare(
    `SELECT id, company, website, canonical_domain, email, sources, status, score
     FROM leads ORDER BY id ASC LIMIT 100`
  )
  .all() as Array<{
  id: number;
  company: string;
  website: string | null;
  canonical_domain: string | null;
  email: string | null;
  sources: string | null;
  status: string;
  score: number | null;
}>;

const buckets: Record<string, number> = {};
const byBucket: Record<string, typeof sample> = {};
for (const r of sample) {
  const b = classifyDomainQuality(r.canonical_domain, r.company);
  buckets[b] = (buckets[b] || 0) + 1;
  (byBucket[b] ||= []).push(r);
}
console.log("CLASSIFY", buckets);
console.log("--- likely_company sample (first 30) ---");
for (const r of (byBucket.likely_company || []).slice(0, 30)) {
  console.log(`${r.id}\t${r.company}\t${r.canonical_domain}\t${r.website}`);
}
console.log("--- media_or_platform sample ---");
for (const r of (byBucket.media_or_platform || []).slice(0, 25)) {
  console.log(`${r.id}\t${r.company}\t${r.canonical_domain}`);
}
console.log("--- listicle_like ---");
for (const r of byBucket.listicle_like || []) {
  console.log(`${r.id}\t${r.company}\t${r.canonical_domain}`);
}

const reject = db
  .prepare(
    `SELECT rejection_reason, COUNT(*) AS c
     FROM discovered_candidates
     WHERE run_id = (SELECT MAX(id) FROM discovery_runs)
     GROUP BY rejection_reason
     ORDER BY c DESC`
  )
  .all();
console.log("LATEST_REJECT", reject);

const project = db
  .prepare(
    `SELECT id, name, substr(icp,1,220) AS icp, substr(lead_plan,1,500) AS lead_plan FROM projects`
  )
  .all();
console.log("PROJECTS", project);

db.close();
