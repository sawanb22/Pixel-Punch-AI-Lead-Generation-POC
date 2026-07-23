export interface ExtractedPageContent {
  title: string | null;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  organizationName: string | null;
  locationHints: string[];
  categoryHints: string[];
  textSnippet: string;
  emails: string[];
  socialLinks: Record<string, string>;
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = decodeBasicEntities(value).replace(/\s+/g, " ").trim();
  return cleaned.length ? cleaned : null;
}

function metaContent(html: string, attr: "name" | "property", key: string): string | null {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${key}["'][^>]*content=["']([^"']*)["'][^>]*>|<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${key}["'][^>]*>`,
    "i"
  );
  const match = html.match(re);
  return cleanText(match?.[1] ?? match?.[2] ?? null);
}

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch {
      /* ignore malformed */
    }
  }
  return blocks;
}

function walkJsonLd(node: unknown, visit: (obj: Record<string, unknown>) => void): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLd(item, visit);
    return;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    visit(obj);
    if (obj["@graph"]) walkJsonLd(obj["@graph"], visit);
  }
}

function locationFromAddress(address: unknown): string | null {
  if (!address || typeof address !== "object") return null;
  const a = address as Record<string, unknown>;
  const city = typeof a.addressLocality === "string" ? a.addressLocality : "";
  const region = typeof a.addressRegion === "string" ? a.addressRegion : "";
  const joined = [city, region].filter(Boolean).join(", ");
  return joined || null;
}

export function extractEmails(html: string): string[] {
  const found = new Set<string>();
  const mailto = html.matchAll(/mailto:([^\s"'?>]+)/gi);
  for (const m of mailto) {
    const addr = decodeURIComponent(m[1].split("?")[0] ?? "")
      .trim()
      .toLowerCase();
    if (addr.includes("@")) found.add(addr);
  }
  const textEmails = html.matchAll(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
  );
  for (const m of textEmails) {
    const addr = m[0].toLowerCase();
    if (addr.endsWith(".png") || addr.endsWith(".jpg")) continue;
    found.add(addr);
  }
  return [...found];
}
export function extractSocialLinks(html: string): Record<string, string> {
  const socials: Record<string, string> = {};
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const markdownHrefs = [...html.matchAll(/\[[^\]]*\]\(([^)#\s]+)\)/gi)].map((m) => m[1]);
  const allHrefs = [...hrefs, ...markdownHrefs];

  for (const href of allHrefs) {
    try {
      const url = new URL(href, "https://example.com");
      const host = url.hostname.replace(/^www\./, "").toLowerCase();
      if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
        socials.linkedin ??= url.toString();
      } else if (host === "twitter.com" || host === "x.com") {
        socials.x ??= url.toString();
      } else if (host === "github.com") {
        socials.github ??= url.toString();
      } else if (host === "facebook.com" || host === "fb.com") {
        socials.facebook ??= url.toString();
      } else if (host === "instagram.com") {
        socials.instagram ??= url.toString();
      }
    } catch {
      /* ignore */
    }
  }
  return socials;
}

export function extractLinksFromHtml(html: string): string[] {
  const hrefs = [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  const markdownHrefs = [...html.matchAll(/\[[^\]]*\]\(([^)#\s]+)\)/gi)].map((m) => m[1]);
  return [...new Set([...hrefs, ...markdownHrefs])];
}

export function extractPageContent(html: string): ExtractedPageContent {
  if (html.trim().startsWith("{")) {
    try {
      const json = JSON.parse(html);
      const data = json.data && typeof json.data === "object" ? json.data : json;
      if (typeof data.content === "string") {
        const content = data.content;
        const title = typeof data.title === "string" ? cleanText(data.title) : null;
        const metaDescription = typeof data.description === "string" ? cleanText(data.description) : null;
        
        const emails = extractEmails(content);
        const descriptionEmails = metaDescription ? extractEmails(metaDescription) : [];
        const allEmails = [...new Set([...emails, ...descriptionEmails])];
        
        const socialLinks = extractSocialLinks(content);
        if (data.links && typeof data.links === "object") {
          for (const val of Object.values(data.links)) {
            if (typeof val === "string") {
              try {
                const url = new URL(val, "https://example.com");
                const host = url.hostname.replace(/^www\./, "").toLowerCase();
                if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
                  socialLinks.linkedin ??= url.toString();
                } else if (host === "twitter.com" || host === "x.com") {
                  socialLinks.x ??= url.toString();
                } else if (host === "github.com") {
                  socialLinks.github ??= url.toString();
                } else if (host === "facebook.com" || host === "fb.com") {
                  socialLinks.facebook ??= url.toString();
                } else if (host === "instagram.com") {
                  socialLinks.instagram ??= url.toString();
                }
              } catch {
                /* ignore */
              }
            }
          }
        }
        
        return {
          title,
          metaDescription,
          ogTitle: null,
          ogDescription: null,
          organizationName: null,
          locationHints: [],
          categoryHints: [],
          textSnippet: cleanText(content)?.slice(0, 500) ?? "",
          emails: allEmails,
          socialLinks,
        };
      }
    } catch {
      /* ignore JSON parse failure, fallback to HTML parsing */
    }
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = cleanText(titleMatch?.[1] ?? null);
  const metaDescription = metaContent(html, "name", "description");
  const ogTitle = metaContent(html, "property", "og:title");
  const ogDescription = metaContent(html, "property", "og:description");

  let organizationName: string | null = null;
  const locationHints: string[] = [];
  const categoryHints: string[] = [];

  for (const block of extractJsonLdBlocks(html)) {
    walkJsonLd(block, (obj) => {
      const type = obj["@type"];
      const types = Array.isArray(type) ? type : [type];
      const isOrg = types.some(
        (t) => typeof t === "string" && /organization|corporation|localbusiness/i.test(t)
      );
      if (isOrg) {
        if (typeof obj.name === "string") organizationName ??= cleanText(obj.name);
        const loc = locationFromAddress(obj.address);
        if (loc && !locationHints.includes(loc)) locationHints.push(loc);
        if (typeof obj.industry === "string") {
          const industry = cleanText(obj.industry);
          if (industry && !categoryHints.includes(industry)) {
            categoryHints.push(industry);
          }
        }
      }
    });
  }

  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const textSnippet =
    cleanText(withoutScripts)?.slice(0, 500) ?? "";

  return {
    title,
    metaDescription,
    ogTitle,
    ogDescription,
    organizationName,
    locationHints,
    categoryHints,
    textSnippet,
    emails: extractEmails(html),
    socialLinks: extractSocialLinks(html),
  };
}
