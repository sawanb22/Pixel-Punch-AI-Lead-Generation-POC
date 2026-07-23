import { describe, it, expect } from "vitest";
import {
  computePlanContextHash,
  resolvePlanState,
} from "../../src/discovery/plan-context-hash.js";

describe("plan-context-hash", () => {
  const base = {
    projectName: "Agency Co",
    websiteSummary: "We build websites",
    description: "Digital agency",
    icp: "SMBs",
    listName: "verify list",
    listDescription: "payment startups",
    geography: "USA",
    volumeTarget: 100,
    enabledActorKeys: ["google_maps", "wellfound_startups"],
  };

  it("computePlanContextHash is stable for same inputs", () => {
    const a = computePlanContextHash(base);
    const b = computePlanContextHash(base);
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it("computePlanContextHash changes when list focus changes", () => {
    const a = computePlanContextHash(base);
    const b = computePlanContextHash({
      ...base,
      listDescription: "blockchain startups",
    });
    expect(a).not.toBe(b);
  });

  it("resolvePlanState returns none without plan", () => {
    expect(
      resolvePlanState({
        plan: null,
        storedHash: null,
        currentHash: "abc",
      }).planState
    ).toBe("none");
  });

  it("resolvePlanState returns stale when hash mismatches", () => {
    const result = resolvePlanState({
      plan: { status: "auto" },
      storedHash: "oldhash",
      currentHash: "newhash",
    });
    expect(result.planState).toBe("stale");
    expect(result.staleReason).toBeTruthy();
  });

  it("resolvePlanState returns ready for current auto plan", () => {
    expect(
      resolvePlanState({
        plan: { status: "auto" },
        storedHash: "same",
        currentHash: "same",
      }).planState
    ).toBe("ready");
  });
});
