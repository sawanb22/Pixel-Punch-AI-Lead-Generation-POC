import type { DB } from "../db/database.js";
import type { Project } from "../domain/types.js";
import type { LeadPlan } from "../discovery/lead-plan.js";
import {
  clampVolumeTarget,
  parseLeadPlan,
} from "../discovery/lead-plan.js";
import {
  defaultLeadStrategy,
  resolveProjectLeadStrategy,
  type LeadStrategy,
} from "../discovery/lead-strategy.js";
import { isDefaultLeadList } from "./lead-list-display.js";
import { getLeadListPlan } from "./lead-lists.repo.js";
import type { ActorKey } from "../discovery/actor-catalog.js";

export interface ListHuntConfig {
  geography?: string | null;
  volumeTarget?: number | null;
  enabledActorKeys?: ActorKey[] | null;
}

export interface ResolvedListHuntConfig {
  geography: string | null;
  volumeTarget: number;
  enabledActorKeys: ActorKey[];
  leadStrategy: LeadStrategy;
}

export function parseListHuntConfig(
  raw: string | null | undefined
): ListHuntConfig | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      geography:
        parsed.geography !== undefined
          ? (parsed.geography as string | null)
          : undefined,
      volumeTarget:
        parsed.volumeTarget !== undefined
          ? (parsed.volumeTarget as number | null)
          : undefined,
      enabledActorKeys: Array.isArray(parsed.enabledActorKeys)
        ? (parsed.enabledActorKeys as ActorKey[])
        : undefined,
    };
  } catch {
    return null;
  }
}

export function serializeListHuntConfig(config: ListHuntConfig): string {
  return JSON.stringify(config);
}

export function projectDefaultHuntConfig(project: Project): ListHuntConfig {
  const strategy = resolveProjectLeadStrategy(project.leadStrategy);
  const projectPlan = parseLeadPlan(project.leadPlan);
  return {
    geography: projectPlan?.geography ?? strategy.defaultGeography ?? null,
    volumeTarget: projectPlan?.volumeTarget ?? 100,
    enabledActorKeys: [...strategy.enabledActorKeys],
  };
}

export function huntConfigTemplateFromProject(project: Project): ListHuntConfig {
  return projectDefaultHuntConfig(project);
}

export function resolveListHuntConfig(
  project: Project,
  list: {
    name: string;
    huntConfigRaw?: string | null;
    listPlan?: LeadPlan | null;
  }
): ResolvedListHuntConfig {
  const stored = parseListHuntConfig(list.huntConfigRaw) ?? {};
  const projectDefaults = projectDefaultHuntConfig(project);
  const strategy = resolveProjectLeadStrategy(project.leadStrategy);
  const planFallback = list.listPlan;

  const geography =
    stored.geography !== undefined
      ? stored.geography?.trim() || null
      : planFallback?.geography ??
        projectDefaults.geography ??
        null;
  const volumeTarget =
    stored.volumeTarget != null
      ? clampVolumeTarget(stored.volumeTarget)
      : clampVolumeTarget(
          planFallback?.volumeTarget ??
            projectDefaults.volumeTarget ??
            100
        );
  const enabledActorKeys = stored.enabledActorKeys?.length
    ? stored.enabledActorKeys
    : projectDefaults.enabledActorKeys ?? strategy.enabledActorKeys;

  return {
    geography,
    volumeTarget,
    enabledActorKeys,
    leadStrategy: defaultLeadStrategy({
      defaultGeography: geography,
      enabledActorKeys,
      buyerMode: strategy.buyerMode,
    }),
  };
}

export function resolveListPlan(
  db: DB,
  project: Project,
  listId: number,
  listName: string
): LeadPlan | null {
  const listPlan = getLeadListPlan(db, listId);
  if (listPlan) return listPlan;
  if (isDefaultLeadList(listName)) {
    return parseLeadPlan(project.leadPlan);
  }
  return null;
}

export function mergeListHuntConfig(
  existingRaw: string | null | undefined,
  patch: ListHuntConfig
): string {
  const existing = parseListHuntConfig(existingRaw) ?? {};
  return serializeListHuntConfig({ ...existing, ...patch });
}
