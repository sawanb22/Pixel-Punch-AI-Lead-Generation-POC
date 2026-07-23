import type { LeadFindingSourceConfig } from "./lead-finding-config.js";
import type { LeadPlan } from "./lead-plan.js";
import { clampVolumeTarget } from "./lead-plan.js";

export interface CompiledLeadFinding {
  sources: LeadFindingSourceConfig[];
  maxCandidates: number;
  maxApifyJobs: number;
  concurrency: number;
}

function chunkQueries(queries: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < queries.length; i += size) {
    out.push(queries.slice(i, i + size));
  }
  return out;
}

function pagesForVolume(volume: number): number {
  if (volume >= 1000) return 10;
  if (volume >= 500) return 8;
  if (volume >= 250) return 6;
  if (volume >= 100) return 5;
  return 3;
}

function placesForVolume(volume: number): number {
  if (volume >= 1000) return 80;
  if (volume >= 500) return 50;
  if (volume >= 250) return 40;
  if (volume >= 100) return 25;
  return 15;
}

/**
 * Compile a human lead plan into Apify-only discovery jobs.
 * Prefer strategicPayloadToJobs for the Find leads path.
 */
export function compileLeadPlanToApifyJobs(plan: LeadPlan): CompiledLeadFinding {
  const volume = clampVolumeTarget(plan.volumeTarget);
  const geo = plan.geography?.trim() || "United States";
  const pages = pagesForVolume(volume);
  const places = placesForVolume(volume);
  const sources: LeadFindingSourceConfig[] = [];

  const searchAngles = plan.searchAngles.filter((q) => q.trim().length > 0);
  const queryChunks = chunkQueries(searchAngles, volume >= 500 ? 2 : 3);

  let idx = 0;
  for (const chunk of queryChunks) {
    idx += 1;
    sources.push({
      id: `apify-search-${idx}`,
      type: "apify",
      enabled: true,
      actorId: "apify/google-search-scraper",
      discoveryQuery: chunk[0],
      input: {
        queries: chunk.join("\n"),
        maxPagesPerQuery: pages,
        resultsPerPage: 10,
        mobileResults: false,
        languageCode: "en",
        csvFriendlyOutput: true,
      },
      mapping: {
        companyField: "title",
        websiteField: "url",
        sourceUrlField: "url",
      },
    });
  }

  const wantsLocal =
    plan.intents.includes("local_smb_digital") ||
    plan.intents.includes("needs_website");
  if (wantsLocal) {
    sources.push({
      id: "apify-maps-local",
      type: "apify",
      enabled: true,
      actorId: "compass/crawler-google-places",
      discoveryQuery: `local businesses ${geo}`,
      input: {
        searchStringsArray: [
          `software company ${geo}`,
          `startup office ${geo}`,
          `marketing agency ${geo}`,
          `restaurant ${geo}`,
        ].slice(0, volume >= 250 ? 4 : 2),
        maxCrawledPlacesPerSearch: places,
        language: "en",
      },
      mapping: {
        companyField: "title",
        websiteField: "website",
        sourceUrlField: "url",
      },
    });
  }

  const wantsStartups =
    plan.intents.includes("new_startup") ||
    plan.intents.includes("needs_ai_feature");
  if (wantsStartups && volume >= 50) {
    sources.push({
      id: "apify-search-startups",
      type: "apify",
      enabled: true,
      actorId: "apify/google-search-scraper",
      discoveryQuery: "new startup launching product",
      input: {
        queries: [
          `new startup launched ${geo}`,
          `"just launched" SaaS ${geo}`,
          `seed startup hiring engineer ${geo}`,
        ].join("\n"),
        maxPagesPerQuery: pages,
        resultsPerPage: 10,
        languageCode: "en",
        csvFriendlyOutput: true,
      },
      mapping: {
        companyField: "title",
        websiteField: "url",
        sourceUrlField: "url",
      },
    });
  }

  const maxApifyJobs =
    volume >= 1000 ? 10 : volume >= 500 ? 8 : volume >= 250 ? 6 : 5;

  return {
    sources: sources.slice(0, maxApifyJobs),
    maxCandidates: volume,
    maxApifyJobs,
    concurrency: volume >= 500 ? 3 : 2,
  };
}

export { strategicPayloadToJobs } from "./validate-strategic-payload.js";
