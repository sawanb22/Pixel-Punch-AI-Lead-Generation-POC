import { createHash } from "node:crypto";

export interface PlanContextInputs {
  projectName: string;
  websiteSummary: string | null;
  description: string | null;
  icp: string | null;
  listName: string;
  listDescription: string | null;
  geography: string | null;
  volumeTarget: number;
  enabledActorKeys: string[];
}

export function computePlanContextHash(input: PlanContextInputs): string {
  const normalized = {
    projectName: input.projectName.trim(),
    websiteSummary: (input.websiteSummary ?? "").trim(),
    description: (input.description ?? "").trim(),
    icp: (input.icp ?? "").trim(),
    listName: input.listName.trim(),
    listDescription: (input.listDescription ?? "").trim(),
    geography: (input.geography ?? "").trim(),
    volumeTarget: input.volumeTarget,
    enabledActorKeys: [...input.enabledActorKeys].sort(),
  };
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex")
    .slice(0, 16);
}

export type PlanState = "none" | "draft" | "stale" | "ready";

export function resolvePlanState(input: {
  plan: { status: string } | null;
  storedHash: string | null;
  currentHash: string;
}): { planState: PlanState; staleReason: string | null } {
  if (!input.plan) {
    return { planState: "none", staleReason: null };
  }
  if (input.storedHash && input.storedHash !== input.currentHash) {
    return {
      planState: "stale",
      staleReason:
        "List focus changed after this plan was generated.",
    };
  }
  if (input.plan.status === "draft") {
    return { planState: "draft", staleReason: null };
  }
  return { planState: "ready", staleReason: null };
}
