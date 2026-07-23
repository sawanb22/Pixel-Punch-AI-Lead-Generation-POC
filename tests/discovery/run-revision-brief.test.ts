import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { createProject } from "../../src/projects/projects.repo.js";
import { getActiveLeadListId } from "../../src/leads/lead-lists.repo.js";
import {
  createDiscoveryRun,
  insertDiscoveredCandidates,
  updateDiscoveryRun,
} from "../../src/discovery/discovery.repo.js";
import {
  BRIEF_MAX_CHARS,
  buildRunRevisionBrief,
  formatRevisionBriefForPrompt,
  summarizeJobInput,
} from "../../src/discovery/run-revision-brief.js";

describe("summarizeJobInput", () => {
  it("extracts search strings and truncates", () => {
    const s = summarizeJobInput({
      searchStringsArray: ["dentist Austin", "dentist Chicago", "x".repeat(200)],
    });
    expect(s).toContain("dentist Austin");
    expect(s.length).toBeLessThanOrEqual(120);
  });
});

describe("buildRunRevisionBrief", () => {
  it("returns null when no completed run exists", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, { name: "P" });
    const listId = getActiveLeadListId(db, project.id);
    expect(buildRunRevisionBrief(db, project.id, listId)).toBeNull();
    db.close();
  });

  it("builds lean brief from latest completed run", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, { name: "P", icp: "dentists" });
    const listId = getActiveLeadListId(db, project.id);

    const payload = {
      version: 1,
      goal: "find dentists",
      geography: "Austin",
      volumeTarget: 25,
      negatives: [],
      jobs: [
        {
          jobId: "maps-1",
          actorKey: "google_maps",
          reasoning: "local",
          apifyInput: {
            searchStringsArray: ["dentist Austin", "dentist Round Rock"],
          },
        },
        {
          jobId: "search-1",
          actorKey: "google_search",
          reasoning: "web",
          apifyInput: { queries: "best dentist austin blog" },
        },
      ],
    };

    const run = createDiscoveryRun(db, {
      projectId: project.id,
      leadListId: listId,
      status: "completed",
      payloadJson: JSON.stringify(payload),
      validationNotes: "provisional=3; circuit_breaker: junk_ratio=0.7",
    });
    updateDiscoveryRun(db, run.id, {
      fetchedCount: 100,
      keptCount: 12,
      rejectedCount: 80,
      duplicateCount: 5,
      finishedAt: new Date().toISOString(),
      status: "completed",
      validationNotes: "provisional=3; circuit_breaker: junk_ratio=0.7",
    });

    insertDiscoveredCandidates(db, [
      {
        runId: run.id,
        sourceJobId: null,
        company: "A",
        website: "https://a.example",
        domain: "a.example",
        source: "maps",
        sourceType: "apify",
        sourceUrl: null,
        discoveryQuery: null,
        rawPayload: {},
        confidence: 1,
        kept: false,
        rejectionReason: "vendor_media_host",
      },
      {
        runId: run.id,
        sourceJobId: null,
        company: "B",
        website: "https://b.example",
        domain: "b.example",
        source: "maps",
        sourceType: "apify",
        sourceUrl: null,
        discoveryQuery: null,
        rawPayload: {},
        confidence: 1,
        kept: false,
        rejectionReason: "vendor_media_host",
      },
      {
        runId: run.id,
        sourceJobId: null,
        company: "C",
        website: "https://c.example",
        domain: "c.example",
        source: "search",
        sourceType: "apify",
        sourceUrl: null,
        discoveryQuery: null,
        rawPayload: {},
        confidence: 0.2,
        kept: false,
        rejectionReason: "buyer_gate:low_score",
      },
      {
        runId: run.id,
        sourceJobId: null,
        company: "D",
        website: "https://d.example",
        domain: "d.example",
        source: "maps",
        sourceType: "apify",
        sourceUrl: null,
        discoveryQuery: null,
        rawPayload: {},
        confidence: 0.5,
        kept: true,
        rejectionReason: "provisional",
      },
    ]);

    const brief = buildRunRevisionBrief(db, project.id, listId);
    expect(brief).not.toBeNull();
    expect(brief!.runId).toBe(run.id);
    expect(brief!.previousJobs.length).toBe(2);
    expect(brief!.previousJobs[0].actorKey).toBe("google_maps");
    expect(brief!.previousJobs[0].inputSummary).toContain("dentist Austin");
    expect(brief!.stats.fetched).toBe(100);
    expect(brief!.stats.kept).toBe(12);
    expect(brief!.stats.rejected).toBe(80);
    expect(brief!.stats.duplicates).toBe(5);
    expect(brief!.stats.provisional).toBe(3);
    expect(brief!.stats.circuitBreaker).toBe(true);
    expect(brief!.rejectionMix[0]).toEqual({
      reason: "vendor_media_host",
      count: 2,
    });

    const formatted = formatRevisionBriefForPrompt(brief!);
    expect(formatted).toContain("REVISION BRIEF");
    expect(formatted).toContain("google_maps");
    expect(formatted.length).toBeLessThanOrEqual(BRIEF_MAX_CHARS);
    db.close();
  });

  it("skips non-completed latest run and uses prior completed", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, { name: "P2" });
    const listId = getActiveLeadListId(db, project.id);

    const done = createDiscoveryRun(db, {
      projectId: project.id,
      leadListId: listId,
      status: "completed",
      payloadJson: JSON.stringify({
        version: 1,
        goal: "g",
        geography: null,
        volumeTarget: 25,
        negatives: [],
        jobs: [
          {
            jobId: "j1",
            actorKey: "google_maps",
            reasoning: "r",
            apifyInput: { searchStringsArray: ["cafe Austin"] },
          },
        ],
      }),
    });
    updateDiscoveryRun(db, done.id, {
      status: "completed",
      fetchedCount: 10,
      keptCount: 4,
      rejectedCount: 2,
      duplicateCount: 0,
      finishedAt: new Date().toISOString(),
    });

    createDiscoveryRun(db, {
      projectId: project.id,
      leadListId: listId,
      status: "running",
    });

    const brief = buildRunRevisionBrief(db, project.id, listId);
    expect(brief?.runId).toBe(done.id);
    db.close();
  });
});
