import { openDatabase } from "../src/db/database.js";
const db = openDatabase("leadradar.db");

// Check run columns
const cols = db.prepare(`PRAGMA table_info(operations_runs)`).all();
console.log("operations_runs columns:", (cols as any[]).map(c => c.name).join(", "));

// Check scored leads count
const scoredCount = db.prepare(`SELECT COUNT(*) as cnt FROM leads WHERE score IS NOT NULL AND lead_list_id=14`).get();
const totalCount = db.prepare(`SELECT COUNT(*) as cnt FROM leads WHERE lead_list_id=14`).get();
console.log(`Progress: ${(scoredCount as any).cnt} / ${(totalCount as any).cnt} scored`);

// Show recent run
const runs = db.prepare(`SELECT * FROM operations_runs WHERE project_id=6 ORDER BY id DESC LIMIT 3`).all();
console.log("Recent runs:", JSON.stringify(runs, null, 2));
