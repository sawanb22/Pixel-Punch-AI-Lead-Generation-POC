import type { ParsedContact } from "./types.js";

/** Patterns to identify LinkedIn profile URLs. */
const LINKEDIN_PROFILE_RE =
  /https?:\/\/(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)\/?/gi;

/** Name + optional title from a markdown link like [Jane Doe - CEO](https://linkedin.com/in/...) */
const MARKDOWN_PERSON_RE =
  /\[([^\]]+)\]\((https?:\/\/(?:www\.)?linkedin\.com\/in\/[^\)]+)\)/gi;

/** Title separators used after a name: "Jane Doe - CEO", "Jane Doe | Head of Marketing" */
const TITLE_SEPARATORS = [" - ", " | ", " – ", " · ", " • ", ", "];

/**
 * Attempt to split a raw label like "Jane Doe - CEO at Acme" into name and title.
 */
function splitNameAndTitle(raw: string): { name: string; title: string | null } {
  const cleaned = raw.trim();
  for (const sep of TITLE_SEPARATORS) {
    const idx = cleaned.indexOf(sep);
    if (idx > 2) {
      return {
        name: cleaned.slice(0, idx).trim(),
        title: cleaned.slice(idx + sep.length).trim() || null,
      };
    }
  }
  return { name: cleaned, title: null };
}

/**
 * Parse a markdown / plain-text string (as returned by Jina Reader for a
 * LinkedIn company/people page) and extract named contacts.
 *
 * Strategy:
 * 1. Look for markdown links whose URL is a linkedin.com/in/... profile.
 *    The link text is treated as "name [sep] title".
 * 2. Fall back: scan plain-text lines that contain an inline linkedin.com/in/ URL.
 *
 * Returns parsed contacts sorted by confidence desc, deduplicated by linkedinUrl.
 */
export function extractContactsFromMarkdown(markdown: string): ParsedContact[] {
  const seen = new Set<string>();
  const results: ParsedContact[] = [];

  // Pass 1: markdown links  [Name - Title](https://linkedin.com/in/...)
  const mdMatches = [...markdown.matchAll(MARKDOWN_PERSON_RE)];
  for (const m of mdMatches) {
    const rawLabel = m[1];
    const url = m[2].split("?")[0].replace(/\/$/, ""); // strip query params + trailing slash
    if (seen.has(url)) continue;
    seen.add(url);

    const { name, title } = splitNameAndTitle(rawLabel);
    if (!name || name.length < 2 || name.length > 80) continue;

    results.push({
      fullName: name,
      title,
      linkedinUrl: url,
      confidence: title ? 0.85 : 0.7,
    });
  }

  // Pass 2: plain-text lines containing linkedin.com/in/ URLs
  for (const line of markdown.split("\n")) {
    const profileMatches = [...line.matchAll(LINKEDIN_PROFILE_RE)];
    for (const pm of profileMatches) {
      const url = pm[0].split("?")[0].replace(/\/$/, "");
      if (seen.has(url)) continue;
      seen.add(url);

      // Try to grab a name-like token that precedes the URL on the same line
      const beforeUrl = line.slice(0, line.indexOf(pm[0])).trim();
      // Take last 60 chars as candidate
      const candidate = beforeUrl.slice(-60).replace(/[\[\]\(\)\*_`]/g, "").trim();
      const { name, title } = splitNameAndTitle(candidate);

      if (!name || name.length < 2 || name.length > 80) {
        // Store URL-only contact with lower confidence
        results.push({ fullName: url, title: null, linkedinUrl: url, confidence: 0.3 });
        continue;
      }

      results.push({
        fullName: name,
        title,
        linkedinUrl: url,
        confidence: 0.5,
      });
    }
  }

  // Sort by confidence desc
  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Extract the LinkedIn company /people page URL from a social links map.
 * social_links is stored as JSON: { linkedin: "https://linkedin.com/company/acme" }
 */
export function buildPeoplePageUrl(
  socialLinks: Record<string, string>
): string | null {
  const base = socialLinks["linkedin"] ?? socialLinks["LinkedIn"] ?? null;
  if (!base) return null;

  // Normalise: strip trailing slash + query params
  const normalized = base.split("?")[0].replace(/\/$/, "");
  // Append /people if not already there
  if (normalized.includes("/people")) return normalized;
  return `${normalized}/people`;
}
