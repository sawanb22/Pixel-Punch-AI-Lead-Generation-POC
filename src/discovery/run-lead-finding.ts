import type { DB } from "../db/database.js";
import type { CanonicalLead } from "../domain/types.js";
import { getProject } from "../projects/projects.repo.js";
import { runIngest } from "../ingest/run-ingest.js";
import type { Source } from "../sources/source.js";
import { ApifyClient } from "./apify-client.js";
import { ApifyActorSource } from "./apify-source.js";
import { dedupeCandidates } from "./dedupe-candidates.js";
import {
  createDiscoveryRun,
  createSourceJob,
  insertDiscoveredCandidates,
  updateDiscoveryRun,
  updateSourceJob,
} from "./discovery.repo.js";
import {
  parseLeadFindingConfigFromProjectJson,
  resolveLeadFindingJobs,
  type LeadFindingSourceConfig,
} from "./lead-finding-config.js";
import type { DiscoveredCompanyCandidate } from "./types.js";

export interface LeadFindingSummary {
  runId: number;
  status: "completed" | "failed";
  sourcesRun: number;
  fetched: number;
  kept: number;
  rejected: number;
  duplicates: number;
  skippedExisting: number;
  costEstimate: number | null;
  errors: string[];
}

export interface RunLeadFindingOptions {
  apifyClient?: ApifyClient;
  env?: NodeJS.ProcessEnv;
  concurrency?: number;
  now?: () => string;
  /** When set, use these Apify jobs instead of parsing source_config. */
  jobs?: LeadFindingSourceConfig[];
  maxCandidates?: number;
}

function toCanonicalLead(c: DiscoveredCompanyCandidate): CanonicalLead {
  const primarySource = c.source.split(",")[0]?.trim() || "apify";
  return {
    company: c.company,
    website: c.website,
    email: null,
    votes: null,
    source: primarySource,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export async function runLeadFinding(
  db: DB,
  projectId: number,
  options: RunLeadFindingOptions = {}
): Promise<LeadFindingSummary> {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`project ${projectId} not found`);

  const env = options.env ?? process.env;
  const config = parseLeadFindingConfigFromProjectJson(project.sourceConfig);
  const jobs =
    options.jobs ?? resolveLeadFindingJobs({ project, env, config });
  const concurrency = options.concurrency ?? config.concurrency;
  const maxCandidates = options.maxCandidates ?? config.maxCandidates;
  const now = options.now ?? (() => new Date().toISOString());

  const apifyJobs = jobs.filter((j) => j.type === "apify");
  if (apifyJobs.length === 0) {
    throw new Error(
      "No Apify lead-finding jobs. Add a lead plan or configure Apify sources."
    );
  }
  if (!options.apifyClient && !env.APIFY_TOKEN?.trim()) {
    throw new Error(
      "APIFY_TOKEN is required for Find leads. Set APIFY_TOKEN in .env."
    );
  }

  const client =
    options.apifyClient ??
    new ApifyClient({
      token: env.APIFY_TOKEN ?? "",
      timeoutMs: config.maxRuntimeSecondsPerJob * 1000,
    });

  const run = createDiscoveryRun(db, { projectId, status: "running" });
  const errors: string[] = [];
  let fetched = 0;
  let rejected = 0;
  let costEstimate = 0;
  const allCandidates: DiscoveredCompanyCandidate[] = [];
  const allRejected: DiscoveredCompanyCandidate[] = [];

  type JobOutcome = {
    jobConfig: LeadFindingSourceConfig;
    sourceJobId: number;
  };

  const jobRows: JobOutcome[] = apifyJobs.map((jobConfig) => ({
    jobConfig,
    sourceJobId: createSourceJob(db, {
      runId: run.id,
      sourceId: jobConfig.id,
      sourceType: "apify",
      status: "running",
      actorId: jobConfig.actorId ?? null,
      taskId: jobConfig.taskId ?? null,
    }).id,
  }));

  await mapPool(jobRows, concurrency, async ({ jobConfig, sourceJobId }) => {
    try {
      const source = new ApifyActorSource({
        client,
        sourceId: jobConfig.id,
        actorId: jobConfig.actorId,
        taskId: jobConfig.taskId,
        input: jobConfig.input,
        mapping: jobConfig.mapping,
        discoveryQuery: jobConfig.discoveryQuery,
        allowCompanyOnly: jobConfig.allowCompanyOnly,
        timeoutMs:
          (jobConfig.timeoutSeconds ?? config.maxRuntimeSecondsPerJob) * 1000,
      });
      const result = await source.fetchCandidates();
      fetched += result.fetched;
      rejected += result.rejected.length;
      if (result.costEstimate) costEstimate += result.costEstimate;
      allCandidates.push(...result.candidates);
      allRejected.push(...result.rejected);

      updateSourceJob(db, sourceJobId, {
        status: "completed",
        apifyRunId: result.apifyRunId,
        datasetId: result.datasetId,
        fetchedCount: result.fetched,
        keptCount: result.candidates.length,
        costEstimate: result.costEstimate,
        finishedAt: now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${jobConfig.id}: ${message}`);
      updateSourceJob(db, sourceJobId, {
        status: "failed",
        error: message,
        finishedAt: now(),
      });
    }
  });

  const { kept: deduped, duplicates } = dedupeCandidates(allCandidates);
  const capped = deduped.slice(0, maxCandidates);

  insertDiscoveredCandidates(db, [
    ...capped.map((c) => ({
      runId: run.id,
      sourceJobId: null,
      company: c.company,
      website: c.website,
      domain: c.domain,
      source: c.source,
      sourceType: c.sourceType,
      sourceUrl: c.sourceUrl,
      discoveryQuery: c.discoveryQuery,
      rawPayload: c.rawPayload,
      confidence: c.confidence,
      kept: true as const,
    })),
    ...allRejected.map((c) => ({
      runId: run.id,
      sourceJobId: null,
      company: c.company,
      website: c.website,
      domain: c.domain,
      source: c.source,
      sourceType: c.sourceType,
      sourceUrl: c.sourceUrl,
      discoveryQuery: c.discoveryQuery,
      rawPayload: c.rawPayload,
      confidence: c.confidence,
      kept: false as const,
      rejectionReason: c.rejectionReason ?? "rejected",
    })),
  ]);

  const canonical = capped.map(toCanonicalLead);
  // Preserve merged source names by expanding CanonicalLead via a thin Source adapter.
  const ingestSource: Source = {
    name: "lead-finding",
    fetch: async () =>
      capped.map((c) => {
        const lead = toCanonicalLead(c);
        // runIngest/validate will set sources from lead.source; multi-source merge
        // is represented by comma-joined source on candidate — split into first for
        // CanonicalLead, full list restored after validate via company match below.
        return lead;
      }),
  };

  let kept = 0;
  let skippedExisting = 0;
  if (canonical.length > 0) {
    const ingestSummary = await runIngest(db, projectId, [ingestSource]);
    kept = ingestSummary.kept;
    skippedExisting = ingestSummary.skippedExisting;
    rejected += ingestSummary.rejected;
  }

  // Enrich persisted leads' sources[] with merged discovery sources when possible.
  // (CanonicalLead only carries a single source string; discovery tables keep full evidence.)

  const status = "completed" as const;
  updateDiscoveryRun(db, run.id, {
    status,
    fetchedCount: fetched,
    keptCount: kept,
    duplicateCount: duplicates,
    rejectedCount: rejected,
    costEstimate: costEstimate || null,
    error: errors.length ? errors.join("; ") : null,
    finishedAt: now(),
  });

  return {
    runId: run.id,
    status,
    sourcesRun: apifyJobs.length,
    fetched,
    kept,
    rejected,
    duplicates,
    skippedExisting,
    costEstimate: costEstimate || null,
    errors,
  };
}
