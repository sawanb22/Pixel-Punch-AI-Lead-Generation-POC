import {
  ACTOR_CATALOG,
  type ActorKey,
  isActorKey,
} from "./actor-catalog.js";
import type { LeadFindingSourceConfig } from "./lead-finding-config.js";
import { clampVolumeTarget } from "./lead-plan.js";
import {
  defaultStrategicPayload,
  mappingForJob,
  parseStrategicPayload,
  type StrategicPayload,
  type StrategicPayloadJob,
  type StrategicPlannerContext,
} from "./strategic-payload.js";

export interface ValidateStrategicPayloadResult {
  payload: StrategicPayload;
  fromFallback: boolean;
  notes: string[];
  droppedJobs: string[];
}

function bannedTokens(
  negatives: string[],
  feedbackNotes: string | null | undefined
): string[] {
  const tokens = new Set<string>();
  for (const n of negatives) {
    const t = n.trim().toLowerCase();
    if (t.length >= 3) tokens.add(t);
  }
  if (feedbackNotes) {
    for (const part of feedbackNotes.split(/[,;\n]+/)) {
      const t = part.trim().toLowerCase();
      if (t.startsWith("avoid ") || t.startsWith("no ")) {
        const rest = t.replace(/^(avoid|no)\s+/, "");
        if (rest.length >= 3) tokens.add(rest);
      }
    }
  }
  // Always-on vendor/media bans for agency buyer hunts
  for (const hard of [
    "visa.com",
    "mastercard",
    "stripe.com",
    "razorpay",
    "paypal.com",
    "forbes.com",
    "medium.com",
    "wikipedia.org",
  ]) {
    tokens.add(hard);
  }
  return [...tokens];
}

function inputContainsBanned(
  input: Record<string, unknown>,
  tokens: string[]
): string | null {
  const blob = JSON.stringify(input).toLowerCase();
  for (const token of tokens) {
    if (blob.includes(token)) return token;
  }
  return null;
}

function maxJobsForVolume(volume: number): number {
  if (volume >= 1000) return 6;
  if (volume >= 500) return 5;
  if (volume >= 250) return 4;
  return 3;
}

function capApifyInput(
  actorKey: ActorKey,
  input: Record<string, unknown>,
  volume: number
): Record<string, unknown> {
  const next = { ...input };
  if (actorKey === "google_maps") {
    const places =
      volume >= 1000 ? 80 : volume >= 500 ? 50 : volume >= 100 ? 25 : 15;
    if (typeof next.maxCrawledPlacesPerSearch !== "number") {
      next.maxCrawledPlacesPerSearch = places;
    } else {
      next.maxCrawledPlacesPerSearch = Math.min(
        Number(next.maxCrawledPlacesPerSearch),
        places
      );
    }
    if (!next.language) next.language = "en";
  }
  if (actorKey === "google_search") {
    if (next.csvFriendlyOutput === undefined) next.csvFriendlyOutput = true;
    if (!next.languageCode) next.languageCode = "en";
    const pages =
      volume >= 1000 ? 8 : volume >= 500 ? 6 : volume >= 100 ? 4 : 3;
    if (typeof next.maxPagesPerQuery !== "number") {
      next.maxPagesPerQuery = pages;
    } else {
      next.maxPagesPerQuery = Math.min(Number(next.maxPagesPerQuery), pages);
    }
  }
  if (actorKey === "wellfound_startups" || actorKey === "linkedin_jobs") {
    const limit = Math.min(volume, 100);
    if (typeof next.limit !== "number" && typeof next.count !== "number") {
      next.limit = limit;
    }
  }
  return next;
}

export function validateStrategicPayload(
  raw: unknown,
  ctx: StrategicPlannerContext
): ValidateStrategicPayloadResult {
  const notes: string[] = [];
  const droppedJobs: string[] = [];
  const enabled = new Set(
    ctx.enabledActorKeys.filter(isActorKey) as ActorKey[]
  );
  const volume = clampVolumeTarget(ctx.volumeTarget ?? 100);
  const parsed = parseStrategicPayload(raw);

  if (!parsed) {
    notes.push("invalid_payload_schema; using fallback");
    return {
      payload: defaultStrategicPayload(ctx),
      fromFallback: true,
      notes,
      droppedJobs,
    };
  }

  const tokens = bannedTokens(parsed.negatives, ctx.feedbackNotes);
  const keptJobs: StrategicPayloadJob[] = [];

  for (const job of parsed.jobs) {
    if (!isActorKey(job.actorKey) || !enabled.has(job.actorKey)) {
      droppedJobs.push(`${job.jobId}: actor_not_in_pool (${job.actorKey})`);
      continue;
    }
    const banned = inputContainsBanned(job.apifyInput, tokens);
    if (banned) {
      droppedJobs.push(`${job.jobId}: banned_token (${banned})`);
      continue;
    }
    keptJobs.push({
      ...job,
      apifyInput: capApifyInput(job.actorKey, job.apifyInput, volume),
      mapping: mappingForJob(job),
    });
  }

  const maxJobs = maxJobsForVolume(volume);
  const capped = keptJobs.slice(0, maxJobs);
  if (keptJobs.length > maxJobs) {
    notes.push(`capped_jobs_to_${maxJobs}`);
  }
  if (droppedJobs.length) {
    notes.push(`dropped_${droppedJobs.length}_jobs`);
  }

  if (capped.length === 0) {
    notes.push("no_valid_jobs; using fallback");
    return {
      payload: defaultStrategicPayload(ctx),
      fromFallback: true,
      notes,
      droppedJobs,
    };
  }

  return {
    payload: {
      version: 1,
      goal: parsed.goal,
      geography: parsed.geography ?? ctx.geography ?? null,
      volumeTarget: volume,
      negatives: parsed.negatives,
      jobs: capped,
    },
    fromFallback: false,
    notes,
    droppedJobs,
  };
}

export function strategicPayloadToJobs(
  payload: StrategicPayload
): {
  sources: LeadFindingSourceConfig[];
  maxCandidates: number;
  maxApifyJobs: number;
  concurrency: number;
} {
  const volume = clampVolumeTarget(payload.volumeTarget);
  const sources: LeadFindingSourceConfig[] = payload.jobs.map((job, i) => {
    const entry = ACTOR_CATALOG[job.actorKey as ActorKey];
    return {
      id: job.jobId || `apify-${job.actorKey}-${i + 1}`,
      type: "apify" as const,
      enabled: true,
      actorId: entry?.actorId,
      discoveryQuery: job.reasoning,
      input: job.apifyInput,
      mapping: mappingForJob(job),
      actorKey: job.actorKey,
    } as LeadFindingSourceConfig & { actorKey?: string };
  });

  return {
    sources,
    maxCandidates: volume,
    maxApifyJobs: sources.length,
    concurrency: volume >= 500 ? 3 : 2,
  };
}
