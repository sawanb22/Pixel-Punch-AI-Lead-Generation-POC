import type { FetchLike } from "../sources/source.js";
import { catalogForPlanner, type ActorKey } from "./actor-catalog.js";
import {
  LeadPlanSchema,
  type LeadPlan,
  type DefaultAgencyPlanInput,
  clampVolumeTarget,
} from "./lead-plan.js";
import {
  defaultStrategicPayload,
  parseStrategicPayload,
  type StrategicPayload,
  type StrategicPlannerContext,
} from "./strategic-payload.js";
import { formatRevisionBriefForPrompt } from "./run-revision-brief.js";

export interface HermesLeadPlannerOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  apiKey?: string | null;
  model?: string;
  timeoutMs?: number;
}

const PLAN_SYSTEM = `You are a Strategic Payload Generator for an automated lead-finding system.
Reply with ONLY a JSON object (no markdown) with this exact shape:
{
  "version": 1,
  "goal": string,
  "geography": string|null,
  "volumeTarget": number,
  "negatives": string[],
  "jobs": [{
    "jobId": string,
    "actorKey": string,
    "actorId": string|null,
    "reasoning": string,
    "apifyInput": object
  }]
}

Rules:
- Select the best scrapers/actors for the specific industry, niche, and geography requested. Prefer enabled actor keys, but for specialized niches (e.g. tourism, hotels, local services) you may recommend specialized Apify store actor keys (like tripadvisor_scraper, yelp_scraper, instagram_profiles, google_maps).
- Strictly target potential BUYER companies, clients, or prospects matching the project's ICP, product description, and campaign list focus — filter out irrelevant competitors, blogs, directory listicles, or vendors.
- If geography is empty or USA, pick major relevant target hubs/cities.
- Apply negatives and user feedback as hard constraints.
- Include 1–3 jobs max. Each job needs clear reasoning matching the project's goal.`;

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("no JSON object in Hermes plan response");
  }
}

function payloadToLeadPlan(
  payload: StrategicPayload,
  input: StrategicPlannerContext,
  generatedBy: "hermes" | "fallback"
): LeadPlan {
  return LeadPlanSchema.parse({
    version: 1,
    mode: "agency",
    goal: payload.goal,
    geography: payload.geography,
    volumeTarget: clampVolumeTarget(payload.volumeTarget),
    intents: ["new_startup", "needs_website", "needs_ai_feature", "local_smb_digital"],
    searchAngles: payload.jobs.map((j) => j.reasoning),
    negatives: payload.negatives,
    status: "draft",
    feedbackNotes: input.feedbackNotes ?? null,
    generatedBy,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Isolated Hermes client for strategic lead planning.
 * Does not share conversation/session state with HermesScorer.
 */
export class HermesLeadPlanner {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: HermesLeadPlannerOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.baseUrl = (
      options.baseUrl ??
      process.env.HERMES_PLAN_API_BASE ??
      process.env.HERMES_API_BASE ??
      "http://127.0.0.1:8642"
    ).replace(/\/$/, "");
    this.apiKey =
      options.apiKey ??
      process.env.HERMES_PLAN_API_KEY ??
      process.env.HERMES_API_KEY ??
      null;
    this.model =
      options.model ??
      process.env.HERMES_PLAN_MODEL ??
      "hermes-lead-planner";
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  /** @deprecated Prefer generateStrategicPayload; kept for LeadPlan UI compatibility. */
  async generatePlan(
    input: DefaultAgencyPlanInput & {
      enabledActorKeys?: ActorKey[];
      websiteSummary?: string | null;
      buyerMode?: "agency" | "hiring" | "custom";
    }
  ): Promise<{ plan: LeadPlan; fromFallback: boolean }> {
    const ctx: StrategicPlannerContext = {
      name: input.name,
      icp: input.icp,
      description: input.description,
      geography: input.geography,
      volumeTarget: input.volumeTarget,
      feedbackNotes: input.feedbackNotes,
      websiteSummary: input.websiteSummary,
      enabledActorKeys: input.enabledActorKeys ?? [
        "google_maps",
        "wellfound_startups",
      ],
      buyerMode: input.buyerMode ?? "agency",
    };
    const result = await this.generateStrategicPayload(ctx);
    return {
      plan: payloadToLeadPlan(
        result.payload,
        ctx,
        result.fromFallback ? "fallback" : "hermes"
      ),
      fromFallback: result.fromFallback,
    };
  }

  async generateStrategicPayload(
    input: StrategicPlannerContext
  ): Promise<{
    payload: StrategicPayload;
    raw: unknown;
    fromFallback: boolean;
    plannerInput: Record<string, unknown>;
  }> {
    const plannerInput = {
      name: input.name,
      icp: input.icp,
      description: input.description,
      geography: input.geography,
      volumeTarget: clampVolumeTarget(input.volumeTarget ?? 100),
      feedbackNotes: input.feedbackNotes,
      websiteSummary: input.websiteSummary,
      enabledActorKeys: input.enabledActorKeys,
      buyerMode: input.buyerMode ?? "agency",
      listName: input.listName ?? null,
      listDescription: input.listDescription ?? null,
      listFocus: input.listFocus ?? null,
      revisionBriefRunId: input.revisionBrief?.runId ?? null,
    };

    try {
      const { payload, raw } = await this.callHermes(input);
      return {
        payload,
        raw,
        fromFallback: false,
        plannerInput,
      };
    } catch {
      const payload = defaultStrategicPayload(input);
      return {
        payload,
        raw: null,
        fromFallback: true,
        plannerInput,
      };
    }
  }

  private async callHermes(
    input: StrategicPlannerContext
  ): Promise<{ payload: StrategicPayload; raw: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const volume = clampVolumeTarget(input.volumeTarget ?? 100);
    const enabled = input.enabledActorKeys;
    const user = [
      `Agency: ${input.name}`,
      `Buyer mode: ${input.buyerMode ?? "agency"}`,
      input.listName
        ? `Hunt scope — lead list: "${input.listName}"${
            input.listDescription ? `\nList focus: ${input.listDescription}` : ""
          }\nPlan ONLY for this campaign. Do not include other services, verticals, or lead types outside this list focus. Project ICP is background context only.`
        : null,
      `What we sell / who we help: ${input.icp ?? input.description ?? "(none)"}`,
      input.websiteSummary
        ? `Website summary:\n${input.websiteSummary}`
        : null,
      `Geography: ${input.geography ?? "(any — default US hubs for Maps)"}`,
      `Volume target: ${volume}`,
      `Enabled actor keys (ONLY use these):\n${enabled.map((k) => `- ${k}`).join("\n")}`,
      `Actor details:\n${catalogForPlanner(enabled)}`,
      input.feedbackNotes
        ? `User feedback to apply: ${input.feedbackNotes}`
        : null,
      input.revisionBrief
        ? formatRevisionBriefForPrompt(input.revisionBrief)
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

      const res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages: [
            { role: "system", content: PLAN_SYSTEM },
            { role: "user", content: user },
          ],
          max_tokens: 2000,
        }),
      });
      if (!res.ok) {
        throw new Error(`Hermes plan HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("empty Hermes plan content");
      const raw = extractJsonObject(content);
      const payload = parseStrategicPayload({
        ...(raw as object),
        version: 1,
        volumeTarget: volume,
      });
      if (!payload) throw new Error("invalid strategic payload from Hermes");
      return { payload, raw };
    } finally {
      clearTimeout(timer);
    }
  }
}
