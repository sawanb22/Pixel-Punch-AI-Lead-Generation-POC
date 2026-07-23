import type { FetchLike } from "../sources/source.js";
import type { DB } from "../db/database.js";
import type { Project } from "../domain/types.js";
import { updateProject } from "../projects/projects.repo.js";

const SUMMARY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface WebsiteSummaryResult {
  summary: string;
  fetchedAt: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMeta(html: string, name: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
    "i"
  );
  return html.match(re)?.[1] ?? html.match(alt)?.[1] ?? null;
}

function extractTitle(html: string): string | null {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
}

export function isWebsiteSummaryStale(
  websiteSummaryAt: string | null | undefined
): boolean {
  if (!websiteSummaryAt) return true;
  const t = Date.parse(websiteSummaryAt);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > SUMMARY_TTL_MS;
}

export async function fetchProjectWebsiteSummary(
  website: string,
  options?: { fetch?: FetchLike; timeoutMs?: number }
): Promise<WebsiteSummaryResult> {
  const fetchImpl = options?.fetch ?? fetch;
  const timeoutMs = options?.timeoutMs ?? 12_000;
  const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "LeadRadar/1.0 (+website-summary)" },
    });
    if (!res.ok) {
      throw new Error(`website fetch HTTP ${res.status}`);
    }
    const html = await res.text();
    const title = extractTitle(html);
    const description =
      extractMeta(html, "description") ??
      extractMeta(html, "og:description");
    const text = stripHtml(html).slice(0, 2000);
    const bullets = [
      title ? `Title: ${title}` : null,
      description ? `Description: ${description}` : null,
      text ? `Page text: ${text}` : null,
    ].filter(Boolean);
    if (bullets.length === 0) {
      throw new Error("empty website content");
    }
    return {
      summary: bullets.join("\n"),
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Refresh and persist website summary when missing/stale or website changed. */
export async function ensureProjectWebsiteSummary(
  db: DB,
  project: Project,
  options?: { fetch?: FetchLike; force?: boolean }
): Promise<Project> {
  if (!project.website?.trim()) return project;
  if (
    !options?.force &&
    project.websiteSummary &&
    !isWebsiteSummaryStale(project.websiteSummaryAt)
  ) {
    return project;
  }
  try {
    const result = await fetchProjectWebsiteSummary(project.website, {
      fetch: options?.fetch,
    });
    return (
      updateProject(db, project.id, {
        websiteSummary: result.summary,
        websiteSummaryAt: result.fetchedAt,
      }) ?? project
    );
  } catch {
    return project;
  }
}
