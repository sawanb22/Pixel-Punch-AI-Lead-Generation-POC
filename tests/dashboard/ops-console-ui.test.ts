import { describe, expect, it } from "vitest";
// @ts-ignore
import { OPS_POLL_INTERVAL_MS, mergeOpenOpsFieldIds, shouldContinueOpsPoll } from "../../src/public/ops-console-ui.js";

describe("shouldContinueOpsPoll", () => {
  it("continues only while status is running", () => {
    expect(shouldContinueOpsPoll("running")).toBe(true);
    expect(shouldContinueOpsPoll("completed")).toBe(false);
    expect(shouldContinueOpsPoll("failed")).toBe(false);
    expect(shouldContinueOpsPoll(null)).toBe(false);
    expect(shouldContinueOpsPoll(undefined)).toBe(false);
  });
});

describe("OPS_POLL_INTERVAL_MS", () => {
  it("is 5 seconds", () => {
    expect(OPS_POLL_INTERVAL_MS).toBe(5000);
  });
});

describe("mergeOpenOpsFieldIds", () => {
  it("keeps previously open ids that still exist after rebuild", () => {
    expect(
      mergeOpenOpsFieldIds(
        ["ops-planner-input", "ops-raw-hermes-output"],
        ["ops-planner-input", "ops-raw-hermes-output", "ops-job-table"]
      )
    ).toEqual(["ops-planner-input", "ops-raw-hermes-output"]);
  });

  it("drops open ids that are no longer rendered", () => {
    expect(
      mergeOpenOpsFieldIds(["ops-planner-input", "ops-gone"], ["ops-planner-input"])
    ).toEqual(["ops-planner-input"]);
  });

  it("returns empty when nothing was open", () => {
    expect(mergeOpenOpsFieldIds([], ["ops-planner-input"])).toEqual([]);
  });
});
