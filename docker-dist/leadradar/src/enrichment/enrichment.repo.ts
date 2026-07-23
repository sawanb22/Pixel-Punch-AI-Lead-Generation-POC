import type { DB } from "../db/database.js";
import {
  EVIDENCE_TEXT_MAX_CHARS,
  type CompanyEnrichmentJob,
  type CompanyEnrichmentRun,
  type CompanyEvidence,
  type CompanyPage,
  type CompanyPageType,
  type CompanyProfile,
  type EnrichmentJobStatus,
  type EnrichmentRunStatus,
} from "./types.js";

interface RunRow {
  id: number;
  project_id: number;
  status: string;
  companies_queued: number;
  companies_enriched: number;
  pages_fetched: number;
  evidence_saved: number;
  emails_found: number;
  failed_count: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

interface JobRow {
  id: number;
  run_id: number;
  project_id: number;
  lead_id: number | null;
  domain: string;
  website: string | null;
  final_homepage_url: string | null;
  status: string;
  pages_fetched: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

interface PageRow {
  id: number;
  run_id: number;
  job_id: number | null;
  project_id: number;
  domain: string;
  url: string;
  final_url: string | null;
  page_type: string | null;
  http_status: number | null;
  title: string | null;
  meta_description: string | null;
  text_snippet: string | null;
  error: string | null;
  fetched_at: string;
}

interface ProfileRow {
  id: number;
  project_id: number;
  lead_id: number | null;
  domain: string;
  homepage_url: string | null;
  title: string | null;
  description: string | null;
  category_hints: string;
  location_hints: string;
  social_links: string;
  email_candidates: string;
  confidence: number;
  updated_at: string;
  created_at: string;
}

interface EvidenceRow {
  id: number;
  project_id: number;
  lead_id: number | null;
  domain: string;
  evidence_type: string;
  url: string | null;
  title: string | null;
  text_excerpt: string | null;
  confidence: number;
  fetched_at: string;
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function toRun(row: RunRow): CompanyEnrichmentRun {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status as EnrichmentRunStatus,
    companiesQueued: row.companies_queued,
    companiesEnriched: row.companies_enriched,
    pagesFetched: row.pages_fetched,
    evidenceSaved: row.evidence_saved,
    emailsFound: row.emails_found,
    failedCount: row.failed_count,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toJob(row: JobRow): CompanyEnrichmentJob {
  return {
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    leadId: row.lead_id,
    domain: row.domain,
    website: row.website,
    finalHomepageUrl: row.final_homepage_url,
    status: row.status as EnrichmentJobStatus,
    pagesFetched: row.pages_fetched,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toPage(row: PageRow): CompanyPage {
  return {
    id: row.id,
    runId: row.run_id,
    jobId: row.job_id,
    projectId: row.project_id,
    domain: row.domain,
    url: row.url,
    finalUrl: row.final_url,
    pageType: row.page_type,
    httpStatus: row.http_status,
    title: row.title,
    metaDescription: row.meta_description,
    textSnippet: row.text_snippet,
    error: row.error,
    fetchedAt: row.fetched_at,
  };
}

function toProfile(row: ProfileRow): CompanyProfile {
  return {
    id: row.id,
    projectId: row.project_id,
    leadId: row.lead_id,
    domain: row.domain,
    homepageUrl: row.homepage_url,
    title: row.title,
    description: row.description,
    categoryHints: parseJsonArray(row.category_hints),
    locationHints: parseJsonArray(row.location_hints),
    socialLinks: parseJsonObject(row.social_links),
    emailCandidates: parseJsonArray(row.email_candidates),
    confidence: row.confidence,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function toEvidence(row: EvidenceRow): CompanyEvidence {
  return {
    id: row.id,
    projectId: row.project_id,
    leadId: row.lead_id,
    domain: row.domain,
    evidenceType: row.evidence_type,
    url: row.url,
    title: row.title,
    textExcerpt: row.text_excerpt ?? "",
    confidence: row.confidence,
    fetchedAt: row.fetched_at,
  };
}

export function capText(text: string | null | undefined, max = EVIDENCE_TEXT_MAX_CHARS): string | null {
  if (text == null) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

export function createEnrichmentRun(
  db: DB,
  input: { projectId: number; status?: EnrichmentRunStatus }
): CompanyEnrichmentRun {
  const result = db
    .prepare(
      `INSERT INTO company_enrichment_runs (project_id, status) VALUES (?, ?)`
    )
    .run(input.projectId, input.status ?? "queued");
  return getEnrichmentRun(db, Number(result.lastInsertRowid))!;
}

export function getEnrichmentRun(
  db: DB,
  id: number
): CompanyEnrichmentRun | undefined {
  const row = db
    .prepare("SELECT * FROM company_enrichment_runs WHERE id = ?")
    .get(id) as RunRow | undefined;
  return row ? toRun(row) : undefined;
}

export interface UpdateEnrichmentRunInput {
  status?: EnrichmentRunStatus;
  companiesQueued?: number;
  companiesEnriched?: number;
  pagesFetched?: number;
  evidenceSaved?: number;
  emailsFound?: number;
  failedCount?: number;
  error?: string | null;
  finishedAt?: string | null;
}

export function updateEnrichmentRun(
  db: DB,
  id: number,
  input: UpdateEnrichmentRunInput
): CompanyEnrichmentRun | undefined {
  const existing = getEnrichmentRun(db, id);
  if (!existing) return undefined;
  db.prepare(
    `UPDATE company_enrichment_runs SET
       status = ?,
       companies_queued = ?,
       companies_enriched = ?,
       pages_fetched = ?,
       evidence_saved = ?,
       emails_found = ?,
       failed_count = ?,
       error = ?,
       finished_at = ?
     WHERE id = ?`
  ).run(
    input.status ?? existing.status,
    input.companiesQueued ?? existing.companiesQueued,
    input.companiesEnriched ?? existing.companiesEnriched,
    input.pagesFetched ?? existing.pagesFetched,
    input.evidenceSaved ?? existing.evidenceSaved,
    input.emailsFound ?? existing.emailsFound,
    input.failedCount ?? existing.failedCount,
    input.error !== undefined ? input.error : existing.error,
    input.finishedAt !== undefined ? input.finishedAt : existing.finishedAt,
    id
  );
  return getEnrichmentRun(db, id);
}

export function createEnrichmentJob(
  db: DB,
  input: {
    runId: number;
    projectId: number;
    leadId?: number | null;
    domain: string;
    website?: string | null;
    status?: EnrichmentJobStatus;
  }
): CompanyEnrichmentJob {
  const result = db
    .prepare(
      `INSERT INTO company_enrichment_jobs
         (run_id, project_id, lead_id, domain, website, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.runId,
      input.projectId,
      input.leadId ?? null,
      input.domain,
      input.website ?? null,
      input.status ?? "queued"
    );
  return getEnrichmentJob(db, Number(result.lastInsertRowid))!;
}

export function getEnrichmentJob(
  db: DB,
  id: number
): CompanyEnrichmentJob | undefined {
  const row = db
    .prepare("SELECT * FROM company_enrichment_jobs WHERE id = ?")
    .get(id) as JobRow | undefined;
  return row ? toJob(row) : undefined;
}

export interface UpdateEnrichmentJobInput {
  status?: EnrichmentJobStatus;
  finalHomepageUrl?: string | null;
  pagesFetched?: number;
  error?: string | null;
  finishedAt?: string | null;
}

export function updateEnrichmentJob(
  db: DB,
  id: number,
  input: UpdateEnrichmentJobInput
): CompanyEnrichmentJob | undefined {
  const existing = getEnrichmentJob(db, id);
  if (!existing) return undefined;
  db.prepare(
    `UPDATE company_enrichment_jobs SET
       status = ?,
       final_homepage_url = ?,
       pages_fetched = ?,
       error = ?,
       finished_at = ?
     WHERE id = ?`
  ).run(
    input.status ?? existing.status,
    input.finalHomepageUrl !== undefined
      ? input.finalHomepageUrl
      : existing.finalHomepageUrl,
    input.pagesFetched ?? existing.pagesFetched,
    input.error !== undefined ? input.error : existing.error,
    input.finishedAt !== undefined ? input.finishedAt : existing.finishedAt,
    id
  );
  return getEnrichmentJob(db, id);
}

export function listEnrichmentJobs(
  db: DB,
  runId: number
): CompanyEnrichmentJob[] {
  const rows = db
    .prepare(
      "SELECT * FROM company_enrichment_jobs WHERE run_id = ? ORDER BY id"
    )
    .all(runId) as unknown as JobRow[];
  return rows.map(toJob);
}

export interface NewCompanyPage {
  runId: number;
  jobId?: number | null;
  projectId: number;
  domain: string;
  url: string;
  finalUrl?: string | null;
  pageType?: CompanyPageType | string | null;
  httpStatus?: number | null;
  title?: string | null;
  metaDescription?: string | null;
  textSnippet?: string | null;
  error?: string | null;
}

export function insertCompanyPages(db: DB, pages: NewCompanyPage[]): void {
  const stmt = db.prepare(
    `INSERT INTO company_pages
       (run_id, job_id, project_id, domain, url, final_url, page_type,
        http_status, title, meta_description, text_snippet, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.exec("BEGIN");
  try {
    for (const p of pages) {
      stmt.run(
        p.runId,
        p.jobId ?? null,
        p.projectId,
        p.domain,
        p.url,
        p.finalUrl ?? null,
        p.pageType ?? null,
        p.httpStatus ?? null,
        p.title ?? null,
        p.metaDescription ?? null,
        capText(p.textSnippet),
        p.error ?? null
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function listCompanyPages(db: DB, runId: number): CompanyPage[] {
  const rows = db
    .prepare("SELECT * FROM company_pages WHERE run_id = ? ORDER BY id")
    .all(runId) as unknown as PageRow[];
  return rows.map(toPage);
}

export interface UpsertCompanyProfileInput {
  projectId: number;
  leadId?: number | null;
  domain: string;
  homepageUrl?: string | null;
  title?: string | null;
  description?: string | null;
  categoryHints?: string[];
  locationHints?: string[];
  socialLinks?: Record<string, string>;
  emailCandidates?: string[];
  confidence?: number;
}

export function upsertCompanyProfile(
  db: DB,
  input: UpsertCompanyProfileInput
): CompanyProfile {
  db.prepare(
    `INSERT INTO company_profiles
       (project_id, lead_id, domain, homepage_url, title, description,
        category_hints, location_hints, social_links, email_candidates, confidence, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(project_id, domain) DO UPDATE SET
       lead_id = excluded.lead_id,
       homepage_url = excluded.homepage_url,
       title = excluded.title,
       description = excluded.description,
       category_hints = excluded.category_hints,
       location_hints = excluded.location_hints,
       social_links = excluded.social_links,
       email_candidates = excluded.email_candidates,
       confidence = excluded.confidence,
       updated_at = datetime('now')`
  ).run(
    input.projectId,
    input.leadId ?? null,
    input.domain,
    input.homepageUrl ?? null,
    input.title ?? null,
    input.description ?? null,
    JSON.stringify(input.categoryHints ?? []),
    JSON.stringify(input.locationHints ?? []),
    JSON.stringify(input.socialLinks ?? {}),
    JSON.stringify(input.emailCandidates ?? []),
    input.confidence ?? 0
  );
  return getCompanyProfile(db, input.projectId, input.domain)!;
}

export function getCompanyProfile(
  db: DB,
  projectId: number,
  domain: string
): CompanyProfile | undefined {
  const row = db
    .prepare(
      "SELECT * FROM company_profiles WHERE project_id = ? AND domain = ?"
    )
    .get(projectId, domain) as ProfileRow | undefined;
  return row ? toProfile(row) : undefined;
}

export function listEnrichedDomains(db: DB, projectId: number): Set<string> {
  const rows = db
    .prepare("SELECT domain FROM company_profiles WHERE project_id = ?")
    .all(projectId) as unknown as Array<{ domain: string }>;
  return new Set(rows.map((r) => r.domain));
}

export interface NewCompanyEvidence {
  projectId: number;
  leadId?: number | null;
  domain: string;
  evidenceType: string;
  url?: string | null;
  title?: string | null;
  textExcerpt: string;
  confidence?: number;
}

export function insertCompanyEvidence(
  db: DB,
  items: NewCompanyEvidence[]
): void {
  const stmt = db.prepare(
    `INSERT INTO company_evidence
       (project_id, lead_id, domain, evidence_type, url, title, text_excerpt, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.exec("BEGIN");
  try {
    for (const item of items) {
      stmt.run(
        item.projectId,
        item.leadId ?? null,
        item.domain,
        item.evidenceType,
        item.url ?? null,
        item.title ?? null,
        capText(item.textExcerpt) ?? "",
        item.confidence ?? 0
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function listCompanyEvidence(
  db: DB,
  projectId: number,
  domain: string
): CompanyEvidence[] {
  const rows = db
    .prepare(
      `SELECT * FROM company_evidence
       WHERE project_id = ? AND domain = ?
       ORDER BY id`
    )
    .all(projectId, domain) as unknown as EvidenceRow[];
  return rows.map(toEvidence);
}

export interface CachedPage {
  url: string;
  finalUrl: string | null;
  httpStatus: number | null;
  contentType: string | null;
  body: string | null;
  fetchedAt: string;
}

export function getCachedPage(db: DB, url: string): CachedPage | undefined {
  const row = db
    .prepare("SELECT * FROM page_fetch_cache WHERE url = ?")
    .get(url) as
    | {
        url: string;
        final_url: string | null;
        http_status: number | null;
        content_type: string | null;
        body: string | null;
        fetched_at: string;
      }
    | undefined;
  if (!row) return undefined;
  return {
    url: row.url,
    finalUrl: row.final_url,
    httpStatus: row.http_status,
    contentType: row.content_type,
    body: row.body,
    fetchedAt: row.fetched_at,
  };
}

export function putCachedPage(
  db: DB,
  input: {
    url: string;
    finalUrl?: string | null;
    httpStatus?: number | null;
    contentType?: string | null;
    body?: string | null;
  }
): void {
  db.prepare(
    `INSERT INTO page_fetch_cache (url, final_url, http_status, content_type, body, fetched_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(url) DO UPDATE SET
       final_url = excluded.final_url,
       http_status = excluded.http_status,
       content_type = excluded.content_type,
       body = excluded.body,
       fetched_at = datetime('now')`
  ).run(
    input.url,
    input.finalUrl ?? null,
    input.httpStatus ?? null,
    input.contentType ?? null,
    input.body ?? null
  );
}
