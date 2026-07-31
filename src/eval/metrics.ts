export interface EnrichmentFidelityResult {
  yieldRate: number; // 0..1 ratio of extracted fields vs maximum expected
  hasDescription: boolean;
  emailCount: number;
  socialCount: number;
  hasLocation: boolean;
  confidence: number;
  hallucinatedEmails: string[];
}

export interface ContactSeniorityResult {
  totalContacts: number;
  decisionMakerCount: number; // CEO, Founder, VP, Director, Owner
  decisionMakerRatio: number; // 0..1
  validLinkedinCount: number;
  validEmailCount: number;
  hallucinatedUrls: string[];
}

export interface PlannerPrecisionResult {
  validJobs: number;
  totalJobs: number;
  precision: number; // 0..1
  knownActorsUsed: number;
  queryRelevanceScore: number;
}

export interface ScorerConsistencyResult {
  spearmanCorrelation: number; // -1..1
  scoreRange: { min: number; max: number };
  averageScore: number;
  isConsistent: boolean;
}

export function evaluateEnrichmentFidelity(profile: {
  description?: string | null;
  emailCandidates?: string[];
  socialLinks?: Record<string, string>;
  locationHints?: string[];
  confidence?: number;
  domain?: string;
}): EnrichmentFidelityResult {
  const emails = profile.emailCandidates ?? [];
  const socials = profile.socialLinks ?? {};
  const locations = profile.locationHints ?? [];
  const dom = (profile.domain ?? "").toLowerCase();

  // Detect hallucinated emails (email domain doesn't match company domain or common provider)
  const hallucinatedEmails: string[] = [];
  for (const email of emails) {
    const parts = email.toLowerCase().split("@");
    if (parts.length !== 2) {
      hallucinatedEmails.push(email);
      continue;
    }
    const emailDom = parts[1];
    if (
      dom &&
      !emailDom.includes(dom) &&
      !["gmail.com", "yahoo.com", "outlook.com", "hotmail.com"].includes(emailDom)
    ) {
      hallucinatedEmails.push(email);
    }
  }

  let points = 0;
  if (profile.description && profile.description.trim().length > 10) points += 0.3;
  if (emails.length > 0) points += 0.3;
  if (Object.keys(socials).length > 0) points += 0.2;
  if (locations.length > 0) points += 0.2;

  const yieldRate = Math.min(1.0, Number(points.toFixed(2)));

  return {
    yieldRate,
    hasDescription: Boolean(profile.description && profile.description.length > 10),
    emailCount: emails.length,
    socialCount: Object.keys(socials).length,
    hasLocation: locations.length > 0,
    confidence: profile.confidence ?? 0,
    hallucinatedEmails,
  };
}

export function evaluateContactSeniority(
  contacts: Array<{
    title?: string | null;
    linkedinUrl?: string | null;
    email?: string | null;
  }>
): ContactSeniorityResult {
  if (contacts.length === 0) {
    return {
      totalContacts: 0,
      decisionMakerCount: 0,
      decisionMakerRatio: 0,
      validLinkedinCount: 0,
      validEmailCount: 0,
      hallucinatedUrls: [],
    };
  }

  const decisionMakerRoles = [
    "ceo",
    "founder",
    "co-founder",
    "owner",
    "president",
    "managing director",
    "vp",
    "director",
    "head of",
    "chief",
  ];

  let decisionMakerCount = 0;
  let validLinkedinCount = 0;
  let validEmailCount = 0;
  const hallucinatedUrls: string[] = [];

  for (const c of contacts) {
    const t = (c.title ?? "").toLowerCase();
    if (decisionMakerRoles.some((r) => t.includes(r))) {
      decisionMakerCount++;
    }

    if (c.linkedinUrl) {
      if (
        c.linkedinUrl.includes("linkedin.com/in/") ||
        c.linkedinUrl.includes("linkedin.com/company/")
      ) {
        validLinkedinCount++;
      } else {
        hallucinatedUrls.push(c.linkedinUrl);
      }
    }

    if (c.email && c.email.includes("@")) {
      validEmailCount++;
    }
  }

  return {
    totalContacts: contacts.length,
    decisionMakerCount,
    decisionMakerRatio: Number((decisionMakerCount / contacts.length).toFixed(2)),
    validLinkedinCount,
    validEmailCount,
    hallucinatedUrls,
  };
}

export function evaluatePlannerPrecision(payload: {
  jobs?: Array<{ actorId?: string; input?: Record<string, unknown> }>;
}): PlannerPrecisionResult {
  const jobs = payload.jobs ?? [];
  if (jobs.length === 0) {
    return {
      validJobs: 0,
      totalJobs: 0,
      precision: 0,
      knownActorsUsed: 0,
      queryRelevanceScore: 0,
    };
  }

  const knownActors = [
    "apify/google-maps-scraper",
    "apify/google-search-scraper",
    "apify/contact-info-scraper",
    "clockworks/free-google-maps-scraper",
    "compass/crawler-google-places",
  ];

  let validJobs = 0;
  let knownActorsUsed = 0;

  for (const j of jobs) {
    if (j.actorId && typeof j.actorId === "string") {
      validJobs++;
      if (knownActors.some((a) => j.actorId!.includes(a) || a.includes(j.actorId!))) {
        knownActorsUsed++;
      }
    }
  }

  const precision = Number((validJobs / jobs.length).toFixed(2));
  const queryRelevanceScore = Number((knownActorsUsed / jobs.length).toFixed(2));

  return {
    validJobs,
    totalJobs: jobs.length,
    precision,
    knownActorsUsed,
    queryRelevanceScore,
  };
}

export function computeSpearmanRankCorrelation(
  ranksA: number[],
  ranksB: number[]
): number {
  if (ranksA.length <= 1 || ranksB.length <= 1) return 1.0;
  if (ranksA.length !== ranksB.length) return 0;
  const n = ranksA.length;
  let dSquaredSum = 0;
  for (let i = 0; i < n; i++) {
    const diff = ranksA[i] - ranksB[i];
    dSquaredSum += diff * diff;
  }
  const rho = 1 - (6 * dSquaredSum) / (n * (n * n - 1));
  return Number(rho.toFixed(2));
}
