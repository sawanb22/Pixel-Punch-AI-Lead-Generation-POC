import { describe, it, expect, vi } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { createProject } from "../../src/projects/projects.repo.js";
import {
  createLeadList,
  activateLeadList,
  getLeadListPlan,
  getLeadListPayloadJson,
} from "../../src/leads/lead-lists.repo.js";
import {
  ensureLeadPlan,
  runOneClickLeadFinding,
} from "../../src/discovery/one-click-lead-finding.js";
import type { ApifyClient } from "../../src/discovery/apify-client.js";
import { HermesLeadPlanner } from "../../src/discovery/hermes-lead-planner.js";
import { defaultStrategicPayload } from "../../src/discovery/strategic-payload.js";

describe("runOneClickLeadFinding", () => {
  it("generates a plan and runs Apify-only discovery without source JSON", async () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, {
      name: "Pixel Punch",
      icp: "We build AI agents and websites for SMBs",
    });

    const client = {
      runActorAndGetItems: vi.fn().mockResolvedValue({
        runId: "r1",
        datasetId: "d1",
        status: "SUCCEEDED",
        items: [
          { title: "Acme Shop", website: "https://acme.example", url: "https://acme.example" },
          {
            title: "Beta Co",
            website: "https://beta.example",
            url: "https://maps/1",
          },
        ],
      }),
    } as unknown as ApifyClient;

    const planner = {
      generateStrategicPayload: vi.fn().mockImplementation(async (input) => ({
        payload: defaultStrategicPayload({
          ...input,
          enabledActorKeys: ["google_maps"],
        }),
        raw: { version: 1 },
        fromFallback: false,
        plannerInput: { name: input.name },
      })),
      generatePlan: vi.fn(),
    } as unknown as HermesLeadPlanner;

    const summary = await runOneClickLeadFinding(db, project.id, {
      apifyClient: client,
      planner,
      env: { APIFY_TOKEN: "tok" },
    });

    expect(summary.kept).toBeGreaterThanOrEqual(1);
    expect(summary.plan.status).toBe("auto");
    expect(client.runActorAndGetItems).toHaveBeenCalled();
    expect(planner.generateStrategicPayload).toHaveBeenCalled();

    // Second run with ready plan should lock and not call Hermes again
    vi.mocked(planner.generateStrategicPayload).mockClear();
    vi.mocked(client.runActorAndGetItems).mockClear();
    const locked = await runOneClickLeadFinding(db, project.id, {
      apifyClient: client,
      planner,
      env: { APIFY_TOKEN: "tok" },
    });
    expect(locked.usedLockedPlan).toBe(true);
    expect(planner.generateStrategicPayload).not.toHaveBeenCalled();
    expect(client.runActorAndGetItems).toHaveBeenCalled();

    // Force replan regenerates with revision brief from last completed run
    vi.mocked(planner.generateStrategicPayload).mockClear();
    const forced = await runOneClickLeadFinding(db, project.id, {
      apifyClient: client,
      planner,
      env: { APIFY_TOKEN: "tok" },
      forceReplan: true,
    });
    expect(forced.usedLockedPlan).toBe(false);
    expect(forced.usedRevisionBrief).toBe(true);
    expect(planner.generateStrategicPayload).toHaveBeenCalled();
    const forcedCtx = vi.mocked(planner.generateStrategicPayload).mock
      .calls[0][0] as { revisionBrief?: { runId: number } | null };
    expect(forcedCtx.revisionBrief?.runId).toBeGreaterThan(0);

    db.close();
  });

  it("force replan without prior completed run does not attach revision brief", async () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, {
      name: "Pixel Punch",
      icp: "We build AI agents and websites for SMBs",
    });

    const client = {
      runActorAndGetItems: vi.fn().mockResolvedValue({
        runId: "r1",
        datasetId: "d1",
        status: "SUCCEEDED",
        items: [
          { title: "Acme Shop", website: "https://acme.example", url: "https://acme.example" },
        ],
      }),
    } as unknown as ApifyClient;

    const planner = {
      generateStrategicPayload: vi.fn().mockImplementation(async (input) => ({
        payload: defaultStrategicPayload({
          ...input,
          enabledActorKeys: ["google_maps"],
        }),
        raw: { version: 1 },
        fromFallback: false,
        plannerInput: { name: input.name },
      })),
      generatePlan: vi.fn(),
    } as unknown as HermesLeadPlanner;

    await ensureLeadPlan(db, project, { planner });

    const forced = await runOneClickLeadFinding(db, project.id, {
      apifyClient: client,
      planner,
      env: { APIFY_TOKEN: "tok" },
      forceReplan: true,
    });

    expect(forced.usedRevisionBrief).toBe(false);
    const ctx = vi.mocked(planner.generateStrategicPayload).mock.calls.at(-1)?.[0] as {
      revisionBrief?: unknown;
    };
    expect(ctx.revisionBrief).toBeFalsy();

    db.close();
  });
});

describe("ensureLeadPlan", () => {
  it("stores separate plans per lead list", async () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, {
      name: "Pixel Punch",
      icp: "We build AI agents and websites for SMBs",
    });
    const listA = createLeadList(db, {
      projectId: project.id,
      name: "mobile app build leads",
      description: "funded startups",
    });
    const listB = createLeadList(db, {
      projectId: project.id,
      name: "fintech SMB leads",
      description: "payment integrations",
    });

    const planner = {
      generateStrategicPayload: vi.fn().mockImplementation(async (input) => ({
        payload: defaultStrategicPayload(input),
        raw: null,
        fromFallback: true,
        plannerInput: input,
      })),
      generatePlan: vi.fn(),
    } as unknown as HermesLeadPlanner;

    const planA = await ensureLeadPlan(db, project, {
      leadListId: listA.id,
      forceRegenerate: true,
      planner,
    });
    expect(planA.plan.goal).toContain("mobile app build leads");

    const planB = await ensureLeadPlan(db, project, {
      leadListId: listB.id,
      forceRegenerate: true,
      planner,
    });
    expect(planB.plan.goal).toContain("fintech SMB leads");

    expect(getLeadListPlan(db, listA.id)?.goal).toContain("mobile app build leads");
    expect(getLeadListPlan(db, listB.id)?.goal).toContain("fintech SMB leads");
    expect(getLeadListPayloadJson(db, listA.id)).toBeTruthy();

    activateLeadList(db, project.id, listA.id);
    const activePlan = getLeadListPlan(db, listA.id);
    expect(activePlan?.goal).toContain("mobile app build leads");
    expect(activePlan?.goal).not.toContain("fintech SMB leads");

    db.close();
  });
});
