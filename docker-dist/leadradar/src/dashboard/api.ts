import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import type { DB } from "../db/database.js";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "../projects/projects.repo.js";
import {
  getLead,
  listLeadsFiltered,
  setLeadStatus,
  type LeadFilter,
} from "../leads/leads.repo.js";
import {
  activateLeadList,
  clearLeadList,
  createLeadList,
  deleteLeadList,
  ensureDefaultLeadList,
  getActiveLeadListId,
  getLeadList,
  listLeadLists,
  updateLeadList,
  updateLeadListPlan,
} from "../leads/lead-lists.repo.js";
import {
  huntConfigTemplateFromProject,
  mergeListHuntConfig,
  parseListHuntConfig,
  resolveListHuntConfig,
  serializeListHuntConfig,
  type ListHuntConfig,
} from "../leads/list-hunt-config.js";
import type { ActorKey } from "../discovery/actor-catalog.js";
import { recordFeedback, getFeedbackStats } from "../feedback/feedback.repo.js";
import { exportLeadsCsv, type ExportPreset } from "../export/csv-export.js";
import { parseCsvSource, type ColumnMapping } from "../sources/csv-source.js";
import { runIngest } from "../ingest/run-ingest.js";
import { runScoring } from "../scoring/run-scoring.js";
import type { Scorer } from "../scoring/scorer.js";
import type { Source, FetchLike } from "../sources/source.js";
import {
  createConfiguredSources,
  parseSourceConfig,
  type CreateConfiguredSourcesOptions,
} from "../sources/registry.js";
import type { MxResolver } from "../validation/email-check.js";
import type { AuthUser } from "./auth.js";
import type { ApifyClient } from "../discovery/apify-client.js";
import { runCompanyEnrichment } from "../enrichment/run-company-enrichment.js";
import { getCompanyProfile, listEnrichedDomains } from "../enrichment/enrichment.repo.js";
import { runContactFinding } from "../contacts/run-contact-finding.js";
import {
  listContactsForLead,
  listContactsForProject,
  contactCountsByLead,
} from "../contacts/contacts.repo.js";
import { runProviderHealthCheck } from "../operations/health.js";
import {
  createOpsRun,
  addLogToRun,
  completeOpsRun,
  listOpsRuns,
  getOpsRun,
  listLogsForRun,
} from "../operations/ops.repo.js";
import {

  ensureLeadPlan,
  runOneClickLeadFinding,
} from "../discovery/one-click-lead-finding.js";
import {
  parseLeadPlan,
  serializeLeadPlan,
} from "../discovery/lead-plan.js";
import { leadPlanResponseForList, planContextForList } from "../discovery/lead-plan-response.js";
import type { HermesLeadPlanner } from "../discovery/hermes-lead-planner.js";
import {
  DASHBOARD_API_FEATURES,
  DASHBOARD_API_VERSION,
} from "./api-version.js";
import {
  getDiscoveryRun,
  getLatestDiscoveryRunForProject,
  listDiscoveryRunsForProject,
  listSourceJobs,
  listDiscoveredCandidates,
} from "../discovery/discovery.repo.js";
import {
  resolveProjectLeadStrategy,
  serializeLeadStrategy,
  defaultLeadStrategy,
} from "../discovery/lead-strategy.js";
import { listActorCatalog } from "../discovery/actor-catalog.js";
import { ensureProjectWebsiteSummary } from "../discovery/project-website-summary.js";
import { parseStrategicPayload } from "../discovery/strategic-payload.js";

export interface ApiOptions {
  db: DB;
  scorer: Scorer;
  /** Optional MX resolver (tests inject a stub to avoid live DNS). */
  mxResolver?: MxResolver;
  /** Injectable fetch for live-source ingest (tests). */
  ingestFetch?: FetchLike;
  /** Injectable fetch for company enrichment crawler (tests). */
  enrichFetch?: FetchLike;
  /** Env override for source credentials (tests). */
  ingestEnv?: NodeJS.ProcessEnv;
  /** Override source builder (tests). */
  createConfiguredSourcesFn?: typeof createConfiguredSources;
  /** Injectable Apify client for lead finding (tests). */
  apifyClient?: ApifyClient;
  /** Injectable Hermes lead planner (tests). */
  leadPlanner?: HermesLeadPlanner;
}

const upload = multer({ storage: multer.memoryStorage() });

function parseFilter(query: Request["query"], leadListId?: number | null): LeadFilter {
  const filter: LeadFilter = {};
  if (leadListId != null) filter.leadListId = leadListId;
  if (typeof query.status === "string" && query.status) {
    filter.status = query.status;
  }
  if (typeof query.minScore === "string" && query.minScore !== "") {
    const n = Number(query.minScore);
    if (Number.isFinite(n)) filter.minScore = n;
  }
  if (typeof query.source === "string" && query.source) {
    filter.source = query.source;
  }
  if (typeof query.q === "string" && query.q) {
    filter.q = query.q;
  }
  return filter;
}

function projectIdParam(req: Request): number {
  return Number(req.params.id);
}

function leadIdParam(req: Request): number {
  return Number(req.params.leadId);
}

function listIdParam(req: Request): number {
  return Number(req.params.listId);
}

type LeadListScope = {
  project: NonNullable<ReturnType<typeof getProject>>;
  list: NonNullable<ReturnType<typeof getLeadList>>;
};

function requireLeadListScope(
  db: DB,
  projectId: number,
  listId: number
): LeadListScope | { error: string; status: number } {
  const project = getProject(db, projectId);
  if (!project) return { error: "project not found", status: 404 };
  const list = getLeadList(db, listId);
  if (!list || list.projectId !== projectId) {
    return { error: "lead list not found", status: 404 };
  }
  return { project, list };
}

function persistListPlanWithHash(
  db: DB,
  project: NonNullable<ReturnType<typeof getProject>>,
  list: NonNullable<ReturnType<typeof getLeadList>>,
  planJson: string
): void {
  const ctx = planContextForList(db, project, list);
  updateLeadListPlan(db, list.id, planJson, ctx.currentHash);
}

function leadPlanJsonResponse(
  db: DB,
  project: NonNullable<ReturnType<typeof getProject>>,
  leadListId: number,
  extra: Record<string, unknown> = {}
) {
  const view = leadPlanResponseForList(db, project, leadListId);
  if (!view) return null;
  return {
    ...view,
    ...extra,
    jobsPreview: view.plan?.searchAngles ?? [],
  };
}

function huntConfigPatchFromBody(
  body: Record<string, unknown>
): ListHuntConfig | null {
  const patch: ListHuntConfig = {};
  let has = false;

  const nested =
    body.huntConfig !== undefined &&
    typeof body.huntConfig === "object" &&
    body.huntConfig
      ? (body.huntConfig as Record<string, unknown>)
      : null;

  const geography = nested?.geography ?? body.geography;
  if (geography !== undefined) {
    patch.geography =
      typeof geography === "string" ? geography.trim() || null : null;
    has = true;
  }

  const volumeTarget = nested?.volumeTarget ?? body.volumeTarget;
  if (volumeTarget !== undefined) {
    patch.volumeTarget =
      typeof volumeTarget === "number" ? volumeTarget : null;
    has = true;
  }

  const enabledActorKeys = nested?.enabledActorKeys ?? body.enabledActorKeys;
  if (enabledActorKeys !== undefined) {
    patch.enabledActorKeys = Array.isArray(enabledActorKeys)
      ? (enabledActorKeys.map(String) as ActorKey[])
      : null;
    has = true;
  }

  return has ? patch : null;
}

function enrichLeadListForApi(
  db: DB,
  project: NonNullable<ReturnType<typeof getProject>>,
  list: NonNullable<ReturnType<typeof getLeadList>>
) {
  const ctx = planContextForList(db, project, list);
  const latestRun = getLatestDiscoveryRunForProject(db, project.id, list.id);
  return {
    ...list,
    huntConfig: parseListHuntConfig(list.huntConfig),
    resolvedHuntConfig: {
      geography: ctx.resolvedHuntConfig.geography,
      volumeTarget: ctx.resolvedHuntConfig.volumeTarget,
      enabledActorKeys: ctx.resolvedHuntConfig.enabledActorKeys,
    },
    planState: ctx.planState,
    planUpdatedAt: ctx.planUpdatedAt,
    staleReason: ctx.staleReason,
    lastRun: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          keptCount: latestRun.keptCount,
          startedAt: latestRun.startedAt,
          finishedAt: latestRun.finishedAt,
        }
      : null,
  };
}

function currentUser(req: Request): AuthUser {
  return req.user as AuthUser;
}

function parseJsonField(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function buildDiscoveryObservability(
  db: DB,
  runId: number
): Record<string, unknown> {
  const run = getDiscoveryRun(db, runId);
  if (!run) return { run: null };
  const jobs = listSourceJobs(db, run.id);
  const rejected = listDiscoveredCandidates(db, run.id, { kept: false }).slice(
    0,
    25
  );
  const kept = listDiscoveredCandidates(db, run.id, { kept: true }).slice(0, 10);
  const payload = parseStrategicPayload(parseJsonField(run.payloadJson));
  const timeline = [
    `Run #${run.id} ${run.status}`,
    run.validationNotes
      ? `Validation: ${run.validationNotes}`
      : null,
    `Fetched ${run.fetchedCount}, kept ${run.keptCount}, rejected ${run.rejectedCount}, duplicates ${run.duplicateCount}`,
    ...(payload?.jobs ?? []).map(
      (j) => `${j.jobId} (${j.actorKey}): ${j.reasoning}`
    ),
    ...jobs.map(
      (j) =>
        `${j.sourceId}: ${j.status}` +
        (j.error ? ` — ${j.error}` : ` (fetched ${j.fetchedCount})`)
    ),
  ].filter(Boolean);
  return {
    run,
    jobs,
    plannerInput: parseJsonField(run.plannerInputJson),
    plannerRaw: parseJsonField(run.plannerRawJson),
    validatedPayload: parseJsonField(run.payloadJson),
    compiledJobs: parseJsonField(run.compiledJobsJson),
    validationNotes: run.validationNotes,
    rejectedSamples: rejected.map((c) => ({
      company: c.company,
      website: c.website,
      reason: c.rejectionReason,
      source: c.source,
    })),
    keptSamples: kept.map((c) => ({
      company: c.company,
      website: c.website,
      source: c.source,
    })),
    timeline,
  };
}

/** Accept object or JSON string; return DB string or null. */
export function serializeSourceConfig(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    parseSourceConfig(trimmed);
    return trimmed;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const json = JSON.stringify(value);
    parseSourceConfig(json);
    return json;
  }
  throw new Error("sourceConfig must be an object or JSON string");
}

export function createApiRouter(options: ApiOptions): Router {
  const {
    db,
    scorer,
    mxResolver,
    ingestFetch,
    enrichFetch,
    ingestEnv,
    createConfiguredSourcesFn = createConfiguredSources,
    apifyClient,
    leadPlanner,
  } = options;
  const router = Router();

  router.get("/me", (req, res) => {
    const user = currentUser(req);
    res.json({ email: user.email, name: user.name });
  });

  router.get("/version", (_req, res) => {
    res.json({
      version: DASHBOARD_API_VERSION,
      features: DASHBOARD_API_FEATURES,
    });
  });

  router.get("/projects", (_req, res) => {
    res.json(listProjects(db));
  });

  router.post("/projects", async (req, res) => {
    try {
      const { name, website, description, icp, sourceConfig, geography, volumeTarget, leadStrategy } =
        req.body ?? {};
      if (!name || typeof name !== "string") {
        res.status(400).json({ error: "name is required" });
        return;
      }
      let strategyJson: string | null = null;
      if (leadStrategy && typeof leadStrategy === "object") {
        strategyJson = serializeLeadStrategy(
          defaultLeadStrategy(leadStrategy)
        );
      }
      let project = createProject(db, {
        name,
        website: website ?? null,
        description: description ?? null,
        icp: icp ?? null,
        sourceConfig: sourceConfig
          ? serializeSourceConfig(sourceConfig)
          : null,
        leadStrategy: strategyJson,
      });

      project = await ensureProjectWebsiteSummary(db, project, {
        fetch: ingestFetch,
        force: true,
      });

      await ensureLeadPlan(db, project, {
        leadListId: getActiveLeadListId(db, project.id),
        geography: typeof geography === "string" ? geography : null,
        volumeTarget: typeof volumeTarget === "number" ? volumeTarget : 100,
        planner: leadPlanner,
        fetch: ingestFetch,
      });
      res.status(201).json(getProject(db, project.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid request";
      res.status(400).json({ error: message });
    }
  });

  router.patch("/projects/:id", async (req, res) => {
    try {
      const id = projectIdParam(req);
      const existing = getProject(db, id);
      if (!existing) {
        res.status(404).json({ error: "project not found" });
        return;
      }
      const body = req.body ?? {};
      const input: Parameters<typeof updateProject>[2] = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string" || !body.name.trim()) {
          res.status(400).json({ error: "name must be a non-empty string" });
          return;
        }
        input.name = body.name.trim();
      }
      if (body.website !== undefined) input.website = body.website ?? null;
      if (body.description !== undefined)
        input.description = body.description ?? null;
      if (body.icp !== undefined) input.icp = body.icp ?? null;
      if (body.sourceConfig !== undefined) {
        input.sourceConfig = serializeSourceConfig(body.sourceConfig);
      }
      if (body.leadStrategy !== undefined) {
        if (body.leadStrategy === null) {
          input.leadStrategy = serializeLeadStrategy(defaultLeadStrategy());
        } else if (typeof body.leadStrategy === "object") {
          input.leadStrategy = serializeLeadStrategy(
            defaultLeadStrategy(body.leadStrategy)
          );
        } else {
          res.status(400).json({ error: "leadStrategy must be an object" });
          return;
        }
      }

      let project = updateProject(db, id, input)!;

      const websiteChanged =
        body.website !== undefined &&
        (body.website ?? null) !== (existing.website ?? null);
      if (websiteChanged || body.refreshWebsiteSummary === true) {
        project = await ensureProjectWebsiteSummary(db, project, {
          fetch: ingestFetch,
          force: true,
        });
      }

      if (
        body.volumeTarget !== undefined ||
        body.geography !== undefined ||
        body.regeneratePlan === true
      ) {
        const defaultListId = ensureDefaultLeadList(db, id).id;
        const { plan } = await ensureLeadPlan(db, project, {
          leadListId: defaultListId,
          volumeTarget:
            typeof body.volumeTarget === "number"
              ? body.volumeTarget
              : undefined,
          geography:
            typeof body.geography === "string" ? body.geography : undefined,
          forceRegenerate: body.regeneratePlan === true,
          planner: leadPlanner,
          fetch: ingestFetch,
        });
        const defaultList = ensureDefaultLeadList(db, id);
        updateLeadListPlan(
          db,
          defaultListId,
          serializeLeadPlan({ ...plan, status: "approved" }),
          planContextForList(db, project, defaultList).currentHash
        );
        project = getProject(db, id)!;
      }

      res.json(project);
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid request";
      res.status(400).json({ error: message });
    }
  });

  router.delete("/projects/:id", (req, res) => {
    try {
      const id = projectIdParam(req);
      deleteProject(db, id);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "delete failed";
      if (message === "project not found") {
        res.status(404).json({ error: message });
        return;
      }
      res.status(400).json({ error: message });
    }
  });

  router.get("/projects/:id", (req, res) => {
    const project = getProject(db, projectIdParam(req));
    if (!project) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    res.json(project);
  });

  router.get("/projects/:id/stats", (req, res) => {
    const id = projectIdParam(req);
    const project = getProject(db, id);
    if (!project) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const leadListId = getActiveLeadListId(db, id);
    const all = listLeadsFiltered(db, id, { leadListId });
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekIso = weekAgo.toISOString().slice(0, 19).replace("T", " ");
    const newThisWeek = all.filter((l) => l.createdAt >= weekIso).length;
    const feedback = getFeedbackStats(db, id, leadListId);
    res.json({
      totalLeads: all.length,
      newThisWeek,
      approvalRate: feedback.approvalRate,
      replyRate: null,
      activeLeadListId: leadListId,
    });
  });

  router.get("/projects/:id/leads", (req, res) => {
    const id = projectIdParam(req);
    if (!getProject(db, id)) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const leadListId = getActiveLeadListId(db, id);
    res.json(listLeadsFiltered(db, id, parseFilter(req.query, leadListId)));
  });

  router.get("/actor-catalog", (_req, res) => {
    res.json({
      actors: listActorCatalog().map((a) => ({
        key: a.key,
        label: a.label,
        verified: a.verified,
        description: a.descriptionForPlanner,
      })),
    });
  });

  router.get("/projects/:id/lead-lists", (req, res) => {
    const id = projectIdParam(req);
    const project = getProject(db, id);
    if (!project) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const lists = listLeadLists(db, id).map((list) =>
      enrichLeadListForApi(db, project, list)
    );
    res.json({
      lists,
      activeLeadListId: getActiveLeadListId(db, id),
    });
  });

  router.post("/projects/:id/lead-lists", (req, res) => {
    try {
      const id = projectIdParam(req);
      const project = getProject(db, id);
      if (!project) {
        res.status(404).json({ error: "project not found" });
        return;
      }
      const name =
        typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!name) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      const huntConfig = serializeListHuntConfig({
        ...huntConfigTemplateFromProject(project),
        ...(huntConfigPatchFromBody(req.body ?? {}) ?? {}),
      });
      const list = createLeadList(db, {
        projectId: id,
        name,
        description:
          typeof req.body?.description === "string"
            ? req.body.description
            : null,
        huntConfig,
      });
      if (req.body?.activate !== false) {
        activateLeadList(db, id, list.id);
      }
      res.status(201).json({
        list: enrichLeadListForApi(db, project, list),
        activeLeadListId: getActiveLeadListId(db, id),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "create failed";
      res.status(400).json({ error: message });
    }
  });

  router.patch("/projects/:id/lead-lists/:listId", async (req, res) => {
    try {
      const id = projectIdParam(req);
      const listId = listIdParam(req);
      const project = getProject(db, id);
      if (!project) {
        res.status(404).json({ error: "project not found" });
        return;
      }
      const existing = getLeadList(db, listId);
      if (!existing || existing.projectId !== id) {
        res.status(404).json({ error: "lead list not found" });
        return;
      }

      const huntPatch = huntConfigPatchFromBody(req.body ?? {});
      const huntConfig =
        huntPatch != null
          ? mergeListHuntConfig(existing.huntConfig, huntPatch)
          : undefined;

      const list = updateLeadList(db, id, listId, {
        name: typeof req.body?.name === "string" ? req.body.name : undefined,
        description:
          req.body?.description !== undefined
            ? req.body.description
            : undefined,
        huntConfig,
      });
      if (!list) {
        res.status(404).json({ error: "lead list not found" });
        return;
      }

      if (req.body?.regeneratePlan === true) {
        const { plan } = await ensureLeadPlan(db, project, {
          leadListId: listId,
          forceRegenerate: true,
          geography:
            typeof req.body?.geography === "string"
              ? req.body.geography
              : undefined,
          volumeTarget:
            typeof req.body?.volumeTarget === "number"
              ? req.body.volumeTarget
              : undefined,
          planner: leadPlanner,
          fetch: ingestFetch,
        });
        const listRow = getLeadList(db, listId)!;
        persistListPlanWithHash(
          db,
          project,
          listRow,
          serializeLeadPlan({ ...plan, status: "auto" })
        );
      }

      res.json({ list: enrichLeadListForApi(db, project, list) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "update failed";
      res.status(400).json({ error: message });
    }
  });

  router.post("/projects/:id/lead-lists/:listId/activate", (req, res) => {
    const id = projectIdParam(req);
    const listId = listIdParam(req);
    const list = activateLeadList(db, id, listId);
    if (!list) {
      res.status(404).json({ error: "lead list not found" });
      return;
    }
    res.json({ list, activeLeadListId: list.id });
  });

  router.post("/projects/:id/lead-lists/:listId/clear", (req, res) => {
    try {
      const id = projectIdParam(req);
      const listId = listIdParam(req);
      const result = clearLeadList(db, id, listId);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "clear failed";
      res.status(400).json({ error: message });
    }
  });

  router.delete("/projects/:id/lead-lists/:listId", (req, res) => {
    try {
      const id = projectIdParam(req);
      const listId = listIdParam(req);
      deleteLeadList(db, id, listId);
      res.json({
        ok: true,
        activeLeadListId: getActiveLeadListId(db, id),
        lists: listLeadLists(db, id).map((list) => {
          const project = getProject(db, id)!;
          return enrichLeadListForApi(db, project, list);
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "delete failed";
      res.status(400).json({ error: message });
    }
  });

  router.get("/projects/:id/lead-lists/:listId/lead-plan", (req, res) => {
    const id = projectIdParam(req);
    const listId = listIdParam(req);
    const scope = requireLeadListScope(db, id, listId);
    if ("error" in scope) {
      res.status(scope.status).json({ error: scope.error });
      return;
    }
    const view = leadPlanJsonResponse(db, scope.project, listId);
    if (!view) {
      res.status(404).json({ error: "lead list not found" });
      return;
    }
    res.json(view);
  });

  router.post(
    "/projects/:id/lead-lists/:listId/lead-plan/generate",
    async (req, res) => {
      try {
        const id = projectIdParam(req);
        const listId = listIdParam(req);
        const scope = requireLeadListScope(db, id, listId);
        if ("error" in scope) {
          res.status(scope.status).json({ error: scope.error });
          return;
        }
        const { plan, fromFallback } = await ensureLeadPlan(db, scope.project, {
          leadListId: listId,
          forceRegenerate: true,
          volumeTarget:
            typeof req.body?.volumeTarget === "number"
              ? req.body.volumeTarget
              : undefined,
          geography:
            typeof req.body?.geography === "string" ? req.body.geography : null,
          feedbackNotes:
            typeof req.body?.feedback === "string" ? req.body.feedback : null,
          planner: leadPlanner,
          fetch: ingestFetch,
        });
        persistListPlanWithHash(
          db,
          scope.project,
          scope.list,
          serializeLeadPlan({ ...plan, status: "auto" })
        );
        const view = leadPlanJsonResponse(db, scope.project, listId, {
          fromFallback,
        });
        res.json(view);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "plan generate failed";
        res.status(400).json({ error: message });
      }
    }
  );

  router.post(
    "/projects/:id/lead-lists/:listId/lead-plan/feedback",
    async (req, res) => {
      try {
        const id = projectIdParam(req);
        const listId = listIdParam(req);
        const scope = requireLeadListScope(db, id, listId);
        if ("error" in scope) {
          res.status(scope.status).json({ error: scope.error });
          return;
        }
        const feedback =
          typeof req.body?.feedback === "string" ? req.body.feedback.trim() : "";
        if (!feedback) {
          res.status(400).json({ error: "feedback is required" });
          return;
        }
        const { plan, fromFallback } = await ensureLeadPlan(db, scope.project, {
          leadListId: listId,
          forceRegenerate: true,
          feedbackNotes: feedback,
          planner: leadPlanner,
          fetch: ingestFetch,
        });
        persistListPlanWithHash(
          db,
          scope.project,
          scope.list,
          serializeLeadPlan({
            ...plan,
            status: "auto",
            feedbackNotes: feedback,
          })
        );
        const view = leadPlanJsonResponse(db, scope.project, listId, {
          fromFallback,
        });
        res.json(view);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "plan feedback failed";
        res.status(400).json({ error: message });
      }
    }
  );

  router.post(
    "/projects/:id/lead-lists/:listId/ingest",
    async (req, res, next) => {
      try {
        const id = projectIdParam(req);
        const listId = listIdParam(req);
        const scope = requireLeadListScope(db, id, listId);
        if ("error" in scope) {
          res.status(scope.status).json({ error: scope.error });
          return;
        }
        const planView = leadPlanResponseForList(db, scope.project, listId);
        if (!planView || planView.planState !== "ready") {
          res.status(400).json({
            error:
              planView?.planState === "stale"
                ? "Plan is stale — regenerate plan for this list first"
                : "Generate a plan for this list before finding leads",
          });
          return;
        }
        try {
          const summary = await runOneClickLeadFinding(db, id, {
            apifyClient,
            env: ingestEnv,
            fetch: ingestFetch,
            planner: leadPlanner,
            leadListId: listId,
            forceReplan: Boolean(req.body?.forceReplan),
            volumeTarget:
              typeof req.body?.volumeTarget === "number"
                ? req.body.volumeTarget
                : undefined,
            geography:
              typeof req.body?.geography === "string"
                ? req.body.geography
                : undefined,
          });
          const freshProject = getProject(db, id)!;
          const refreshedView = leadPlanResponseForList(
            db,
            freshProject,
            listId
          );
          res.status(201).json({
            ...summary,
            ...refreshedView,
            jobsPreview: refreshedView?.plan?.searchAngles ?? [],
          });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "lead finding failed";
          res.status(400).json({ error: message });
        }
      } catch (err) {
        next(err);
      }
    }
  );

  router.get("/projects/:id/lead-lists/:listId/leads", (req, res) => {
    const id = projectIdParam(req);
    const listId = listIdParam(req);
    const scope = requireLeadListScope(db, id, listId);
    if ("error" in scope) {
      res.status(scope.status).json({ error: scope.error });
      return;
    }
    const leads = listLeadsFiltered(db, id, parseFilter(req.query, listId));
    const enrichedDomains = listEnrichedDomains(db, id);
    const leadIds = leads.map((l) => l.id);
    const cMap = contactCountsByLead(db, id, leadIds);

    const decorated = leads.map((l) => {
      const rawWebsite = l.website || l.canonicalDomain || "";
      const domain = l.canonicalDomain || rawWebsite.replace(/^https?:\/\//i, "").split("/")[0].split("?")[0];
      return {
        ...l,
        enriched: Boolean(domain && enrichedDomains.has(domain)),
        contactsCount: cMap.get(l.id) ?? 0,
      };
    });
    res.json(decorated);
  });

  router.get("/projects/:id/lead-lists/:listId/stats", (req, res) => {
    const id = projectIdParam(req);
    const listId = listIdParam(req);
    const scope = requireLeadListScope(db, id, listId);
    if ("error" in scope) {
      res.status(scope.status).json({ error: scope.error });
      return;
    }
    const all = listLeadsFiltered(db, id, { leadListId: listId });
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekIso = weekAgo.toISOString().slice(0, 19).replace("T", " ");
    const newThisWeek = all.filter((l) => l.createdAt >= weekIso).length;
    const feedback = getFeedbackStats(db, id, listId);
    res.json({
      totalLeads: all.length,
      newThisWeek,
      approvalRate: feedback.approvalRate,
      replyRate: null,
      leadListId: listId,
    });
  });

  router.get(
    "/projects/:id/lead-lists/:listId/discovery/latest",
    (req, res) => {
      const id = projectIdParam(req);
      const listId = listIdParam(req);
      const scope = requireLeadListScope(db, id, listId);
      if ("error" in scope) {
        res.status(scope.status).json({ error: scope.error });
        return;
      }
      const run = getLatestDiscoveryRunForProject(db, id, listId);
      if (!run) {
        res.json({
          run: null,
          jobs: [],
          rejectedSamples: [],
          keptSamples: [],
          timeline: [],
          plannerInput: null,
          plannerRaw: null,
          validatedPayload: null,
          compiledJobs: null,
          validationNotes: null,
        });
        return;
      }
      res.json(buildDiscoveryObservability(db, run.id));
    }
  );

  router.get("/projects/:id/lead-lists/:listId/discovery/runs", (req, res) => {
    const id = projectIdParam(req);
    const listId = listIdParam(req);
    const scope = requireLeadListScope(db, id, listId);
    if ("error" in scope) {
      res.status(scope.status).json({ error: scope.error });
      return;
    }
    const runs = listDiscoveryRunsForProject(db, id, {
      leadListId: listId,
      limit: 10,
    });
    res.json({
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        fetchedCount: r.fetchedCount,
        keptCount: r.keptCount,
        rejectedCount: r.rejectedCount,
        duplicateCount: r.duplicateCount,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      })),
    });
  });

  router.get("/projects/:id/lead-lists/:listId/export.csv", (req, res) => {
    const id = projectIdParam(req);
    const listId = listIdParam(req);
    const scope = requireLeadListScope(db, id, listId);
    if ("error" in scope) {
      res.status(scope.status).json({ error: scope.error });
      return;
    }
    const presetRaw =
      typeof req.query.preset === "string" ? req.query.preset : "all";
    const normalized =
      presetRaw === "emails" ? "emails_only" : presetRaw;
    const preset: ExportPreset =
      normalized === "emails_only" || normalized === "current"
        ? normalized
        : "all";
    const leads = listLeadsFiltered(db, id, parseFilter(req.query, listId));
    const csv = exportLeadsCsv(leads, preset);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="leads-${id}-list-${listId}-${preset}.csv"`
    );
    res.send(csv);
  });

  router.post("/projects/:id/lead-lists/:listId/score", async (req, res, next) => {
    try {
      const id = projectIdParam(req);
      const listId = listIdParam(req);
      const scope = requireLeadListScope(db, id, listId);
      if ("error" in scope) {
        res.status(scope.status).json({ error: scope.error });
        return;
      }

      // 1. Health check first
      const health = await runProviderHealthCheck({
        fetchFn: enrichFetch ?? globalThis.fetch,
        checkJina: false,
        checkApify: false,
        checkHermes: true,
      });

      if (!health.ok) {
        const run = createOpsRun(db, { projectId: id, runType: "scoring", status: "failed" });
        for (const err of health.errors) {
          addLogToRun(db, { runId: run.id, message: err, level: "error" });
        }
        completeOpsRun(db, run.id, health.errors.join("; "));
        res.status(400).json({ error: health.errors.join("; ") });
        return;
      }

      // 2. Start running
      const run = createOpsRun(db, { projectId: id, runType: "scoring", status: "running" });
      addLogToRun(db, { runId: run.id, message: "Hermes Gateway health check passed." });
      addLogToRun(db, { runId: run.id, message: "Starting lead scoring..." });

      try {
        const summary = await runScoring(db, id, scorer, {
          leadListId: listId,
          onProgress: (msg, level) => {
            addLogToRun(db, { runId: run.id, message: msg, level });
          },
        });
        completeOpsRun(db, run.id);
        res.json(summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : "scoring failed";
        addLogToRun(db, { runId: run.id, message: `Failed: ${message}`, level: "error" });
        completeOpsRun(db, run.id, message);
        res.status(400).json({ error: message });
      }
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/projects/:id/lead-lists/:listId/import.csv",
    upload.single("file"),
    async (req, res, next) => {
      try {
        const id = projectIdParam(req);
        const listId = listIdParam(req);
        const scope = requireLeadListScope(db, id, listId);
        if ("error" in scope) {
          res.status(scope.status).json({ error: scope.error });
          return;
        }

        let csvText: string | undefined;
        if (req.file) {
          csvText = req.file.buffer.toString("utf-8");
        } else if (typeof req.body?.csv === "string") {
          csvText = req.body.csv;
        } else if (typeof req.body === "string") {
          csvText = req.body;
        }

        if (!csvText) {
          res.status(400).json({ error: "csv body or file required" });
          return;
        }

        let mapping: ColumnMapping = {
          company: "Company",
          website: "Website",
          email: "Email",
          votes: "Votes",
        };
        if (typeof req.body?.mapping === "string") {
          mapping = { ...mapping, ...JSON.parse(req.body.mapping) };
        } else if (req.body?.mapping && typeof req.body.mapping === "object") {
          mapping = { ...mapping, ...req.body.mapping };
        }

        const csvSource: Source = {
          name: "csv",
          fetch: async () => parseCsvSource(csvText!, mapping),
        };
        const summary = await runIngest(db, id, [csvSource], {
          resolver: mxResolver,
          leadListId: listId,
        });
        res.status(201).json(summary);
      } catch (err) {
        next(err);
      }
    }
  );

  router.post("/projects/:id/website-summary/refresh", async (req, res) => {
    try {
      const id = projectIdParam(req);
      const project = getProject(db, id);
      if (!project) {
        res.status(404).json({ error: "project not found" });
        return;
      }
      if (!project.website?.trim()) {
        res.status(400).json({ error: "project has no website" });
        return;
      }
      const updated = await ensureProjectWebsiteSummary(db, project, {
        fetch: ingestFetch,
        force: true,
      });
      res.json({
        websiteSummary: updated.websiteSummary,
        websiteSummaryAt: updated.websiteSummaryAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "refresh failed";
      res.status(400).json({ error: message });
    }
  });

  router.get("/projects/:id/leads/:leadId", (req, res) => {
    const lead = getLead(db, projectIdParam(req), leadIdParam(req));
    if (!lead) {
      res.status(404).json({ error: "lead not found" });
      return;
    }
    res.json(lead);
  });

  router.post("/projects/:id/leads/:leadId/approve", (req, res) => {
    const projectId = projectIdParam(req);
    const leadId = leadIdParam(req);
    if (!getLead(db, projectId, leadId)) {
      res.status(404).json({ error: "lead not found" });
      return;
    }
    const notes =
      typeof req.body?.notes === "string" ? req.body.notes : null;
    recordFeedback(db, {
      projectId,
      leadId,
      good: true,
      notes,
      reviewedBy: currentUser(req).email,
      source: "dashboard",
    });
    res.json(getLead(db, projectId, leadId));
  });

  router.post("/projects/:id/leads/:leadId/reject", (req, res) => {
    const projectId = projectIdParam(req);
    const leadId = leadIdParam(req);
    if (!getLead(db, projectId, leadId)) {
      res.status(404).json({ error: "lead not found" });
      return;
    }
    const notes =
      typeof req.body?.notes === "string" ? req.body.notes : null;
    recordFeedback(db, {
      projectId,
      leadId,
      good: false,
      notes,
      reviewedBy: currentUser(req).email,
      source: "dashboard",
    });
    res.json(getLead(db, projectId, leadId));
  });

  router.post("/projects/:id/leads/:leadId/promote", (req, res) => {
    const projectId = projectIdParam(req);
    const leadId = leadIdParam(req);
    const lead = getLead(db, projectId, leadId);
    if (!lead) {
      res.status(404).json({ error: "lead not found" });
      return;
    }
    if (lead.status !== "provisional") {
      res.status(400).json({ error: "only provisional leads can be promoted" });
      return;
    }
    const updated = setLeadStatus(db, projectId, leadId, "gated");
    res.json(updated);
  });

  router.post("/projects/:id/leads/:leadId/discard", (req, res) => {
    const projectId = projectIdParam(req);
    const leadId = leadIdParam(req);
    const lead = getLead(db, projectId, leadId);
    if (!lead) {
      res.status(404).json({ error: "lead not found" });
      return;
    }
    if (lead.status !== "provisional") {
      res.status(400).json({ error: "only provisional leads can be discarded" });
      return;
    }
    const notes =
      typeof req.body?.notes === "string"
        ? req.body.notes
        : "discarded provisional";
    recordFeedback(db, {
      projectId,
      leadId,
      good: false,
      notes,
      reviewedBy: currentUser(req).email,
      source: "dashboard",
    });
    res.json(getLead(db, projectId, leadId));
  });

  router.post("/projects/:id/score", async (req, res, next) => {
    try {
      const id = projectIdParam(req);
      if (!getProject(db, id)) {
        res.status(404).json({ error: "project not found" });
        return;
      }

      // 1. Health check first
      const health = await runProviderHealthCheck({
        fetchFn: enrichFetch ?? globalThis.fetch,
        checkJina: false,
        checkApify: false,
        checkHermes: true,
      });

      if (!health.ok) {
        const run = createOpsRun(db, { projectId: id, runType: "scoring", status: "failed" });
        for (const err of health.errors) {
          addLogToRun(db, { runId: run.id, message: err, level: "error" });
        }
        completeOpsRun(db, run.id, health.errors.join("; "));
        res.status(400).json({ error: health.errors.join("; ") });
        return;
      }

      // 2. Start running
      const run = createOpsRun(db, { projectId: id, runType: "scoring", status: "running" });
      addLogToRun(db, { runId: run.id, message: "Hermes Gateway health check passed." });
      addLogToRun(db, { runId: run.id, message: "Starting lead scoring..." });

      try {
        const summary = await runScoring(db, id, scorer, {
          onProgress: (msg, level) => {
            addLogToRun(db, { runId: run.id, message: msg, level });
          },
        });
        completeOpsRun(db, run.id);
        res.json(summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : "scoring failed";
        addLogToRun(db, { runId: run.id, message: `Failed: ${message}`, level: "error" });
        completeOpsRun(db, run.id, message);
        res.status(400).json({ error: message });
      }
    } catch (err) {
      next(err);
    }
  });

  router.post("/projects/:id/ingest", async (req, res, next) => {
    try {
      const id = projectIdParam(req);
      const project = getProject(db, id);
      if (!project) {
        res.status(404).json({ error: "project not found" });
        return;
      }

      try {
        const summary = await runOneClickLeadFinding(db, id, {
          apifyClient,
          env: ingestEnv,
          fetch: ingestFetch,
          planner: leadPlanner,
          volumeTarget:
            typeof req.body?.volumeTarget === "number"
              ? req.body.volumeTarget
              : undefined,
          geography:
            typeof req.body?.geography === "string"
              ? req.body.geography
              : undefined,
        });
        const freshProject = getProject(db, id)!;
        const planView = leadPlanResponseForList(
          db,
          freshProject,
          summary.leadListId
        );
        res.status(201).json({
          ...summary,
          ...planView,
          jobsPreview: planView?.plan?.searchAngles ?? [],
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "lead finding failed";
        res.status(400).json({ error: message });
      }
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects/:id/lead-plan", (req, res) => {
    const project = getProject(db, projectIdParam(req));
    if (!project) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const leadListId = getActiveLeadListId(db, project.id);
    const view = leadPlanResponseForList(db, project, leadListId);
    if (!view) {
      res.status(404).json({ error: "lead list not found" });
      return;
    }
    res.json({
      ...view,
      jobsPreview: view.plan?.searchAngles ?? [],
    });
  });

  router.post("/projects/:id/lead-plan/generate", async (req, res) => {
    try {
      const id = projectIdParam(req);
      const project = getProject(db, id);
      if (!project) {
        res.status(404).json({ error: "project not found" });
        return;
      }
      const leadListId = getActiveLeadListId(db, id);
      const { plan, fromFallback } = await ensureLeadPlan(db, project, {
        leadListId,
        forceRegenerate: true,
        volumeTarget:
          typeof req.body?.volumeTarget === "number"
            ? req.body.volumeTarget
            : undefined,
        geography:
          typeof req.body?.geography === "string" ? req.body.geography : null,
        feedbackNotes:
          typeof req.body?.feedback === "string" ? req.body.feedback : null,
        planner: leadPlanner,
        fetch: ingestFetch,
      });
      const listRow = getLeadList(db, leadListId)!;
      persistListPlanWithHash(
        db,
        project,
        listRow,
        serializeLeadPlan({ ...plan, status: "auto" })
      );
      const view = leadPlanJsonResponse(db, project, leadListId, {
        fromFallback,
      });
      res.json(view);
    } catch (err) {
      const message = err instanceof Error ? err.message : "plan generate failed";
      res.status(400).json({ error: message });
    }
  });

  router.post("/projects/:id/lead-plan/feedback", async (req, res) => {
    try {
      const id = projectIdParam(req);
      const project = getProject(db, id);
      if (!project) {
        res.status(404).json({ error: "project not found" });
        return;
      }
      const feedback =
        typeof req.body?.feedback === "string" ? req.body.feedback.trim() : "";
      if (!feedback) {
        res.status(400).json({ error: "feedback is required" });
        return;
      }
      const leadListId = getActiveLeadListId(db, id);
      const { plan, fromFallback } = await ensureLeadPlan(db, project, {
        leadListId,
        forceRegenerate: true,
        feedbackNotes: feedback,
        planner: leadPlanner,
        fetch: ingestFetch,
      });
      const listRow = getLeadList(db, leadListId)!;
      persistListPlanWithHash(
        db,
        project,
        listRow,
        serializeLeadPlan({
          ...plan,
          status: "auto",
          feedbackNotes: feedback,
        })
      );
      const view = leadPlanJsonResponse(db, project, leadListId, {
        fromFallback,
      });
      res.json(view);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "plan feedback failed";
      res.status(400).json({ error: message });
    }
  });

  router.get("/projects/:id/discovery/latest", (req, res) => {
    const id = projectIdParam(req);
    if (!getProject(db, id)) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const leadListId = getActiveLeadListId(db, id);
    const run = getLatestDiscoveryRunForProject(db, id, leadListId);
    if (!run) {
      res.json({
        run: null,
        jobs: [],
        rejectedSamples: [],
        keptSamples: [],
        timeline: [],
        plannerInput: null,
        plannerRaw: null,
        validatedPayload: null,
        compiledJobs: null,
        validationNotes: null,
      });
      return;
    }
    res.json(buildDiscoveryObservability(db, run.id));
  });

  router.get("/projects/:id/discovery/runs", (req, res) => {
    const id = projectIdParam(req);
    if (!getProject(db, id)) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const leadListId = getActiveLeadListId(db, id);
    const runs = listDiscoveryRunsForProject(db, id, {
      leadListId,
      limit: 10,
    });
    res.json({
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        fetchedCount: r.fetchedCount,
        keptCount: r.keptCount,
        rejectedCount: r.rejectedCount,
        duplicateCount: r.duplicateCount,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      })),
    });
  });

  router.get("/projects/:id/discovery/runs/:runId", (req, res) => {
    const id = projectIdParam(req);
    const runId = Number(req.params.runId);
    if (!getProject(db, id)) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const run = getDiscoveryRun(db, runId);
    if (!run || run.projectId !== id) {
      res.status(404).json({ error: "run not found" });
      return;
    }
    res.json(buildDiscoveryObservability(db, run.id));
  });

  router.post("/projects/:id/enrich-companies", async (req, res, next) => {
    try {
      const id = projectIdParam(req);
      if (!getProject(db, id)) {
        res.status(404).json({ error: "project not found" });
        return;
      }
      const force = req.body?.force === true;

      // 1. Health check first
      const health = await runProviderHealthCheck({
        fetchFn: enrichFetch ?? globalThis.fetch,
        checkJina: true,
        checkApify: false,
        checkHermes: false,
      });

      if (!health.ok) {
        // Log pre-run failure
        const run = createOpsRun(db, { projectId: id, runType: "enrichment", status: "failed" });
        for (const err of health.errors) {
          addLogToRun(db, { runId: run.id, message: err, level: "error" });
        }
        completeOpsRun(db, run.id, health.errors.join("; "));
        res.status(400).json({ error: health.errors.join("; ") });
        return;
      }

      // 2. Start running
      const run = createOpsRun(db, { projectId: id, runType: "enrichment", status: "running" });
      addLogToRun(db, { runId: run.id, message: "Jina Reader credentials check passed." });
      addLogToRun(db, { runId: run.id, message: "Starting company enrichment crawler..." });

      try {
        const summary = await runCompanyEnrichment(db, id, {
          fetch: enrichFetch,
          force,
          onProgress: (msg, level) => {
            addLogToRun(db, { runId: run.id, message: msg, level });
          },
        });
        completeOpsRun(db, run.id);
        res.status(201).json(summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : "company enrichment failed";
        addLogToRun(db, { runId: run.id, message: `Failed: ${message}`, level: "error" });
        completeOpsRun(db, run.id, message);
        res.status(400).json({ error: message });
      }
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects/:id/export.csv", (req, res) => {
    const id = projectIdParam(req);
    if (!getProject(db, id)) {
      res.status(404).json({ error: "project not found" });
      return;
    }
    const presetRaw =
      typeof req.query.preset === "string" ? req.query.preset : "all";
    const normalized =
      presetRaw === "emails" ? "emails_only" : presetRaw;
    const preset: ExportPreset =
      normalized === "emails_only" || normalized === "current"
        ? normalized
        : "all";
    const leadListId = getActiveLeadListId(db, id);
    const leads = listLeadsFiltered(db, id, parseFilter(req.query, leadListId));
    const csv = exportLeadsCsv(leads, preset);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="leads-${id}-${preset}.csv"`
    );
    res.send(csv);
  });

  router.post(
    "/projects/:id/import.csv",
    upload.single("file"),
    async (req, res, next) => {
      try {
        const id = projectIdParam(req);
        if (!getProject(db, id)) {
          res.status(404).json({ error: "project not found" });
          return;
        }

        let csvText: string | undefined;
        if (req.file) {
          csvText = req.file.buffer.toString("utf-8");
        } else if (typeof req.body?.csv === "string") {
          csvText = req.body.csv;
        } else if (typeof req.body === "string") {
          csvText = req.body;
        }

        if (!csvText) {
          res.status(400).json({ error: "csv body or file required" });
          return;
        }

        let mapping: ColumnMapping = {
          company: "Company",
          website: "Website",
          email: "Email",
          votes: "Votes",
        };
        if (typeof req.body?.mapping === "string") {
          mapping = { ...mapping, ...JSON.parse(req.body.mapping) };
        } else if (req.body?.mapping && typeof req.body.mapping === "object") {
          mapping = { ...mapping, ...req.body.mapping };
        }

        const csvSource: Source = {
          name: "csv",
          fetch: async () => parseCsvSource(csvText!, mapping),
        };
        const summary = await runIngest(db, id, [csvSource], {
          resolver: mxResolver,
          leadListId: getActiveLeadListId(db, id),
        });
        res.status(201).json(summary);
      } catch (err) {
        next(err);
      }
    }
  );

  // ── Contact / Person Finder ──────────────────────────────────────────────
  router.post("/projects/:id/find-contacts", async (req, res, next) => {
    try {
      const id = projectIdParam(req);
      if (!getProject(db, id)) {
        res.status(404).json({ error: "project not found" });
        return;
      }
      const refresh = req.body?.refresh === true;

      // 1. Health check first (requires Jina Reader to scrape LinkedIn people profiles)
      const health = await runProviderHealthCheck({
        fetchFn: enrichFetch ?? globalThis.fetch,
        checkJina: true,
        checkApify: false,
        checkHermes: false,
      });

      if (!health.ok) {
        const run = createOpsRun(db, { projectId: id, runType: "contacts", status: "failed" });
        for (const err of health.errors) {
          addLogToRun(db, { runId: run.id, message: err, level: "error" });
        }
        completeOpsRun(db, run.id, health.errors.join("; "));
        res.status(400).json({ error: health.errors.join("; ") });
        return;
      }

      // 2. Start running
      const run = createOpsRun(db, { projectId: id, runType: "contacts", status: "running" });
      addLogToRun(db, { runId: run.id, message: "Jina Reader credentials check passed." });
      addLogToRun(db, { runId: run.id, message: "Starting contact finding from LinkedIn..." });

      try {
        const summary = await runContactFinding({
          fetch: enrichFetch ?? globalThis.fetch,
          db,
          projectId: id,
          refresh,
          onProgress: (msg, level) => {
            addLogToRun(db, { runId: run.id, message: msg, level });
          },
        });
        completeOpsRun(db, run.id);
        res.status(201).json(summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : "find contacts failed";
        addLogToRun(db, { runId: run.id, message: `Failed: ${message}`, level: "error" });
        completeOpsRun(db, run.id, message);
        res.status(400).json({ error: message });
      }
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects/:id/leads/:leadId/contacts", (req, res, next) => {
    try {
      const id = projectIdParam(req);
      if (!getProject(db, id)) {
        res.status(404).json({ error: "project not found" });
        return;
      }
      const leadId = Number(req.params.leadId);
      if (!Number.isFinite(leadId)) {
        res.status(400).json({ error: "invalid leadId" });
        return;
      }
      const contacts = listContactsForLead(db, leadId);
      res.json(contacts);
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects/:id/leads/:leadId/profile", (req, res, next) => {
    try {
      const id = projectIdParam(req);
      if (!getProject(db, id)) {
        res.status(404).json({ error: "project not found" });
        return;
      }
      const leadId = Number(req.params.leadId);
      if (!Number.isFinite(leadId)) {
        res.status(400).json({ error: "invalid leadId" });
        return;
      }
      const lead = getLead(db, id, leadId);
      if (!lead) {
        res.status(404).json({ error: "lead not found" });
        return;
      }
      const rawWebsite = lead.website || lead.canonicalDomain || "";
      const domain = lead.canonicalDomain || rawWebsite.replace(/^https?:\/\//i, "").split("/")[0].split("?")[0];
      if (!domain) {
        res.json(null);
        return;
      }
      const profile = getCompanyProfile(db, id, domain);
      res.json(profile || null);
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects/:id/contacts", (req, res, next) => {
    try {
      const id = projectIdParam(req);
      if (!getProject(db, id)) {
        res.status(404).json({ error: "project not found" });
        return;
      }
      const contacts = listContactsForProject(db, id);
      res.json(contacts);
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects/:id/ops/runs", (req, res, next) => {
    try {
      const id = projectIdParam(req);
      if (!getProject(db, id)) {
        res.status(404).json({ error: "project not found" });
        return;
      }
      const filter = req.query.type as any;
      const runs = listOpsRuns(db, id, filter);
      res.json({ runs });
    } catch (err) {
      next(err);
    }
  });

  router.get("/projects/:id/ops/runs/:runId", (req, res, next) => {
    try {
      const id = projectIdParam(req);
      const runId = Number(req.params.runId);
      if (!getProject(db, id)) {
        res.status(404).json({ error: "project not found" });
        return;
      }
      const run = getOpsRun(db, runId);
      if (!run || run.projectId !== id) {
        res.status(404).json({ error: "run not found" });
        return;
      }
      const logs = listLogsForRun(db, run.id);
      res.json({
        run: {
          id: run.id,
          status: run.status,
          // Map counts to support standard UI summary mapping
          fetchedCount: run.runType === "discovery" ? 0 : undefined,
          keptCount: 0,
          rejectedCount: 0,
          duplicateCount: 0,
        },
        timeline: logs.map((l) => `${l.createdAt.substring(11, 19)} [${l.level.toUpperCase()}] ${l.message}`),
        logs,
      });
    } catch (err) {
      next(err);
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "internal error";
    res.status(500).json({ error: message });
  });

  return router;
}
