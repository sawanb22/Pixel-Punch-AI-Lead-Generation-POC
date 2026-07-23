import type { DB } from "../db/database.js";
import type { Project } from "../domain/types.js";
import {
  defaultLeadStrategy,
  serializeLeadStrategy,
} from "../discovery/lead-strategy.js";
import { ensureDefaultLeadList } from "../leads/lead-lists.repo.js";

export interface NewProject {
  name: string;
  website?: string | null;
  description?: string | null;
  icp?: string | null;
  sourceConfig?: string | null;
  leadPlan?: string | null;
  leadStrategy?: string | null;
  websiteSummary?: string | null;
  websiteSummaryAt?: string | null;
}

interface ProjectRow {
  id: number;
  name: string;
  website: string | null;
  description: string | null;
  icp: string | null;
  source_config: string | null;
  lead_plan?: string | null;
  lead_strategy?: string | null;
  website_summary?: string | null;
  website_summary_at?: string | null;
  active_lead_list_id?: number | null;
  status: string;
  created_at: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    website: row.website,
    description: row.description,
    icp: row.icp,
    sourceConfig: row.source_config,
    leadPlan: row.lead_plan ?? null,
    leadStrategy: row.lead_strategy ?? null,
    websiteSummary: row.website_summary ?? null,
    websiteSummaryAt: row.website_summary_at ?? null,
    activeLeadListId: row.active_lead_list_id ?? null,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function createProject(db: DB, input: NewProject): Project {
  const strategy =
    input.leadStrategy ??
    serializeLeadStrategy(defaultLeadStrategy());
  const result = db
    .prepare(
      `INSERT INTO projects
         (name, website, description, icp, source_config, lead_plan, lead_strategy,
          website_summary, website_summary_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.name,
      input.website ?? null,
      input.description ?? null,
      input.icp ?? null,
      input.sourceConfig ?? null,
      input.leadPlan ?? null,
      strategy,
      input.websiteSummary ?? null,
      input.websiteSummaryAt ?? null
    );
  const id = Number(result.lastInsertRowid);
  ensureDefaultLeadList(db, id);
  return getProject(db, id)!;
}

export function getProject(db: DB, id: number): Project | undefined {
  const row = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(id) as ProjectRow | undefined;
  return row ? toProject(row) : undefined;
}

export function listProjects(db: DB): Project[] {
  const rows = db
    .prepare("SELECT * FROM projects ORDER BY id")
    .all() as unknown as ProjectRow[];
  return rows.map(toProject);
}

export interface UpdateProjectInput {
  name?: string;
  website?: string | null;
  description?: string | null;
  icp?: string | null;
  sourceConfig?: string | null;
  leadPlan?: string | null;
  leadStrategy?: string | null;
  websiteSummary?: string | null;
  websiteSummaryAt?: string | null;
  activeLeadListId?: number | null;
}

export function updateProject(
  db: DB,
  id: number,
  input: UpdateProjectInput
): Project | undefined {
  const existing = getProject(db, id);
  if (!existing) return undefined;

  db.prepare(
    `UPDATE projects
     SET name = ?, website = ?, description = ?, icp = ?, source_config = ?,
         lead_plan = ?, lead_strategy = ?, website_summary = ?,
         website_summary_at = ?, active_lead_list_id = ?
     WHERE id = ?`
  ).run(
    input.name !== undefined ? input.name : existing.name,
    input.website !== undefined ? input.website : existing.website,
    input.description !== undefined ? input.description : existing.description,
    input.icp !== undefined ? input.icp : existing.icp,
    input.sourceConfig !== undefined
      ? input.sourceConfig
      : existing.sourceConfig,
    input.leadPlan !== undefined ? input.leadPlan : existing.leadPlan,
    input.leadStrategy !== undefined
      ? input.leadStrategy
      : existing.leadStrategy,
    input.websiteSummary !== undefined
      ? input.websiteSummary
      : existing.websiteSummary,
    input.websiteSummaryAt !== undefined
      ? input.websiteSummaryAt
      : existing.websiteSummaryAt,
    input.activeLeadListId !== undefined
      ? input.activeLeadListId
      : existing.activeLeadListId,
    id
  );
  return getProject(db, id);
}

export function deleteProject(db: DB, id: number): void {
  const existing = getProject(db, id);
  if (!existing) {
    throw new Error("project not found");
  }

  const discoveryRunIds = (
    db
      .prepare(`SELECT id FROM discovery_runs WHERE project_id = ?`)
      .all(id) as Array<{ id: number }>
  ).map((r) => r.id);

  const enrichmentRunIds = (
    db
      .prepare(`SELECT id FROM company_enrichment_runs WHERE project_id = ?`)
      .all(id) as Array<{ id: number }>
  ).map((r) => r.id);

  const opsRunIds = (
    db
      .prepare(`SELECT id FROM operations_runs WHERE project_id = ?`)
      .all(id) as Array<{ id: number }>
  ).map((r) => r.id);

  db.exec("BEGIN");
  try {
    db.prepare(`UPDATE projects SET active_lead_list_id = NULL WHERE id = ?`).run(
      id
    );

    for (const runId of opsRunIds) {
      db.prepare(`DELETE FROM operations_logs WHERE run_id = ?`).run(runId);
    }
    db.prepare(`DELETE FROM operations_runs WHERE project_id = ?`).run(id);

    for (const runId of discoveryRunIds) {
      db.prepare(`DELETE FROM discovered_candidates WHERE run_id = ?`).run(
        runId
      );
      db.prepare(`DELETE FROM discovery_source_jobs WHERE run_id = ?`).run(
        runId
      );
    }
    db.prepare(`DELETE FROM discovery_runs WHERE project_id = ?`).run(id);

    for (const runId of enrichmentRunIds) {
      db.prepare(`DELETE FROM company_pages WHERE run_id = ?`).run(runId);
      db.prepare(`DELETE FROM company_enrichment_jobs WHERE run_id = ?`).run(
        runId
      );
    }
    db.prepare(`DELETE FROM company_enrichment_runs WHERE project_id = ?`).run(
      id
    );

    db.prepare(`DELETE FROM contacts WHERE project_id = ?`).run(id);
    db.prepare(`DELETE FROM feedback WHERE project_id = ?`).run(id);
    db.prepare(`DELETE FROM leads WHERE project_id = ?`).run(id);
    db.prepare(`DELETE FROM lead_lists WHERE project_id = ?`).run(id);
    db.prepare(`DELETE FROM company_evidence WHERE project_id = ?`).run(id);
    db.prepare(`DELETE FROM company_profiles WHERE project_id = ?`).run(id);
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
