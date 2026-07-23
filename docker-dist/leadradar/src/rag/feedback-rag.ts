import type { FeedbackDoc } from "./types.js";

export interface FeedbackRag {
  upsert(doc: FeedbackDoc): void;
  similar(projectId: number, queryText: string, k: number): FeedbackDoc[];
  clearProject(projectId: number): void;
}
