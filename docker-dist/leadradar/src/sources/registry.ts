import type { Project } from "../domain/types.js";
import type { FetchLike, Source } from "./source.js";
import { ProductHuntSource } from "./producthunt-source.js";
import { GoogleSearchSource } from "./google-search-source.js";
import { JinaSearchSource } from "./jina-search-source.js";

export interface ProductHuntConfig {
  enabled?: boolean;
  first?: number;
}

export interface GoogleSearchConfig {
  enabled?: boolean;
  /** Required when enabled. */
  query?: string;
  num?: number;
}

export interface JinaSearchConfig {
  enabled?: boolean;
  /** Required when enabled. */
  query?: string;
  num?: number;
}

/** JSON shape stored in `projects.source_config`. */
export interface SourceConfig {
  producthunt?: ProductHuntConfig;
  google?: GoogleSearchConfig;
  jina?: JinaSearchConfig;
  /** When true, website enricher runs after merge (before validate). */
  enrich?: boolean;
}

export interface CreateConfiguredSourcesOptions {
  /** Injectable fetch for all HTTP adapters. */
  fetch?: FetchLike;
  /** Env for API credentials; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface ConfiguredSources {
  sources: Source[];
  enrich: boolean;
}

export function parseSourceConfig(json: string | null | undefined): SourceConfig {
  if (!json || !json.trim()) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("sourceConfig must be a JSON object");
    }
    return parsed as SourceConfig;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid sourceConfig JSON: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Build Source adapters from a project's sourceConfig JSON + env credentials.
 * Missing credentials for an enabled source throw a clear error.
 */
export function createConfiguredSources(
  project: Project,
  options: CreateConfiguredSourcesOptions = {}
): ConfiguredSources {
  const config = parseSourceConfig(project.sourceConfig);
  const env = options.env ?? process.env;
  const sources: Source[] = [];

  const ph = config.producthunt;
  if (ph != null && ph.enabled !== false) {
    const token = env.PRODUCTHUNT_TOKEN;
    if (!token?.trim()) {
      throw new Error(
        "sourceConfig enables producthunt but PRODUCTHUNT_TOKEN is not set"
      );
    }
    sources.push(
      new ProductHuntSource({
        token,
        first: ph.first,
        fetch: options.fetch,
      })
    );
  }

  const google = config.google;
  if (google != null && google.enabled !== false) {
    const query = google.query?.trim();
    if (!query) {
      throw new Error(
        "sourceConfig.google requires a non-empty query when enabled"
      );
    }
    const apiKey = env.GOOGLE_CSE_KEY;
    const cx = env.GOOGLE_CSE_ID;
    if (!apiKey?.trim()) {
      throw new Error(
        "sourceConfig enables google but GOOGLE_CSE_KEY is not set"
      );
    }
    if (!cx?.trim()) {
      throw new Error(
        "sourceConfig enables google but GOOGLE_CSE_ID is not set"
      );
    }
    sources.push(
      new GoogleSearchSource({
        apiKey,
        cx,
        query,
        num: google.num,
        fetch: options.fetch,
      })
    );
  }

  const jina = config.jina;
  if (jina != null && jina.enabled !== false) {
    const query = jina.query?.trim();
    if (!query) {
      throw new Error(
        "sourceConfig.jina requires a non-empty query when enabled"
      );
    }
    const apiKey = env.JINA_API_KEY;
    if (!apiKey?.trim()) {
      throw new Error("sourceConfig enables jina but JINA_API_KEY is not set");
    }
    sources.push(
      new JinaSearchSource({
        apiKey,
        query,
        num: jina.num,
        fetch: options.fetch,
      })
    );
  }

  return { sources, enrich: config.enrich === true };
}
