import type { DB } from "../db/database.js";
import type { Project } from "../domain/types.js";
import {
  getLeadList,
  getLeadListPayloadJson,
  getLeadListPlanContextHash,
  getLeadListPlanUpdatedAt,
} from "../leads/lead-lists.repo.js";
import {
  resolveListHuntConfig,
  resolveListPlan,
} from "../leads/list-hunt-config.js";
import { buildLeadPlanView, type LeadPlanView } from "./lead-plan-view.js";
import {
  computePlanContextHash,
  resolvePlanState,
} from "./plan-context-hash.js";

export function planContextForList(
  db: DB,
  project: Project,
  list: NonNullable<ReturnType<typeof getLeadList>>
) {
  const listPlan = resolveListPlan(db, project, list.id, list.name);
  const resolvedHuntConfig = resolveListHuntConfig(project, {
    name: list.name,
    huntConfigRaw: list.huntConfig,
    listPlan,
  });
  const currentHash = computePlanContextHash({
    projectName: project.name,
    websiteSummary: project.websiteSummary,
    description: project.description,
    icp: project.icp,
    listName: list.name,
    listDescription: list.description,
    geography: resolvedHuntConfig.geography,
    volumeTarget: resolvedHuntConfig.volumeTarget,
    enabledActorKeys: resolvedHuntConfig.enabledActorKeys,
  });
  const storedHash = getLeadListPlanContextHash(db, list.id);
  const { planState, staleReason } = resolvePlanState({
    plan: listPlan,
    storedHash,
    currentHash,
  });
  return {
    listPlan,
    resolvedHuntConfig,
    currentHash,
    storedHash,
    planState,
    staleReason,
    planUpdatedAt: getLeadListPlanUpdatedAt(db, list.id),
  };
}

export function leadPlanResponseForList(
  db: DB,
  project: Project,
  leadListId: number
): LeadPlanView | null {
  const list = getLeadList(db, leadListId);
  if (!list || list.projectId !== project.id) return null;
  const ctx = planContextForList(db, project, list);
  return buildLeadPlanView({
    leadListId: list.id,
    leadListName: list.name,
    listDescription: list.description,
    plan: ctx.listPlan,
    planState: ctx.planState,
    planUpdatedAt: ctx.planUpdatedAt,
    planContextHash: ctx.storedHash,
    staleReason: ctx.staleReason,
    leadStrategy: ctx.resolvedHuntConfig.leadStrategy,
    websiteSummary: project.websiteSummary,
    websiteSummaryAt: project.websiteSummaryAt,
    payloadJson: getLeadListPayloadJson(db, leadListId),
    resolvedHuntConfig: {
      geography: ctx.resolvedHuntConfig.geography,
      volumeTarget: ctx.resolvedHuntConfig.volumeTarget,
      enabledActorKeys: ctx.resolvedHuntConfig.enabledActorKeys,
    },
  });
}

export { computePlanContextHash };
