import type { DB } from "../db/database.js";
import type { FetchLike } from "../sources/source.js";
import { listLeadsFiltered } from "../leads/leads.repo.js";
import { getCompanyProfile } from "../enrichment/enrichment.repo.js";
import { fetchHtmlPage } from "../enrichment/page-fetcher.js";
import { extractContactsFromMarkdown, buildPeoplePageUrl } from "./linkedin-extractor.js";
import {
  insertContact,
  listContactsForLead,
  deleteContactsForLead,
} from "./contacts.repo.js";
import type { ContactFindingSummary, Contact } from "./types.js";

export interface ContactFindingOptions {
  fetch: FetchLike;
  db: DB;
  projectId: number;
  /** Max contacts to keep per lead. Default: 5 */
  maxContactsPerLead?: number;
  /** Whether to re-run for leads that already have contacts. Default: false */
  refresh?: boolean;
  /** Jina Reader API key override (falls back to JINA_API_KEY env). */
  jinaApiKey?: string;
  onProgress?: (message: string, level?: "info" | "warning" | "error") => void;
}


/**
 * Find decision-maker contacts for all enriched leads in a project.
 *
 * Strategy per lead:
 * 1. Look up `company_profiles` for the lead's domain → get LinkedIn company URL.
 * 2. Build the LinkedIn /people page URL.
 * 3. Fetch via Jina Reader (bypasses LinkedIn bot-detection).
 * 4. Parse returned markdown for person names, titles, LinkedIn profile URLs.
 * 5. Store top N contacts in the `contacts` table.
 */
export async function runContactFinding(
  options: ContactFindingOptions
): Promise<ContactFindingSummary> {
  const {
    fetch,
    db,
    projectId,
    maxContactsPerLead = 5,
    refresh = false,
    jinaApiKey,
    onProgress,
  } = options;

  // Fetch all leads for this project that have a canonical domain
  const leads = listLeadsFiltered(db, projectId);
  const eligibleLeads = leads.filter((l) => l.canonicalDomain);

  onProgress?.(`Starting contact finding for ${eligibleLeads.length} leads.`);

  let leadsProcessed = 0;
  let contactsFound = 0;
  let failed = 0;
  const allContacts: Contact[] = [];
  let index = 0;

  for (const lead of eligibleLeads) {
    const domain = lead.canonicalDomain!;
    index++;
    onProgress?.(`Finding contacts for lead ${index}/${eligibleLeads.length}: ${domain}`);


    // Skip if already has contacts and not refreshing
    if (!refresh) {
      const existing = listContactsForLead(db, lead.id);
      if (existing.length > 0) {
        allContacts.push(...existing);
        contactsFound += existing.length;
        leadsProcessed++;
        continue;
      }
    }

    // Get the company profile to extract the LinkedIn URL if available
    const profile = getCompanyProfile(db, projectId, domain);
    const socialLinks = profile?.socialLinks ?? {};
    const peoplePageUrl = buildPeoplePageUrl(socialLinks);

    if (!peoplePageUrl) {
      // No LinkedIn URL found — first try extracting company profile emails found during enrichment
      const emailCandidates = profile?.emailCandidates ?? [];
      if (emailCandidates.length > 0) {
        if (refresh) deleteContactsForLead(db, lead.id);
        for (const email of emailCandidates.slice(0, maxContactsPerLead)) {
          const contact = insertContact(db, {
            projectId,
            leadId: lead.id,
            domain,
            fullName: `${domain} Contact`,
            title: "General Contact / Inquiries",
            linkedinUrl: null,
            confidence: 0.7,
            source: "website-enrichment",
          });
          allContacts.push(contact);
          contactsFound++;
        }
        leadsProcessed++;
        continue;
      }

      // No profile emails — try guessing LinkedIn domain slug
      const domainSlug = domain.replace(/\.(com|io|co|net|org|ai)$/, "").replace(/\./g, "-");
      const guessedUrl = `https://www.linkedin.com/company/${domainSlug}/people`;

      try {
        const page = await fetchViaJinaOnly(guessedUrl, fetch, jinaApiKey);
        if (page) {
          const parsed = extractContactsFromMarkdown(page).slice(0, maxContactsPerLead);
          if (parsed.length > 0) {
            if (refresh) deleteContactsForLead(db, lead.id);
            for (const c of parsed) {
              const contact = insertContact(db, {
                projectId,
                leadId: lead.id,
                domain,
                fullName: c.fullName,
                title: c.title,
                linkedinUrl: c.linkedinUrl,
                confidence: c.confidence * 0.8, // lower confidence for guessed URL
                source: "linkedin-guessed",
              });
              allContacts.push(contact);
              contactsFound++;
            }
            leadsProcessed++;
            continue;
          }
        }
      } catch {
        // silent — move on
      }
      failed++;
      continue;
    }

    try {
      const markdown = await fetchViaJinaOnly(peoplePageUrl, fetch, jinaApiKey);
      if (!markdown) {
        failed++;
        continue;
      }

      const parsed = extractContactsFromMarkdown(markdown).slice(0, maxContactsPerLead);
      if (parsed.length === 0) {
        failed++;
        continue;
      }

      if (refresh) deleteContactsForLead(db, lead.id);

      for (const c of parsed) {
        const contact = insertContact(db, {
          projectId,
          leadId: lead.id,
          domain,
          fullName: c.fullName,
          title: c.title,
          linkedinUrl: c.linkedinUrl,
          confidence: c.confidence,
          source: "linkedin",
        });
        allContacts.push(contact);
        contactsFound++;
      }

      leadsProcessed++;
    } catch (err) {
      console.error(
        `[contact-finding] Failed for ${domain}: ${err instanceof Error ? err.message : String(err)}`
      );
      failed++;
    }
  }

  onProgress?.(`Contact finding complete. Processed: ${leadsProcessed}, Contacts found: ${contactsFound}, Failed: ${failed}`);
  return { leadsProcessed, contactsFound, failed, contacts: allContacts };
}


/**
 * Fetch a URL purely via the Jina Reader API and return the markdown body,
 * or null if Jina is not configured or returns no content.
 */
async function fetchViaJinaOnly(
  url: string,
  fetchFn: FetchLike,
  jinaApiKey?: string
): Promise<string | null> {
  const apiKey = jinaApiKey ?? process.env.JINA_API_KEY;
  if (!apiKey) return null;

  const jinaUrl = `https://r.jina.ai/${url}`;
  try {
    const res = await fetchFn(jinaUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "X-Return-Format": "markdown",
        "X-No-Cache": "true",
      },
    });
    if (!res.ok) return null;

    const text = await res.text();
    if (!text || text.length < 100) return null;

    // Jina returns JSON with data.content
    try {
      const json = JSON.parse(text) as { data?: { content?: string } };
      return json.data?.content ?? null;
    } catch {
      // Plain text / markdown fallback
      return text;
    }
  } catch {
    return null;
  }
}
