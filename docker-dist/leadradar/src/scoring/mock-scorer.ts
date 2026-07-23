import type { Lead, Project } from "../domain/types.js";
import type { ScoreResult, Scorer, ScoreContext } from "./scorer.js";

export class MockScorer implements Scorer {
  async scoreLead(
    lead: Lead,
    project: Project,
    context?: ScoreContext
  ): Promise<ScoreResult> {
    let score = 50 + Math.min(50, Math.floor((lead.votes ?? 0) / 2));
    const icp = (project.icp ?? "").toLowerCase();
    const hay = `${lead.company} ${lead.website ?? ""}`.toLowerCase();
    const fit = icp && hay.includes(icp.split(/\s+/)[0] ?? "") ? "ICP keyword match" : "generic fit";
    const reasons: string[] = [`${fit}; votes=${lead.votes ?? 0}`];

    const similar = context?.similar ?? [];
    const hasGood = similar.some((d) => d.good);
    if (hasGood) {
      score = Math.min(100, score + 10);
      const example = similar.find((d) => d.good)!;
      reasons.push(`similar approved lead: ${example.company}`);
    }

    return { score, reasons: reasons.join("; ") };
  }
}
