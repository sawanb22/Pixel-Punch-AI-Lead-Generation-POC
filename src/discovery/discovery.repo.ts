import type { DB } from "../db/database.js";
import {
  RAW_PAYLOAD_MAX_CHARS,
  type DiscoveredCandidateRow,
  type DiscoveryRun,
  type DiscoveryRunStatus,
  type DiscoverySourceJob,
  type DiscoverySourceType,
  type SourceJobStatus,
} from "./types.js";

interface DiscoveryRunRow {
  id: number;
  project_id: number;
  status: string;
  fetched_count: number;
  kept_count: number;
  duplicate_count: number;
  rejected_count: number;
  cost_estimate: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

interface SourceJobRow {
  id: number;
  run_id: number;
  source_id: string;
  source_type: string;
  status: string;
  actor_id: string | null;
  task_id: string | null;
  apify_run_id: string | null;
  dataset_id: string | null;
  fetched_count: number;
  kept_count: number;
  error: string | null;
  cost_estimate: number | null;
  started_at: string;
  finished_at: string | null;
}

interface CandidateRow {
  id: number;
  run_id: number;
  source_job_id: number | null;
  company: string;
  website: string | null;
  domain: string | null;
  source: string;
  source_type: string;
  source_url: string | null;
  discovery_query: string | null;
  raw_payload: string | null;
  confidence: number;
  kept: number;
  rejection_reason: string | null;
  created_at: string;
}

function toRun(row: DiscoveryRunRow): DiscoveryRun {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status as DiscoveryRunStatus,
    fetchedCount: row.fetched_count,
    keptCount: row.kept_count,
    duplicateCount: row.duplicate_count,
    rejectedCount: row.rejected_count,
    costEstimate: row.cost_estimate,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toJob(row: SourceJobRow): DiscoverySourceJob {
  return {
    id: row.id,
    runId: row.run_id,
    sourceId: row.source_id,
    sourceType: row.source_type as DiscoverySourceType,
    status: row.status as SourceJobStatus,
    actorId: row.actor_id,
    taskId: row.task_id,
    apifyRunId: row.apify_run_id,
    datasetId: row.dataset_id,
    fetchedCount: row.fetched_count,
    keptCount: row.kept_count,
    error: row.error,
    costEstimate: row.cost_estimate,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function parseRawPayload(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function toCandidate(row: CandidateRow): DiscoveredCandidateRow {
  return {
    id: row.id,
    runId: row.run_id,
    sourceJobId: row.source_job_id,
    company: row.company,
    website: row.website,
    domain: row.domain,
    source: row.source,
    sourceType: row.source_type as DiscoverySourceType,
    sourceUrl: row.source_url,
    discoveryQuery: row.discovery_query,
    rawPayload: parseRawPayload(row.raw_payload),
    confidence: row.confidence,
    kept: row.kept === 1,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  };
}

export function serializeRawPayload(payload: unknown): string | null {
  if (payload == null) return null;
  let text: string;
  try {
    text = JSON.stringify(payload);
  } catch {
    text = String(payload);
  }
  if (text.length <= RAW_PAYLOAD_MAX_CHARS) return text;
  return JSON.stringify({
    _truncated: true,
    preview: text.slice(0, RAW_PAYLOAD_MAX_CHARS - 80),
  });
}

export function createDiscoveryRun(
  db: DB,
  input: { projectId: number; status?: DiscoveryRunStatus }
): DiscoveryRun {
  const result = db
    .prepare(
      `INSERT INTO discovery_runs (project_id, status)
       VALUES (?, ?)`
    )
    .run(input.projectId, input.status ?? "queued");
  return getDiscoveryRun(db, Number(result.lastInsertRowid))!;
}

export function getDiscoveryRun(db: DB, id: number): DiscoveryRun | undefined {
  const row = db
    .prepare("SELECT * FROM discovery_runs WHERE id = ?")
    .get(id) as DiscoveryRunRow | undefined;
  return row ? toRun(row) : undefined;
}

export function getLatestDiscoveryRunForProject(
  db: DB,
  projectId: number
): DiscoveryRun | undefined {
  const row = db
    .prepare(
      `SELECT * FROM discovery_runs
       WHERE project_id = ?
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(projectId) as DiscoveryRunRow | undefined;
  return row ? toRun(row) : undefined;
}

export interface UpdateDiscoveryRunInput {
  status?: DiscoveryRunStatus;
  fetchedCount?: number;
  keptCount?: number;
  duplicateCount?: number;
  rejectedCount?: number;
  costEstimate?: number | null;
  error?: string | null;
  finishedAt?: string | null;
}

export function updateDiscoveryRun(
  db: DB,
  id: number,
  input: UpdateDiscoveryRunInput
): DiscoveryRun | undefined {
  const existing = getDiscoveryRun(db, id);
  if (!existing) return undefined;
  db.prepare(
    `UPDATE discovery_runs SET
       status = ?,
       fetched_count = ?,
       kept_count = ?,
       duplicate_count = ?,
       rejected_count = ?,
       cost_estimate = ?,
       error = ?,
       finished_at = ?
     WHERE id = ?`
  ).run(
    input.status ?? existing.status,
    input.fetchedCount ?? existing.fetchedCount,
    input.keptCount ?? existing.keptCount,
    input.duplicateCount ?? existing.duplicateCount,
    input.rejectedCount ?? existing.rejectedCount,
    input.costEstimate !== undefined
      ? input.costEstimate
      : existing.costEstimate,
    input.error !== undefined ? input.error : existing.error,
    input.finishedAt !== undefined ? input.finishedAt : existing.finishedAt,
    id
  );
  return getDiscoveryRun(db, id);
}

export function createSourceJob(
  db: DB,
  input: {
    runId: number;
    sourceId: string;
    sourceType: DiscoverySourceType;
    status?: SourceJobStatus;
    actorId?: string | null;
    taskId?: string | null;
  }
): DiscoverySourceJob {
  const result = db
    .prepare(
      `INSERT INTO discovery_source_jobs
         (run_id, source_id, source_type, status, actor_id, task_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.runId,
      input.sourceId,
      input.sourceType,
      input.status ?? "queued",
      input.actorId ?? null,
      input.taskId ?? null
    );
  return getSourceJob(db, Number(result.lastInsertRowid))!;
}

export function getSourceJob(
  db: DB,
  id: number
): DiscoverySourceJob | undefined {
  const row = db
    .prepare("SELECT * FROM discovery_source_jobs WHERE id = ?")
    .get(id) as SourceJobRow | undefined;
  return row ? toJob(row) : undefined;
}

export interface UpdateSourceJobInput {
  status?: SourceJobStatus;
  apifyRunId?: string | null;
  datasetId?: string | null;
  fetchedCount?: number;
  keptCount?: number;
  error?: string | null;
  costEstimate?: number | null;
  finishedAt?: string | null;
}

export function updateSourceJob(
  db: DB,
  id: number,
  input: UpdateSourceJobInput
): DiscoverySourceJob | undefined {
  const existing = getSourceJob(db, id);
  if (!existing) return undefined;
  db.prepare(
    `UPDATE discovery_source_jobs SET
       status = ?,
       apify_run_id = ?,
       dataset_id = ?,
       fetched_count = ?,
       kept_count = ?,
       error = ?,
       cost_estimate = ?,
       finished_at = ?
     WHERE id = ?`
  ).run(
    input.status ?? existing.status,
    input.apifyRunId !== undefined ? input.apifyRunId : existing.apifyRunId,
    input.datasetId !== undefined ? input.datasetId : existing.datasetId,
    input.fetchedCount ?? existing.fetchedCount,
    input.keptCount ?? existing.keptCount,
    input.error !== undefined ? input.error : existing.error,
    input.costEstimate !== undefined
      ? input.costEstimate
      : existing.costEstimate,
    input.finishedAt !== undefined ? input.finishedAt : existing.finishedAt,
    id
  );
  return getSourceJob(db, id);
}

export function listSourceJobs(db: DB, runId: number): DiscoverySourceJob[] {
  const rows = db
    .prepare(
      "SELECT * FROM discovery_source_jobs WHERE run_id = ? ORDER BY id"
    )
    .all(runId) as unknown as SourceJobRow[];
  return rows.map(toJob);
}

export interface NewDiscoveredCandidate {
  runId: number;
  sourceJobId?: number | null;
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
  rejectionReason?: string | null;
}

export function insertDiscoveredCandidates(
  db: DB,
  candidates: NewDiscoveredCandidate[]
): void {
  const stmt = db.prepare(
    `INSERT INTO discovered_candidates
       (run_id, source_job_id, company, website, domain, source, source_type,
        source_url, discovery_query, raw_payload, confidence, kept, rejection_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.exec("BEGIN");
  try {
    for (const c of candidates) {
      stmt.run(
        c.runId,
        c.sourceJobId ?? null,
        c.company,
        c.website,
        c.domain,
        c.source,
        c.sourceType,
        c.sourceUrl,
        c.discoveryQuery,
        serializeRawPayload(c.rawPayload),
        c.confidence,
        c.kept ? 1 : 0,
        c.rejectionReason ?? null
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function listDiscoveredCandidates(
  db: DB,
  runId: number,
  filter?: { kept?: boolean }
): DiscoveredCandidateRow[] {
  let sql = "SELECT * FROM discovered_candidates WHERE run_id = ?";
  const params: (number | string)[] = [runId];
  if (filter?.kept !== undefined) {
    sql += " AND kept = ?";
    params.push(filter.kept ? 1 : 0);
  }
  sql += " ORDER BY id";
  const rows = db.prepare(sql).all(...params) as unknown as CandidateRow[];
  return rows.map(toCandidate);
}
