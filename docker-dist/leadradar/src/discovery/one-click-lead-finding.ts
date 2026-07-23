import type { DB } from "../db/database.js";
import type { Project } from "../domain/types.js";
import { getProject } from "../projects/projects.repo.js";
import {
  deriveListFocus,
  getActiveLeadListId,
  getLeadList,
  getLeadListCompiledJobsJson,
  getLeadListPayloadJson,
  getLeadListPlanContextHash,
  saveLeadListPlanArtifacts,
  updateLeadListPlan,
} from "../leads/lead-lists.repo.js";
import {
  resolveListHuntConfig,
  resolveListPlan,
} from "../leads/list-hunt-config.js";
import { HermesLeadPlanner } from "./hermes-lead-planner.js";
import {
  serializeLeadPlan,
  clampVolumeTarget,
  type LeadPlan,
  LeadPlanSchema,
} from "./lead-plan.js";
import {
  computePlanContextHash,
  resolvePlanState,
} from "./plan-context-hash.js";
import { ensureProjectWebsiteSummary } from "./project-website-summary.js";
import {
  parseStrategicPayload,
  serializeStrategicPayload,
  type StrategicPayload,
  type StrategicPlannerContext,
} from "./strategic-payload.js";
import {
  strategicPayloadToJobs,
  validateStrategicPayload,
} from "./validate-strategic-payload.js";
import { runLeadFinding, type LeadFindingSummary } from "./run-lead-finding.js";
import type { ApifyClient } from "./apify-client.js";
import type { FetchLike } from "../sources/source.js";
import type { ResolvedListHuntConfig } from "../leads/list-hunt-config.js";
import type { LeadFindingSourceConfig } from "./lead-finding-config.js";
import { buildRunRevisionBrief } from "./run-revision-brief.js";

export interface EnsureLeadPlanOptions {
  leadListId?: number;
  volumeTarget?: number;
  geography?: string | null;
  feedbackNotes?: string | null;
  forceRegenerate?: boolean;
  planner?: HermesLeadPlanner;
  fetch?: FetchLike;
}

function leadPlanFromPayload(
  payload: StrategicPayload,
  feedbackNotes: string | null | undefined,
  generatedBy: "hermes" | "fallback"
): LeadPlan {
  return LeadPlanSchema.parse({
    version: 1,
    mode: "agency",
    goal: payload.goal,
    geography: payload.geography,
    volumeTarget: clampVolumeTarget(payload.volumeTarget),
    intents: [
      "new_startup",
      "needs_website",
      "needs_ai_feature",
      "needs_ai_agent",
      "local_smb_digital",
    ],
    searchAngles: payload.jobs.map((j) => j.reasoning),
    negatives: payload.negatives,
    status: "auto",
    feedbackNotes: feedbackNotes ?? null,
    generatedBy,
    updatedAt: new Date().toISOString(),
  });
}

function resolveLeadListForPlanning(
  db: DB,
  project: Project,
  leadListId?: number
) {
  const listId = leadListId ?? getActiveLeadListId(db, project.id);
  const list = getLeadList(db, listId);
  if (!list || list.projectId !== project.id) {
    throw new Error(`lead list ${listId} not found for project ${project.id}`);
  }
  return list;
}

function existingPlanForList(
  db: DB,
  project: Project,
  list: { id: number; name: string }
): LeadPlan | null {
  return resolveListPlan(db, project, list.id, list.name);
}

function plannerContextForList(
  project: Project,
  list: { name: string; description: string | null; huntConfig?: string | null },
  resolved: ResolvedListHuntConfig,
  options: {
    geography?: string | null;
    volumeTarget?: number;
    feedbackNotes?: string | null;
    existing?: LeadPlan | null;
  }
): StrategicPlannerContext {
  const listFocus = deriveListFocus(list);
  return {
    name: project.name,
    icp: project.icp,
    description: project.description,
    geography:
      options.geography ??
      options.existing?.geography ??
      resolved.geography ??
      null,
    volumeTarget:
      options.volumeTarget ?? options.existing?.volumeTarget ?? resolved.volumeTarget,
    feedbackNotes:
      options.feedbackNotes ?? options.existing?.feedbackNotes ?? null,
    websiteSummary: project.websiteSummary,
    enabledActorKeys: resolved.enabledActorKeys,
    buyerMode: resolved.leadStrategy.buyerMode,
    listName: list.name,
    listDescription: list.description,
    listFocus: listFocus || null,
  };
}

function planContextHashForList(
  project: Project,
  list: { name: string; description: string | null; huntConfig?: string | null },
  listPlan: LeadPlan | null
): string {
  const resolved = resolveListHuntConfig(project, {
    name: list.name,
    huntConfigRaw: list.huntConfig,
    listPlan,
  });
  return computePlanContextHash({
    projectName: project.name,
    websiteSummary: project.websiteSummary,
    description: project.description,
    icp: project.icp,
    listName: list.name,
    listDescription: list.description,
    geography: resolved.geography,
    volumeTarget: resolved.volumeTarget,
    enabledActorKeys: resolved.enabledActorKeys,
  });
}

function tryLoadLockedJobs(
  db: DB,
  listId: number
): {
  payload: StrategicPayload;
  jobs: LeadFindingSourceConfig[];
  maxCandidates: number;
  concurrency: number;
} | null {
  const payloadRaw = getLeadListPayloadJson(db, listId);
  const jobsRaw = getLeadListCompiledJobsJson(db, listId);
  if (!payloadRaw?.trim() || !jobsRaw?.trim()) return null;
  try {
    const parsedPayload =
      typeof payloadRaw === "string" ? JSON.parse(payloadRaw) : payloadRaw;
    const payload = parseStrategicPayload(parsedPayload);
    if (!payload) return null;
    const sources = JSON.parse(jobsRaw) as LeadFindingSourceConfig[];
    if (!Array.isArray(sources) || sources.length === 0) return null;
    const compiled = strategicPayloadToJobs(payload);
    return {
      payload,
      jobs: sources,
      maxCandidates: compiled.maxCandidates,
      concurrency: compiled.concurrency,
    };
  } catch {
    return null;
  }
}

export async function ensureLeadPlan(
  db: DB,
  project: Project,
  options: EnsureLeadPlanOptions = {}
): Promise<{ plan: LeadPlan; fromFallback: boolean; leadListId: number }> {
  const list = resolveLeadListForPlanning(db, project, options.leadListId);
  const existing = existingPlanForList(db, project, list);
  if (
    existing &&
    !options.forceRegenerate &&
    (existing.status === "approved" || existing.status === "auto")
  ) {
    const geoChanging =
      options.geography !== undefined &&
      (options.geography ?? null) !== existing.geography;
    if (!geoChanging) {
      const volume = options.volumeTarget
        ? clampVolumeTarget(options.volumeTarget)
        : existing.volumeTarget;
      if (volume !== existing.volumeTarget && options.volumeTarget) {
        const bumped = {
          ...existing,
          volumeTarget: volume,
          updatedAt: new Date().toISOString(),
        };
        updateLeadListPlan(
          db,
          list.id,
          serializeLeadPlan(bumped),
          planContextHashForList(project, list, bumped)
        );
        return { plan: bumped, fromFallback: false, leadListId: list.id };
      }
      return { plan: existing, fromFallback: false, leadListId: list.id };
    }
  }

  const refreshed = await ensureProjectWebsiteSummary(db, project, {
    fetch: options.fetch,
  });
  const resolved = resolveListHuntConfig(refreshed, {
    name: list.name,
    huntConfigRaw: list.huntConfig,
    listPlan: existing,
  });
  const planner =
    options.planner ??
    new HermesLeadPlanner({ fetch: options.fetch });

  const ctx = plannerContextForList(refreshed, list, resolved, {
    geography: options.geography,
    volumeTarget: options.volumeTarget,
    feedbackNotes: options.feedbackNotes,
    existing,
  });

  const { payload, fromFallback } = await planner.generateStrategicPayload(ctx);

  const validated = validateStrategicPayload(payload, ctx);

  const saved = leadPlanFromPayload(
    validated.payload,
    options.feedbackNotes ?? existing?.feedbackNotes ?? null,
    fromFallback || validated.fromFallback ? "fallback" : "hermes"
  );
  const compiled = strategicPayloadToJobs(validated.payload);
  const planContextHash = planContextHashForList(refreshed, list, saved);
  saveLeadListPlanArtifacts(db, list.id, {
    leadPlanJson: serializeLeadPlan(saved),
    payloadJson: serializeStrategicPayload(validated.payload),
    compiledJobsJson: JSON.stringify(compiled.sources),
    planContextHash,
  });
  return {
    plan: saved,
    fromFallback: fromFallback || validated.fromFallback,
    leadListId: list.id,
  };
}

export interface RunOneClickLeadFindingOptions {
  apifyClient?: ApifyClient;
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  planner?: HermesLeadPlanner;
  volumeTarget?: number;
  geography?: string | null;
  leadListId?: number;
  /** When true, ignore ready stored payload and regenerate with Hermes. */
  forceReplan?: boolean;
}

/** One-click: strategic payload → validate → Apify discovery on active lead list. */
export async function runOneClickLeadFinding(
  db: DB,
  projectId: number,
  options: RunOneClickLeadFindingOptions = {}
): Promise<
  LeadFindingSummary & {
    plan: LeadPlan;
    fromFallback: boolean;
    payload: StrategicPayload;
    leadListId: number;
    usedLockedPlan: boolean;
    usedRevisionBrief: boolean;
  }
> {
  let project = getProject(db, projectId);
  if (!project) throw new Error(`project ${projectId} not found`);

  project = await ensureProjectWebsiteSummary(db, project, {
    fetch: options.fetch,
  });

  const leadListId = options.leadListId ?? getActiveLeadListId(db, projectId);
  const list = getLeadList(db, leadListId);
  if (!list) throw new Error(`lead list ${leadListId} not found`);

  const existingPlan = existingPlanForList(db, project, list);
  const resolved = resolveListHuntConfig(project, {
    name: list.name,
    huntConfigRaw: list.huntConfig,
    listPlan: existingPlan,
  });

  const currentHash = planContextHashForList(project, list, existingPlan);
  const storedHash = getLeadListPlanContextHash(db, leadListId);
  const { planState } = resolvePlanState({
    plan: existingPlan,
    storedHash,
    currentHash,
  });

  const locked =
    !options.forceReplan && planState === "ready"
      ? tryLoadLockedJobs(db, leadListId)
      : null;

  let payload: StrategicPayload;
  let jobs: LeadFindingSourceConfig[];
  let maxCandidates: number;
  let concurrency: number;
  let plan: LeadPlan;
  let fromFallback = false;
  let usedLockedPlan = false;
  let usedRevisionBrief = false;
  let plannerInputJson: string | null = null;
  let plannerRawJson: string | null = null;
  let validationNotes: string | null = null;

  if (locked && existingPlan) {
    usedLockedPlan = true;
    payload = locked.payload;
    jobs = locked.jobs;
    maxCandidates = locked.maxCandidates;
    concurrency = locked.concurrency;
    plan = existingPlan;
    validationNotes = "plan_lock: executed stored ready payload";
    plannerInputJson = JSON.stringify({
      locked: true,
      listId: leadListId,
      planState,
    });
  } else {
    const planner =
      options.planner ??
      new HermesLeadPlanner({ fetch: options.fetch });

    let revisionBrief: ReturnType<typeof buildRunRevisionBrief> = null;
    if (options.forceReplan) {
      try {
        revisionBrief = buildRunRevisionBrief(db, projectId, leadListId);
      } catch {
        revisionBrief = null;
      }
    }
    usedRevisionBrief = Boolean(revisionBrief);

    const ctx = plannerContextForList(project, list, resolved, {
      geography:
        options.geography ??
        existingPlan?.geography ??
        resolved.geography ??
        null,
      volumeTarget:
        options.volumeTarget ??
        existingPlan?.volumeTarget ??
        resolved.volumeTarget,
      feedbackNotes: existingPlan?.feedbackNotes ?? null,
      existing: existingPlan,
    });
    if (revisionBrief) {
      ctx.revisionBrief = revisionBrief;
    }

    const generated = await planner.generateStrategicPayload(ctx);
    const validated = validateStrategicPayload(generated.payload, ctx);
    fromFallback = generated.fromFallback || validated.fromFallback;
    payload = validated.payload;
    plan = leadPlanFromPayload(
      validated.payload,
      existingPlan?.feedbackNotes ?? null,
      fromFallback ? "fallback" : "hermes"
    );
    const compiled = strategicPayloadToJobs(validated.payload);
    jobs = compiled.sources;
    maxCandidates = compiled.maxCandidates;
    concurrency = compiled.concurrency;
    plannerInputJson = JSON.stringify(generated.plannerInput);
    plannerRawJson = generated.raw ? JSON.stringify(generated.raw) : null;
    const noteParts = [
      ...validated.notes,
      ...validated.droppedJobs,
      revisionBrief ? `revised_from_run=#${revisionBrief.runId}` : null,
    ].filter(Boolean);
    validationNotes = noteParts.length ? noteParts.join("; ") : null;

    saveLeadListPlanArtifacts(db, leadListId, {
      leadPlanJson: serializeLeadPlan(plan),
      payloadJson: serializeStrategicPayload(validated.payload),
      compiledJobsJson: JSON.stringify(compiled.sources),
      planContextHash: planContextHashForList(project, list, plan),
    });
  }

  const summary = await runLeadFinding(db, projectId, {
    apifyClient: options.apifyClient,
    env: options.env,
    jobs,
    maxCandidates,
    concurrency,
    leadListId,
    negatives: payload.negatives,
    buyerGate: {
      icp: project.icp,
      geography: plan.geography ?? resolved.geography,
      listFocus: deriveListFocus(list) || null,
    },
    snapshots: {
      plannerInputJson,
      plannerRawJson,
      payloadJson: serializeStrategicPayload(payload),
      compiledJobsJson: JSON.stringify(jobs),
      validationNotes,
    },
  });

  return {
    ...summary,
    plan,
    fromFallback,
    payload,
    leadListId,
    usedLockedPlan,
    usedRevisionBrief,
  };
}
