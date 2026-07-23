import type { Lead, Project } from "../domain/types.js";
import type { ScoreResult, Scorer, ScoreContext } from "./scorer.js";

export interface HermesScorerOptions {
  baseUrl?: string;
  apiKey?: string | null;
  fetchFn?: typeof fetch;
  model?: string;
}

const SYSTEM_PROMPT =
  'You score B2B leads from the fields provided only. Do not call tools, search, or look up anything. Reply with ONLY a single JSON object and nothing else: {"score":0-100,"reasons":"short ICP fit explanation"}. No markdown, no preamble.';

function looksLikeToolNoise(reasons: string): boolean {
  return /lead_id|top picks|pending leads|record_feedback|get_top_picks|save_score|mcp|tool call/i.test(
    reasons
  );
}

function stripMarkdownFences(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]!.trim() : trimmed;
}

/**
 * Strip known safety / refusal preamble lines before parsing.
 * e.g. "User Safety: safe" emitted by some free OpenRouter models.
 */
function stripSafetyPreamble(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !/^\s*user\s+safety\s*:/i.test(line))
    .join("\n")
    .trim();
}

/**
 * Try to parse key:value prose format that some models emit instead of JSON:
 *   score: 75
 *   reasons: Good ICP fit…
 */
function tryParseKeyValueProse(content: string): string | null {
  const scoreMatch = content.match(/score\s*[:\-]\s*(\d+)/i);
  const reasonsMatch = content.match(/reasons?\s*[:\-]\s*([\s\S]+)/i);
  if (scoreMatch && reasonsMatch) {
    return JSON.stringify({
      score: Number(scoreMatch[1]),
      reasons: reasonsMatch[1].trim().slice(0, 500),
    });
  }
  return null;
}

/** Pull the first JSON object from agent prose if needed. */
export function extractJsonObject(content: string): string {
  // Strip safety preamble first
  const cleaned = stripSafetyPreamble(content);
  const stripped = stripMarkdownFences(cleaned);
  try {
    JSON.parse(stripped);
    return stripped;
  } catch {
    /* fall through */
  }
  // Try extracting {…} block
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return stripped.slice(start, end + 1);
  }
  // Try key:value prose fallback
  const prose = tryParseKeyValueProse(stripped);
  if (prose) return prose;
  return stripped;
}

function formatSimilarSection(context?: ScoreContext): string | null {
  const similar = context?.similar ?? [];
  if (similar.length === 0) return null;
  const lines = similar.map((d) => {
    const label = d.good ? "approved" : "rejected";
    const notes = d.notes ? ` notes=${d.notes}` : "";
    const score = d.score !== null ? ` score=${d.score}` : "";
    return `- ${d.company} (${d.website ?? "n/a"}) ${label}${score}${notes}`;
  });
  return ["Similar past leads:", ...lines].join("\n");
}

export class HermesScorer implements Scorer {
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly fetchFn: typeof fetch;
  private readonly model: string;

  constructor(options: HermesScorerOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.HERMES_API_BASE ?? "http://127.0.0.1:8642").replace(
      /\/$/,
      ""
    );
    this.apiKey = options.apiKey ?? process.env.HERMES_API_KEY ?? null;
    this.fetchFn = options.fetchFn ?? fetch;
    this.model = options.model ?? process.env.HERMES_MODEL ?? "hermes-agent";
  }

  async scoreLead(
    lead: Lead,
    project: Project,
    context?: ScoreContext
  ): Promise<ScoreResult> {
    const parts = [
      `ICP: ${project.icp ?? "(none)"}`,
      `Company: ${lead.company}`,
      `Website: ${lead.website ?? "(none)"}`,
      `Email: ${lead.email ?? "(none)"}`,
      `Votes: ${lead.votes ?? "(none)"}`,
      `Sources: ${lead.sources.join(", ")}`,
    ];
    const similarSection = formatSimilarSection(context);
    if (similarSection) parts.push(similarSection);
    const userPrompt = parts.join("\n");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const res = await this.fetchFn(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 1000,
      }),
    });

    if (!res.ok) {
      throw new Error(`Hermes API error: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Hermes response missing content");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonObject(content));
    } catch {
      throw new Error(
        `Hermes response is not valid JSON: ${content.slice(0, 200)}`
      );
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("score" in parsed) ||
      !("reasons" in parsed)
    ) {
      throw new Error("Hermes JSON missing score/reasons");
    }

    const score = Number((parsed as { score: unknown }).score);
    const reasons = String((parsed as { reasons: unknown }).reasons);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error("Hermes score out of range (must be 0–100)");
    }
    if (looksLikeToolNoise(reasons)) {
      throw new Error(
        `Hermes returned tool/MCP noise instead of a score reason: ${reasons.slice(0, 200)}`
      );
    }

    return { score: Math.round(score), reasons };
  }
}
