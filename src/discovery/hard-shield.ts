import type { DiscoveredCompanyCandidate } from "./types.js";

/** Social / profile hosts — never company websites. */
export const SOCIAL_HOST_SUFFIXES = [
  "linkedin.com",
  "facebook.com",
  "fb.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "reddit.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "pinterest.com",
];

/** Directories / marketplaces — not buyer companies. */
export const DIRECTORY_HOST_SUFFIXES = [
  "producthunt.com",
  "crunchbase.com",
  "ycombinator.com",
  "angel.co",
  "wellfound.com",
  "g2.com",
  "capterra.com",
  "getapp.com",
  "alternativeto.net",
  "saasworthy.com",
  "f6s.com",
  "betalist.com",
  "yelp.com",
  "yellowpages.com",
  "tripadvisor.com",
];

/** Job boards. */
export const JOB_HOST_SUFFIXES = [
  "greenhouse.io",
  "lever.co",
  "boards.greenhouse.io",
  "jobs.lever.co",
  "indeed.com",
  "glassdoor.com",
  "linkedin.com",
];

/**
 * Vendors, media, mega-platforms — unified with inspect-leads-quality patterns.
 * Hard Shield must reject these so they never become gated leads.
 */
export const VENDOR_MEDIA_PLATFORM_HOST_SUFFIXES = [
  "visa.com",
  "mastercard.com",
  "stripe.com",
  "razorpay.com",
  "paypal.com",
  "square.com",
  "adyen.com",
  "connectpay.com",
  "forbes.com",
  "bloomberg.com",
  "techcrunch.com",
  "medium.com",
  "substack.com",
  "wikipedia.org",
  "wikihow.com",
  "quora.com",
  "nytimes.com",
  "bbc.com",
  "bbc.co.uk",
  "amazon.com",
  "apple.com",
  "microsoft.com",
  "google.com",
  "shopify.com",
  "wix.com",
  "squarespace.com",
  "wordpress.com",
  "hubspot.com",
  "salesforce.com",
  "github.com",
  "notion.so",
  "openai.com",
  "claude.ai",
  "anthropic.com",
];

const LISTICLE_TITLE =
  /\b(top|best|list of|how to|what is|\d+\s+(best|top)|startups? to watch|companies? (and|&) startups?)\b/i;

const JOB_PATH = /\/(jobs?|careers?|job-openings?)\b/i;

const BLOG_PATH = /\/(blog|news|articles?|insights?)\b/i;

export function hostnameOf(website: string | null | undefined): string | null {
  if (!website?.trim()) return null;
  try {
    const withProto = /^https?:\/\//i.test(website)
      ? website
      : `https://${website}`;
    return new URL(withProto).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function matchesHostSuffix(host: string, suffixes: string[]): boolean {
  return suffixes.some((s) => host === s || host.endsWith(`.${s}`));
}

export function isBlockedHost(hostOrUrl: string): boolean {
  const host = hostOrUrl.includes("/")
    ? hostnameOf(hostOrUrl)
    : hostOrUrl.replace(/^www\./, "").toLowerCase();
  if (!host) return false;
  return matchesHostSuffix(host, SOCIAL_HOST_SUFFIXES);
}

export interface HardShieldDecision {
  reject: boolean;
  reason?: string;
}

export interface HardShieldOptions {
  allowSocialHosts?: boolean;
  allowDirectories?: boolean;
  /** When true, wellfound.com / angel.co profile domains are allowed. */
  allowWellfoundHosts?: boolean;
  /** Plan negatives + feedback tokens matched against company/website/domain. */
  negatives?: string[];
  /** When false (default), require website or domain. */
  allowCompanyOnly?: boolean;
}

function matchesNegative(
  candidate: DiscoveredCompanyCandidate,
  negatives: string[]
): string | null {
  const blob = [
    candidate.company,
    candidate.website ?? "",
    candidate.domain ?? "",
    candidate.sourceUrl ?? "",
  ]
    .join(" ")
    .toLowerCase();
  for (const raw of negatives) {
    const token = raw.trim().toLowerCase();
    if (token.length < 3) continue;
    if (blob.includes(token)) return token;
  }
  return null;
}

function isWellfoundHost(host: string): boolean {
  return (
    host === "wellfound.com" ||
    host.endsWith(".wellfound.com") ||
    host === "angel.co" ||
    host.endsWith(".angel.co")
  );
}

function isGovOrEdu(host: string): boolean {
  return host.endsWith(".gov") || host.endsWith(".edu");
}

/**
 * Deterministic hard reject. If inspect-leads-quality would call it junk,
 * this must reject it.
 */
export function evaluateHardShield(
  candidate: DiscoveredCompanyCandidate,
  options?: HardShieldOptions
): HardShieldDecision {
  if (!candidate.company.trim()) {
    return { reject: true, reason: "empty_company" };
  }

  if (LISTICLE_TITLE.test(candidate.company)) {
    return { reject: true, reason: "listicle_title" };
  }

  if (options?.negatives?.length) {
    const hit = matchesNegative(candidate, options.negatives);
    if (hit) {
      return { reject: true, reason: `negative:${hit}` };
    }
  }

  const host = candidate.domain ?? hostnameOf(candidate.website);
  if (!host && !options?.allowCompanyOnly) {
    return { reject: true, reason: "no_website" };
  }

  if (host) {
    if (isGovOrEdu(host)) {
      return { reject: true, reason: "gov_edu_host" };
    }

    if (
      !options?.allowSocialHosts &&
      matchesHostSuffix(host, SOCIAL_HOST_SUFFIXES)
    ) {
      return { reject: true, reason: "blocked_host" };
    }

    if (
      !options?.allowDirectories &&
      matchesHostSuffix(host, DIRECTORY_HOST_SUFFIXES)
    ) {
      if (!(options?.allowWellfoundHosts && isWellfoundHost(host))) {
        return { reject: true, reason: "directory_host" };
      }
    }

    if (matchesHostSuffix(host, JOB_HOST_SUFFIXES)) {
      return { reject: true, reason: "job_board_host" };
    }

    if (matchesHostSuffix(host, VENDOR_MEDIA_PLATFORM_HOST_SUFFIXES)) {
      return { reject: true, reason: "vendor_media_host" };
    }
  }

  const website = candidate.website ?? "";
  if (JOB_PATH.test(website)) {
    return { reject: true, reason: "job_page" };
  }
  if (BLOG_PATH.test(website) && /forbes|medium|blog\./i.test(website)) {
    return { reject: true, reason: "blog_page" };
  }

  return { reject: false };
}

/** Classify domain the same way inspect-leads-quality does (for tests / tooling). */
export function classifyDomainQuality(
  domain: string | null,
  company: string
): "no_domain" | "media_or_platform" | "listicle_like" | "likely_company" {
  const d = (domain || "").toLowerCase();
  if (!d) return "no_domain";
  if (isGovOrEdu(d) || matchesHostSuffix(d, SOCIAL_HOST_SUFFIXES)) {
    return "media_or_platform";
  }
  if (matchesHostSuffix(d, DIRECTORY_HOST_SUFFIXES)) {
    return "media_or_platform";
  }
  if (matchesHostSuffix(d, VENDOR_MEDIA_PLATFORM_HOST_SUFFIXES)) {
    return "media_or_platform";
  }
  if (LISTICLE_TITLE.test(company)) return "listicle_like";
  return "likely_company";
}
