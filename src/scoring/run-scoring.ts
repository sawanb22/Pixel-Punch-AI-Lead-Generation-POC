import type { DB } from "../db/database.js";
import { getProject } from "../projects/projects.repo.js";
import { listGatedLeads, saveScore, setLeadPipelineStatus } from "../leads/leads.repo.js";
import { getActiveLeadListId } from "../leads/lead-lists.repo.js";
import type { FeedbackRag } from "../rag/feedback-rag.js";
import { FileFeedbackRag } from "../rag/file-feedback-rag.js";
import type { Scorer } from "./scorer.js";
import { withRetry } from "../utils/with-retry.js";

export interface ScoringSummary {
  scored: number;
  skipped: number;
  errors: number;
  errorMessages: string[];
}

export interface RunScoringOptions {
  rag?: FeedbackRag | null;
  similarK?: number;
  leadListId?: number;
  onProgress?: (message: string, level?: "info" | "warning" | "error") => void;
}

function resolveRag(options?: RunScoringOptions): FeedbackRag | null {
  if (options && "rag" in options) {
    return options.rag ?? null;
  }
  if (process.env.RAG_SYNC === "0") return null;
  return new FileFeedbackRag(process.env.RAG_DIR ?? "data/rag");
}

export async function runScoring(
  db: DB,
  projectId: number,
  scorer: Scorer,
  options?: RunScoringOptions
): Promise<ScoringSummary> {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  const leadListId =
    options?.leadListId ?? getActiveLeadListId(db, projectId);
  const gated = listGatedLeads(db, projectId, leadListId);
  const rag = resolveRag(options);
  const k = options?.similarK ?? 3;
  
  options?.onProgress?.(`Starting scoring for ${gated.length} leads.`);
  
  let scored = 0,
    errors = 0;
  const errorMessages: string[] = [];
  let index = 0;
  for (const lead of gated) {
    index++;
    options?.onProgress?.(`Scoring lead ${index}/${gated.length}: ${lead.company}`);
    setLeadPipelineStatus(db, projectId, lead.id, "scoring");
    try {
      const query = [lead.company, lead.website ?? "", project.icp ?? ""]
        .filter((p) => p.length > 0)
        .join(" ");
      const similar = rag ? rag.similar(projectId, query, k) : [];
      const result = await withRetry(
        () => scorer.scoreLead(lead, project, { similar }),
        { attempts: 3, baseDelayMs: 500 }
      );
      saveScore(db, projectId, lead.id, result.score, result.reasons, result.draft);
      scored++;
    } catch (err) {
      errors++;
      setLeadPipelineStatus(db, projectId, lead.id, "scoring_failed");
      const msg = err instanceof Error ? err.message : String(err);
      errorMessages.push(`lead ${lead.id} (${lead.company}): ${msg}`);
    }
  }
  
  options?.onProgress?.(`Scoring complete. Scored: ${scored}, Errors: ${errors}`);
  
  return {
    scored,
    skipped: 0,
    errors,
    errorMessages,
  };
}
