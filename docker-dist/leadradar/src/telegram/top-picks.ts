import type { DB } from "../db/database.js";
import type { Lead, Project } from "../domain/types.js";

export interface ClarifyMessage {
  text: string;
  choices: ["Good", "Bad"];
  leadId: number;
  projectId: number;
}

interface LeadRow {
  id: number;
  project_id: number;
  lead_list_id: number | null;
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
    leadListId: row.lead_list_id,
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

/** Highest-scored leads still awaiting feedback (status=scored). */
export function selectTopPicks(
  db: DB,
  projectId: number,
  limit = 5
): Lead[] {
  const rows = db
    .prepare(
      `SELECT * FROM leads
       WHERE project_id = ? AND status = 'scored'
       ORDER BY score DESC, id
       LIMIT ?`
    )
    .all(projectId, limit) as unknown as LeadRow[];
  return rows.map(toLead);
}

/** Hermes clarify payload: message text + Good/Bad choices. */
export function formatClarifyMessage(
  lead: Lead,
  project: Project
): ClarifyMessage {
  const website = lead.website?.trim() || "(none)";
  const reasons = lead.reasons?.trim() || "(none)";
  const score = lead.score ?? "?";
  const text = [
    `Top pick for ${project.name}`,
    `Company: ${lead.company}`,
    `Website: ${website}`,
    `Score: ${score}`,
    `Reasons: ${reasons}`,
    `Lead #${lead.id} (project ${project.id})`,
    "",
    "Is this a good lead?",
  ].join("\n");

  return {
    text,
    choices: ["Good", "Bad"],
    leadId: lead.id,
    projectId: project.id,
  };
}
