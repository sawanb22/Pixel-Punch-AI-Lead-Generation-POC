import type { DB } from "../db/database.js";
import type {
  OperationsRun,
  OperationsLog,
  NewOperationsRun,
  NewOperationsLog,
  OperationType,
} from "./types.js";

interface RunRow {
  id: number;
  project_id: number;
  run_type: string;
  status: string;
  progress_info: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

interface LogRow {
  id: number;
  run_id: number;
  message: string;
  level: string;
  created_at: string;
}

function toRun(row: RunRow): OperationsRun {
  return {
    id: row.id,
    projectId: row.project_id,
    runType: row.run_type as OperationType,
    status: row.status as any,
    progressInfo: row.progress_info,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toLog(row: LogRow): OperationsLog {
  return {
    id: row.id,
    runId: row.run_id,
    message: row.message,
    level: row.level as any,
    createdAt: row.created_at,
  };
}

export function createOpsRun(db: DB, run: NewOperationsRun): OperationsRun {
  const row = db
    .prepare(
      `INSERT INTO operations_runs (project_id, run_type, status, progress_info)
       VALUES (?, ?, ?, ?)
       RETURNING *`
    )
    .get(
      run.projectId,
      run.runType,
      run.status ?? "running",
      run.progressInfo ?? null
    ) as unknown as RunRow;
  return toRun(row);
}

export function addLogToRun(
  db: DB,
  log: NewOperationsLog
): OperationsLog {
  const row = db
    .prepare(
      `INSERT INTO operations_logs (run_id, message, level)
       VALUES (?, ?, ?)
       RETURNING *`
    )
    .get(log.runId, log.message, log.level ?? "info") as unknown as LogRow;
  return toLog(row);
}

export function completeOpsRun(
  db: DB,
  runId: number,
  error?: string | null
): void {
  db.prepare(
    `UPDATE operations_runs
     SET status = ?, error = ?, finished_at = datetime('now')
     WHERE id = ?`
  ).run(error ? "failed" : "completed", error ?? null, runId);
}

export function updateOpsRunProgress(
  db: DB,
  runId: number,
  progressInfo: string
): void {
  db.prepare(
    `UPDATE operations_runs
     SET progress_info = ?
     WHERE id = ?`
  ).run(progressInfo, runId);
}

export function listOpsRuns(
  db: DB,
  projectId: number,
  typeFilter?: OperationType | "all",
  limit = 100
): OperationsRun[] {
  let query = `SELECT * FROM operations_runs WHERE project_id = ?`;
  const params: any[] = [projectId];

  if (typeFilter && typeFilter !== "all") {
    query += ` AND run_type = ?`;
    params.push(typeFilter);
  }

  query += ` ORDER BY id DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(query).all(...params) as unknown as RunRow[];
  return rows.map(toRun);
}

export function getOpsRun(db: DB, runId: number): OperationsRun | undefined {
  const row = db
    .prepare(`SELECT * FROM operations_runs WHERE id = ?`)
    .get(runId) as unknown as RunRow | undefined;
  return row ? toRun(row) : undefined;
}

export function getLatestOpsRun(
  db: DB,
  projectId: number,
  type?: OperationType
): OperationsRun | undefined {
  let query = `SELECT * FROM operations_runs WHERE project_id = ?`;
  const params: any[] = [projectId];

  if (type) {
    query += ` AND run_type = ?`;
    params.push(type);
  }

  query += ` ORDER BY id DESC LIMIT 1`;
  const row = db.prepare(query).get(...params) as unknown as RunRow | undefined;
  return row ? toRun(row) : undefined;
}

export function listLogsForRun(db: DB, runId: number): OperationsLog[] {
  const rows = db
    .prepare(`SELECT * FROM operations_logs WHERE run_id = ? ORDER BY id ASC`)
    .all(runId) as unknown as LogRow[];
  return rows.map(toLog);
}
