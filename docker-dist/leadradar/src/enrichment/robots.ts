import type { FetchLike } from "../sources/source.js";

/** Minimal robots.txt allow check for a single user-agent path. */
export async function isUrlAllowedByRobots(
  pageUrl: string,
  options: {
    fetch: FetchLike;
    userAgent?: string;
    timeoutMs?: number;
  }
): Promise<boolean> {
  try {
    const url = new URL(pageUrl);
    const robotsUrl = `${url.origin}/robots.txt`;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 5_000
    );
    const res = await options.fetch(robotsUrl, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": options.userAgent ?? "LeadRadar/0.1" },
    });
    clearTimeout(timer);
    if (!res.ok) return true;
    const text = await res.text();
    return pathAllowed(text, url.pathname || "/", options.userAgent ?? "*");
  } catch {
    return true;
  }
}

function pathAllowed(
  robotsText: string,
  path: string,
  _userAgent: string
): boolean {
  const lines = robotsText.split(/\r?\n/);
  let inStar = false;
  const rules: Array<{ allow: boolean; prefix: string }> = [];

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const k = key.toLowerCase();
    if (k === "user-agent") {
      inStar = value === "*";
      continue;
    }
    if (!inStar) continue;
    if (k === "disallow") {
      rules.push({ allow: false, prefix: value || "/" });
    } else if (k === "allow") {
      rules.push({ allow: true, prefix: value });
    }
  }

  let decision: boolean | null = null;
  let bestLen = -1;
  for (const rule of rules) {
    if (!rule.prefix) continue;
    if (path.startsWith(rule.prefix) && rule.prefix.length >= bestLen) {
      bestLen = rule.prefix.length;
      decision = rule.allow;
    }
  }
  return decision !== false;
}
