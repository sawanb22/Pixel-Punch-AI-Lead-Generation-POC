import type { DB } from "../db/database.js";
import type { Project } from "../domain/types.js";
import { getProject, updateProject } from "../projects/projects.repo.js";
import { compileLeadPlanToApifyJobs } from "./compile-lead-plan.js";
import { HermesLeadPlanner } from "./hermes-lead-planner.js";
import {
  defaultAgencyLeadPlan,
  parseLeadPlan,
  serializeLeadPlan,
  clampVolumeTarget,
  type LeadPlan,
} from "./lead-plan.js";
import { runLeadFinding, type LeadFindingSummary } from "./run-lead-finding.js";
import type { ApifyClient } from "./apify-client.js";
import type { FetchLike } from "../sources/source.js";

export interface EnsureLeadPlanOptions {
  volumeTarget?: number;
  geography?: string | null;
  feedbackNotes?: string | null;
  forceRegenerate?: boolean;
  planner?: HermesLeadPlanner;
  fetch?: FetchLike;
}

export async function ensureLeadPlan(
  db: DB,
  project: Project,
  options: EnsureLeadPlanOptions = {}
): Promise<{ plan: LeadPlan; fromFallback: boolean }> {
  const existing = parseLeadPlan(project.leadPlan);
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
        updateProject(db, project.id, { leadPlan: serializeLeadPlan(bumped) });
        return { plan: bumped, fromFallback: false };
      }
      return { plan: existing, fromFallback: false };
    }
  }

  const planner =
    options.planner ??
    new HermesLeadPlanner({ fetch: options.fetch });
  const { plan, fromFallback } = await planner.generatePlan({
    name: project.name,
    icp: project.icp,
    description: project.description,
    geography: options.geography ?? existing?.geography ?? null,
    volumeTarget:
      options.volumeTarget ?? existing?.volumeTarget ?? 100,
    feedbackNotes: options.feedbackNotes ?? existing?.feedbackNotes ?? null,
  });

  const saved: LeadPlan = {
    ...plan,
    status: "auto",
    updatedAt: new Date().toISOString(),
  };
  updateProject(db, project.id, { leadPlan: serializeLeadPlan(saved) });
  return { plan: saved, fromFallback };
}

export interface RunOneClickLeadFindingOptions {
  apifyClient?: ApifyClient;
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  planner?: HermesLeadPlanner;
  volumeTarget?: number;
  geography?: string | null;
}

/** One-click: ensure plan → compile Apify jobs → run discovery. */
export async function runOneClickLeadFinding(
  db: DB,
  projectId: number,
  options: RunOneClickLeadFindingOptions = {}
): Promise<LeadFindingSummary & { plan: LeadPlan; fromFallback: boolean }> {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`project ${projectId} not found`);

  const { plan, fromFallback } = await ensureLeadPlan(db, project, {
    volumeTarget: options.volumeTarget,
    geography: options.geography,
    planner: options.planner,
    fetch: options.fetch,
  });

  const compiled = compileLeadPlanToApifyJobs(plan);
  const summary = await runLeadFinding(db, projectId, {
    apifyClient: options.apifyClient,
    env: options.env,
    jobs: compiled.sources,
    maxCandidates: compiled.maxCandidates,
    concurrency: compiled.concurrency,
  });

  return { ...summary, plan, fromFallback };
}
