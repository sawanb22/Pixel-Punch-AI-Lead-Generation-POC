import type { DB } from "../db/database.js";
import {
  parseLeadPlan,
  serializeLeadPlan,
  type LeadPlan,
} from "../discovery/lead-plan.js";

export interface LeadList {
  id: number;
  projectId: number;
  name: string;
  description: string | null;
  createdAt: string;
  leadCount?: number;
  leadPlan?: string | null;
  huntConfig?: string | null;
}

interface LeadListRow {
  id: number;
  project_id: number;
  name: string;
  description: string | null;
  lead_plan?: string | null;
  hunt_config?: string | null;
  created_at: string;
}

export function deriveListFocus(list: {
  name: string;
  description?: string | null;
}): string {
  const name = list.name.trim();
  const desc = list.description?.trim();
  if (name && desc) return `${name} — ${desc}`;
  return name || desc || "";
}

function toLeadList(row: LeadListRow, leadCount?: number): LeadList {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    leadPlan: row.lead_plan ?? null,
    huntConfig: row.hunt_config ?? null,
    leadCount,
  };
}

export function getLeadListPlan(db: DB, listId: number): LeadPlan | null {
  const row = db
    .prepare("SELECT lead_plan FROM lead_lists WHERE id = ?")
    .get(listId) as { lead_plan: string | null } | undefined;
  if (!row) return null;
  return parseLeadPlan(row.lead_plan);
}

export function getLeadListPlanContextHash(
  db: DB,
  listId: number
): string | null {
  const row = db
    .prepare("SELECT plan_context_hash FROM lead_lists WHERE id = ?")
    .get(listId) as { plan_context_hash: string | null } | undefined;
  return row?.plan_context_hash ?? null;
}

export function updateLeadListPlanContextHash(
  db: DB,
  listId: number,
  hash: string
): void {
  db.prepare(
    `UPDATE lead_lists SET plan_context_hash = ? WHERE id = ?`
  ).run(hash, listId);
}

export function getLeadListPlanUpdatedAt(
  db: DB,
  listId: number
): string | null {
  const row = db
    .prepare("SELECT plan_updated_at FROM lead_lists WHERE id = ?")
    .get(listId) as { plan_updated_at: string | null } | undefined;
  return row?.plan_updated_at ?? null;
}

export function updateLeadListPlan(
  db: DB,
  listId: number,
  leadPlanJson: string,
  planContextHash?: string | null
): void {
  if (planContextHash != null) {
    db.prepare(
      `UPDATE lead_lists SET lead_plan = ?, plan_updated_at = datetime('now'), plan_context_hash = ? WHERE id = ?`
    ).run(leadPlanJson, planContextHash, listId);
    return;
  }
  db.prepare(
    `UPDATE lead_lists SET lead_plan = ?, plan_updated_at = datetime('now') WHERE id = ?`
  ).run(leadPlanJson, listId);
}

export function getLeadListPayloadJson(
  db: DB,
  listId: number
): string | null {
  const row = db
    .prepare("SELECT payload_json FROM lead_lists WHERE id = ?")
    .get(listId) as { payload_json: string | null } | undefined;
  return row?.payload_json ?? null;
}

export function getLeadListCompiledJobsJson(
  db: DB,
  listId: number
): string | null {
  const row = db
    .prepare("SELECT compiled_jobs_json FROM lead_lists WHERE id = ?")
    .get(listId) as { compiled_jobs_json: string | null } | undefined;
  return row?.compiled_jobs_json ?? null;
}

/** Append unique negative tokens to the list's lead plan (reject → filter flywheel). */
export function appendLeadListNegatives(
  db: DB,
  listId: number,
  tokens: string[]
): LeadPlan | null {
  const plan = getLeadListPlan(db, listId);
  if (!plan) return null;
  const existing = new Set(plan.negatives.map((n) => n.toLowerCase()));
  const added: string[] = [];
  for (const raw of tokens) {
    const t = raw.trim().toLowerCase();
    if (t.length < 3 || existing.has(t)) continue;
    existing.add(t);
    added.push(t);
  }
  if (!added.length) return plan;
  const updated: LeadPlan = {
    ...plan,
    negatives: [...plan.negatives, ...added],
    updatedAt: new Date().toISOString(),
  };
  updateLeadListPlan(db, listId, serializeLeadPlan(updated));
  return updated;
}

export function updateLeadListPayload(
  db: DB,
  listId: number,
  input: {
    payloadJson: string;
    compiledJobsJson?: string | null;
  }
): void {
  db.prepare(
    `UPDATE lead_lists
     SET payload_json = ?,
         compiled_jobs_json = COALESCE(?, compiled_jobs_json),
         plan_updated_at = datetime('now')
     WHERE id = ?`
  ).run(input.payloadJson, input.compiledJobsJson ?? null, listId);
}

export function saveLeadListPlanArtifacts(
  db: DB,
  listId: number,
  input: {
    leadPlanJson: string;
    payloadJson: string;
    compiledJobsJson?: string | null;
    planContextHash?: string | null;
  }
): void {
  db.prepare(
    `UPDATE lead_lists
     SET lead_plan = ?,
         payload_json = ?,
         compiled_jobs_json = COALESCE(?, compiled_jobs_json),
         plan_updated_at = datetime('now'),
         plan_context_hash = COALESCE(?, plan_context_hash)
     WHERE id = ?`
  ).run(
    input.leadPlanJson,
    input.payloadJson,
    input.compiledJobsJson ?? null,
    input.planContextHash ?? null,
    listId
  );
}

export function createLeadList(
  db: DB,
  input: {
    projectId: number;
    name: string;
    description?: string | null;
    huntConfig?: string | null;
  }
): LeadList {
  const name = input.name.trim();
  if (!name) throw new Error("lead list name is required");
  const result = db
    .prepare(
      `INSERT INTO lead_lists (project_id, name, description, hunt_config)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      input.projectId,
      name,
      input.description ?? null,
      input.huntConfig ?? null
    );
  return getLeadList(db, Number(result.lastInsertRowid))!;
}

export function getLeadList(db: DB, id: number): LeadList | undefined {
  const row = db
    .prepare("SELECT * FROM lead_lists WHERE id = ?")
    .get(id) as LeadListRow | undefined;
  return row ? toLeadList(row) : undefined;
}

export function listLeadLists(db: DB, projectId: number): LeadList[] {
  const rows = db
    .prepare(
      `SELECT ll.*,
              (SELECT COUNT(*) FROM leads l
               WHERE l.lead_list_id = ll.id) AS lead_count
       FROM lead_lists ll
       WHERE ll.project_id = ?
       ORDER BY ll.id`
    )
    .all(projectId) as unknown as Array<LeadListRow & { lead_count: number }>;
  return rows.map((r) => toLeadList(r, Number(r.lead_count)));
}

export function ensureDefaultLeadList(db: DB, projectId: number): LeadList {
  const lists = listLeadLists(db, projectId);
  let defaultList = lists.find((l) => l.name === "Default");
  if (!defaultList) {
    if (lists.length === 0) {
      defaultList = createLeadList(db, {
        projectId,
        name: "Default",
      });
    } else {
      defaultList = lists[0];
    }
  }
  const active = db
    .prepare("SELECT active_lead_list_id FROM projects WHERE id = ?")
    .get(projectId) as { active_lead_list_id: number | null } | undefined;
  if (!active?.active_lead_list_id) {
    db.prepare(
      `UPDATE projects SET active_lead_list_id = ? WHERE id = ?`
    ).run(defaultList.id, projectId);
  }
  return defaultList;
}

export function updateLeadList(
  db: DB,
  projectId: number,
  listId: number,
  input: {
    name?: string;
    description?: string | null;
    huntConfig?: string | null;
  }
): LeadList | undefined {
  const existing = getLeadList(db, listId);
  if (!existing || existing.projectId !== projectId) return undefined;
  db.prepare(
    `UPDATE lead_lists SET name = ?, description = ?, hunt_config = ? WHERE id = ? AND project_id = ?`
  ).run(
    input.name !== undefined ? input.name.trim() : existing.name,
    input.description !== undefined ? input.description : existing.description,
    input.huntConfig !== undefined ? input.huntConfig : (existing.huntConfig ?? null),
    listId,
    projectId
  );
  return getLeadList(db, listId);
}

export function activateLeadList(
  db: DB,
  projectId: number,
  listId: number
): LeadList | undefined {
  const list = getLeadList(db, listId);
  if (!list || list.projectId !== projectId) return undefined;
  db.prepare(
    `UPDATE projects SET active_lead_list_id = ? WHERE id = ?`
  ).run(listId, projectId);
  return list;
}

export function getActiveLeadListId(
  db: DB,
  projectId: number
): number {
  const row = db
    .prepare("SELECT active_lead_list_id FROM projects WHERE id = ?")
    .get(projectId) as { active_lead_list_id: number | null } | undefined;
  if (row?.active_lead_list_id) {
    const list = getLeadList(db, row.active_lead_list_id);
    if (list && list.projectId === projectId) return list.id;
  }
  return ensureDefaultLeadList(db, projectId).id;
}

export function clearLeadList(
  db: DB,
  projectId: number,
  listId: number
): { deletedLeads: number; deletedRuns: number } {
  const list = getLeadList(db, listId);
  if (!list || list.projectId !== projectId) {
    throw new Error("lead list not found");
  }

  const runIds = (
    db
      .prepare(
        `SELECT id FROM discovery_runs WHERE project_id = ? AND lead_list_id = ?`
      )
      .all(projectId, listId) as Array<{ id: number }>
  ).map((r) => r.id);

  db.exec("BEGIN");
  try {
    db.prepare(
      `DELETE FROM contacts WHERE lead_id IN (SELECT id FROM leads WHERE project_id = ? AND lead_list_id = ?)`
    ).run(projectId, listId);
    db.prepare(
      `DELETE FROM feedback WHERE project_id = ? AND lead_list_id = ?`
    ).run(projectId, listId);
    const leadResult = db
      .prepare(
        `DELETE FROM leads WHERE project_id = ? AND lead_list_id = ?`
      )
      .run(projectId, listId);

    for (const runId of runIds) {
      db.prepare(
        `DELETE FROM discovered_candidates WHERE run_id = ?`
      ).run(runId);
      db.prepare(
        `DELETE FROM discovery_source_jobs WHERE run_id = ?`
      ).run(runId);
    }
    const runResult = db
      .prepare(
        `DELETE FROM discovery_runs WHERE project_id = ? AND lead_list_id = ?`
      )
      .run(projectId, listId);
    db.exec("COMMIT");
    return {
      deletedLeads: Number(leadResult.changes ?? 0),
      deletedRuns: Number(runResult.changes ?? 0),
    };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function deleteLeadList(
  db: DB,
  projectId: number,
  listId: number
): void {
  const list = getLeadList(db, listId);
  if (!list || list.projectId !== projectId) throw new Error("lead list not found");

  clearLeadList(db, projectId, listId);
  const activeId = getActiveLeadListId(db, projectId);
  db.prepare(`DELETE FROM lead_lists WHERE id = ? AND project_id = ?`).run(
    listId,
    projectId
  );
  const remaining = listLeadLists(db, projectId);
  if (remaining.length === 0) {
    ensureDefaultLeadList(db, projectId);
  } else if (activeId === listId) {
    activateLeadList(db, projectId, remaining[0].id);
  }
}
