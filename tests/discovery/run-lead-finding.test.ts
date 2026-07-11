import { describe, it, expect, vi } from "vitest";
import {
  parseLeadFindingConfig,
  resolveLeadFindingJobs,
} from "../../src/discovery/lead-finding-config.js";
import { getSourcePack, listSourcePackIds } from "../../src/discovery/source-packs.js";
import { ApifyActorSource } from "../../src/discovery/apify-source.js";
import type { ApifyClient } from "../../src/discovery/apify-client.js";
import { openDatabase } from "../../src/db/database.js";
import { createProject } from "../../src/projects/projects.repo.js";
import { runLeadFinding } from "../../src/discovery/run-lead-finding.js";
import { listLeads } from "../../src/leads/leads.repo.js";
import {
  getDiscoveryRun,
  listSourceJobs,
  listDiscoveredCandidates,
} from "../../src/discovery/discovery.repo.js";

describe("lead-finding-config", () => {
  it("parses leadFinding from source_config JSON", () => {
    const cfg = parseLeadFindingConfig({
      leadFinding: {
        mode: "apify_first",
        maxCandidates: 100,
        maxApifyJobs: 3,
        sources: [
          {
            id: "maps",
            type: "apify",
            enabled: true,
            actorId: "apify/google-maps-scraper",
            input: { searchStringsArray: ["cafes"] },
            mapping: {
              companyField: "title",
              websiteField: "website",
              sourceUrlField: "url",
            },
          },
        ],
      },
    });
    expect(cfg.mode).toBe("apify_first");
    expect(cfg.maxCandidates).toBe(100);
    expect(cfg.sources).toHaveLength(1);
    expect(cfg.sources[0].actorId).toBe("apify/google-maps-scraper");
  });

  it("resolves explicit sources over packs", () => {
    const jobs = resolveLeadFindingJobs({
      project: {
        id: 1,
        name: "Local Bites",
        website: null,
        description: "restaurants",
        icp: "local restaurants in NYC",
        sourceConfig: JSON.stringify({
          leadFinding: {
            sources: [
              {
                id: "custom",
                type: "apify",
                actorId: "user/actor",
                mapping: { companyField: "name", websiteField: "web" },
              },
            ],
          },
        }),
        leadPlan: null,
        status: "active",
        createdAt: "",
      },
      env: {},
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("custom");
  });
});

describe("source-packs", () => {
  it("exposes starter packs with apify templates", () => {
    const ids = listSourcePackIds();
    expect(ids).toEqual(
      expect.arrayContaining([
        "local_business",
        "saas_startup",
        "ecommerce",
        "b2b_general",
        "hiring_intent",
      ])
    );
    const local = getSourcePack("local_business");
    expect(local.sources.length).toBeGreaterThan(0);
    expect(local.sources[0].type).toBe("apify");
    expect(local.sources[0].mapping.companyField).toBeTruthy();
  });
});

describe("ApifyActorSource", () => {
  it("maps dataset items into discovered candidates", async () => {
    const client = {
      runActorAndGetItems: vi.fn().mockResolvedValue({
        runId: "r1",
        datasetId: "d1",
        status: "SUCCEEDED",
        items: [
          {
            title: "Acme Cafe",
            website: "https://acme.example",
            url: "https://maps.example/1",
          },
          { title: "", website: "" },
          {
            title: "Noise Inc",
            website: "https://linkedin.com/company/noise",
            url: "https://maps.example/2",
          },
        ],
        usageTotalUsd: 0.12,
      }),
    } as unknown as ApifyClient;

    const source = new ApifyActorSource({
      client,
      sourceId: "maps",
      actorId: "apify/google-maps-scraper",
      input: { searchStringsArray: ["cafes"] },
      mapping: {
        companyField: "title",
        websiteField: "website",
        sourceUrlField: "url",
      },
      discoveryQuery: "cafes",
    });

    const result = await source.fetchCandidates();
    expect(result.apifyRunId).toBe("r1");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].company).toBe("Acme Cafe");
    expect(result.rejected.length).toBeGreaterThanOrEqual(1);
    expect(
      result.rejected.some((r) => /blocked|job/i.test(r.rejectionReason ?? ""))
    ).toBe(true);
  });
});

describe("runLeadFinding", () => {
  it("runs multiple jobs, survives one failure, dedupes, and ingests leads", async () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, {
      name: "Demo",
      icp: "B2B SaaS analytics",
      sourceConfig: JSON.stringify({
        leadFinding: {
          maxCandidates: 10,
          sources: [
            {
              id: "ok-source",
              type: "apify",
              actorId: "user/ok",
              input: { q: "analytics" },
              mapping: {
                companyField: "name",
                websiteField: "website",
                sourceUrlField: "url",
              },
            },
            {
              id: "bad-source",
              type: "apify",
              actorId: "user/bad",
              mapping: {
                companyField: "name",
                websiteField: "website",
              },
            },
            {
              id: "dup-source",
              type: "apify",
              actorId: "user/dup",
              mapping: {
                companyField: "name",
                websiteField: "website",
              },
            },
          ],
        },
      }),
    });

    const client = {
      runActorAndGetItems: vi.fn(async (input: { actorId?: string }) => {
        if (input.actorId === "user/bad") {
          throw new Error("actor exploded");
        }
        if (input.actorId === "user/dup") {
          return {
            runId: "r-dup",
            datasetId: "d-dup",
            status: "SUCCEEDED",
            items: [
              { name: "Acme Analytics", website: "https://acme.example" },
            ],
          };
        }
        return {
          runId: "r-ok",
          datasetId: "d-ok",
          status: "SUCCEEDED",
          items: [
            { name: "Acme Analytics", website: "https://acme.example", url: "https://src/1" },
            { name: "Beta Data", website: "https://beta.example", url: "https://src/2" },
            { name: "Gamma", website: "https://linkedin.com/company/gamma" },
          ],
        };
      }),
    } as unknown as ApifyClient;

    const summary = await runLeadFinding(db, project.id, {
      apifyClient: client,
      concurrency: 2,
    });

    expect(summary.status).toBe("completed");
    expect(summary.sourcesRun).toBe(3);
    expect(summary.errors.length).toBe(1);
    expect(summary.errors[0]).toMatch(/bad-source/);
    expect(summary.fetched).toBeGreaterThanOrEqual(3);
    expect(summary.kept).toBe(2);
    expect(summary.duplicates).toBeGreaterThanOrEqual(1);
    expect(summary.rejected).toBeGreaterThanOrEqual(1);

    const run = getDiscoveryRun(db, summary.runId)!;
    expect(run.status).toBe("completed");
    const jobs = listSourceJobs(db, summary.runId);
    expect(jobs.some((j) => j.status === "failed")).toBe(true);
    expect(jobs.some((j) => j.status === "completed")).toBe(true);

    const keptCandidates = listDiscoveredCandidates(db, summary.runId, {
      kept: true,
    });
    expect(keptCandidates).toHaveLength(2);

    const leads = listLeads(db, project.id);
    expect(leads).toHaveLength(2);
    expect(leads.map((l) => l.company).sort()).toEqual([
      "Acme Analytics",
      "Beta Data",
    ]);
    expect(leads[0].sources.length).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it("respects maxCandidates", async () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, {
      name: "Cap",
      sourceConfig: JSON.stringify({
        leadFinding: {
          maxCandidates: 1,
          sources: [
            {
              id: "many",
              type: "apify",
              actorId: "user/many",
              mapping: { companyField: "name", websiteField: "website" },
            },
          ],
        },
      }),
    });

    const client = {
      runActorAndGetItems: vi.fn().mockResolvedValue({
        runId: "r",
        datasetId: "d",
        status: "SUCCEEDED",
        items: [
          { name: "One", website: "https://one.example" },
          { name: "Two", website: "https://two.example" },
          { name: "Three", website: "https://three.example" },
        ],
      }),
    } as unknown as ApifyClient;

    const summary = await runLeadFinding(db, project.id, {
      apifyClient: client,
    });
    expect(summary.kept).toBe(1);
    expect(listLeads(db, project.id)).toHaveLength(1);
    db.close();
  });

  it("errors clearly when APIFY_TOKEN missing and apify jobs configured", async () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, {
      name: "NoToken",
      sourceConfig: JSON.stringify({
        leadFinding: {
          sources: [
            {
              id: "maps",
              type: "apify",
              actorId: "a/b",
              mapping: { companyField: "n", websiteField: "w" },
            },
          ],
        },
      }),
    });

    await expect(
      runLeadFinding(db, project.id, { env: {} })
    ).rejects.toThrow(/APIFY_TOKEN/);
    db.close();
  });
});
