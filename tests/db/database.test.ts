import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { openDatabase } from "../../src/db/database.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

describe("openDatabase", () => {
  it("creates all core tables in an in-memory db", () => {
    const db = openDatabase(":memory:");
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toContain("projects");
    expect(names).toContain("leads");
    expect(names).toContain("feedback");
    expect(names).toContain("users");
    expect(names).toContain("lead_lists");
    db.close();
  });

  it("migrates legacy DB file that predates lead lists", () => {
    const dir = mkdtempSync(join(tmpdir(), "leadradar-legacy-db-"));
    const path = join(dir, "legacy.db");
    try {
      const legacy = new DatabaseSync(path);
      legacy.exec(`
        CREATE TABLE projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          website TEXT,
          description TEXT,
          icp TEXT,
          source_config TEXT,
          lead_plan TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE leads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          company TEXT NOT NULL,
          website TEXT,
          canonical_domain TEXT,
          email TEXT,
          votes INTEGER,
          sources TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'raw',
          score INTEGER,
          reasons TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE discovery_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          fetched_count INTEGER NOT NULL DEFAULT 0,
          kept_count INTEGER NOT NULL DEFAULT 0,
          duplicate_count INTEGER NOT NULL DEFAULT 0,
          rejected_count INTEGER NOT NULL DEFAULT 0,
          cost_estimate REAL,
          error TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT
        );
        CREATE TABLE feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          lead_id INTEGER NOT NULL,
          good INTEGER NOT NULL,
          notes TEXT,
          reviewed_by TEXT,
          source TEXT NOT NULL DEFAULT 'dashboard',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      legacy
        .prepare(`INSERT INTO projects (name) VALUES ('Legacy Co')`)
        .run();
      legacy.close();

      const db = openDatabase(path);
      const cols = db
        .prepare("PRAGMA table_info(leads)")
        .all() as Array<{ name: string }>;
      expect(cols.some((c) => c.name === "lead_list_id")).toBe(true);

      const lists = db
        .prepare("SELECT * FROM lead_lists WHERE project_id = 1")
        .all();
      expect(lists.length).toBeGreaterThanOrEqual(1);

      const project = db
        .prepare("SELECT active_lead_list_id FROM projects WHERE id = 1")
        .get() as { active_lead_list_id: number | null };
      expect(project.active_lead_list_id).toBeTruthy();
      db.close();
    } finally {
      try {
        rmSync(path, { force: true });
        rmSync(`${path}-wal`, { force: true });
        rmSync(`${path}-shm`, { force: true });
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may briefly lock WAL files after close.
      }
    }
  });

  it("backfills projects.lead_plan onto default lead list", () => {
    const dir = mkdtempSync(join(tmpdir(), "leadradar-plan-backfill-"));
    const path = join(dir, "backfill.db");
    const planJson = JSON.stringify({
      version: 1,
      mode: "agency",
      goal: "legacy project plan goal",
      geography: null,
      volumeTarget: 100,
      intents: ["new_startup"],
      searchAngles: ["legacy angle"],
      negatives: [],
      status: "auto",
      feedbackNotes: null,
      generatedBy: "fallback",
      updatedAt: "2026-07-11T00:00:00.000Z",
    });
    try {
      const legacy = new DatabaseSync(path);
      legacy.exec(`
        CREATE TABLE projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          lead_plan TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE lead_lists (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      legacy
        .prepare(`INSERT INTO projects (name, lead_plan) VALUES ('Co', ?)`)
        .run(planJson);
      legacy
        .prepare(`INSERT INTO lead_lists (project_id, name) VALUES (1, 'Default')`)
        .run();
      legacy.close();

      const db = openDatabase(path);
      const row = db
        .prepare(`SELECT lead_plan FROM lead_lists WHERE project_id = 1`)
        .get() as { lead_plan: string };
      expect(JSON.parse(row.lead_plan).goal).toBe("legacy project plan goal");
      db.close();
    } finally {
      try {
        rmSync(path, { force: true });
        rmSync(`${path}-wal`, { force: true });
        rmSync(`${path}-shm`, { force: true });
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may briefly lock WAL files after close.
      }
    }
  });
});
