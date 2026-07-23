import { z } from "zod";
import {
  ACTOR_CATALOG,
  DEFAULT_AGENCY_ACTOR_KEYS,
  type ActorKey,
} from "./actor-catalog.js";

export const LeadStrategySchema = z.object({
  version: z.literal(1).default(1),
  enabledActorKeys: z
    .array(z.string())
    .min(1)
    .transform((keys) =>
      keys.filter((k): k is ActorKey => k in ACTOR_CATALOG)
    ),
  defaultGeography: z.string().nullable().optional(),
  buyerMode: z.enum(["agency", "hiring", "custom"]).default("agency"),
});

export type LeadStrategy = z.infer<typeof LeadStrategySchema>;

export function defaultLeadStrategy(
  overrides?: Partial<LeadStrategy>
): LeadStrategy {
  return LeadStrategySchema.parse({
    version: 1,
    enabledActorKeys: overrides?.enabledActorKeys?.length
      ? overrides.enabledActorKeys
      : [...DEFAULT_AGENCY_ACTOR_KEYS],
    defaultGeography: overrides?.defaultGeography ?? "USA",
    buyerMode: overrides?.buyerMode ?? "agency",
  });
}

export function parseLeadStrategy(
  raw: string | null | undefined
): LeadStrategy | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    const result = LeadStrategySchema.safeParse(parsed);
    if (!result.success) return null;
    if (result.data.enabledActorKeys.length === 0) {
      return defaultLeadStrategy({
        defaultGeography: result.data.defaultGeography ?? null,
        buyerMode: result.data.buyerMode,
      });
    }
    return result.data;
  } catch {
    return null;
  }
}

export function serializeLeadStrategy(strategy: LeadStrategy): string {
  return JSON.stringify(LeadStrategySchema.parse(strategy));
}

export function resolveProjectLeadStrategy(
  raw: string | null | undefined
): LeadStrategy {
  return parseLeadStrategy(raw) ?? defaultLeadStrategy();
}
