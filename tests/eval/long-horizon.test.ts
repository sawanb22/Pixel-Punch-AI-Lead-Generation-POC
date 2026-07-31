import { describe, it, expect } from "vitest";
import { runLongHorizonSimulation } from "../../src/eval/harness/long-horizon-harness.js";
import { BENCHMARK_ICPS } from "../../src/eval/benchmark-dataset.js";

describe("long horizon simulation harness", () => {
  it("runs 3 batch simulation cycles and generates structured report", async () => {
    const report = await runLongHorizonSimulation(BENCHMARK_ICPS[0], 3);
    expect(report.totalBatchesExecuted).toBe(3);
    expect(report.batchSummaries.length).toBe(3);
    expect(report.passed).toBe(true);
    expect(report.overallFailureRate).toBeLessThanOrEqual(0.1);
  });
});
