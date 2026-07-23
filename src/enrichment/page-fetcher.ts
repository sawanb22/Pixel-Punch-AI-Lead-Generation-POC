import type { DB } from "../db/database.js";
import type { FetchLike } from "../sources/source.js";
import {
  getCachedPage,
  putCachedPage,
} from "./enrichment.repo.js";
import { PAGE_CACHE_TTL_MS } from "./types.js";

export interface FetchedPage {
  url: string;
  finalUrl: string;
  httpStatus: number;
  contentType: string | null;
  body: string | null;
  fromCache: boolean;
  error?: string;
}

export interface FetchPageOptions {
  fetch: FetchLike;
  db?: DB;
  timeoutMs?: number;
  useCache?: boolean;
  userAgent?: string;
  useJinaReader?: boolean;
  jinaApiKey?: string;
}

function isHtml(contentType: string | null): boolean {
  if (!contentType) return true;
  return /text\/html|application\/xhtml\+xml/i.test(contentType);
}

function cacheFresh(fetchedAt: string): boolean {
  const ts = Date.parse(fetchedAt);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < PAGE_CACHE_TTL_MS;
}

function isLikelySpaOrSkeleton(body: string | null): boolean {
  if (!body) return true;
  const cleanBody = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .trim();
  const textLength = cleanBody.replace(/\s+/g, "").length;
  if (textLength < 250 && (/id=["'](root|app|__next)["']/i.test(body) || /<app-root/i.test(body))) {
    return true;
  }
  return false;
}

async function fetchViaJina(
  url: string,
  options: FetchPageOptions
): Promise<FetchedPage> {
  const apiKey = options.jinaApiKey ?? process.env.JINA_API_KEY;
  if (!apiKey) {
    return {
      url,
      finalUrl: url,
      httpStatus: 0,
      contentType: null,
      body: null,
      fromCache: false,
      error: "jina_no_api_key",
    };
  }

  const jinaUrl = `https://r.jina.ai/${encodeURI(url)}`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 15_000
  );

  try {
    const res = await options.fetch(jinaUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "X-Return-Format": "markdown",
      },
    });
    clearTimeout(timer);

    const body = await res.text();
    if (!res.ok) {
      return {
        url,
        finalUrl: url,
        httpStatus: res.status,
        contentType: "application/json",
        body: null,
        fromCache: false,
        error: `Jina Reader failed: HTTP ${res.status}`,
      };
    }

    if (options.db) {
      putCachedPage(options.db, {
        url,
        finalUrl: url,
        httpStatus: res.status,
        contentType: "application/json",
        body,
      });
    }

    return {
      url,
      finalUrl: url,
      httpStatus: res.status,
      contentType: "application/json",
      body,
      fromCache: false,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      url,
      finalUrl: url,
      httpStatus: 0,
      contentType: null,
      body: null,
      fromCache: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchHtmlPage(
  url: string,
  options: FetchPageOptions
): Promise<FetchedPage> {
  if (options.useCache !== false && options.db) {
    const cached = getCachedPage(options.db, url);
    if (cached && cacheFresh(cached.fetchedAt) && cached.body != null) {
      return {
        url,
        finalUrl: cached.finalUrl ?? url,
        httpStatus: cached.httpStatus ?? 200,
        contentType: cached.contentType,
        body: cached.body,
        fromCache: true,
      };
    }
  }

  let stdFetchResult: FetchedPage | null = null;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 10_000
  );

  try {
    const res = await options.fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": options.userAgent ?? "LeadRadar/0.1 (+company-enrichment)",
      },
    });
    clearTimeout(timer);

    const contentType = res.headers.get("content-type");
    const finalUrl = res.url || url;

    if (!res.ok) {
      stdFetchResult = {
        url,
        finalUrl,
        httpStatus: res.status,
        contentType,
        body: null,
        fromCache: false,
        error: `HTTP ${res.status}`,
      };
    } else if (!isHtml(contentType)) {
      stdFetchResult = {
        url,
        finalUrl,
        httpStatus: res.status,
        contentType,
        body: null,
        fromCache: false,
        error: "non_html",
      };
    } else {
      const body = await res.text();
      if (isLikelySpaOrSkeleton(body)) {
        stdFetchResult = {
          url,
          finalUrl,
          httpStatus: res.status,
          contentType,
          body,
          fromCache: false,
          error: "spa_detected",
        };
      } else {
        if (options.db) {
          putCachedPage(options.db, {
            url,
            finalUrl,
            httpStatus: res.status,
            contentType,
            body: body.slice(0, 500_000),
          });
        }
        return {
          url,
          finalUrl,
          httpStatus: res.status,
          contentType,
          body,
          fromCache: false,
        };
      }
    }
  } catch (err) {
    clearTimeout(timer);
    stdFetchResult = {
      url,
      finalUrl: url,
      httpStatus: 0,
      contentType: null,
      body: null,
      fromCache: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Trigger Jina fallback if standard fetch failed or detected SPA
  if (options.useJinaReader !== false) {
    const jinaResult = await fetchViaJina(url, options);
    if (jinaResult.body) {
      return jinaResult;
    }
  }

  return stdFetchResult;
}
