import { z } from "zod";

export const VOLUME_STEPS = [25, 50, 100, 250, 500, 1000, 2000] as const;
export type VolumeTarget = (typeof VOLUME_STEPS)[number];

export const AGENCY_INTENTS = [
  "new_startup",
  "needs_website",
  "needs_ai_feature",
  "needs_ai_agent",
  "hiring_engineer",
  "local_smb_digital",
] as const;

export const LeadPlanSchema = z.object({
  version: z.literal(1),
  mode: z.literal("agency"),
  goal: z.string().min(1),
  geography: z.string().nullable(),
  volumeTarget: z.number().int().positive().max(2000),
  intents: z.array(z.string()).min(1),
  searchAngles: z.array(z.string()).min(1),
  negatives: z.array(z.string()).default([]),
  status: z.enum(["draft", "approved", "auto"]),
  feedbackNotes: z.string().nullable().optional(),
  generatedBy: z.enum(["hermes", "fallback", "user"]),
  updatedAt: z.string(),
});

export type LeadPlan = z.infer<typeof LeadPlanSchema>;

export function clampVolumeTarget(n: number): VolumeTarget {
  if (!Number.isFinite(n) || n <= 0) return 100;
  let best: VolumeTarget = VOLUME_STEPS[0];
  let bestDist = Math.abs(n - best);
  for (const step of VOLUME_STEPS) {
    const dist = Math.abs(n - step);
    if (dist < bestDist) {
      best = step;
      bestDist = dist;
    }
  }
  return best;
}

export function parseLeadPlan(
  raw: string | null | undefined
): LeadPlan | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    const result = LeadPlanSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function serializeLeadPlan(plan: LeadPlan): string {
  return JSON.stringify(LeadPlanSchema.parse(plan));
}

export interface DefaultAgencyPlanInput {
  name: string;
  icp?: string | null;
  description?: string | null;
  geography?: string | null;
  volumeTarget?: number;
  feedbackNotes?: string | null;
}

/** Deterministic agency plan when Hermes is unavailable. */
export function defaultAgencyLeadPlan(
  input: DefaultAgencyPlanInput
): LeadPlan {
  const niche =
    input.icp?.trim() ||
    input.description?.trim() ||
    `${input.name} client services`;
  const geo = input.geography?.trim() || null;
  const geoBit = geo ? ` in ${geo}` : "";
  const volumeTarget = clampVolumeTarget(input.volumeTarget ?? 100);

  return LeadPlanSchema.parse({
    version: 1,
    mode: "agency",
    goal: `Find startups and SMBs${geoBit} that likely need a new website, AI feature, AI agent, or product integration (clients for ${input.name}).`,
    geography: geo,
    volumeTarget,
    intents: [
      "new_startup",
      "needs_website",
      "needs_ai_feature",
      "needs_ai_agent",
      "local_smb_digital",
    ],
    searchAngles: [
      `${niche} startup launching website${geoBit}`,
      `small business needs website redesign${geoBit}`,
      `"looking for" AI chatbot OR "AI agent" agency${geoBit}`,
      `hiring AI engineer OR "full stack" startup${geoBit}`,
      `SaaS company needs custom AI integration${geoBit}`,
      localMapsQuery(niche, geo),
    ].filter(Boolean),
    negatives: [
      "directories",
      "job boards as company website",
      "social-only profiles",
      "listicle pages",
    ],
    status: "draft",
    feedbackNotes: input.feedbackNotes ?? null,
    generatedBy: "fallback",
    updatedAt: new Date().toISOString(),
  });
}

function localMapsQuery(niche: string, geo: string | null): string {
  const place = geo || "major US cities";
  return `local businesses needing digital / AI help near ${place} (${niche})`;
}
