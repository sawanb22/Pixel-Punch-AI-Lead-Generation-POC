import { loadEnvFile } from "../config/load-env.js";
import { openDatabase } from "../db/database.js";
import { createApp, parseAllowlist, resolveScorer } from "./app.js";

// Load .env first so HERMES_* apply. Do not override explicit shell exports
// except we never want a stale SCORE_MOCK from a parent shell for dashboard:dev —
// dashboard:dev clears SCORE_MOCK before spawn; here we only load missing keys.
loadEnvFile();

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.LEADRADAR_DB ?? "leadradar.db";

const db = openDatabase(dbPath);
const scorer = resolveScorer();
const app = createApp({
  db,
  scorer,
  allowlist: parseAllowlist(),
});

app.listen(port, () => {
  console.log(`LeadRadar dashboard on http://localhost:${port}`);
  if (process.env.LEADRADAR_AUTH_BYPASS === "1") {
    console.log("AUTH BYPASS enabled (dev@local)");
  }
  if (process.env.SCORE_MOCK === "1") {
    console.log("Using MockScorer (SCORE_MOCK=1)");
  } else {
    console.log("Using HermesScorer (real scoring)");
  }
});
