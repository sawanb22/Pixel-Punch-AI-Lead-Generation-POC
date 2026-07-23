export const ENRICHMENT_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
] as const;

export type EnrichmentRunStatus = (typeof ENRICHMENT_RUN_STATUSES)[number];

export const ENRICHMENT_JOB_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
] as const;

export type EnrichmentJobStatus = (typeof ENRICHMENT_JOB_STATUSES)[number];

export type CompanyPageType =
  | "homepage"
  | "about"
  | "contact"
  | "team"
  | "pricing"
  | "careers"
  | "blog"
  | "press"
  | "other";

export interface CompanyEnrichmentRun {
  id: number;
  projectId: number;
  status: EnrichmentRunStatus;
  companiesQueued: number;
  companiesEnriched: number;
  pagesFetched: number;
  evidenceSaved: number;
  emailsFound: number;
  failedCount: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface CompanyEnrichmentJob {
  id: number;
  runId: number;
  projectId: number;
  leadId: number | null;
  domain: string;
  website: string | null;
  finalHomepageUrl: string | null;
  status: EnrichmentJobStatus;
  pagesFetched: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface CompanyPage {
  id: number;
  runId: number;
  jobId: number | null;
  projectId: number;
  domain: string;
  url: string;
  finalUrl: string | null;
  pageType: CompanyPageType | string | null;
  httpStatus: number | null;
  title: string | null;
  metaDescription: string | null;
  textSnippet: string | null;
  error: string | null;
  fetchedAt: string;
}

export interface CompanyProfile {
  id: number;
  projectId: number;
  leadId: number | null;
  domain: string;
  homepageUrl: string | null;
  title: string | null;
  description: string | null;
  categoryHints: string[];
  locationHints: string[];
  socialLinks: Record<string, string>;
  emailCandidates: string[];
  confidence: number;
  updatedAt: string;
  createdAt: string;
}

export interface CompanyEvidence {
  id: number;
  projectId: number;
  leadId: number | null;
  domain: string;
  evidenceType: string;
  url: string | null;
  title: string | null;
  textExcerpt: string;
  confidence: number;
  fetchedAt: string;
}

export const EVIDENCE_TEXT_MAX_CHARS = 2_000;
export const PAGE_SNIPPET_MAX_CHARS = 2_000;
export const PAGE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
