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

export interface GoogleSearchResultItem {
  title?: string;
  url?: string;
  description?: string;
  snippet?: string;
  searchQuery?: { term?: string };
}

/**
 * Parse a single Google Search result item for a LinkedIn profile.
 */
export function parseLinkedInSearchResultItem(
  item: GoogleSearchResultItem
): ParsedContact | null {
  const url = item.url?.trim();
  if (
    !url ||
    !/https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]+/i.test(url)
  ) {
    return null;
  }
  const cleanUrl = url.split("?")[0].replace(/\/$/, "");

  let rawTitle = item.title ?? "";
  // Strip " - LinkedIn", " | LinkedIn", " ... - LinkedIn", etc.
  rawTitle = rawTitle.replace(/[-|•·]\s*LinkedIn$/i, "").trim();

  // Common titles look like: "Jane Doe - Chief Executive Officer - Acme Corp"
  // or "Jane Doe | CEO & Founder at Acme"
  const parts = rawTitle.split(/\s+[-|•·]\s+/);

  let name = parts[0]?.trim() || "";
  let jobTitle: string | null = parts[1]?.trim() || null;

  if (
    parts.length > 2 &&
    jobTitle &&
    !/CEO|Founder|Director|Manager|President|VP|Head|Owner|Chief/i.test(jobTitle)
  ) {
    if (/CEO|Founder|Director|Manager|President|VP|Head|Owner|Chief/i.test(parts[2])) {
      jobTitle = parts[2].trim();
    }
  }

  // Fallback to snippet/description if jobTitle wasn't clearly parsed
  const snippet = (item.snippet ?? item.description ?? "").trim();
  if (!jobTitle && snippet) {
    const titleMatch = snippet.match(
      /\b(CEO|Founder|Co-Founder|Owner|President|Managing Director|Chief Executive Officer|VP|Head of [A-Z][a-z]+|Marketing Director|Sales Director)\b/i
    );
    if (titleMatch) {
      jobTitle = titleMatch[0];
    }
  }

  if (!name || name.length < 2 || name.length > 80 || name.includes("http")) {
    return null;
  }

  return {
    fullName: name,
    title: jobTitle,
    linkedinUrl: cleanUrl,
    confidence: jobTitle ? 0.9 : 0.75,
  };
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
