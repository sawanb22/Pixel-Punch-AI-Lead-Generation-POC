import { describe, it, expect } from "vitest";
import {
  summarizeApifyInput,
  jobsFromStrategicPayload,
} from "../../src/discovery/lead-plan-view.js";
import { defaultStrategicPayload } from "../../src/discovery/strategic-payload.js";

describe("lead-plan-view", () => {
  it("summarizeApifyInput formats maps and wellfound inputs", () => {
    const maps = summarizeApifyInput({
      searchStringsArray: ["dentist Chicago", "startup Austin"],
      maxCrawledPlacesPerSearch: 25,
    });
    expect(maps).toContain("Searches:");
    expect(maps).toContain("Max places/search: 25");

    const wf = summarizeApifyInput({
      query: "software engineer",
      location: "United States",
      limit: 50,
    });
    expect(wf).toContain("Query: software engineer");
    expect(wf).toContain("Limit: 50");
  });

  it("jobsFromStrategicPayload includes actor labels", () => {
    const payload = defaultStrategicPayload({
      name: "Co",
      enabledActorKeys: ["google_maps"],
    });
    const jobs = jobsFromStrategicPayload(payload);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].actorLabel).toBe("Google Maps");
    expect(jobs[0].actorId).toContain("google");
  });
});
