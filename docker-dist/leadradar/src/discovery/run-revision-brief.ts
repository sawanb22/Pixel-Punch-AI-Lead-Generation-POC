import type { DB } from "../db/database.js";
import {
  listDiscoveredCandidates,
  listDiscoveryRunsForProject,
} from "./discovery.repo.js";
import { parseStrategicPayload } from "./strategic-payload.js";

/** Soft cap for formatted prompt block (~400 tokens). */
export const BRIEF_MAX_CHARS = 2000;

const INPUT_SUMMARY_MAX = 120;
const MAX_JOBS = 6;
const MAX_MIX = 8;

export interface RunRevisionBriefJob {
  actorKey: string;
  jobId: string;
  inputSummary: string;
}

export interface RunRevisionBrief {
  runId: number;
  previousJobs: RunRevisionBriefJob[];
  stats: {
    fetched: number;
    kept: number;
    provisional: number;
    rejected: number;
    duplicates: number;
    circuitBreaker: boolean;
    circuitBreakerReason: string | null;
  };
  rejectionMix: Array<{ reason: string; count: number }>;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** Extract only hunt keywords from Apify input — never dump full input JSON. */
export function summarizeJobInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  const arrKeys = ["searchStringsArray", "queries"];
  for (const key of arrKeys) {
    const v = input[key];
    if (Array.isArray(v)) {
      parts.push(
        ...v.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      );
    } else if (typeof v === "string" && v.trim()) {
      parts.push(v.trim());
    }
  }
  for (const key of ["query", "location", "keyword", "keywords"]) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
  }
  if (!parts.length) return "(no query fields)";
  return truncate(parts.join(" | "), INPUT_SUMMARY_MAX);
}

function parseProvisional(notes: string | null): number {
  if (!notes) return 0;
  const m = notes.match(/provisional\s*=\s*(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function parseCircuitBreaker(notes: string | null): {
  tripped: boolean;
  reason: string | null;
} {
  if (!notes || !/circuit_breaker/i.test(notes)) {
    return { tripped: false, reason: null };
  }
  const m = notes.match(/circuit_breaker:\s*([^;]+)/i);
  return {
    tripped: true,
    reason: m ? m[1].trim() : "tripped",
  };
}

function jobsFromPayloadJson(raw: string | null): RunRevisionBriefJob[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const payload = parseStrategicPayload(parsed);
    if (!payload) return [];
    return payload.jobs.slice(0, MAX_JOBS).map((j) => ({
      actorKey: String(j.actorKey),
      jobId: String(j.jobId),
      inputSummary: summarizeJobInput(
        (j.apifyInput ?? {}) as Record<string, unknown>
      ),
    }));
  } catch {
    return [];
  }
}

function rejectionMixForRun(
  db: DB,
  runId: number
): Array<{ reason: string; count: number }> {
  const rows = listDiscoveredCandidates(db, runId, { kept: false });
  const counts = new Map<string, number>();
  for (const r of rows) {
    const reason = (r.rejectionReason ?? "unknown").trim() || "unknown";
    if (reason === "provisional") continue;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_MIX);
}

/**
 * Build a compact revision brief from the latest completed discovery run for a list.
 * Fail-soft: returns null on missing data or parse errors.
 */
export function buildRunRevisionBrief(
  db: DB,
  projectId: number,
  leadListId: number
): RunRevisionBrief | null {
  try {
    const runs = listDiscoveryRunsForProject(db, projectId, {
      leadListId,
      limit: 20,
    });
    const run = runs.find((r) => r.status === "completed");
    if (!run) return null;

    const cb = parseCircuitBreaker(run.validationNotes);
    const brief: RunRevisionBrief = {
      runId: run.id,
      previousJobs: jobsFromPayloadJson(run.payloadJson),
      stats: {
        fetched: run.fetchedCount,
        kept: run.keptCount,
        provisional: parseProvisional(run.validationNotes),
        rejected: run.rejectedCount,
        duplicates: run.duplicateCount,
        circuitBreaker: cb.tripped,
        circuitBreakerReason: cb.reason,
      },
      rejectionMix: rejectionMixForRun(db, run.id),
    };

    // Ensure formatted size stays under cap by trimming mix if needed
    let formatted = formatRevisionBriefForPrompt(brief);
    while (
      formatted.length > BRIEF_MAX_CHARS &&
      brief.rejectionMix.length > 1
    ) {
      brief.rejectionMix.pop();
      formatted = formatRevisionBriefForPrompt(brief);
    }
    for (const job of brief.previousJobs) {
      while (
        formatRevisionBriefForPrompt(brief).length > BRIEF_MAX_CHARS &&
        job.inputSummary.length > 20
      ) {
        job.inputSummary = truncate(job.inputSummary, job.inputSummary.length - 20);
      }
    }
    return brief;
  } catch {
    return null;
  }
}

export function formatRevisionBriefForPrompt(brief: RunRevisionBrief): string {
  const jobLines = brief.previousJobs.length
    ? brief.previousJobs
        .map(
          (j) =>
            `- ${j.actorKey} (${j.jobId}): ${j.inputSummary}`
        )
        .join("\n")
    : "- (no prior jobs recorded)";
  const mixLines = brief.rejectionMix.length
    ? brief.rejectionMix.map((m) => `- ${m.reason}: ${m.count}`).join("\n")
    : "- (none)";
  const cb = brief.stats.circuitBreaker
    ? `yes (${brief.stats.circuitBreakerReason ?? "tripped"})`
    : "no";

  return [
    "REVISION BRIEF (from last hunt — revise; do not repeat failed patterns):",
    `Run #${brief.runId}`,
    `Stats: fetched=${brief.stats.fetched} kept=${brief.stats.kept} provisional=${brief.stats.provisional} rejected=${brief.stats.rejected} duplicates=${brief.stats.duplicates} circuitBreaker=${cb}`,
    "Previous jobs:",
    jobLines,
    "Rejection mix (top):",
    mixLines,
  ].join("\n");
}
