import { describe, it, expect } from "vitest";
import {
  classifyDomainQuality,
  evaluateHardShield,
  isBlockedHost,
} from "../../src/discovery/hard-shield.js";
import type { DiscoveredCompanyCandidate } from "../../src/discovery/types.js";
import { scoreBuyerEvidence, gateCandidates } from "../../src/discovery/buyer-evidence-gate.js";
import {
  createCircuitBreakerState,
  recordJobOutcome,
  shouldStopFurtherJobs,
} from "../../src/discovery/circuit-breaker.js";

function cand(
  partial: Partial<DiscoveredCompanyCandidate> & { company: string }
): DiscoveredCompanyCandidate {
  return {
    website: null,
    domain: null,
    source: "test",
    sourceType: "apify",
    sourceUrl: null,
    discoveryQuery: null,
    rawPayload: {},
    confidence: 0.5,
    ...partial,
  };
}

describe("hard-shield golden junk", () => {
  const junkDomains = [
    ["visa.com", "Visa"],
    ["forbes.com", "Forbes"],
    ["medium.com", "Medium Article"],
    ["stripe.com", "Stripe"],
    ["wikipedia.org", "Wikipedia"],
    ["producthunt.com", "PH"],
    ["shopify.com", "Shopify"],
    ["wix.com", "Wix"],
    ["openai.com", "OpenAI"],
    ["nytimes.com", "NYT"],
  ] as const;

  for (const [domain, company] of junkDomains) {
    it(`rejects ${domain}`, () => {
      const result = evaluateHardShield(
        cand({
          company,
          website: `https://${domain}`,
          domain,
        })
      );
      expect(result.reject).toBe(true);
      expect(classifyDomainQuality(domain, company)).toBe("media_or_platform");
    });
  }

  it("rejects .gov / .edu", () => {
    expect(
      evaluateHardShield(
        cand({ company: "Agency", website: "https://nasa.gov", domain: "nasa.gov" })
      ).reject
    ).toBe(true);
    expect(
      evaluateHardShield(
        cand({ company: "Uni", website: "https://mit.edu", domain: "mit.edu" })
      ).reject
    ).toBe(true);
  });

  it("rejects listicles", () => {
    const r = evaluateHardShield(
      cand({
        company: "Top 10 Startups to Watch",
        website: "https://example.com",
        domain: "example.com",
      })
    );
    expect(r.reject).toBe(true);
    expect(r.reason).toBe("listicle_title");
  });

  it("rejects missing website by default", () => {
    const r = evaluateHardShield(cand({ company: "Nameless Co" }));
    expect(r.reject).toBe(true);
    expect(r.reason).toBe("no_website");
  });

  it("keeps real company domains", () => {
    const r = evaluateHardShield(
      cand({
        company: "Acme Labs",
        website: "https://acme.example",
        domain: "acme.example",
      })
    );
    expect(r.reject).toBe(false);
    expect(isBlockedHost("acme.example")).toBe(false);
  });

  it("allows wellfound when opted in", () => {
    const blocked = evaluateHardShield(
      cand({
        company: "Startup",
        website: "https://wellfound.com/company/x",
        domain: "wellfound.com",
      })
    );
    expect(blocked.reject).toBe(true);

    const allowed = evaluateHardShield(
      cand({
        company: "Startup",
        website: "https://wellfound.com/company/x",
        domain: "wellfound.com",
      }),
      { allowWellfoundHosts: true }
    );
    expect(allowed.reject).toBe(false);
  });
});

describe("buyer-evidence-gate", () => {
  it("fits ICP-overlapping homepage companies", () => {
    const result = scoreBuyerEvidence(
      cand({
        company: "Austin Dental Clinic",
        website: "https://austindentals.example",
        domain: "austindentals.example",
        confidence: 0.8,
      }),
      { icp: "dentists and dental clinics in Austin", geography: "Austin" }
    );
    expect(result.verdict).toBe("fit");
    expect(result.score).toBeGreaterThanOrEqual(55);
  });

  it("rejects low-signal content paths", () => {
    const result = scoreBuyerEvidence(
      cand({
        company: "Random",
        website: "https://random.example/blog/news",
        domain: "random.example",
        confidence: 0.1,
      }),
      { icp: "fintech buyers", geography: "USA" }
    );
    expect(result.verdict).toBe("no");
  });

  it("gates a batch into fit/maybe/no", () => {
    const { fit, maybe, rejected } = gateCandidates(
      [
        cand({
          company: "Pixel Dentist Austin",
          website: "https://pixeldentist.example",
          domain: "pixeldentist.example",
        }),
        cand({
          company: "Vague Co",
          website: "https://vague.example/about",
          domain: "vague.example",
        }),
        cand({
          company: "Spam",
          website: "https://spam.example/blog/post",
          domain: "spam.example",
          confidence: 0,
        }),
      ],
      { icp: "dentist Austin", geography: "Austin" }
    );
    expect(fit.length + maybe.length + rejected.length).toBe(3);
    expect(fit.some((c) => c.company.includes("Dentist"))).toBe(true);
  });
});

describe("circuit-breaker", () => {
  it("trips when junk ratio exceeds threshold after enough decisions", () => {
    let state = createCircuitBreakerState();
    state = recordJobOutcome(state, { fetched: 20, kept: 2, rejected: 18 });
    expect(shouldStopFurtherJobs(state)).toBe(true);
    expect(state.reason).toMatch(/junk_ratio/);
  });

  it("does not trip on small samples", () => {
    let state = createCircuitBreakerState();
    state = recordJobOutcome(state, { fetched: 4, kept: 1, rejected: 3 });
    expect(shouldStopFurtherJobs(state)).toBe(false);
  });
});
