import type { Lead, Project } from "../domain/types.js";
import type { FeedbackDoc } from "../rag/types.js";

export interface ScoreResult {
  score: number; // 0–100
  reasons: string;
  draft?: string | null; // reserved
}

export interface ScoreContext {
  similar: FeedbackDoc[];
}

export interface Scorer {
  scoreLead(lead: Lead, project: Project, context?: ScoreContext): Promise<ScoreResult>;
}
