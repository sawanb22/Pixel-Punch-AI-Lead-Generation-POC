import type { DB } from "../db/database.js";
import type { CanonicalLead } from "../domain/types.js";
import { getProject } from "../projects/projects.repo.js";
import { runIngest } from "../ingest/run-ingest.js";
import type { Source } from "../sources/source.js";
import { ApifyClient } from "./apify-client.js";
import { ApifyActorSource } from "./apify-source.js";
import { gateCandidates } from "./buyer-evidence-gate.js";
import {
  createCircuitBreakerState,
  recordJobOutcome,
  shouldStopFurtherJobs,
} from "./circuit-breaker.js";
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
import { insertLeads } from "../leads/leads.repo.js";
import { canonicalDomain } from "../validation/canonicalize.js";
import type { DedupedLead } from "../validation/dedup.js";
import { leadIdentityKey } from "../validation/dedup.js";
import { listLeads } from "../leads/leads.repo.js";

export interface LeadFindingSummary {
  runId: number;
  status: "completed" | "failed";
  sourcesRun: number;
  fetched: number;
  kept: number;
  provisional: number;
  rejected: number;
  duplicates: number;
  skippedExisting: number;
  costEstimate: number | null;
  errors: string[];
  circuitBreakerTripped: boolean;
  circuitBreakerReason: string | null;
}

export interface RunLeadFindingOptions {
  apifyClient?: ApifyClient;
  env?: NodeJS.ProcessEnv;
  concurrency?: number;
  now?: () => string;
  /** When set, use these Apify jobs instead of parsing source_config. */
  jobs?: LeadFindingSourceConfig[];
  maxCandidates?: number;
  leadListId?: number | null;
  negatives?: string[];
  buyerGate?: {
    icp?: string | null;
    geography?: string | null;
    listFocus?: string | null;
  };
  /** Skip buyer evidence gate (tests / legacy). Default false. */
  skipBuyerGate?: boolean;
  snapshots?: {
    plannerInputJson?: string | null;
    plannerRawJson?: string | null;
    payloadJson?: string | null;
    compiledJobsJson?: string | null;
    validationNotes?: string | null;
  };
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

function toDedupedLead(c: DiscoveredCompanyCandidate): DedupedLead {
  const lead = toCanonicalLead(c);
  return {
    ...lead,
    canonicalDomain: c.domain ?? (c.website ? canonicalDomain(c.website) : null),
    sources: c.source.split(",").map((s) => s.trim()).filter(Boolean),
  };
}

function filterNovel(
  db: DB,
  projectId: number,
  leads: DedupedLead[],
  leadListId?: number | null
): { novel: DedupedLead[]; skipped: number } {
  const existing = listLeads(db, projectId, leadListId);
  const keys = new Set(
    existing.map((l) =>
      leadIdentityKey({
        company: l.company,
        website: l.website,
        canonicalDomain: l.canonicalDomain,
      })
    )
  );
  const novel: DedupedLead[] = [];
  let skipped = 0;
  for (const lead of leads) {
    const key = leadIdentityKey(lead);
    if (keys.has(key)) {
      skipped++;
      continue;
    }
    keys.add(key);
    novel.push(lead);
  }
  return { novel, skipped };
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

  const run = createDiscoveryRun(db, {
    projectId,
    leadListId: options.leadListId ?? null,
    status: "running",
    plannerInputJson: options.snapshots?.plannerInputJson ?? null,
    plannerRawJson: options.snapshots?.plannerRawJson ?? null,
    payloadJson: options.snapshots?.payloadJson ?? null,
    compiledJobsJson: options.snapshots?.compiledJobsJson ?? null,
    validationNotes: options.snapshots?.validationNotes ?? null,
  });
  const errors: string[] = [];
  let fetched = 0;
  let rejected = 0;
  let costEstimate = 0;
  const allCandidates: DiscoveredCompanyCandidate[] = [];
  const allRejected: DiscoveredCompanyCandidate[] = [];
  let breaker = createCircuitBreakerState();
  let sourcesRun = 0;

  // Sequential jobs so circuit breaker can stop further Apify spend.
  for (const jobConfig of apifyJobs) {
    if (shouldStopFurtherJobs(breaker)) {
      errors.push(`circuit_breaker: skipped remaining jobs (${breaker.reason})`);
      break;
    }

    const sourceJobId = createSourceJob(db, {
      runId: run.id,
      sourceId: jobConfig.id,
      sourceType: "apify",
      status: "running",
      actorId: jobConfig.actorId ?? null,
      taskId: jobConfig.taskId ?? null,
    }).id;
    sourcesRun++;

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
        actorKey: jobConfig.actorKey,
        negatives: options.negatives,
        timeoutMs:
          (jobConfig.timeoutSeconds ?? config.maxRuntimeSecondsPerJob) * 1000,
      });
      const result = await source.fetchCandidates();
      fetched += result.fetched;
      rejected += result.rejected.length;
      if (result.costEstimate) costEstimate += result.costEstimate;
      allCandidates.push(...result.candidates);
      allRejected.push(...result.rejected);

      breaker = recordJobOutcome(breaker, {
        fetched: result.fetched,
        kept: result.candidates.length,
        rejected: result.rejected.length,
      });

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
  }

  const { kept: deduped, duplicates } = dedupeCandidates(allCandidates);
  const capped = deduped.slice(0, maxCandidates);

  let fit = capped;
  let maybe: DiscoveredCompanyCandidate[] = [];
  let gateRejected: DiscoveredCompanyCandidate[] = [];

  if (!options.skipBuyerGate) {
    const gated = gateCandidates(capped, {
      icp: options.buyerGate?.icp ?? project.icp,
      geography: options.buyerGate?.geography ?? null,
      listFocus: options.buyerGate?.listFocus ?? null,
      negatives: options.negatives,
    });
    fit = gated.fit;
    maybe = gated.maybe;
    gateRejected = gated.rejected;
    rejected += gateRejected.length;
  }

  insertDiscoveredCandidates(db, [
    ...fit.map((c) => ({
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
    ...maybe.map((c) => ({
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
      rejectionReason: "provisional",
    })),
    ...[...allRejected, ...gateRejected].map((c) => ({
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

  let kept = 0;
  let provisional = 0;
  let skippedExisting = 0;

  if (fit.length > 0) {
    const ingestSource: Source = {
      name: "lead-finding",
      fetch: async () => fit.map(toCanonicalLead),
    };
    const ingestSummary = await runIngest(db, projectId, [ingestSource], {
      leadListId: options.leadListId ?? null,
    });
    kept = ingestSummary.kept;
    skippedExisting += ingestSummary.skippedExisting;
    rejected += ingestSummary.rejected;
  }

  if (maybe.length > 0) {
    const provisionalLeads = maybe.map(toDedupedLead);
    const { novel, skipped } = filterNovel(
      db,
      projectId,
      provisionalLeads,
      options.leadListId ?? null
    );
    skippedExisting += skipped;
    if (novel.length) {
      insertLeads(
        db,
        projectId,
        novel,
        options.leadListId ?? null,
        "provisional"
      );
      provisional = novel.length;
    }
  }

  const noteParts = [
    options.snapshots?.validationNotes,
    breaker.tripped ? `circuit_breaker: ${breaker.reason}` : null,
    provisional > 0 ? `provisional=${provisional}` : null,
  ].filter(Boolean);

  const status = "completed" as const;
  updateDiscoveryRun(db, run.id, {
    status,
    fetchedCount: fetched,
    keptCount: kept,
    duplicateCount: duplicates,
    rejectedCount: rejected,
    costEstimate: costEstimate || null,
    error: errors.length ? errors.join("; ") : null,
    validationNotes: noteParts.length ? noteParts.join("; ") : null,
    finishedAt: now(),
  });

  return {
    runId: run.id,
    status,
    sourcesRun,
    fetched,
    kept,
    provisional,
    rejected,
    duplicates,
    skippedExisting,
    costEstimate: costEstimate || null,
    errors,
    circuitBreakerTripped: breaker.tripped,
    circuitBreakerReason: breaker.reason,
  };
}
