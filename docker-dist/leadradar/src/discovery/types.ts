/** Status of a full discovery run across one or more source jobs. */
export const DISCOVERY_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
] as const;

export type DiscoveryRunStatus = (typeof DISCOVERY_RUN_STATUSES)[number];

export const SOURCE_JOB_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
] as const;

export type SourceJobStatus = (typeof SOURCE_JOB_STATUSES)[number];

export type DiscoverySourceType = "apify" | "api" | "csv" | "search";

/** Internal candidate shape before conversion to CanonicalLead. */
export interface DiscoveredCompanyCandidate {
  company: string;
  website: string | null;
  domain: string | null;
  source: string;
  sourceType: DiscoverySourceType;
  sourceUrl: string | null;
  discoveryQuery: string | null;
  rawPayload: unknown;
  confidence: number;
  rejectionReason?: string;
}

export interface DiscoveryRun {
  id: number;
  projectId: number;
  leadListId: number | null;
  status: DiscoveryRunStatus;
  fetchedCount: number;
  keptCount: number;
  duplicateCount: number;
  rejectedCount: number;
  costEstimate: number | null;
  error: string | null;
  plannerInputJson: string | null;
  plannerRawJson: string | null;
  payloadJson: string | null;
  compiledJobsJson: string | null;
  validationNotes: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface DiscoverySourceJob {
  id: number;
  runId: number;
  sourceId: string;
  sourceType: DiscoverySourceType;
  status: SourceJobStatus;
  actorId: string | null;
  taskId: string | null;
  apifyRunId: string | null;
  datasetId: string | null;
  fetchedCount: number;
  keptCount: number;
  error: string | null;
  costEstimate: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface DiscoveredCandidateRow {
  id: number;
  runId: number;
  sourceJobId: number | null;
  company: string;
  website: string | null;
  domain: string | null;
  source: string;
  sourceType: DiscoverySourceType;
  sourceUrl: string | null;
  discoveryQuery: string | null;
  rawPayload: unknown;
  confidence: number;
  kept: boolean;
  rejectionReason: string | null;
  createdAt: string;
}

/** Cap serialized raw payload size for storage. */
export const RAW_PAYLOAD_MAX_CHARS = 8_000;
