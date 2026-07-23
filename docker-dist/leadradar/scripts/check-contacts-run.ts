import { openDatabase } from "../src/db/database.js";
const db = openDatabase("leadradar.db");

// Count company profiles
const profilesCount = db.prepare(`SELECT COUNT(*) as cnt FROM company_profiles WHERE project_id=6`).get();
console.log("Company profiles for project 6:", profilesCount);

// Get recent logs for the contacts runs
const logs = db.prepare(`
  SELECT l.run_id, l.message, l.level, l.created_at
  FROM operations_logs l
  WHERE l.run_id IN (8, 9)
  ORDER BY l.id DESC
  LIMIT 10
`).all();
console.log("Recent logs:", JSON.stringify(logs, null, 2));

// Count contacts found
const contacts = db.prepare(`SELECT * FROM contacts WHERE project_id=6`).all();
console.log("Contacts found so far:", contacts);

