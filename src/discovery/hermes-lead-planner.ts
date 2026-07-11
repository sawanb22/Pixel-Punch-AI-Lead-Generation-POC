import type { FetchLike } from "../sources/source.js";
import {
  LeadPlanSchema,
  defaultAgencyLeadPlan,
  type LeadPlan,
  type DefaultAgencyPlanInput,
  clampVolumeTarget,
} from "./lead-plan.js";

export interface HermesLeadPlannerOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  apiKey?: string | null;
  model?: string;
  timeoutMs?: number;
}

const PLAN_SYSTEM = `You draft lead-finding plans for an agency that sells websites, AI integrations, AI agents, and product features to client businesses.
Reply with ONLY a JSON object (no markdown) with keys:
version (always 1), mode ("agency"), goal (string), geography (string|null), volumeTarget (number),
intents (string[]), searchAngles (string[] of Google-style queries), negatives (string[]),
status ("draft"), generatedBy ("hermes").
Focus on companies that NEED services, not software buyers of analytics products.`;

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

/**
 * Isolated Hermes client for lead planning only.
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

  async generatePlan(
    input: DefaultAgencyPlanInput
  ): Promise<{ plan: LeadPlan; fromFallback: boolean }> {
    try {
      const plan = await this.callHermes(input);
      return { plan, fromFallback: false };
    } catch {
      const plan = defaultAgencyLeadPlan(input);
      return { plan, fromFallback: true };
    }
  }

  private async callHermes(input: DefaultAgencyPlanInput): Promise<LeadPlan> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const volume = clampVolumeTarget(input.volumeTarget ?? 100);
    const user = [
      `Agency: ${input.name}`,
      `What we sell / who we help: ${input.icp ?? input.description ?? "(none)"}`,
      `Geography: ${input.geography ?? "(any)"}`,
      `Volume target: ${volume}`,
      input.feedbackNotes
        ? `User feedback to apply: ${input.feedbackNotes}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

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
      const raw = extractJsonObject(content) as Record<string, unknown>;
      return LeadPlanSchema.parse({
        ...raw,
        version: 1,
        mode: "agency",
        volumeTarget: clampVolumeTarget(
          typeof raw.volumeTarget === "number" ? raw.volumeTarget : volume
        ),
        status: "draft",
        generatedBy: "hermes",
        feedbackNotes: input.feedbackNotes ?? null,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
