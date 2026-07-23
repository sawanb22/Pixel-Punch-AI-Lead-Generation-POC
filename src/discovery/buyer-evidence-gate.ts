import type { DiscoveredCompanyCandidate } from "./types.js";
import { hostnameOf } from "./hard-shield.js";

export type BuyerGateVerdict = "fit" | "maybe" | "no";

export interface BuyerEvidenceContext {
  icp?: string | null;
  geography?: string | null;
  listFocus?: string | null;
  negatives?: string[];
  /** Actor / source id hint — google search rows get stricter mid-band treatment. */
  sourceHint?: string | null;
}

export interface BuyerEvidenceResult {
  verdict: BuyerGateVerdict;
  score: number;
  reasons: string[];
}

const HOMEPAGE_LIKE =
  /^https?:\/\/[^/]+\/?$/i;

const PATH_PENALTY =
  /\/(blog|news|articles?|insights?|wiki|topics?)\b/i;

function tokenize(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

function overlapScore(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let hits = 0;
  for (const t of a) {
    if (setB.has(t)) hits++;
  }
  return Math.min(40, hits * 8);
}

/**
 * Deterministic buyer evidence score (0–100).
 * High → fit (gated). Mid → maybe (provisional). Low → no (reject).
 */
export function scoreBuyerEvidence(
  candidate: DiscoveredCompanyCandidate,
  ctx: BuyerEvidenceContext = {}
): BuyerEvidenceResult {
  let score = 40;
  const reasons: string[] = [];

  const website = candidate.website?.trim() || "";
  const host = candidate.domain ?? hostnameOf(website);

  if (!host) {
    return { verdict: "no", score: 0, reasons: ["no_domain"] };
  }

  if (website && HOMEPAGE_LIKE.test(website.replace(/\?.*$/, ""))) {
    score += 15;
    reasons.push("homepage_url");
  } else if (website && PATH_PENALTY.test(website)) {
    score -= 25;
    reasons.push("content_path");
  } else if (website) {
    score += 5;
    reasons.push("has_website");
  }

  const companyTokens = tokenize(candidate.company);
  const icpTokens = [
    ...tokenize(ctx.icp),
    ...tokenize(ctx.listFocus),
    ...tokenize(ctx.geography),
  ];
  const ov = overlapScore(companyTokens, icpTokens);
  if (ov > 0) {
    score += ov;
    reasons.push(`icp_overlap:${ov}`);
  }

  const category =
    candidate.rawPayload &&
    typeof candidate.rawPayload === "object" &&
    candidate.rawPayload !== null &&
    "categoryName" in candidate.rawPayload
      ? String(
          (candidate.rawPayload as { categoryName?: unknown }).categoryName ??
            ""
        )
      : "";
  const catOv = overlapScore(tokenize(category), icpTokens);
  if (catOv > 0) {
    score += Math.min(20, catOv);
    reasons.push(`category_overlap:${catOv}`);
  }

  if (ctx.geography?.trim()) {
    const geo = ctx.geography.toLowerCase();
    const blob = [
      candidate.company,
      website,
      candidate.sourceUrl ?? "",
      category,
      JSON.stringify(candidate.rawPayload ?? {}),
    ]
      .join(" ")
      .toLowerCase();
    if (
      blob.includes(geo) ||
      (geo.includes("usa") && /\b(us|usa|united states)\b/i.test(blob))
    ) {
      score += 10;
      reasons.push("geo_hint");
    }
  }

  if (ctx.negatives?.length) {
    const blob = [
      candidate.company,
      website,
      candidate.domain ?? "",
    ]
      .join(" ")
      .toLowerCase();
    for (const n of ctx.negatives) {
      const t = n.trim().toLowerCase();
      if (t.length >= 3 && blob.includes(t)) {
        score -= 35;
        reasons.push(`negative:${t}`);
        break;
      }
    }
  }

  score += Math.round(Math.min(10, candidate.confidence * 10));
  score = Math.max(0, Math.min(100, score));

  const fromSearch =
    /google.?search|search/i.test(candidate.source) ||
    /google.?search|search/i.test(ctx.sourceHint ?? "");

  let verdict: BuyerGateVerdict;
  if (score >= 55) {
    verdict = "fit";
  } else if (score >= 35) {
    verdict = "maybe";
  } else {
    verdict = "no";
  }

  // Search-sourced mid-band stays provisional (higher junk risk)
  if (fromSearch && verdict === "fit" && score < 70) {
    verdict = "maybe";
    reasons.push("search_stricter");
  }

  return { verdict, score, reasons };
}

export function gateCandidates(
  candidates: DiscoveredCompanyCandidate[],
  ctx: BuyerEvidenceContext
): {
  fit: DiscoveredCompanyCandidate[];
  maybe: DiscoveredCompanyCandidate[];
  rejected: DiscoveredCompanyCandidate[];
} {
  const fit: DiscoveredCompanyCandidate[] = [];
  const maybe: DiscoveredCompanyCandidate[] = [];
  const rejected: DiscoveredCompanyCandidate[] = [];

  for (const c of candidates) {
    const result = scoreBuyerEvidence(c, {
      ...ctx,
      sourceHint: ctx.sourceHint ?? c.source,
    });
    if (result.verdict === "fit") {
      fit.push({ ...c, confidence: Math.max(c.confidence, result.score / 100) });
    } else if (result.verdict === "maybe") {
      maybe.push({
        ...c,
        confidence: result.score / 100,
        rejectionReason: undefined,
      });
    } else {
      rejected.push({
        ...c,
        rejectionReason: `buyer_gate:${result.reasons.join(",") || "low_score"}`,
      });
    }
  }

  return { fit, maybe, rejected };
}
