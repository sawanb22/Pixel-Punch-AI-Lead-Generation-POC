import { z } from "zod";
import {
  ACTOR_CATALOG,
  DEFAULT_AGENCY_ACTOR_KEYS,
  type ActorKey,
  findActorEntry,
  isActorKey,
} from "./actor-catalog.js";
import type { LeadStrategy } from "./lead-strategy.js";
import type { ApifyResultMapping } from "./map-candidate.js";
import { clampVolumeTarget } from "./lead-plan.js";
import type { RunRevisionBrief } from "./run-revision-brief.js";

const MappingSchema = z.object({
  companyField: z.string().min(1),
  websiteField: z.string().min(1),
  sourceUrlField: z.string().optional(),
  locationField: z.string().optional(),
  categoryField: z.string().optional(),
});

export const StrategicPayloadJobSchema = z.object({
  jobId: z.string().min(1),
  actorKey: z.string().optional(),
  actorId: z.string().min(1),
  reasoning: z.string().min(1),
  apifyInput: z.record(z.string(), z.unknown()),
  mapping: MappingSchema.optional(),
});

export const StrategicPayloadSchema = z.object({
  version: z.literal(1),
  goal: z.string().min(1),
  geography: z.string().nullable(),
  volumeTarget: z.number().int().positive().max(2000),
  negatives: z.array(z.string()).default([]),
  jobs: z.array(StrategicPayloadJobSchema).min(1),
});

export type StrategicPayloadJob = z.infer<typeof StrategicPayloadJobSchema>;
export type StrategicPayload = z.infer<typeof StrategicPayloadSchema>;

export interface StrategicPlannerContext {
  name: string;
  icp?: string | null;
  description?: string | null;
  geography?: string | null;
  volumeTarget?: number;
  feedbackNotes?: string | null;
  websiteSummary?: string | null;
  enabledActorKeys?: ActorKey[];
  buyerMode?: LeadStrategy["buyerMode"];
  listName?: string | null;
  listDescription?: string | null;
  listFocus?: string | null;
  /** Compact last-hunt summary for Force replan (lean — no raw leads). */
  revisionBrief?: RunRevisionBrief | null;
}

const US_HUBS = ["Chicago", "Austin", "New York", "Los Angeles", "Miami"];

function placesForVolume(volume: number): number {
  if (volume >= 1000) return 80;
  if (volume >= 500) return 50;
  if (volume >= 250) return 40;
  if (volume >= 100) return 25;
  return 15;
}

function mapsSearchStrings(
  niche: string,
  geography: string | null
): string[] {
  const hubs =
    geography && !/united states|usa|us\b/i.test(geography)
      ? [geography]
      : US_HUBS.slice(0, 3);
  const verticals = [
    "software company",
    "startup office",
    "marketing agency",
    "professional services",
  ];
  const out: string[] = [];
  for (const hub of hubs) {
    for (const v of verticals.slice(0, 2)) {
      out.push(`${v} ${hub}`);
    }
  }
  if (niche) out.push(`${niche} ${hubs[0]}`);
  return out.slice(0, 6);
}

/** Deterministic payload when Hermes fails or validation rejects everything. */
export function defaultStrategicPayload(
  ctx: StrategicPlannerContext
): StrategicPayload {
  const volume = clampVolumeTarget(ctx.volumeTarget ?? 100);
  const geo = ctx.geography?.trim() || "USA";
  const niche =
    ctx.listFocus?.trim() ||
    ctx.icp?.trim() ||
    ctx.description?.trim() ||
    `${ctx.name} client services`;
  const focusLabel = ctx.listFocus?.trim() || ctx.listName?.trim();
  const goal = focusLabel
    ? `Find buyer companies for list "${focusLabel}" (${niche}) in ${geo}.`
    : `Find buyer companies for ${ctx.name} (${niche}) in ${geo}.`;
  const enabled = (ctx.enabledActorKeys || []).filter(isActorKey);
  const keys =
    enabled.length > 0 ? enabled : [...DEFAULT_AGENCY_ACTOR_KEYS];

  const jobs: StrategicPayloadJob[] = [];

  if (keys.includes("google_maps")) {
    jobs.push({
      jobId: "fallback-maps-1",
      actorKey: "google_maps",
      actorId: ACTOR_CATALOG.google_maps.actorId,
      reasoning:
        "Fallback Maps hunt for local SMBs/startups likely to need agency builds.",
      apifyInput: {
        searchStringsArray: mapsSearchStrings(niche, geo),
        maxCrawledPlacesPerSearch: placesForVolume(volume),
        language: "en",
      },
      mapping: ACTOR_CATALOG.google_maps.defaultMapping,
    });
  }

  if (keys.includes("wellfound_startups")) {
    jobs.push({
      jobId: "fallback-wellfound-1",
      actorKey: "wellfound_startups",
      actorId: ACTOR_CATALOG.wellfound_startups.actorId,
      reasoning:
        "Fallback Wellfound hunt for US startups with hiring/growth signal.",
      apifyInput: {
        query: "software engineer OR full stack",
        location: geo === "USA" ? "United States" : geo,
        limit: Math.min(volume, 100),
      },
      mapping: ACTOR_CATALOG.wellfound_startups.defaultMapping,
    });
  }

  if (keys.includes("linkedin_jobs") && jobs.length < 2) {
    jobs.push({
      jobId: "fallback-linkedin-1",
      actorKey: "linkedin_jobs",
      actorId: ACTOR_CATALOG.linkedin_jobs.actorId,
      reasoning: "Fallback LinkedIn jobs for companies hiring engineers.",
      apifyInput: {
        title: "software engineer",
        location: geo === "USA" ? "United States" : geo,
        count: Math.min(volume, 50),
      },
      mapping: ACTOR_CATALOG.linkedin_jobs.defaultMapping,
    });
  }

  if (keys.includes("google_search") && jobs.length === 0) {
    jobs.push({
      jobId: "fallback-search-1",
      actorKey: "google_search",
      actorId: ACTOR_CATALOG.google_search.actorId,
      reasoning:
        "Fallback narrow Google queries for companies needing websites/AI help.",
      apifyInput: {
        queries: [
          `startup "looking for" website OR "need a website" ${geo}`,
          `"just launched" SaaS hiring engineer ${geo}`,
          `small business website redesign ${geo}`,
        ].join("\n"),
        maxPagesPerQuery: 3,
        resultsPerPage: 10,
        languageCode: "en",
        csvFriendlyOutput: true,
      },
      mapping: ACTOR_CATALOG.google_search.defaultMapping,
    });
  }

  if (jobs.length === 0 && keys[0]) {
    const key = keys[0];
    jobs.push({
      jobId: `fallback-${key}-1`,
      actorKey: key,
      actorId: ACTOR_CATALOG[key].actorId,
      reasoning: `Fallback single job for ${key}.`,
      apifyInput: {},
      mapping: ACTOR_CATALOG[key].defaultMapping,
    });
  }

  return StrategicPayloadSchema.parse({
    version: 1,
    goal,
    geography: geo,
    volumeTarget: volume,
    negatives: [
      "directories",
      "job boards as company website",
      "social-only profiles",
      "listicle pages",
      "visa",
      "stripe",
      "razorpay",
      "forbes",
      "medium.com",
    ],
    jobs,
  });
}

export function parseStrategicPayload(
  raw: unknown
): StrategicPayload | null {
  if (raw && typeof raw === "object" && "jobs" in raw && Array.isArray((raw as Record<string, unknown>).jobs)) {
    const rawObj = raw as Record<string, unknown>;
    const normJobs = (rawObj.jobs as Array<Record<string, unknown>>).map((j) => {
      if (j && typeof j === "object") {
        const actorKey = typeof j.actorKey === "string" ? j.actorKey : undefined;
        const entry = actorKey ? findActorEntry(actorKey) : undefined;
        const actorId =
          typeof j.actorId === "string" && j.actorId.trim()
            ? j.actorId
            : entry?.actorId ?? actorKey ?? "unknown";
        return { ...j, actorId };
      }
      return j;
    });
    const result = StrategicPayloadSchema.safeParse({ ...rawObj, jobs: normJobs });
    return result.success ? result.data : null;
  }
  const result = StrategicPayloadSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function serializeStrategicPayload(payload: StrategicPayload): string {
  return JSON.stringify(StrategicPayloadSchema.parse(payload));
}

export function mappingForJob(
  job: StrategicPayloadJob
): ApifyResultMapping {
  if (job.mapping) return job.mapping;
  const entry = findActorEntry(job.actorKey || "") || findActorEntry(job.actorId || "");
  return entry?.defaultMapping ?? {
    companyField: "title",
    websiteField: "url",
    sourceUrlField: "url",
  };
}
