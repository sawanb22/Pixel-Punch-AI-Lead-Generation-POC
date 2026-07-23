import type { DB } from "../db/database.js";
import { getLead } from "../leads/leads.repo.js";
import type { FeedbackRag } from "./feedback-rag.js";
import type { FeedbackDoc } from "./types.js";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

interface FeedbackRow {
  good: number;
  notes: string | null;
}

function buildDocText(parts: {
  company: string;
  website: string | null;
  email: string | null;
  score: number | null;
  good: boolean;
  notes: string | null;
}): string {
  return [
    parts.company,
    parts.website ?? "",
    parts.email ?? "",
    parts.score !== null ? `score ${parts.score}` : "",
    parts.good ? "good approved" : "bad rejected",
    parts.notes ?? "",
  ]
    .filter((p) => p.length > 0)
    .join(" ");
}

function latestFeedback(
  db: DB,
  projectId: number,
  leadId: number
): FeedbackRow | undefined {
  return db
    .prepare(
      `SELECT good, notes FROM feedback
       WHERE project_id = ? AND lead_id = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(projectId, leadId) as FeedbackRow | undefined;
}

export function leadFeedbackToDoc(
  db: DB,
  projectId: number,
  leadId: number
): FeedbackDoc | null {
  const lead = getLead(db, projectId, leadId);
  if (!lead) return null;
  const fb = latestFeedback(db, projectId, leadId);
  if (!fb) return null;
  const good = Boolean(fb.good);
  const notes = fb.notes;
  return {
    projectId,
    leadId,
    company: lead.company,
    website: lead.website,
    email: lead.email,
    score: lead.score,
    good,
    notes,
    text: buildDocText({
      company: lead.company,
      website: lead.website,
      email: lead.email,
      score: lead.score,
      good,
      notes,
    }),
  };
}

/** Best-effort: push project corpus into Hermes knowledge_base when enabled. */
export function maybeHermesDocsSync(projectId: number): void {
  if (process.env.HERMES_DOCS_SYNC !== "1") return;
  const dir = join(process.env.RAG_DIR ?? "data/rag", `project_${projectId}`);
  try {
    execFileSync("hermes", ["docs", "add", dir], { stdio: "ignore" });
  } catch {
    // Hermes may be missing; RAG file corpus remains valid.
  }
}

/** Load lead + latest feedback and upsert into the RAG store. */
export function syncFeedbackToRag(
  db: DB,
  rag: FeedbackRag,
  projectId: number,
  leadId: number
): void {
  const doc = leadFeedbackToDoc(db, projectId, leadId);
  if (!doc) return;
  rag.upsert(doc);
  maybeHermesDocsSync(projectId);
}

/**
 * Clear the project corpus and re-upsert one doc per lead that has feedback
 * (using the latest feedback row for that lead).
 */
export function rebuildProjectRag(db: DB, rag: FeedbackRag, projectId: number): void {
  rag.clearProject(projectId);
  const rows = db
    .prepare(
      `SELECT DISTINCT lead_id AS leadId FROM feedback WHERE project_id = ? ORDER BY lead_id`
    )
    .all(projectId) as Array<{ leadId: number }>;
  for (const row of rows) {
    syncFeedbackToRag(db, rag, projectId, row.leadId);
  }
}
