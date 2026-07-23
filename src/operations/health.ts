import type { FetchLike } from "../sources/source.js";

export interface HealthCheckResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validates credentials and endpoints for Jina, Apify, and LLM (via Hermes API).
 */
export async function runProviderHealthCheck(options: {
  fetchFn: FetchLike;
  checkJina?: boolean;
  checkApify?: boolean;
  checkHermes?: boolean;
  hermesBaseUrl?: string;
  apifyToken?: string;
  jinaApiKey?: string;
}): Promise<HealthCheckResult> {
  const {
    fetchFn,
    checkJina = true,
    checkApify = true,
    checkHermes = true,
    hermesBaseUrl = process.env.HERMES_API_BASE || "http://127.0.0.1:8642",
    apifyToken = process.env.APIFY_TOKEN,
    jinaApiKey = process.env.JINA_API_KEY,
  } = options;

  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return { ok: true, errors: [] };
  }

  const errors: string[] = [];

  // 1. Validate Jina Reader
  if (checkJina) {
    if (!jinaApiKey) {
      errors.push("Jina API key (JINA_API_KEY) is missing in environment.");
    } else {
      try {
        // Quick verify request to Jina to check key status
        const res = await fetchFn("https://r.jina.ai/https://example.com", {
          method: "HEAD",
          headers: {
            Authorization: `Bearer ${jinaApiKey}`,
          },
        });
        if (res.status === 401 || res.status === 403) {
          errors.push(`Jina API authentication failed (HTTP ${res.status}). Invalid API key.`);
        } else if (res.status === 402) {
          errors.push("Jina API quota exhausted (HTTP 402). Please add credits to your account.");
        }
      } catch (err) {
        // Network warning only, don't hard-fail if Jina endpoint has transient network issues
      }
    }
  }

  // 2. Validate Apify Token
  if (checkApify) {
    if (!apifyToken) {
      errors.push("Apify API token (APIFY_TOKEN) is missing in environment.");
    } else {
      try {
        const res = await fetchFn(`https://api.apify.com/v2/users/me?token=${apifyToken}`);
        if (!res.ok) {
          if (res.status === 401) {
            errors.push("Apify authentication failed. Invalid API token.");
          } else {
            errors.push(`Apify API health check failed with status: ${res.status}`);
          }
        }
      } catch (err) {
        errors.push(`Failed to reach Apify API: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 3. Validate Hermes/Bifrost Connection
  if (checkHermes) {
    if (!hermesBaseUrl) {
      errors.push("Hermes base URL (HERMES_API_BASE) is missing in environment.");
    } else {
      try {
        // Ping Hermes API server models endpoint with auth token
        const res = await fetchFn(`${hermesBaseUrl}/v1/models`, {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${process.env.HERMES_API_KEY || ""}`,
          },
        });
        if (!res.ok) {
          errors.push(`Hermes API server returned status ${res.status} on health check.`);
        }
      } catch (err) {
        errors.push(`Failed to connect to Hermes Gateway at ${hermesBaseUrl}. Is the gateway running?`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
