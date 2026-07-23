import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { createProject } from "../../src/projects/projects.repo.js";
import {
  activateLeadList,
  clearLeadList,
  createLeadList,
  deleteLeadList,
  getActiveLeadListId,
  listLeadLists,
} from "../../src/leads/lead-lists.repo.js";
import { insertLeads, listLeads } from "../../src/leads/leads.repo.js";
import {
  defaultStrategicPayload,
} from "../../src/discovery/strategic-payload.js";
import {
  strategicPayloadToJobs,
  validateStrategicPayload,
} from "../../src/discovery/validate-strategic-payload.js";
import { evaluateCandidateNoise } from "../../src/discovery/noise-filter.js";
import { serializeLeadStrategy } from "../../src/discovery/lead-strategy.js";
import { HermesLeadPlanner } from "../../src/discovery/hermes-lead-planner.js";
import { runOneClickLeadFinding } from "../../src/discovery/one-click-lead-finding.js";
import type { ApifyClient } from "../../src/discovery/apify-client.js";
import {
  getLatestDiscoveryRunForProject,
  listDiscoveryRunsForProject,
} from "../../src/discovery/discovery.repo.js";

describe("validateStrategicPayload", () => {
  const ctx = {
    name: "Pixel Punch",
    icp: "websites and AI for US SMBs",
    geography: "USA",
    volumeTarget: 100,
    enabledActorKeys: ["google_maps", "wellfound_startups"] as const,
    buyerMode: "agency" as const,
  };

  it("rejects actors not in the project pool", () => {
    const result = validateStrategicPayload(
      {
        version: 1,
        goal: "test",
        geography: "USA",
        volumeTarget: 100,
        negatives: [],
        jobs: [
          {
            jobId: "bad",
            actorKey: "linkedin_jobs",
            reasoning: "hiring",
            apifyInput: { title: "engineer" },
          },
          {
            jobId: "good",
            actorKey: "google_maps",
            reasoning: "local smbs",
            apifyInput: {
              searchStringsArray: ["software company Austin"],
            },
          },
        ],
      },
      { ...ctx, enabledActorKeys: [...ctx.enabledActorKeys] }
    );
    expect(result.fromFallback).toBe(false);
    expect(result.payload.jobs).toHaveLength(1);
    expect(result.payload.jobs[0].actorKey).toBe("google_maps");
    expect(result.droppedJobs.some((d) => d.includes("linkedin_jobs"))).toBe(
      true
    );
  });

  it("falls back when all jobs banned or empty", () => {
    const result = validateStrategicPayload(
      {
        version: 1,
        goal: "test",
        geography: "USA",
        volumeTarget: 50,
        negatives: ["stripe"],
        jobs: [
          {
            jobId: "ban",
            actorKey: "google_search",
            reasoning: "bad",
            apifyInput: { queries: "stripe.com payment" },
          },
        ],
      },
      {
        ...ctx,
        enabledActorKeys: ["google_maps", "wellfound_startups"],
      }
    );
    expect(result.fromFallback).toBe(true);
    expect(result.payload.jobs.length).toBeGreaterThan(0);
    expect(
      result.payload.jobs.every((j) =>
        ["google_maps", "wellfound_startups"].includes(j.actorKey)
      )
    ).toBe(true);
  });

  it("compiles payload to Apify jobs with catalog actorIds", () => {
    const payload = defaultStrategicPayload({
      ...ctx,
      enabledActorKeys: ["google_maps", "wellfound_startups"],
    });
    const compiled = strategicPayloadToJobs(payload);
    expect(compiled.sources.length).toBeGreaterThan(0);
    expect(compiled.sources.every((s) => s.actorId)).toBe(true);
    expect(compiled.maxCandidates).toBe(100);
  });

  it("fallback goal uses list focus when provided", () => {
    const payload = defaultStrategicPayload({
      ...ctx,
      enabledActorKeys: ["google_maps"],
      listFocus: "mobile app build leads — funded startups",
      listName: "mobile app build leads",
    });
    expect(payload.goal).toContain("mobile app build leads");
  });
});

describe("multi-project actor pools", () => {
  it("builds different Hermes planner inputs per enabled actors", async () => {
    const seen: string[][] = [];
    const fetchMock = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const user = body.messages?.find((m: { role: string }) => m.role === "user")
        ?.content as string;
      const keys = [...user.matchAll(/^- (\w+)/gm)].map((m) => m[1]);
      seen.push(keys);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  version: 1,
                  goal: "g",
                  geography: "USA",
                  volumeTarget: 50,
                  negatives: [],
                  jobs: [
                    {
                      jobId: "j1",
                      actorKey: keys[0] || "google_maps",
                      reasoning: "r",
                      apifyInput: { searchStringsArray: ["x"] },
                    },
                  ],
                }),
              },
            },
          ],
        }),
      } as Response;
    };

    const planner = new HermesLeadPlanner({ fetch: fetchMock as never });
    await planner.generateStrategicPayload({
      name: "A",
      enabledActorKeys: ["google_maps", "wellfound_startups"],
      volumeTarget: 50,
    });
    await planner.generateStrategicPayload({
      name: "B",
      enabledActorKeys: ["linkedin_jobs", "google_search"],
      volumeTarget: 50,
      buyerMode: "hiring",
    });
    expect(seen[0]).toEqual(
      expect.arrayContaining(["google_maps", "wellfound_startups"])
    );
    expect(seen[1]).toEqual(
      expect.arrayContaining(["linkedin_jobs", "google_search"])
    );
  });
});

describe("noise filter negatives + wellfound", () => {
  it("rejects vendor hosts and allows wellfound when opted in", () => {
    const vendor = evaluateCandidateNoise({
      company: "Visa",
      website: "https://www.visa.com",
      domain: "visa.com",
      source: "x",
      sourceType: "apify",
      sourceUrl: null,
      discoveryQuery: null,
      rawPayload: {},
      confidence: 0.5,
    });
    expect(vendor.reject).toBe(true);

    const wfBlocked = evaluateCandidateNoise({
      company: "Acme",
      website: "https://wellfound.com/company/acme",
      domain: "wellfound.com",
      source: "wf",
      sourceType: "apify",
      sourceUrl: null,
      discoveryQuery: null,
      rawPayload: {},
      confidence: 0.5,
    });
    expect(wfBlocked.reject).toBe(true);

    const wfAllowed = evaluateCandidateNoise(
      {
        company: "Acme",
        website: "https://wellfound.com/company/acme",
        domain: "wellfound.com",
        source: "wf",
        sourceType: "apify",
        sourceUrl: null,
        discoveryQuery: null,
        rawPayload: {},
        confidence: 0.5,
      },
      { allowWellfoundHosts: true }
    );
    expect(wfAllowed.reject).toBe(false);

    const negative = evaluateCandidateNoise(
      {
        company: "Stripe Payments Blog",
        website: "https://example.com",
        domain: "example.com",
        source: "s",
        sourceType: "apify",
        sourceUrl: null,
        discoveryQuery: null,
        rawPayload: {},
        confidence: 0.5,
      },
      { negatives: ["stripe"] }
    );
    expect(negative.reject).toBe(true);
    expect(negative.reason).toContain("negative");
  });
});

describe("lead lists", () => {
  it("isolates leads across lists and supports clear/delete", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, { name: "Pixel Punch" });
    const defaultId = getActiveLeadListId(db, project.id);
    insertLeads(
      db,
      project.id,
      [
        {
          company: "A Co",
          website: "https://a.example",
          canonicalDomain: "a.example",
          email: null,
          votes: null,
          source: "t",
          sources: ["t"],
        },
      ],
      defaultId
    );

    const listB = createLeadList(db, {
      projectId: project.id,
      name: "NFT startups",
    });
    activateLeadList(db, project.id, listB.id);
    insertLeads(
      db,
      project.id,
      [
        {
          company: "B Co",
          website: "https://b.example",
          canonicalDomain: "b.example",
          email: null,
          votes: null,
          source: "t",
          sources: ["t"],
        },
      ],
      listB.id
    );

    expect(listLeads(db, project.id, defaultId)).toHaveLength(1);
    expect(listLeads(db, project.id, listB.id)).toHaveLength(1);

    clearLeadList(db, project.id, listB.id);
    expect(listLeads(db, project.id, listB.id)).toHaveLength(0);
    expect(listLeads(db, project.id, defaultId)).toHaveLength(1);

    deleteLeadList(db, project.id, listB.id);
    expect(listLeadLists(db, project.id)).toHaveLength(1);
    expect(getActiveLeadListId(db, project.id)).toBe(defaultId);
  });
});

describe("one-click strategic payload run", () => {
  it("stores observability snapshots and uses enabled actors", async () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, {
      name: "Agency",
      icp: "AI websites for SMBs",
      leadStrategy: serializeLeadStrategy({
        version: 1,
        enabledActorKeys: ["google_maps"],
        defaultGeography: "USA",
        buyerMode: "agency",
      }),
    });

    const apifyClient = {
      runActorAndGetItems: async () => ({
        runId: "run-1",
        datasetId: "ds-1",
        usageTotalUsd: 0.01,
        items: [
          {
            title: "Local Soft LLC",
            website: "https://localsoft.example",
            url: "https://maps.example/1",
          },
        ],
      }),
    } as unknown as ApifyClient;

    const planner = new HermesLeadPlanner({
      fetch: (async () => {
        throw new Error("force fallback");
      }) as never,
    });

    const summary = await runOneClickLeadFinding(db, project.id, {
      apifyClient,
      planner,
      env: { APIFY_TOKEN: "test" },
    });

    expect(summary.kept).toBeGreaterThanOrEqual(1);
    expect(summary.payload.jobs.every((j) => j.actorKey === "google_maps")).toBe(
      true
    );
    const run = getLatestDiscoveryRunForProject(
      db,
      project.id,
      getActiveLeadListId(db, project.id)
    );
    expect(run?.payloadJson).toBeTruthy();
    expect(run?.compiledJobsJson).toBeTruthy();
    expect(run?.plannerInputJson).toBeTruthy();
    expect(listDiscoveryRunsForProject(db, project.id)).toHaveLength(1);
  });
});
