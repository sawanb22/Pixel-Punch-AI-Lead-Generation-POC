import type { DB } from "../db/database.js";
import type { Lead } from "../domain/types.js";
import { listLeads, setLeadEmailIfEmpty, setLeadPipelineStatus } from "../leads/leads.repo.js";
import { withRetry } from "../utils/with-retry.js";
import { getProject } from "../projects/projects.repo.js";
import type { FetchLike } from "../sources/source.js";
import { isBlockedHost } from "../discovery/noise-filter.js";
import { scoreEnrichmentConfidence } from "./confidence.js";
import { parseCompanyEnrichmentConfigFromJson } from "./config.js";
import {
  createEnrichmentJob,
  createEnrichmentRun,
  getCompanyProfile,
  insertCompanyEvidence,
  insertCompanyPages,
  listEnrichedDomains,
  updateEnrichmentJob,
  updateEnrichmentRun,
  upsertCompanyProfile,
  type NewCompanyEvidence,
  type NewCompanyPage,
} from "./enrichment.repo.js";
import { ApifyClient } from "../discovery/apify-client.js";
import {
  extractLinksFromHtml,
  extractPageContent,
} from "./html-extract.js";
import { classifyPageType, rankPageLinks } from "./link-ranker.js";
import { fetchHtmlPage } from "./page-fetcher.js";
import { isUrlAllowedByRobots } from "./robots.js";
import {
  domainFromWebsite,
  filterSameDomainLinks,
  normalizeHomepageUrl,
} from "./url-utils.js";

export interface CompanyEnrichmentSummary {
  runId: number;
  status: "completed" | "failed";
  companiesQueued: number;
  companiesEnriched: number;
  pagesFetched: number;
  evidenceSaved: number;
  emailsFound: number;
  failed: number;
  errors: string[];
}

export interface RunCompanyEnrichmentOptions {
  fetch?: FetchLike;
  force?: boolean;
  concurrency?: number;
  now?: () => string;
  onProgress?: (message: string, level?: "info" | "warning" | "error") => void;
  apifyClient?: ApifyClient;
}

function parseApifyContactItem(item: Record<string, unknown>): {
  domainUrl?: string;
  emails: string[];
  socialLinks: Record<string, string>;
} {
  const emails: string[] = [];
  const socialLinks: Record<string, string> = {};

  const domainUrl =
    typeof item.url === "string"
      ? item.url
      : typeof item.inputUrl === "string"
      ? item.inputUrl
      : typeof item.startUrl === "string"
      ? item.startUrl
      : undefined;

  if (Array.isArray(item.emails)) {
    for (const e of item.emails) {
      if (typeof e === "string" && e.includes("@")) emails.push(e.toLowerCase());
      else if (typeof e === "object" && e && typeof (e as Record<string, unknown>).email === "string") {
        emails.push(((e as Record<string, unknown>).email as string).toLowerCase());
      }
    }
  }

  const checkUrl = (urlStr: string) => {
    try {
      const u = new URL(urlStr, "https://example.com");
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      if (host.includes("linkedin.com")) socialLinks.linkedin ??= u.toString();
      else if (host.includes("twitter.com") || host.includes("x.com")) socialLinks.x ??= u.toString();
      else if (host.includes("facebook.com") || host.includes("fb.com")) socialLinks.facebook ??= u.toString();
      else if (host.includes("instagram.com")) socialLinks.instagram ??= u.toString();
      else if (host.includes("github.com")) socialLinks.github ??= u.toString();
    } catch {}
  };

  if (typeof item.linkedin === "string") checkUrl(item.linkedin);
  if (typeof item.twitter === "string") checkUrl(item.twitter);
  if (typeof item.facebook === "string") checkUrl(item.facebook);
  if (typeof item.instagram === "string") checkUrl(item.instagram);

  if (Array.isArray(item.socialLinks)) {
    for (const s of item.socialLinks) {
      if (typeof s === "string") checkUrl(s);
      else if (typeof s === "object" && s && typeof (s as Record<string, unknown>).url === "string") {
        checkUrl((s as Record<string, unknown>).url as string);
      }
    }
  }

  return { domainUrl, emails: [...new Set(emails)], socialLinks };
}


async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () =>
      worker()
    )
  );
  return results;
}

function pickCompanyEmail(emails: string[]): string | null {
  const preferred = emails.find(
    (e) => /^(hello|hi|info|contact|sales|support)@/i.test(e)
  );
  return preferred ?? emails[0] ?? null;
}

function selectEligibleLeads(
  leads: Lead[],
  enrichedDomains: Set<string>,
  force: boolean
): Lead[] {
  const out: Lead[] = [];
  const seen = new Set<string>();
  for (const lead of leads) {
    const domain =
      lead.canonicalDomain ?? domainFromWebsite(lead.website) ?? null;
    if (!domain && !lead.website) continue;
    if (!domain) continue;
    if (isBlockedHost(domain)) continue;
    if (!force && enrichedDomains.has(domain)) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push(lead);
  }
  return out;
}

export async function runCompanyEnrichment(
  db: DB,
  projectId: number,
  options: RunCompanyEnrichmentOptions = {}
): Promise<CompanyEnrichmentSummary> {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`project ${projectId} not found`);

  const config = parseCompanyEnrichmentConfigFromJson(project.sourceConfig);
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const concurrency = options.concurrency ?? config.concurrency;
  const force = options.force === true;

  const leads = listLeads(db, projectId);
  const withWebsites = leads.filter((lead) => {
    const domain =
      lead.canonicalDomain ?? domainFromWebsite(lead.website) ?? null;
    if (!domain && !lead.website) return false;
    if (!domain) return false;
    if (isBlockedHost(domain)) return false;
    return true;
  });
  if (withWebsites.length === 0) {
    throw new Error(
      "No eligible company websites to enrich. Find leads with websites first, or pass force to re-enrich."
    );
  }

  const enrichedDomains = listEnrichedDomains(db, projectId);
  const eligible = selectEligibleLeads(leads, enrichedDomains, force).slice(
    0,
    config.maxCompanies
  );

  const run = createEnrichmentRun(db, { projectId, status: "running" });

  if (eligible.length === 0) {
    updateEnrichmentRun(db, run.id, {
      status: "completed",
      companiesQueued: 0,
      finishedAt: now(),
    });
    return {
      runId: run.id,
      status: "completed",
      companiesQueued: 0,
      companiesEnriched: 0,
      pagesFetched: 0,
      evidenceSaved: 0,
      emailsFound: 0,
      failed: 0,
      errors: [],
    };
  }

  updateEnrichmentRun(db, run.id, { companiesQueued: eligible.length });
  options.onProgress?.(`Found ${eligible.length} eligible companies to enrich.`);

  const errors: string[] = [];
  let companiesEnriched = 0;
  let pagesFetched = 0;
  let evidenceSaved = 0;
  let emailsFound = 0;
  let failed = 0;
  let processedCount = 0;

  await mapPool(eligible, concurrency, async (lead) => {
    const domain =
      lead.canonicalDomain ?? domainFromWebsite(lead.website) ?? "unknown";
    processedCount++;
    options.onProgress?.(`Enriching company ${processedCount}/${eligible.length}: ${domain}`);
    setLeadPipelineStatus(db, projectId, lead.id, "enriching");

    const homepage = normalizeHomepageUrl(lead.website);
    const job = createEnrichmentJob(db, {
      runId: run.id,
      projectId,
      leadId: lead.id,
      domain,
      website: lead.website,
      status: "running",
    });

    if (!homepage) {
      failed += 1;
      errors.push(`${domain}: missing homepage URL`);
      updateEnrichmentJob(db, job.id, {
        status: "failed",
        error: "missing homepage URL",
        finishedAt: now(),
      });
      setLeadPipelineStatus(db, projectId, lead.id, "enrichment_failed");
      return;
    }

    try {
      if (config.respectRobots) {
        const allowed = await isUrlAllowedByRobots(homepage, {
          fetch: fetchImpl,
          timeoutMs: config.timeoutSeconds * 1000,
        });
        if (!allowed) {
          failed += 1;
          errors.push(`${domain}: blocked by robots.txt`);
          updateEnrichmentJob(db, job.id, {
            status: "failed",
            error: "blocked by robots.txt",
            finishedAt: now(),
          });
          setLeadPipelineStatus(db, projectId, lead.id, "enrichment_failed");
          return;
        }
      }

      const pageRecords: NewCompanyPage[] = [];
      const evidence: NewCompanyEvidence[] = [];
      const allEmails = new Set<string>();
      const socialLinks: Record<string, string> = {};
      const locationHints: string[] = [];
      const categoryHints: string[] = [];
      const pageTypes: string[] = [];
      let description: string | null = null;
      let title: string | null = null;
      let finalHomepage = homepage;
      let companyPagesFetched = 0;

      const homepageFetch = await withRetry(
        () =>
          fetchHtmlPage(homepage, {
            fetch: fetchImpl,
            db,
            timeoutMs: config.timeoutSeconds * 1000,
            useJinaReader: config.useJinaReader,
          }),
        { attempts: 3, baseDelayMs: 500 }
      );

      if (!homepageFetch.body) {
        throw new Error(homepageFetch.error ?? "homepage fetch failed");
      }

      finalHomepage = homepageFetch.finalUrl || homepage;
      companyPagesFetched += 1;
      pagesFetched += 1;

      const homeContent = extractPageContent(homepageFetch.body);
      title = homeContent.title ?? homeContent.ogTitle;
      description =
        homeContent.metaDescription ??
        homeContent.ogDescription ??
        homeContent.textSnippet.slice(0, 280) ??
        null;
      for (const e of homeContent.emails) allEmails.add(e);
      Object.assign(socialLinks, homeContent.socialLinks);
      for (const loc of homeContent.locationHints) {
        if (!locationHints.includes(loc)) locationHints.push(loc);
      }
      for (const cat of homeContent.categoryHints) {
        if (!categoryHints.includes(cat)) categoryHints.push(cat);
      }
      pageTypes.push("homepage");

      pageRecords.push({
        runId: run.id,
        jobId: job.id,
        projectId,
        domain,
        url: homepage,
        finalUrl: finalHomepage,
        pageType: "homepage",
        httpStatus: homepageFetch.httpStatus,
        title: homeContent.title,
        metaDescription: homeContent.metaDescription,
        textSnippet: homeContent.textSnippet,
      });

      if (homeContent.textSnippet) {
        evidence.push({
          projectId,
          leadId: lead.id,
          domain,
          evidenceType: "homepage_snippet",
          url: finalHomepage,
          title: homeContent.title,
          textExcerpt: homeContent.textSnippet,
          confidence: 0.6,
        });
      }

      const discovered = filterSameDomainLinks(
        finalHomepage,
        extractLinksFromHtml(homepageFetch.body)
      );
      const ranked = rankPageLinks(
        discovered,
        Math.max(0, config.maxPagesPerCompany - 1)
      );

      for (const pageUrl of ranked) {
        if (companyPagesFetched >= config.maxPagesPerCompany) break;
        if (config.respectRobots) {
          const ok = await isUrlAllowedByRobots(pageUrl, {
            fetch: fetchImpl,
            timeoutMs: config.timeoutSeconds * 1000,
          });
          if (!ok) continue;
        }

        const page = await withRetry(
          () =>
            fetchHtmlPage(pageUrl, {
              fetch: fetchImpl,
              db,
              timeoutMs: config.timeoutSeconds * 1000,
              useJinaReader: config.useJinaReader,
            }),
          { attempts: 3, baseDelayMs: 500 }
        );
        companyPagesFetched += 1;
        pagesFetched += 1;

        if (!page.body) {
          pageRecords.push({
            runId: run.id,
            jobId: job.id,
            projectId,
            domain,
            url: pageUrl,
            finalUrl: page.finalUrl,
            pageType: classifyPageType(pageUrl),
            httpStatus: page.httpStatus,
            error: page.error ?? "fetch_failed",
          });
          continue;
        }

        const content = extractPageContent(page.body);
        const pageType = classifyPageType(page.finalUrl || pageUrl);
        pageTypes.push(pageType);
        for (const e of content.emails) allEmails.add(e);
        Object.assign(socialLinks, content.socialLinks);
        for (const loc of content.locationHints) {
          if (!locationHints.includes(loc)) locationHints.push(loc);
        }
        if (!description && (content.metaDescription || content.textSnippet)) {
          description =
            content.metaDescription ?? content.textSnippet.slice(0, 280);
        }
        if (!title && content.title) title = content.title;

        pageRecords.push({
          runId: run.id,
          jobId: job.id,
          projectId,
          domain,
          url: pageUrl,
          finalUrl: page.finalUrl,
          pageType,
          httpStatus: page.httpStatus,
          title: content.title,
          metaDescription: content.metaDescription,
          textSnippet: content.textSnippet,
        });

        if (content.textSnippet) {
          evidence.push({
            projectId,
            leadId: lead.id,
            domain,
            evidenceType: `${pageType}_snippet`,
            url: page.finalUrl || pageUrl,
            title: content.title,
            textExcerpt: content.textSnippet,
            confidence: pageType === "about" ? 0.8 : 0.55,
          });
        }
      }

      const emailList = [...allEmails];
      const confidence = scoreEnrichmentConfidence({
        hasHomepage: true,
        hasDescription: Boolean(description),
        pageTypes,
        emailCount: emailList.length,
        socialCount: Object.keys(socialLinks).length,
        hasLocation: locationHints.length > 0,
      });

      upsertCompanyProfile(db, {
        projectId,
        leadId: lead.id,
        domain,
        homepageUrl: finalHomepage,
        title,
        description,
        categoryHints,
        locationHints,
        socialLinks,
        emailCandidates: emailList,
        confidence,
      });

      if (pageRecords.length) insertCompanyPages(db, pageRecords);
      if (evidence.length) {
        insertCompanyEvidence(db, evidence);
        evidenceSaved += evidence.length;
      }

      const companyEmail = pickCompanyEmail(emailList);
      if (companyEmail) {
        emailsFound += 1;
        setLeadEmailIfEmpty(db, projectId, lead.id, companyEmail);
      }

      companiesEnriched += 1;
      updateEnrichmentJob(db, job.id, {
        status: "completed",
        finalHomepageUrl: finalHomepage,
        pagesFetched: companyPagesFetched,
        finishedAt: now(),
      });
      setLeadPipelineStatus(db, projectId, lead.id, "enriched");
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${domain}: ${message}`);
      updateEnrichmentJob(db, job.id, {
        status: "failed",
        error: message,
        finishedAt: now(),
      });
      setLeadPipelineStatus(db, projectId, lead.id, "enrichment_failed");
    }
  });

  // ── Tier 2: Apify Contact Info Scraper Fallback for Low-Confidence / Blocked Leads ─
  const token = process.env.APIFY_TOKEN?.trim();
  const apifyClient =
    options.apifyClient ??
    (token ? new ApifyClient({ token, fetch: fetchImpl }) : null);

  if (config.useApifyContactScraper && apifyClient) {
    const tier2Candidates = eligible.filter((lead) => {
      const dom = lead.canonicalDomain ?? domainFromWebsite(lead.website) ?? "";
      if (!dom) return false;
      const profile = getCompanyProfile(db, projectId, dom);
      if (!profile) return true; // failed job, no profile created
      if (profile.confidence < 0.6 || profile.emailCandidates.length === 0 || !profile.socialLinks.linkedin) {
        return true;
      }
      return false;
    });

    if (tier2Candidates.length > 0) {
      options.onProgress?.(
        `Running Tier 2 Apify contact scraper for ${tier2Candidates.length} low-confidence / blocked leads...`
      );

      const BATCH_SIZE = config.apifyEnrichmentBatchSize ?? 50;
      for (let i = 0; i < tier2Candidates.length; i += BATCH_SIZE) {
        const batch = tier2Candidates.slice(i, i + BATCH_SIZE);
        const startUrls = batch
          .map((l) => {
            const rawUrl = normalizeHomepageUrl(l.website) ?? (l.canonicalDomain ? `https://${l.canonicalDomain}` : null);
            return rawUrl ? { url: rawUrl } : null;
          })
          .filter((u): u is { url: string } => u !== null);

        if (startUrls.length === 0) continue;

        try {
          const apifyRes = await withRetry(
            () =>
              apifyClient.runActorAndGetItems({
                actorId: "apify/contact-info-scraper",
                input: {
                  startUrls,
                  maxDepth: 1,
                  maxRequestsPerStartUrl: 5,
                },
                timeoutMs: 180_000,
              }),
            { attempts: 3, baseDelayMs: 2000 }
          );

          const items = (apifyRes.items as Array<Record<string, unknown>>) || [];
          for (const item of items) {
            const parsed = parseApifyContactItem(item);
            if (!parsed.domainUrl && parsed.emails.length === 0 && Object.keys(parsed.socialLinks).length === 0) continue;

            // Match back to lead by domain or URL
            const matchedLead = batch.find((lead) => {
              const dom = (lead.canonicalDomain ?? domainFromWebsite(lead.website) ?? "").toLowerCase();
              const itemBlob = JSON.stringify(item).toLowerCase();
              return dom && itemBlob.includes(dom);
            });

            if (!matchedLead) continue;
            const dom = matchedLead.canonicalDomain ?? domainFromWebsite(matchedLead.website) ?? "";
            if (!dom) continue;

            const existingProfile = getCompanyProfile(db, projectId, dom);
            const mergedEmails = [...new Set([...(existingProfile?.emailCandidates ?? []), ...parsed.emails])];
            const mergedSocials = { ...(existingProfile?.socialLinks ?? {}), ...parsed.socialLinks };

            const newConf = scoreEnrichmentConfidence({
              hasHomepage: true,
              hasDescription: Boolean(existingProfile?.description),
              pageTypes: existingProfile ? ["homepage"] : [],
              emailCount: mergedEmails.length,
              socialCount: Object.keys(mergedSocials).length,
              hasLocation: (existingProfile?.locationHints?.length ?? 0) > 0,
              hasApifyEnrichment: true,
            });

            upsertCompanyProfile(db, {
              projectId,
              leadId: matchedLead.id,
              domain: dom,
              homepageUrl: existingProfile?.homepageUrl ?? matchedLead.website ?? `https://${dom}`,
              title: existingProfile?.title,
              description: existingProfile?.description,
              categoryHints: existingProfile?.categoryHints,
              locationHints: existingProfile?.locationHints,
              socialLinks: mergedSocials,
              emailCandidates: mergedEmails,
              confidence: newConf,
            });
            setLeadPipelineStatus(db, projectId, matchedLead.id, "enriched");

            const companyEmail = pickCompanyEmail(mergedEmails);
            if (companyEmail) {
              const wasSet = setLeadEmailIfEmpty(db, projectId, matchedLead.id, companyEmail);
              if (wasSet && (!existingProfile || existingProfile.emailCandidates.length === 0)) {
                emailsFound++;
              }
            }

            if (!existingProfile) {
              companiesEnriched++;
              if (failed > 0) failed--;
            }
          }
        } catch (err) {
          options.onProgress?.(
            `Tier 2 Apify enrichment batch failed: ${err instanceof Error ? err.message : String(err)}`,
            "warning"
          );
        }
      }
    }
  }

  updateEnrichmentRun(db, run.id, {
    status: "completed",
    companiesQueued: eligible.length,
    companiesEnriched,
    pagesFetched,
    evidenceSaved,
    emailsFound,
    failedCount: failed,
    error: errors.length ? errors.join("; ") : null,
    finishedAt: now(),
  });

  options.onProgress?.(`Enrichment complete. Enriched: ${companiesEnriched}, Emails found: ${emailsFound}, Failed: ${failed}`);


  return {
    runId: run.id,
    status: "completed",
    companiesQueued: eligible.length,
    companiesEnriched,
    pagesFetched,
    evidenceSaved,
    emailsFound,
    failed,
    errors,
  };
}
