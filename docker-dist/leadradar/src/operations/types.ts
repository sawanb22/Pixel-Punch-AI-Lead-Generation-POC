export type OperationType = "discovery" | "enrichment" | "contacts" | "scoring";
export type OperationStatus = "running" | "completed" | "failed";
export type LogLevel = "info" | "warning" | "error";

export interface OperationsRun {
  id: number;
  projectId: number;
  runType: OperationType;
  status: OperationStatus;
  progressInfo: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface OperationsLog {
  id: number;
  runId: number;
  message: string;
  level: LogLevel;
  createdAt: string;
}

export interface NewOperationsRun {
  projectId: number;
  runType: OperationType;
  status?: OperationStatus;
  progressInfo?: string | null;
}

export interface NewOperationsLog {
  runId: number;
  message: string;
  level?: LogLevel;
}
