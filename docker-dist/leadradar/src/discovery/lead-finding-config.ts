import type { Project } from "../domain/types.js";
import type { ApifyResultMapping } from "./map-candidate.js";
import {
  applyQueryTemplates,
  getSourcePack,
} from "./source-packs.js";

export type LeadFindingMode = "apify_first" | "legacy";

export interface LeadFindingSourceConfig {
  id: string;
  type: "apify" | "api" | "csv" | "search";
  enabled?: boolean;
  actorId?: string;
  taskId?: string;
  input?: Record<string, unknown>;
  mapping: ApifyResultMapping;
  allowCompanyOnly?: boolean;
  maxResults?: number;
  timeoutSeconds?: number;
  /** Optional pack query template key for docs/debugging. */
  discoveryQuery?: string;
  /** Strategic payload actor key (google_maps, wellfound_startups, …). */
  actorKey?: string;
}

export interface LeadFindingConfig {
  mode: LeadFindingMode;
  maxCandidates: number;
  maxApifyJobs: number;
  maxRuntimeSecondsPerJob: number;
  concurrency: number;
  pack?: string;
  sources: LeadFindingSourceConfig[];
}

const DEFAULTS: Omit<LeadFindingConfig, "sources"> = {
  mode: "apify_first",
  maxCandidates: 500,
  maxApifyJobs: 10,
  maxRuntimeSecondsPerJob: 600,
  concurrency: 2,
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseMapping(value: unknown): ApifyResultMapping | null {
  const obj = asObject(value);
  if (!obj) return null;
  const companyField =
    typeof obj.companyField === "string" ? obj.companyField.trim() : "";
  const websiteField =
    typeof obj.websiteField === "string" ? obj.websiteField.trim() : "";
  if (!companyField || !websiteField) return null;
  return {
    companyField,
    websiteField,
    sourceUrlField:
      typeof obj.sourceUrlField === "string" ? obj.sourceUrlField : undefined,
    locationField:
      typeof obj.locationField === "string" ? obj.locationField : undefined,
    categoryField:
      typeof obj.categoryField === "string" ? obj.categoryField : undefined,
  };
}

function parseSource(value: unknown): LeadFindingSourceConfig | null {
  const obj = asObject(value);
  if (!obj) return null;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const type = obj.type;
  const mapping = parseMapping(obj.mapping);
  if (!id || !mapping) return null;
  if (type !== "apify" && type !== "api" && type !== "csv" && type !== "search") {
    return null;
  }
  return {
    id,
    type,
    enabled: obj.enabled !== false,
    actorId: typeof obj.actorId === "string" ? obj.actorId : undefined,
    taskId: typeof obj.taskId === "string" ? obj.taskId : undefined,
    input: asObject(obj.input) ?? undefined,
    mapping,
    allowCompanyOnly: obj.allowCompanyOnly === true,
    maxResults:
      typeof obj.maxResults === "number" ? obj.maxResults : undefined,
    timeoutSeconds:
      typeof obj.timeoutSeconds === "number" ? obj.timeoutSeconds : undefined,
    discoveryQuery:
      typeof obj.discoveryQuery === "string" ? obj.discoveryQuery : undefined,
  };
}

export function parseLeadFindingConfig(
  sourceConfig: unknown
): LeadFindingConfig {
  const root = asObject(sourceConfig) ?? {};
  const lf = asObject(root.leadFinding) ?? {};

  const sourcesRaw = Array.isArray(lf.sources) ? lf.sources : [];
  const sources = sourcesRaw
    .map(parseSource)
    .filter((s): s is LeadFindingSourceConfig => s != null && s.enabled !== false);

  return {
    mode:
      lf.mode === "legacy" || lf.mode === "apify_first"
        ? lf.mode
        : DEFAULTS.mode,
    maxCandidates:
      typeof lf.maxCandidates === "number" && lf.maxCandidates > 0
        ? lf.maxCandidates
        : DEFAULTS.maxCandidates,
    maxApifyJobs:
      typeof lf.maxApifyJobs === "number" && lf.maxApifyJobs > 0
        ? lf.maxApifyJobs
        : DEFAULTS.maxApifyJobs,
    maxRuntimeSecondsPerJob:
      typeof lf.maxRuntimeSecondsPerJob === "number" &&
      lf.maxRuntimeSecondsPerJob > 0
        ? lf.maxRuntimeSecondsPerJob
        : DEFAULTS.maxRuntimeSecondsPerJob,
    concurrency:
      typeof lf.concurrency === "number" && lf.concurrency > 0
        ? lf.concurrency
        : DEFAULTS.concurrency,
    pack: typeof lf.pack === "string" ? lf.pack : undefined,
    sources,
  };
}

export function parseLeadFindingConfigFromProjectJson(
  sourceConfigJson: string | null | undefined
): LeadFindingConfig {
  if (!sourceConfigJson?.trim()) return { ...DEFAULTS, sources: [] };
  try {
    return parseLeadFindingConfig(JSON.parse(sourceConfigJson));
  } catch {
    throw new Error("Invalid sourceConfig JSON for leadFinding");
  }
}

function inferPackId(project: Project): string {
  const hay = `${project.icp ?? ""} ${project.description ?? ""} ${project.name}`.toLowerCase();
  if (/\b(restaurant|local|maps|city|storefront|salon|clinic)\b/.test(hay)) {
    return "local_business";
  }
  if (/\b(shopify|ecommerce|e-commerce|store|dtc)\b/.test(hay)) {
    return "ecommerce";
  }
  if (/\b(hiring|job|recruit|career)\b/.test(hay)) {
    return "hiring_intent";
  }
  if (/\b(saas|startup|product hunt|b2b)\b/.test(hay)) {
    return "saas_startup";
  }
  return "b2b_general";
}

function templateVars(project: Project): Record<string, string> {
  const icp = project.icp?.trim() || project.description?.trim() || project.name;
  return {
    niche: icp,
    category: icp,
    city: "New York",
    role: "founder",
  };
}

export interface ResolveLeadFindingJobsOptions {
  project: Project;
  env?: NodeJS.ProcessEnv;
  config?: LeadFindingConfig;
}

/** Build enabled source jobs from explicit config or inferred pack. */
export function resolveLeadFindingJobs(
  options: ResolveLeadFindingJobsOptions
): LeadFindingSourceConfig[] {
  const config =
    options.config ??
    parseLeadFindingConfigFromProjectJson(options.project.sourceConfig);

  let sources = config.sources;
  if (sources.length === 0) {
    const packId = config.pack ?? inferPackId(options.project);
    sources = getSourcePack(packId).sources;
  }

  const enabled = sources.filter((s) => s.enabled !== false);
  const templated = applyQueryTemplates(enabled, templateVars(options.project));
  return templated.slice(0, config.maxApifyJobs);
}
