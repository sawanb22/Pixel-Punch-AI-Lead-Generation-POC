import { canonicalDomain } from "../validation/canonicalize.js";

export function normalizeHomepageUrl(
  website: string | null | undefined
): string | null {
  if (!website?.trim()) return null;
  try {
    const raw = website.trim();
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProto);
    if (!url.hostname) return null;
    url.hash = "";
    url.search = "";
    url.pathname = "/";
    return url.toString();
  } catch {
    return null;
  }
}

function registrableHost(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

export function isSameDomain(a: string, b: string): boolean {
  try {
    const ha = registrableHost(new URL(a).hostname);
    const hb = registrableHost(new URL(b).hostname);
    return ha === hb;
  } catch {
    return false;
  }
}

export function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export function filterSameDomainLinks(
  baseUrl: string,
  hrefs: string[]
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const href of hrefs) {
    const absolute = resolveUrl(baseUrl, href);
    if (!absolute) continue;
    if (!isSameDomain(baseUrl, absolute)) continue;
    let normalized: string;
    try {
      const u = new URL(absolute);
      u.hash = "";
      normalized = u.toString().replace(/\/$/, "") || u.origin;
      // keep trailing slash only for root
      if (u.pathname === "/" || u.pathname === "") {
        normalized = `${u.origin}/`;
      }
    } catch {
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function domainFromWebsite(
  website: string | null | undefined
): string | null {
  return canonicalDomain(website ?? null);
}
