import type { ApifyResultMapping } from "./map-candidate.js";

export type ActorKey =
  | "google_maps"
  | "google_search"
  | "wellfound_startups"
  | "linkedin_jobs"
  | "tripadvisor_scraper"
  | "yelp_scraper"
  | "instagram_profiles"
  | "contact_info_scraper"
  | "linkedin_employees";

export interface ActorCatalogEntry {
  key: ActorKey;
  label: string;
  actorId: string;
  /** When false, UI may show the source but default payloads skip it until verified. */
  verified: boolean;
  defaultMapping: ApifyResultMapping;
  descriptionForPlanner: string;
  inputHints: string;
}

export const ACTOR_CATALOG: Record<ActorKey, ActorCatalogEntry> = {
  google_maps: {
    key: "google_maps",
    label: "Google Maps",
    actorId: "compass/crawler-google-places",
    verified: true,
    defaultMapping: {
      companyField: "title",
      websiteField: "website",
      sourceUrlField: "url",
      locationField: "address",
      categoryField: "categoryName",
    },
    descriptionForPlanner:
      "Local SMB / physical business discovery via Google Places. Use searchStringsArray of buyer verticals (e.g. 'dentist Chicago', 'restaurant Austin') — not vendor product topics.",
    inputHints:
      '{ "searchStringsArray": string[], "maxCrawledPlacesPerSearch": number, "language": "en" }',
  },
  google_search: {
    key: "google_search",
    label: "Google Search",
    actorId: "apify/google-search-scraper",
    verified: true,
    defaultMapping: {
      companyField: "title",
      websiteField: "url",
      sourceUrlField: "url",
    },
    descriptionForPlanner:
      "Narrow Google queries that surface company websites (hiring pages, 'just launched' startups). Avoid broad topic SEO queries that return blogs/vendors (payment gateway, NFT marketplace).",
    inputHints:
      '{ "queries": "newline-separated strings", "maxPagesPerQuery": number, "resultsPerPage": 10, "languageCode": "en", "csvFriendlyOutput": true }',
  },
  wellfound_startups: {
    key: "wellfound_startups",
    label: "Wellfound startups",
    actorId: "radeance/wellfound-job-listings-scraper",
    verified: true,
    defaultMapping: {
      companyField: "company_name",
      websiteField: "company_website",
      sourceUrlField: "company_url",
      locationField: "company_location",
    },
    descriptionForPlanner:
      "US startups on Wellfound (AngelList) — hiring signal / company profiles. Prefer company website fields over wellfound.com profile URLs when available.",
    inputHints:
      '{ "query": string, "location": string, "limit": number } — adapt to actor input; keep volume modest.',
  },
  linkedin_jobs: {
    key: "linkedin_jobs",
    label: "LinkedIn jobs",
    actorId: "curious_coder/linkedin-jobs-scraper",
    verified: true,
    defaultMapping: {
      companyField: "companyName",
      websiteField: "companyWebsite",
      sourceUrlField: "jobUrl",
      locationField: "location",
    },
    descriptionForPlanner:
      "Companies actively hiring (role-intent leads). Use job title keywords that imply need for product/engineering help. Map company name + website when present.",
    inputHints:
      '{ "queries": string[] or keyword string, "location": string, "maxResults": number }',
  },
  tripadvisor_scraper: {
    key: "tripadvisor_scraper",
    label: "TripAdvisor",
    actorId: "apify/tripadvisor-scraper",
    verified: true,
    defaultMapping: {
      companyField: "name",
      websiteField: "website",
      sourceUrlField: "url",
      locationField: "address",
      categoryField: "category",
    },
    descriptionForPlanner:
      "Tourism, hospitality, tour operators, travel agencies, and attractions discovery via TripAdvisor.",
    inputHints:
      '{ "locationQuery": string, "maxItems": number }',
  },
  yelp_scraper: {
    key: "yelp_scraper",
    label: "Yelp",
    actorId: "apify/yelp-scraper",
    verified: true,
    defaultMapping: {
      companyField: "name",
      websiteField: "website",
      sourceUrlField: "url",
      locationField: "address",
    },
    descriptionForPlanner:
      "Local service businesses, contractors, agencies, and SMB discovery on Yelp.",
    inputHints:
      '{ "searchTerms": string[], "location": string, "maxItems": number }',
  },
  instagram_profiles: {
    key: "instagram_profiles",
    label: "Instagram Profiles",
    actorId: "apify/instagram-profile-scraper",
    verified: true,
    defaultMapping: {
      companyField: "fullName",
      websiteField: "externalUrl",
      sourceUrlField: "url",
    },
    descriptionForPlanner:
      "Creative agencies, D2C brands, travel creators, and business profiles on Instagram.",
    inputHints:
      '{ "search": string, "maxItems": number }',
  },
  contact_info_scraper: {
    key: "contact_info_scraper",
    label: "Contact Info Scraper",
    actorId: "apify/contact-info-scraper",
    verified: true,
    defaultMapping: {
      companyField: "domain",
      websiteField: "url",
    },
    descriptionForPlanner:
      "Extract direct emails, phone numbers, and social links by crawling target company websites.",
    inputHints:
      '{ "startUrls": [{ "url": string }], "maxDepth": 2 }',
  },
  linkedin_employees: {
    key: "linkedin_employees",
    label: "LinkedIn Employees",
    actorId: "curious_coder/linkedin-company-employees-scraper",
    verified: true,
    defaultMapping: {
      companyField: "companyName",
      websiteField: "profileUrl",
    },
    descriptionForPlanner:
      "Discover company decision makers, executives, and employee profiles on LinkedIn.",
    inputHints:
      '{ "companyUrl": string, "maxResults": number }',
  },
};

export const DEFAULT_AGENCY_ACTOR_KEYS: ActorKey[] = [
  "google_maps",
  "wellfound_startups",
];

export const ALL_ACTOR_KEYS: ActorKey[] = Object.keys(ACTOR_CATALOG) as ActorKey[];

export function listActorCatalog(): ActorCatalogEntry[] {
  return Object.values(ACTOR_CATALOG);
}

export function getActorEntry(key: string): ActorCatalogEntry | undefined {
  return ACTOR_CATALOG[key as ActorKey];
}

export function findActorEntry(keyOrId: string): ActorCatalogEntry | undefined {
  if (!keyOrId?.trim()) return undefined;
  const raw = keyOrId.trim().toLowerCase().replace(/[-_]/g, "");
  if (keyOrId in ACTOR_CATALOG) return ACTOR_CATALOG[keyOrId as ActorKey];
  for (const entry of Object.values(ACTOR_CATALOG)) {
    const k = entry.key.toLowerCase().replace(/[-_]/g, "");
    const a = entry.actorId.toLowerCase().replace(/[-_]/g, "");
    if (raw === k || raw === a || raw.includes(k) || k.includes(raw)) {
      return entry;
    }
  }
  return undefined;
}

export function isActorKey(key: string): key is ActorKey {
  return key in ACTOR_CATALOG;
}

export function catalogForPlanner(enabledKeys?: ActorKey[]): string {
  const keys = enabledKeys && enabledKeys.length > 0 ? enabledKeys : ALL_ACTOR_KEYS;
  return keys
    .map((key) => {
      const entry = ACTOR_CATALOG[key];
      if (!entry) return null;
      return `- ${entry.key} (${entry.actorId}): ${entry.descriptionForPlanner} Input shape: ${entry.inputHints}`;
    })
    .filter(Boolean)
    .join("\n");
}

