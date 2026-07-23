import { ACTOR_CATALOG, isActorKey, type ActorKey } from "./actor-catalog.js";
import type { LeadPlan } from "./lead-plan.js";
import type { LeadStrategy } from "./lead-strategy.js";
import {
  parseStrategicPayload,
  type StrategicPayload,
} from "./strategic-payload.js";
import { displayLeadListName, isDefaultLeadList } from "../leads/lead-list-display.js";
import type { PlanState } from "./plan-context-hash.js";

export interface LeadPlanJobView {
  jobId: string;
  actorKey: string;
  actorLabel: string;
  actorId: string;
  reasoning: string;
  apifyInput: Record<string, unknown>;
  paramSummary: string;
}

export interface LeadPlanView {
  leadListId: number;
  leadListName: string;
  leadListDisplayName: string;
  listDescription: string | null;
  isDefaultList: boolean;
  plan: LeadPlan | null;
  planState: PlanState;
  planUpdatedAt: string | null;
  planContextHash: string | null;
  staleReason: string | null;
  leadStrategy: LeadStrategy;
  resolvedHuntConfig: {
    geography: string | null;
    volumeTarget: number;
    enabledActorKeys: string[];
  };
  websiteSummary: string | null;
  websiteSummaryAt: string | null;
  strategicPayload: StrategicPayload | null;
  jobs: LeadPlanJobView[];
}

export function summarizeApifyInput(
  input: Record<string, unknown>
): string {
  const parts: string[] = [];
  const searches = input.searchStringsArray;
  if (Array.isArray(searches) && searches.length > 0) {
    const shown = searches.slice(0, 3).map(String).join("; ");
    parts.push(
      `Searches: ${shown}${searches.length > 3 ? ` (+${searches.length - 3} more)` : ""}`
    );
  }
  if (typeof input.queries === "string" && input.queries.trim()) {
    const lines = input.queries.trim().split("\n");
    parts.push(
      `Queries: ${lines.slice(0, 2).join("; ")}${lines.length > 2 ? "…" : ""}`
    );
  }
  if (input.query != null && String(input.query).trim()) {
    parts.push(`Query: ${String(input.query)}`);
  }
  if (input.location != null && String(input.location).trim()) {
    parts.push(`Location: ${String(input.location)}`);
  }
  if (input.title != null && String(input.title).trim()) {
    parts.push(`Title: ${String(input.title)}`);
  }
  if (typeof input.maxCrawledPlacesPerSearch === "number") {
    parts.push(`Max places/search: ${input.maxCrawledPlacesPerSearch}`);
  }
  if (typeof input.limit === "number") {
    parts.push(`Limit: ${input.limit}`);
  }
  if (typeof input.count === "number") {
    parts.push(`Count: ${input.count}`);
  }
  if (typeof input.maxPagesPerQuery === "number") {
    parts.push(`Pages/query: ${input.maxPagesPerQuery}`);
  }
  return parts.join(" · ") || "See details for full input";
}

export function jobsFromStrategicPayload(
  payload: StrategicPayload | null
): LeadPlanJobView[] {
  if (!payload?.jobs?.length) return [];
  return payload.jobs.map((job) => {
    const key = isActorKey(job.actorKey) ? job.actorKey : null;
    const catalog = key ? ACTOR_CATALOG[key as ActorKey] : null;
    return {
      jobId: job.jobId,
      actorKey: job.actorKey,
      actorLabel: catalog?.label ?? job.actorKey,
      actorId: catalog?.actorId ?? "—",
      reasoning: job.reasoning,
      apifyInput: job.apifyInput,
      paramSummary: summarizeApifyInput(job.apifyInput),
    };
  });
}

export function buildLeadPlanView(input: {
  leadListId: number;
  leadListName: string;
  listDescription: string | null;
  plan: LeadPlan | null;
  planState: PlanState;
  planUpdatedAt: string | null;
  planContextHash: string | null;
  staleReason: string | null;
  leadStrategy: LeadStrategy;
  resolvedHuntConfig?: {
    geography: string | null;
    volumeTarget: number;
    enabledActorKeys: string[];
  };
  websiteSummary: string | null;
  websiteSummaryAt: string | null;
  payloadJson: string | null | undefined;
}): LeadPlanView {
  let strategicPayload: StrategicPayload | null = null;
  if (input.payloadJson?.trim()) {
    try {
      strategicPayload = parseStrategicPayload(JSON.parse(input.payloadJson));
    } catch {
      strategicPayload = null;
    }
  }
  const resolvedHuntConfig = input.resolvedHuntConfig ?? {
    geography: input.plan?.geography ?? null,
    volumeTarget: input.plan?.volumeTarget ?? 100,
    enabledActorKeys: input.leadStrategy.enabledActorKeys,
  };
  return {
    leadListId: input.leadListId,
    leadListName: input.leadListName,
    leadListDisplayName: displayLeadListName(input.leadListName),
    listDescription: input.listDescription,
    isDefaultList: isDefaultLeadList(input.leadListName),
    plan: input.plan,
    planState: input.planState,
    planUpdatedAt: input.planUpdatedAt,
    planContextHash: input.planContextHash,
    staleReason: input.staleReason,
    leadStrategy: input.leadStrategy,
    resolvedHuntConfig,
    websiteSummary: input.websiteSummary,
    websiteSummaryAt: input.websiteSummaryAt,
    strategicPayload,
    jobs: jobsFromStrategicPayload(strategicPayload),
  };
}
