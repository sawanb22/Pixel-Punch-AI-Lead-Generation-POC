export const LEAD_STATUSES = [
  "raw",
  "gated",
  "provisional",
  "enriching",
  "enriched",
  "enrichment_failed",
  "scoring",
  "scored",
  "scoring_failed",
  "approved",
  "rejected",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(value);
}

export interface Project {
  id: number;
  name: string;
  website: string | null;
  description: string | null;
  icp: string | null;
  sourceConfig: string | null; // JSON string (internal/legacy)
  leadPlan: string | null; // JSON string — human lead plan
  leadStrategy: string | null; // JSON string — enabled actors / buyer mode
  websiteSummary: string | null;
  websiteSummaryAt: string | null;
  activeLeadListId: number | null;
  status: string;
  createdAt: string;
}

/** A lead as emitted by a source adapter, before validation/persistence. */
export interface CanonicalLead {
  company: string;
  website: string | null;
  email: string | null;
  votes: number | null;
  source: string; // e.g. "csv", "producthunt"
}

/** A lead after persistence. */
export interface Lead extends CanonicalLead {
  id: number;
  projectId: number;
  leadListId: number | null;
  canonicalDomain: string | null;
  sources: string[];
  status: LeadStatus;
  score: number | null;
  reasons: string | null;
  createdAt: string;
}
