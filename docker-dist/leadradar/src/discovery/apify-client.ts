import type { FetchLike } from "../sources/source.js";

const APIFY_API_BASE = "https://api.apify.com/v2";

const TERMINAL_SUCCESS = new Set(["SUCCEEDED"]);
const TERMINAL_FAILURE = new Set([
  "FAILED",
  "ABORTED",
  "TIMED-OUT",
  "TIMED_OUT",
]);

export class ApifyClientError extends Error {
  readonly statusCode?: number;
  readonly type?: string;

  constructor(
    message: string,
    options?: { statusCode?: number; type?: string; cause?: unknown }
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "ApifyClientError";
    this.statusCode = options?.statusCode;
    this.type = options?.type;
  }
}

export interface ApifyClientOptions {
  token: string;
  fetch?: FetchLike;
  pollIntervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ApifyRunResult {
  runId: string;
  datasetId: string | null;
  status: string;
  items: unknown[];
  usageTotalUsd?: number | null;
}

export interface RunActorAndGetItemsInput {
  actorId?: string;
  taskId?: string;
  input?: Record<string, unknown>;
  timeoutMs?: number;
}

interface ApifyRunData {
  id: string;
  status: string;
  defaultDatasetId?: string | null;
  statusMessage?: string | null;
  usageTotalUsd?: number | null;
}

function encodeApifyId(id: string): string {
  return id.trim().replace(/\//g, "~");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ApifyClient {
  private readonly token: string;
  private readonly fetchImpl: FetchLike;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: ApifyClientOptions) {
    if (!options.token?.trim()) {
      throw new ApifyClientError("APIFY_TOKEN is required");
    }
    this.token = options.token.trim();
    this.fetchImpl = options.fetch ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.timeoutMs = options.timeoutMs ?? 600_000;
    this.maxRetries = options.maxRetries ?? 3;
  }

  async runActorAndGetItems(
    input: RunActorAndGetItemsInput
  ): Promise<ApifyRunResult> {
    if (!input.actorId?.trim() && !input.taskId?.trim()) {
      throw new ApifyClientError("actorId or taskId is required");
    }

    const run = await this.startRun(input);
    const finished = TERMINAL_SUCCESS.has(run.status) ||
      TERMINAL_FAILURE.has(run.status)
      ? run
      : await this.pollUntilDone(run.id, input.timeoutMs ?? this.timeoutMs);

    if (TERMINAL_FAILURE.has(finished.status)) {
      throw new ApifyClientError(
        finished.statusMessage?.trim() ||
          `Apify run ${finished.id} ended with status ${finished.status}`,
        { type: finished.status }
      );
    }

    const datasetId = finished.defaultDatasetId ?? null;
    const items = datasetId ? await this.fetchDatasetItems(datasetId) : [];

    return {
      runId: finished.id,
      datasetId,
      status: finished.status,
      items,
      usageTotalUsd: finished.usageTotalUsd ?? null,
    };
  }

  private async startRun(
    input: RunActorAndGetItemsInput
  ): Promise<ApifyRunData> {
    const path = input.taskId?.trim()
      ? `/actor-tasks/${encodeApifyId(input.taskId)}/runs`
      : `/acts/${encodeApifyId(input.actorId!)}/runs`;

    const body = await this.requestJson<{ data: ApifyRunData }>(path, {
      method: "POST",
      body: JSON.stringify(input.input ?? {}),
    });
    if (!body.data?.id) {
      throw new ApifyClientError("Apify start run response missing run id");
    }
    return body.data;
  }

  private async pollUntilDone(
    runId: string,
    timeoutMs: number
  ): Promise<ApifyRunData> {
    const deadline = Date.now() + timeoutMs;
    let current = await this.getRun(runId);

    while (
      !TERMINAL_SUCCESS.has(current.status) &&
      !TERMINAL_FAILURE.has(current.status)
    ) {
      if (Date.now() >= deadline) {
        throw new ApifyClientError(
          `Apify run ${runId} timed out after ${timeoutMs}ms`
        );
      }
      await sleep(this.pollIntervalMs);
      current = await this.getRun(runId);
    }
    return current;
  }

  private async getRun(runId: string): Promise<ApifyRunData> {
    const body = await this.requestJson<{ data: ApifyRunData }>(
      `/actor-runs/${encodeApifyId(runId)}`
    );
    if (!body.data?.id) {
      throw new ApifyClientError(`Apify run ${runId} not found`);
    }
    return body.data;
  }

  async fetchDatasetItems(datasetId: string): Promise<unknown[]> {
    const items = await this.requestJson<unknown[]>(
      `/datasets/${encodeApifyId(datasetId)}/items?format=json`
    );
    if (!Array.isArray(items)) {
      throw new ApifyClientError("Apify dataset items response was not an array");
    }
    return items;
  }

  private async requestJson<T>(
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const url = `${APIFY_API_BASE}${path}`;
    let delay = 500;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(init?.headers ?? {}),
          },
        });

        if (res.status === 429 || res.status >= 500) {
          const text = await res.text();
          lastError = new ApifyClientError(
            `Apify HTTP ${res.status}: ${text || res.statusText}`,
            { statusCode: res.status }
          );
          if (attempt < this.maxRetries) {
            await sleep(delay);
            delay *= 2;
            continue;
          }
          throw lastError;
        }

        if (!res.ok) {
          const text = await res.text();
          let message = `Apify HTTP ${res.status}`;
          let type: string | undefined;
          try {
            const errBody = JSON.parse(text) as {
              error?: { message?: string; type?: string };
            };
            if (errBody.error?.message) message = errBody.error.message;
            type = errBody.error?.type;
          } catch {
            if (text) message = `${message}: ${text}`;
          }
          throw new ApifyClientError(message, {
            statusCode: res.status,
            type,
          });
        }

        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      } catch (err) {
        if (err instanceof ApifyClientError) throw err;
        lastError = err;
        if (attempt < this.maxRetries) {
          await sleep(delay);
          delay *= 2;
          continue;
        }
        throw new ApifyClientError(
          err instanceof Error ? err.message : "Apify request failed",
          { cause: err }
        );
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new ApifyClientError("Apify request failed");
  }
}
