import type { DB } from "../db/database.js";
import { getLead } from "../leads/leads.repo.js";
import { appendLeadListNegatives } from "../leads/lead-lists.repo.js";
import type { FeedbackRag } from "../rag/feedback-rag.js";
import { FileFeedbackRag } from "../rag/file-feedback-rag.js";
import { syncFeedbackToRag } from "../rag/sync-feedback.js";
import { hostnameOf } from "../discovery/hard-shield.js";

export interface NewFeedback {
  projectId: number;
  leadId: number;
  leadListId?: number | null;
  good: boolean;
  notes: string | null;
  reviewedBy: string | null;
  source: "dashboard" | "telegram";
}

export interface FeedbackStats {
  total: number;
  good: number;
  bad: number;
  approvalRate: number; // 0–1, 0 if total=0
}

export interface RecordFeedbackOptions {
  /** Inject RAG store; pass null to skip sync. Default: FileFeedbackRag unless RAG_SYNC=0. */
  rag?: FeedbackRag | null;
}

let defaultRag: FeedbackRag | null | undefined;

function resolveRag(options?: RecordFeedbackOptions): FeedbackRag | null {
  if (options && "rag" in options) {
    return options.rag ?? null;
  }
  if (process.env.RAG_SYNC === "0") return null;
  if (defaultRag === undefined) {
    defaultRag = new FileFeedbackRag(process.env.RAG_DIR ?? "data/rag");
  }
  return defaultRag;
}

/** Test helper to reset the cached default RAG instance. */
export function resetDefaultFeedbackRag(): void {
  defaultRag = undefined;
}

export function recordFeedback(
  db: DB,
  input: NewFeedback,
  options?: RecordFeedbackOptions
): void {
  const lead = getLead(db, input.projectId, input.leadId);
  if (!lead) {
    throw new Error(`lead ${input.leadId} not found in project ${input.projectId}`);
  }
  db.prepare(
    `INSERT INTO feedback (project_id, lead_id, lead_list_id, good, notes, reviewed_by, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.projectId,
    input.leadId,
    input.leadListId ?? lead.leadListId ?? null,
    input.good ? 1 : 0,
    input.notes,
    input.reviewedBy,
    input.source
  );
  // Also flip lead status for convenience
  db.prepare(
    `UPDATE leads SET status = ? WHERE project_id = ? AND id = ?`
  ).run(input.good ? "approved" : "rejected", input.projectId, input.leadId);

  // Reject → filter flywheel: append domain / note tokens to list plan negatives
  if (!input.good) {
    const listId = input.leadListId ?? lead.leadListId;
    if (listId) {
      const tokens: string[] = [];
      const domain =
        lead.canonicalDomain ?? hostnameOf(lead.website);
      if (domain) tokens.push(domain);
      if (input.notes?.trim()) {
        for (const part of input.notes.split(/[,;\n]+/)) {
          const t = part.trim().toLowerCase().replace(/^(avoid|no)\s+/, "");
          if (t.length >= 3) tokens.push(t);
        }
      }
      try {
        appendLeadListNegatives(db, listId, tokens);
      } catch {
        // Best-effort: feedback row is source of truth
      }
    }
  }

  const rag = resolveRag(options);
  if (rag) {
    try {
      syncFeedbackToRag(db, rag, input.projectId, input.leadId);
    } catch {
      // Best-effort: SQLite feedback is source of truth; RAG is derived.
    }
  }
}

export function getFeedbackStats(
  db: DB,
  projectId: number,
  leadListId?: number
): FeedbackStats {
  const row = (
    leadListId != null
      ? db.prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN good = 1 THEN 1 ELSE 0 END) AS good,
             SUM(CASE WHEN good = 0 THEN 1 ELSE 0 END) AS bad
           FROM feedback WHERE project_id = ? AND lead_list_id = ?`
        ).get(projectId, leadListId)
      : db.prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN good = 1 THEN 1 ELSE 0 END) AS good,
             SUM(CASE WHEN good = 0 THEN 1 ELSE 0 END) AS bad
           FROM feedback WHERE project_id = ?`
        ).get(projectId)
  ) as { total: number; good: number | null; bad: number | null };
  const total = Number(row.total) || 0;
  const good = Number(row.good) || 0;
  const bad = Number(row.bad) || 0;
  return { total, good, bad, approvalRate: total === 0 ? 0 : good / total };
}
