export interface BenchmarkICP {
  id: string;
  name: string;
  icpDescription: string;
  targetGeography: string;
  expectedKeywords: string[];
  expectedTargetRoles: string[];
  expectedActors: string[];
  referenceLeads: Array<{
    company: string;
    website: string;
    domain: string;
    expectedDescriptionSnippet: string;
    expectedLocation: string;
    expectedEmailCount: number;
    expectedSocials: string[];
  }>;
}

export const BENCHMARK_ICPS: BenchmarkICP[] = [
  {
    id: "icp_local_services",
    name: "Local Services (Plumbing & HVAC)",
    icpDescription: "Commercial and residential plumbers and HVAC contractors operating in Austin, Texas.",
    targetGeography: "Austin, Texas, USA",
    expectedKeywords: ["plumber", "hvac", "pipe", "repair", "contractor", "austin"],
    expectedTargetRoles: ["Owner", "President", "Founder", "General Manager"],
    expectedActors: ["apify/google-maps-scraper", "clockworks/free-google-maps-scraper"],
    referenceLeads: [
      {
        company: "Austin Precision Plumbing",
        website: "https://austinprecisionplumbing.com",
        domain: "austinprecisionplumbing.com",
        expectedDescriptionSnippet: "Commercial plumbing and repair services in Austin, TX",
        expectedLocation: "Austin, TX",
        expectedEmailCount: 1,
        expectedSocials: ["facebook", "linkedin"],
      },
      {
        company: "Lone Star HVAC & Air",
        website: "https://lonestarhvacair.com",
        domain: "lonestarhvacair.com",
        expectedDescriptionSnippet: "HVAC installation and AC repair for Austin homes",
        expectedLocation: "Austin, TX",
        expectedEmailCount: 1,
        expectedSocials: ["facebook"],
      },
    ],
  },
  {
    id: "icp_b2b_saas",
    name: "B2B SaaS DevTools",
    icpDescription: "Early to mid-stage B2B SaaS startups building Developer Tools and Cloud Infrastructure.",
    targetGeography: "United States",
    expectedKeywords: ["saas", "devtools", "developer", "cloud", "api", "platform"],
    expectedTargetRoles: ["CEO", "Co-Founder", "CTO", "VP Engineering"],
    expectedActors: ["apify/google-search-scraper", "apify/contact-info-scraper"],
    referenceLeads: [
      {
        company: "DevSync Cloud",
        website: "https://devsync.io",
        domain: "devsync.io",
        expectedDescriptionSnippet: "Developer automation and cloud sync CLI platform",
        expectedLocation: "San Francisco, CA",
        expectedEmailCount: 2,
        expectedSocials: ["linkedin", "twitter", "github"],
      },
    ],
  },
];
