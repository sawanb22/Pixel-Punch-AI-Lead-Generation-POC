import { computeSpearmanRankCorrelation } from "../metrics.js";

export interface ScorerEvalReport {
  totalLeadsScored: number;
  averageScore: number;
  scoreSpread: { min: number; max: number };
  spearmanCorrelation: number;
  passed: boolean;
}

export function evaluateScorerOutputs(
  scores: number[],
  referenceRanks?: number[]
): ScorerEvalReport {
  if (scores.length === 0) {
    return {
      totalLeadsScored: 0,
      averageScore: 0,
      scoreSpread: { min: 0, max: 0 },
      spearmanCorrelation: 1.0,
      passed: true,
    };
  }

  const sum = scores.reduce((a, b) => a + b, 0);
  const averageScore = Number((sum / scores.length).toFixed(1));
  const min = Math.min(...scores);
  const max = Math.max(...scores);

  // Compute rank order of scores (highest score gets rank 1)
  const sorted = [...scores].map((val, idx) => ({ val, idx })).sort((a, b) => b.val - a.val);
  const actualRanks = new Array(scores.length);
  sorted.forEach((item, rank) => {
    actualRanks[item.idx] = rank + 1;
  });

  const expectedRanks = referenceRanks ?? Array.from({ length: scores.length }, (_, i) => i + 1);
  const spearmanCorrelation = computeSpearmanRankCorrelation(actualRanks, expectedRanks);
  const passed = scores.length <= 1 || spearmanCorrelation >= 0.5;

  return {
    totalLeadsScored: scores.length,
    averageScore,
    scoreSpread: { min, max },
    spearmanCorrelation,
    passed,
  };
}
