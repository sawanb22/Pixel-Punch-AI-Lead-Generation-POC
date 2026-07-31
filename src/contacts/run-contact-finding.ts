import type { DB } from "../db/database.js";
import type { FetchLike } from "../sources/source.js";
import { listLeadsFiltered } from "../leads/leads.repo.js";
import { getCompanyProfile } from "../enrichment/enrichment.repo.js";
import { getProject } from "../projects/projects.repo.js";
import { ApifyClient } from "../discovery/apify-client.js";
import { withRetry } from "../utils/with-retry.js";
import {
  parseLinkedInSearchResultItem,
  buildPeoplePageUrl,
  extractContactsFromMarkdown,
  type GoogleSearchResultItem,
} from "./linkedin-extractor.js";
import {
  insertContact,
  listContactsForLead,
  deleteContactsForLead,
} from "./contacts.repo.js";
import type { ContactFindingSummary, Contact } from "./types.js";

export interface ContactFindingOptions {
  fetch?: FetchLike;
  db: DB;
  projectId: number;
  /** Max contacts to keep per lead. Default: 5 */
  maxContactsPerLead?: number;
  /** Whether to re-run for leads that already have contacts. Default: false */
  refresh?: boolean;
  /** Apify Client instance override. */
  apifyClient?: ApifyClient;
  /** Environment variables. */
  env?: NodeJS.ProcessEnv;
  /** Jina Reader API key override (legacy fallback). */
  jinaApiKey?: string;
  onProgress?: (message: string, level?: "info" | "warning" | "error") => void;
}

const DEFAULT_TARGET_ROLES = [
  "CEO",
  "Founder",
  "Co-Founder",
  "Owner",
  "President",
  "Managing Director",
  "VP",
  "Director",
];

/**
 * Find decision-maker contacts for all eligible leads in a project using Apify.
 */
export async function runContactFinding(
  options: ContactFindingOptions
): Promise<ContactFindingSummary> {
  const {
    fetch: fetchImpl,
    db,
    projectId,
    maxContactsPerLead = 5,
    refresh = false,
    env = process.env,
    onProgress,
  } = options;

  const project = getProject(db, projectId);
  const leads = listLeadsFiltered(db, projectId);
  const eligibleLeads = leads.filter((l) => l.canonicalDomain);

  onProgress?.(`Starting contact finding for ${eligibleLeads.length} leads.`);

  let leadsProcessed = 0;
  let contactsFound = 0;
  let failed = 0;
  const allContacts: Contact[] = [];

  // 1. Identify leads that need processing
  const leadsToProcess = eligibleLeads.filter((lead) => {
    if (refresh) return true;
    const existing = listContactsForLead(db, lead.id);
    if (existing.length > 0) {
      allContacts.push(...existing);
      contactsFound += existing.length;
      leadsProcessed++;
      return false;
    }
    return true;
  });

  if (leadsToProcess.length === 0) {
    onProgress?.(`Contact finding complete. All ${leadsProcessed} leads already had contacts.`);
    return { leadsProcessed, contactsFound, failed, contacts: allContacts };
  }

  // 2. Setup Apify Client if token is available
  const token = env.APIFY_TOKEN?.trim();
  const client =
    options.apifyClient ??
    (token ? new ApifyClient({ token, fetch: fetchImpl }) : null);

  if (client) {
    onProgress?.(`Using Apify to discover contacts for ${leadsToProcess.length} leads...`);

    // Process in batches of 10 leads to run efficient Apify Google Search jobs
    const BATCH_SIZE = 10;
    for (let i = 0; i < leadsToProcess.length; i += BATCH_SIZE) {
      const batch = leadsToProcess.slice(i, i + BATCH_SIZE);
      const queryMap = new Map<string, number>(); // search query string -> leadId
      const queries: string[] = [];

      for (const lead of batch) {
        const domain = lead.canonicalDomain!;
        const companyName = lead.company || domain.replace(/\.[a-z]+$/, "");
        const roleQuery = DEFAULT_TARGET_ROLES.map((r) => `"${r}"`).join(" OR ");
        const query = `site:linkedin.com/in (${roleQuery}) "${companyName}"`;
        queries.push(query);
        queryMap.set(query.toLowerCase(), lead.id);
      }

      onProgress?.(
        `Searching contacts via Apify (batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          leadsToProcess.length / BATCH_SIZE
        )})...`
      );

      try {
        const apifyResult = await withRetry(
          () =>
            client.runActorAndGetItems({
              actorId: "apify/google-search-scraper",
              input: {
                queries: queries.join("\n"),
                maxPagesPerQuery: 1,
                resultsPerPage: 5,
                csvFriendlyOutput: true,
              },
              timeoutMs: 120_000,
            }),
          { attempts: 3, baseDelayMs: 2000 }
        );

        const items = (apifyResult.items as GoogleSearchResultItem[]) || [];
        const contactsByLead = new Map<number, Contact[]>();

        for (const item of items) {
          const parsed = parseLinkedInSearchResultItem(item);
          if (!parsed) continue;

          // Find which lead this item belongs to
          const rawTerm = item.searchQuery?.term?.toLowerCase() ?? "";
          let matchingLeadId: number | null = null;

          for (const [qTerm, lId] of queryMap.entries()) {
            if (rawTerm.includes(qTerm) || rawTerm === qTerm) {
              matchingLeadId = lId;
              break;
            }
          }

          if (!matchingLeadId) {
            // Fallback match by company name or domain in title/snippet
            for (const lead of batch) {
              const dom = lead.canonicalDomain!.toLowerCase();
              const comp = lead.company.toLowerCase();
              const blob = `${item.title ?? ""} ${item.snippet ?? ""}`.toLowerCase();
              if (blob.includes(dom) || blob.includes(comp)) {
                matchingLeadId = lead.id;
                break;
              }
            }
          }

          if (!matchingLeadId) continue;

          const lead = batch.find((b) => b.id === matchingLeadId);
          if (!lead) continue;

          if (!contactsByLead.has(lead.id)) {
            contactsByLead.set(lead.id, []);
          }
          const list = contactsByLead.get(lead.id)!;
          if (
            list.length < maxContactsPerLead &&
            !list.some((c) => c.linkedinUrl === parsed.linkedinUrl)
          ) {
            if (refresh) deleteContactsForLead(db, lead.id);
            const inserted = insertContact(db, {
              projectId,
              leadId: lead.id,
              domain: lead.canonicalDomain!,
              fullName: parsed.fullName,
              title: parsed.title,
              linkedinUrl: parsed.linkedinUrl,
              confidence: parsed.confidence,
              source: "apify-google-search",
            });
            list.push(inserted);
            allContacts.push(inserted);
            contactsFound++;
          }
        }

        for (const lead of batch) {
          const foundList = contactsByLead.get(lead.id);
          if (foundList && foundList.length > 0) {
            leadsProcessed++;
          } else {
            // Fallback for this lead
            const fallbackOk = tryEnrichmentFallback(
              db,
              projectId,
              lead,
              maxContactsPerLead,
              refresh,
              allContacts
            );
            if (fallbackOk) {
              leadsProcessed++;
              contactsFound += fallbackOk;
            } else {
              failed++;
            }
          }
        }
      } catch (err) {
        onProgress?.(
          `Apify contact search batch failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          "warning"
        );
        // Fallback batch to enrichment email candidates
        for (const lead of batch) {
          const fallbackOk = tryEnrichmentFallback(
            db,
            projectId,
            lead,
            maxContactsPerLead,
            refresh,
            allContacts
          );
          if (fallbackOk) {
            leadsProcessed++;
            contactsFound += fallbackOk;
          } else {
            failed++;
          }
        }
      }
    }
  } else {
    onProgress?.(
      `APIFY_TOKEN not available. Using website enrichment email candidates for contacts.`,
      "warning"
    );
    for (const lead of leadsToProcess) {
      const fallbackOk = tryEnrichmentFallback(
        db,
        projectId,
        lead,
        maxContactsPerLead,
        refresh,
        allContacts
      );
      if (fallbackOk) {
        leadsProcessed++;
        contactsFound += fallbackOk;
      } else {
        failed++;
      }
    }
  }

  onProgress?.(
    `Contact finding complete. Processed: ${leadsProcessed}, Contacts found: ${contactsFound}, Failed: ${failed}`
  );
  return { leadsProcessed, contactsFound, failed, contacts: allContacts };
}

function tryEnrichmentFallback(
  db: DB,
  projectId: number,
  lead: { id: number; canonicalDomain: string | null },
  maxContactsPerLead: number,
  refresh: boolean,
  allContacts: Contact[]
): number | null {
  if (!lead.canonicalDomain) return null;
  const domain = lead.canonicalDomain;
  const profile = getCompanyProfile(db, projectId, domain);
  const emailCandidates = profile?.emailCandidates ?? [];

  if (emailCandidates.length > 0) {
    if (refresh) deleteContactsForLead(db, lead.id);
    let added = 0;
    for (const email of emailCandidates.slice(0, maxContactsPerLead)) {
      const contact = insertContact(db, {
        projectId,
        leadId: lead.id,
        domain,
        fullName: `${domain} Contact`,
        title: "General Contact / Inquiries",
        email,
        linkedinUrl: null,
        confidence: 0.7,
        source: "website-enrichment",
      });
      allContacts.push(contact);
      added++;
    }
    return added;
  }
  return null;
}
