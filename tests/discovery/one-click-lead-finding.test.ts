import { describe, it, expect, vi } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { createProject } from "../../src/projects/projects.repo.js";
import { runOneClickLeadFinding } from "../../src/discovery/one-click-lead-finding.js";
import { parseLeadPlan } from "../../src/discovery/lead-plan.js";
import type { ApifyClient } from "../../src/discovery/apify-client.js";
import { HermesLeadPlanner } from "../../src/discovery/hermes-lead-planner.js";

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
          { title: "Acme Shop", url: "https://acme.example" },
          { title: "Beta Co", website: "https://beta.example", url: "https://maps/1" },
        ],
      }),
    } as unknown as ApifyClient;

    const planner = {
      generatePlan: vi.fn().mockImplementation(async () => ({
        plan: parseLeadPlan(
          JSON.stringify({
            version: 1,
            mode: "agency",
            goal: "Find SMBs needing AI",
            geography: "Austin",
            volumeTarget: 50,
            intents: ["needs_website", "needs_ai_agent", "local_smb_digital"],
            searchAngles: ["SMB needs website Austin", "AI chatbot for restaurant"],
            negatives: ["directories"],
            status: "draft",
            generatedBy: "hermes",
            updatedAt: new Date().toISOString(),
          })
        )!,
        fromFallback: false,
      })),
    } as unknown as HermesLeadPlanner;

    const summary = await runOneClickLeadFinding(db, project.id, {
      apifyClient: client,
      planner,
      env: { APIFY_TOKEN: "tok" },
    });

    expect(summary.kept).toBeGreaterThanOrEqual(1);
    expect(summary.plan.status).toBe("auto");
    expect(client.runActorAndGetItems).toHaveBeenCalled();
    expect(planner.generatePlan).toHaveBeenCalled();
    db.close();
  });
});
