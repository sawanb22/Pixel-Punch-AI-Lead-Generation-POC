import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const here = dirname(fileURLToPath(import.meta.url));

export type DB = InstanceType<typeof DatabaseSync>;

function columnNames(db: DB, table: string): Set<string> {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return new Set(cols.map((c) => c.name));
}

function addColumnIfMissing(
  db: DB,
  table: string,
  column: string,
  ddl: string
): void {
  const names = columnNames(db, table);
  if (!names.has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

function ensureDefaultLeadLists(db: DB): void {
  const projects = db
    .prepare("SELECT id, active_lead_list_id FROM projects")
    .all() as Array<{ id: number; active_lead_list_id: number | null }>;

  for (const project of projects) {
    let listId = project.active_lead_list_id;
    if (listId != null) {
      const exists = db
        .prepare("SELECT id FROM lead_lists WHERE id = ? AND project_id = ?")
        .get(listId, project.id);
      if (!exists) listId = null;
    }
    if (listId == null) {
      const existing = db
        .prepare(
          `SELECT id FROM lead_lists WHERE project_id = ? ORDER BY id LIMIT 1`
        )
        .get(project.id) as { id: number } | undefined;
      if (existing) {
        listId = existing.id;
      } else {
        const result = db
          .prepare(
            `INSERT INTO lead_lists (project_id, name, description)
             VALUES (?, 'Default', NULL)`
          )
          .run(project.id);
        listId = Number(result.lastInsertRowid);
      }
      db.prepare(
        `UPDATE projects SET active_lead_list_id = ? WHERE id = ?`
      ).run(listId, project.id);
    }

    db.prepare(
      `UPDATE leads SET lead_list_id = ? WHERE project_id = ? AND lead_list_id IS NULL`
    ).run(listId, project.id);
    db.prepare(
      `UPDATE discovery_runs SET lead_list_id = ? WHERE project_id = ? AND lead_list_id IS NULL`
    ).run(listId, project.id);
    db.prepare(
      `UPDATE feedback SET lead_list_id = ? WHERE project_id = ? AND lead_list_id IS NULL`
    ).run(listId, project.id);
  }
}

function createIndexIfNotExists(db: DB, name: string, ddl: string): void {
  const row = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`
    )
    .get(name);
  if (!row) {
    db.exec(ddl);
  }
}

function migrateDatabase(db: DB): void {
  addColumnIfMissing(db, "projects", "lead_plan", "lead_plan TEXT");
  addColumnIfMissing(db, "projects", "lead_strategy", "lead_strategy TEXT");
  addColumnIfMissing(db, "projects", "website_summary", "website_summary TEXT");
  addColumnIfMissing(
    db,
    "projects",
    "website_summary_at",
    "website_summary_at TEXT"
  );
  addColumnIfMissing(
    db,
    "projects",
    "active_lead_list_id",
    "active_lead_list_id INTEGER"
  );

  addColumnIfMissing(db, "leads", "lead_list_id", "lead_list_id INTEGER");
  addColumnIfMissing(db, "feedback", "lead_list_id", "lead_list_id INTEGER");
  addColumnIfMissing(
    db,
    "discovery_runs",
    "lead_list_id",
    "lead_list_id INTEGER"
  );
  addColumnIfMissing(
    db,
    "discovery_runs",
    "planner_input_json",
    "planner_input_json TEXT"
  );
  addColumnIfMissing(
    db,
    "discovery_runs",
    "planner_raw_json",
    "planner_raw_json TEXT"
  );
  addColumnIfMissing(db, "discovery_runs", "payload_json", "payload_json TEXT");
  addColumnIfMissing(
    db,
    "discovery_runs",
    "compiled_jobs_json",
    "compiled_jobs_json TEXT"
  );
  addColumnIfMissing(
    db,
    "discovery_runs",
    "validation_notes",
    "validation_notes TEXT"
  );

  createIndexIfNotExists(
    db,
    "idx_leads_list",
    "CREATE INDEX idx_leads_list ON leads(project_id, lead_list_id)"
  );
  createIndexIfNotExists(
    db,
    "idx_discovery_runs_list",
    "CREATE INDEX idx_discovery_runs_list ON discovery_runs(project_id, lead_list_id)"
  );

  addColumnIfMissing(db, "lead_lists", "lead_plan", "lead_plan TEXT");
  addColumnIfMissing(db, "lead_lists", "payload_json", "payload_json TEXT");
  addColumnIfMissing(
    db,
    "lead_lists",
    "compiled_jobs_json",
    "compiled_jobs_json TEXT"
  );
  addColumnIfMissing(
    db,
    "lead_lists",
    "plan_updated_at",
    "plan_updated_at TEXT"
  );
  addColumnIfMissing(db, "lead_lists", "hunt_config", "hunt_config TEXT");
  addColumnIfMissing(
    db,
    "lead_lists",
    "plan_context_hash",
    "plan_context_hash TEXT"
  );

  ensureDefaultLeadLists(db);
  backfillLeadListPlansFromProjects(db);
  backfillLeadListPayloadFromRuns(db);
}

function backfillLeadListPayloadFromRuns(db: DB): void {
  const lists = db
    .prepare(
      `SELECT id FROM lead_lists
       WHERE payload_json IS NULL OR TRIM(payload_json) = ''`
    )
    .all() as Array<{ id: number }>;

  for (const list of lists) {
    const run = db
      .prepare(
        `SELECT payload_json, compiled_jobs_json FROM discovery_runs
         WHERE lead_list_id = ? AND payload_json IS NOT NULL AND TRIM(payload_json) != ''
         ORDER BY id DESC LIMIT 1`
      )
      .get(list.id) as
      | { payload_json: string; compiled_jobs_json: string | null }
      | undefined;
    if (!run) continue;
    db.prepare(
      `UPDATE lead_lists SET payload_json = ?, compiled_jobs_json = COALESCE(compiled_jobs_json, ?)
       WHERE id = ?`
    ).run(run.payload_json, run.compiled_jobs_json, list.id);
  }
}

function backfillLeadListPlansFromProjects(db: DB): void {
  const projects = db
    .prepare(
      `SELECT id, lead_plan FROM projects
       WHERE lead_plan IS NOT NULL AND TRIM(lead_plan) != ''`
    )
    .all() as Array<{ id: number; lead_plan: string }>;

  for (const project of projects) {
    const list = db
      .prepare(
        `SELECT id, lead_plan FROM lead_lists
         WHERE project_id = ?
         ORDER BY CASE WHEN name = 'Default' THEN 0 ELSE 1 END, id
         LIMIT 1`
      )
      .get(project.id) as { id: number; lead_plan: string | null } | undefined;
    if (!list || (list.lead_plan != null && list.lead_plan.trim() !== "")) {
      continue;
    }
    db.prepare(`UPDATE lead_lists SET lead_plan = ? WHERE id = ?`).run(
      project.lead_plan,
      list.id
    );
  }
}

export function openDatabase(path = "leadradar.db"): DB {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  const schema = readFileSync(join(here, "schema.sql"), "utf-8");
  db.exec(schema);
  migrateDatabase(db);
  return db;
}
