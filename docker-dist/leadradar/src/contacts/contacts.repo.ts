import type { DB } from "../db/database.js";
import type { Contact, NewContact } from "./types.js";

interface ContactRow {
  id: number;
  project_id: number;
  lead_id: number;
  domain: string;
  full_name: string;
  title: string | null;
  linkedin_url: string | null;
  email: string | null;
  confidence: number;
  source: string;
  created_at: string;
}

function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    projectId: row.project_id,
    leadId: row.lead_id,
    domain: row.domain,
    fullName: row.full_name,
    title: row.title,
    linkedinUrl: row.linkedin_url,
    email: row.email,
    confidence: row.confidence,
    source: row.source,
    createdAt: row.created_at,
  };
}

export function insertContact(db: DB, contact: NewContact): Contact {
  const result = db
    .prepare(
      `INSERT INTO contacts
         (project_id, lead_id, domain, full_name, title, linkedin_url, email, confidence, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`
    )
    .get(
      contact.projectId,
      contact.leadId,
      contact.domain,
      contact.fullName,
      contact.title ?? null,
      contact.linkedinUrl ?? null,
      contact.email ?? null,
      contact.confidence ?? 0,
      contact.source ?? "linkedin"
    ) as unknown as ContactRow;
  return toContact(result);
}

export function listContactsForLead(db: DB, leadId: number): Contact[] {
  const rows = db
    .prepare(
      `SELECT * FROM contacts WHERE lead_id = ? ORDER BY confidence DESC, id ASC`
    )
    .all(leadId) as unknown as ContactRow[];
  return rows.map(toContact);
}

export function listContactsForProject(
  db: DB,
  projectId: number,
  limit = 500
): Contact[] {
  const rows = db
    .prepare(
      `SELECT * FROM contacts WHERE project_id = ? ORDER BY confidence DESC, id ASC LIMIT ?`
    )
    .all(projectId, limit) as unknown as ContactRow[];
  return rows.map(toContact);
}

export function countContactsForProject(db: DB, projectId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM contacts WHERE project_id = ?`)
    .get(projectId) as { n: number };
  return row.n;
}

export function deleteContactsForLead(db: DB, leadId: number): void {
  db.prepare(`DELETE FROM contacts WHERE lead_id = ?`).run(leadId);
}

/** How many contacts exist per lead — returns a map of leadId → count. */
export function contactCountsByLead(
  db: DB,
  projectId: number,
  leadIds: number[]
): Map<number, number> {
  const map = new Map<number, number>();
  if (leadIds.length === 0) return map;

  const placeholders = leadIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT lead_id, COUNT(*) AS n FROM contacts
       WHERE project_id = ? AND lead_id IN (${placeholders})
       GROUP BY lead_id`
    )
    .all(projectId, ...leadIds) as Array<{ lead_id: number; n: number }>;

  for (const row of rows) {
    map.set(row.lead_id, row.n);
  }
  return map;
}
