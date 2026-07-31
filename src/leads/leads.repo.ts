import type { DB } from "../db/database.js";
import type { Lead } from "../domain/types.js";
import type { DedupedLead } from "../validation/dedup.js";

interface LeadRow {
  id: number;
  project_id: number;
  lead_list_id?: number | null;
  company: string;
  website: string | null;
  canonical_domain: string | null;
  email: string | null;
  votes: number | null;
  sources: string;
  status: string;
  score: number | null;
  reasons: string | null;
  created_at: string;
}

function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    projectId: row.project_id,
    leadListId: row.lead_list_id ?? null,
    company: row.company,
    website: row.website,
    canonicalDomain: row.canonical_domain,
    email: row.email,
    votes: row.votes,
    source: JSON.parse(row.sources)[0] ?? "unknown",
    sources: JSON.parse(row.sources),
    status: row.status as Lead["status"],
    score: row.score,
    reasons: row.reasons,
    createdAt: row.created_at,
  };
}

/** Inserts leads for a project (optionally scoped to a lead list). */
export function insertLeads(
  db: DB,
  projectId: number,
  leads: DedupedLead[],
  leadListId?: number | null,
  status: Lead["status"] = "gated"
): void {
  let listId = leadListId;
  if (listId === undefined) {
    const row = db
      .prepare("SELECT active_lead_list_id FROM projects WHERE id = ?")
      .get(projectId) as { active_lead_list_id: number | null } | undefined;
    listId = row?.active_lead_list_id ?? null;
  }
  const stmt = db.prepare(
    `INSERT INTO leads
       (project_id, lead_list_id, company, website, canonical_domain, email, votes, sources, status)
     VALUES
       (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.exec("BEGIN");
  try {
    for (const lead of leads) {
      stmt.run(
        projectId,
        listId ?? null,
        lead.company,
        lead.website,
        lead.canonicalDomain,
        lead.email,
        lead.votes,
        JSON.stringify(lead.sources),
        status
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function setLeadStatus(
  db: DB,
  projectId: number,
  leadId: number,
  status: Lead["status"]
): Lead | undefined {
  const existing = getLead(db, projectId, leadId);
  if (!existing) return undefined;
  db.prepare(
    `UPDATE leads SET status = ? WHERE project_id = ? AND id = ?`
  ).run(status, projectId, leadId);
  return getLead(db, projectId, leadId);
}

export function setLeadPipelineStatus(
  db: DB,
  projectId: number,
  leadId: number,
  status: Lead["status"]
): Lead | undefined {
  return setLeadStatus(db, projectId, leadId, status);
}

export function listLeads(
  db: DB,
  projectId: number,
  leadListId?: number | null
): Lead[] {
  if (leadListId != null) {
    const rows = db
      .prepare(
        `SELECT * FROM leads
         WHERE project_id = ? AND lead_list_id = ?
         ORDER BY id`
      )
      .all(projectId, leadListId) as unknown as LeadRow[];
    return rows.map(toLead);
  }
  const rows = db
    .prepare("SELECT * FROM leads WHERE project_id = ? ORDER BY id")
    .all(projectId) as unknown as LeadRow[];
  return rows.map(toLead);
}

export function listGatedLeads(
  db: DB,
  projectId: number,
  leadListId?: number | null
): Lead[] {
  if (leadListId != null) {
    const rows = db
      .prepare(
        `SELECT * FROM leads
         WHERE project_id = ? AND lead_list_id = ? AND status NOT IN ('approved', 'rejected', 'scored')
         ORDER BY id`
      )
      .all(projectId, leadListId) as unknown as LeadRow[];
    return rows.map(toLead);
  }
  const rows = db
    .prepare(
      "SELECT * FROM leads WHERE project_id = ? AND status NOT IN ('approved', 'rejected', 'scored') ORDER BY id"
    )
    .all(projectId) as unknown as LeadRow[];
  return rows.map(toLead);
}

export function getLead(
  db: DB,
  projectId: number,
  leadId: number
): Lead | undefined {
  const row = db
    .prepare("SELECT * FROM leads WHERE project_id = ? AND id = ?")
    .get(projectId, leadId) as unknown as LeadRow | undefined;
  return row ? toLead(row) : undefined;
}

export function saveScore(
  db: DB,
  projectId: number,
  leadId: number,
  score: number,
  reasons: string,
  draft?: string | null
): Lead {
  if (score < 0 || score > 100 || !Number.isFinite(score)) {
    throw new Error("score must be 0–100");
  }
  const existing = getLead(db, projectId, leadId);
  if (!existing)
    throw new Error(`lead ${leadId} not found in project ${projectId}`);
  void draft;
  db.prepare(
    `UPDATE leads SET score = ?, reasons = ?, status = 'scored' WHERE project_id = ? AND id = ?`
  ).run(Math.round(score), reasons, projectId, leadId);
  return getLead(db, projectId, leadId)!;
}

/** Set email only when the lead currently has none. Returns updated lead or undefined if unchanged/missing. */
export function setLeadEmailIfEmpty(
  db: DB,
  projectId: number,
  leadId: number,
  email: string
): Lead | undefined {
  const existing = getLead(db, projectId, leadId);
  if (!existing) return undefined;
  if (existing.email?.trim()) return existing;
  const cleaned = email.trim();
  if (!cleaned) return existing;
  db.prepare(
    `UPDATE leads SET email = ? WHERE project_id = ? AND id = ? AND (email IS NULL OR email = '')`
  ).run(cleaned, projectId, leadId);
  return getLead(db, projectId, leadId);
}

export interface LeadFilter {
  status?: string;
  minScore?: number;
  source?: string;
  q?: string;
  leadListId?: number | null;
}

export function listLeadsFiltered(
  db: DB,
  projectId: number,
  filter: LeadFilter = {}
): Lead[] {
  const clauses = ["project_id = ?"];
  const params: (string | number)[] = [projectId];

  if (filter.leadListId != null) {
    clauses.push("lead_list_id = ?");
    params.push(filter.leadListId);
  }
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  if (filter.minScore !== undefined) {
    clauses.push("score >= ?");
    params.push(filter.minScore);
  }
  if (filter.q) {
    clauses.push("company LIKE ?");
    params.push(`%${filter.q}%`);
  }
  if (filter.source) {
    clauses.push("sources LIKE ?");
    params.push(`%"${filter.source}"%`);
  }

  const sql = `SELECT * FROM leads WHERE ${clauses.join(" AND ")} ORDER BY score DESC NULLS LAST, id`;
  const rows = db.prepare(sql).all(...params) as unknown as LeadRow[];
  return rows.map(toLead);
}
