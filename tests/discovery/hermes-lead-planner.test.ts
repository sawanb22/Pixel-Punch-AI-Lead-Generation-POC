import { describe, it, expect, vi } from "vitest";
import { HermesLeadPlanner } from "../../src/discovery/hermes-lead-planner.js";
import type { RunRevisionBrief } from "../../src/discovery/run-revision-brief.js";

const samplePayload = {
  version: 1,
  goal: "find buyers",
  geography: "Austin",
  volumeTarget: 25,
  negatives: [],
  jobs: [
    {
      jobId: "maps-1",
      actorKey: "google_maps",
      reasoning: "local smb",
      apifyInput: { searchStringsArray: ["cafe Austin"] },
    },
  ],
};

describe("HermesLeadPlanner revision brief", () => {
  it("includes revision brief in user prompt when provided", async () => {
    let userContent = "";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages: Array<{ role: string; content: string }>;
      };
      userContent =
        body.messages.find((m) => m.role === "user")?.content ?? "";
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(samplePayload),
              },
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const brief: RunRevisionBrief = {
      runId: 42,
      previousJobs: [
        {
          actorKey: "google_search",
          jobId: "s1",
          inputSummary: "payment gateway vendors",
        },
      ],
      stats: {
        fetched: 50,
        kept: 2,
        provisional: 1,
        rejected: 40,
        duplicates: 3,
        circuitBreaker: true,
        circuitBreakerReason: "junk_ratio=0.8",
      },
      rejectionMix: [{ reason: "vendor_media_host", count: 30 }],
    };

    const planner = new HermesLeadPlanner({
      fetch: fetchImpl,
      baseUrl: "http://hermes.test",
      timeoutMs: 5000,
    });

    await planner.generateStrategicPayload({
      name: "Pixel Punch",
      icp: "SMBs needing websites",
      enabledActorKeys: ["google_maps", "google_search"],
      revisionBrief: brief,
    });

    expect(userContent).toContain("REVISION BRIEF");
    expect(userContent).toContain("Run #42");
    expect(userContent).toContain("google_search");
    expect(userContent).toContain("vendor_media_host");
    expect(userContent).toMatch(/revise|do not repeat/i);
  });

  it("omits revision brief when null", async () => {
    let userContent = "";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages: Array<{ role: string; content: string }>;
      };
      userContent =
        body.messages.find((m) => m.role === "user")?.content ?? "";
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(samplePayload),
              },
            },
          ],
        }),
      };
    }) as unknown as typeof fetch;

    const planner = new HermesLeadPlanner({
      fetch: fetchImpl,
      baseUrl: "http://hermes.test",
      timeoutMs: 5000,
    });

    await planner.generateStrategicPayload({
      name: "Pixel Punch",
      icp: "SMBs",
      enabledActorKeys: ["google_maps"],
    });

    expect(userContent).not.toContain("REVISION BRIEF");
  });

  it("accepts dynamic unlisted Apify store actors from Hermes plan payload", async () => {
    const dynamicPayload = {
      version: 1,
      goal: "Find Baku tour operators on TripAdvisor",
      geography: "Baku, Azerbaijan",
      volumeTarget: 50,
      negatives: ["blogs"],
      jobs: [
        {
          jobId: "tripadvisor-1",
          actorKey: "tripadvisor_scraper",
          actorId: "apify/tripadvisor-scraper",
          reasoning: "Discover Baku local travel agencies & tour operators",
          apifyInput: { locationQuery: "Baku", maxItems: 50 },
        },
      ],
    };

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(dynamicPayload) } }],
      }),
    })) as unknown as typeof fetch;

    const planner = new HermesLeadPlanner({
      fetch: fetchImpl,
      baseUrl: "http://hermes.test",
      timeoutMs: 5000,
    });

    const res = await planner.generateStrategicPayload({
      name: "Azerbaijan Tourism Campaign",
      icp: "Travel agencies in Baku",
      enabledActorKeys: ["google_maps"],
      listFocus: "Baku tour operators",
    });

    expect(res.fromFallback).toBe(false);
    expect(res.payload.jobs[0].actorKey).toBe("tripadvisor_scraper");
    expect(res.payload.jobs[0].actorId).toBe("apify/tripadvisor-scraper");
    expect(res.payload.jobs[0].apifyInput).toEqual({ locationQuery: "Baku", maxItems: 50 });
  });
});
