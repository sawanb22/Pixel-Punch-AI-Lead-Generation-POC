import { describe, it, expect } from "vitest";
import {
  LeadPlanSchema,
  parseLeadPlan,
  defaultAgencyLeadPlan,
  VOLUME_STEPS,
  clampVolumeTarget,
} from "../../src/discovery/lead-plan.js";
import { openDatabase } from "../../src/db/database.js";
import {
  createProject,
  getProject,
  updateProject,
} from "../../src/projects/projects.repo.js";

describe("lead-plan", () => {
  it("validates agency lead plan shape", () => {
    const plan = defaultAgencyLeadPlan({
      name: "Pixel Punch",
      icp: "We build AI integrations and websites for SMBs",
      geography: "US",
      volumeTarget: 100,
    });
    expect(LeadPlanSchema.parse(plan).mode).toBe("agency");
    expect(plan.intents.length).toBeGreaterThan(0);
    expect(plan.searchAngles.length).toBeGreaterThan(0);
    expect(plan.volumeTarget).toBe(100);
  });

  it("clamps volume to allowed steps up to 2000", () => {
    expect(VOLUME_STEPS).toContain(2000);
    expect(clampVolumeTarget(180)).toBe(250);
    expect(clampVolumeTarget(5000)).toBe(2000);
    expect(clampVolumeTarget(10)).toBe(25);
  });

  it("parseLeadPlan returns null for invalid JSON", () => {
    expect(parseLeadPlan(null)).toBeNull();
    expect(parseLeadPlan("{")).toBeNull();
  });
});

describe("projects.leadPlan persistence", () => {
  it("stores and updates lead_plan on projects", () => {
    const db = openDatabase(":memory:");
    const plan = defaultAgencyLeadPlan({
      name: "Pixel Punch",
      icp: "AI agents for local businesses",
      volumeTarget: 250,
    });
    const created = createProject(db, {
      name: "Pixel Punch",
      icp: "AI agents for local businesses",
      leadPlan: JSON.stringify(plan),
    });
    expect(created.leadPlan).toBeTruthy();
    expect(parseLeadPlan(created.leadPlan)?.volumeTarget).toBe(250);

    const updated = updateProject(db, created.id, {
      leadPlan: JSON.stringify({ ...plan, volumeTarget: 1000, status: "approved" }),
    });
    expect(parseLeadPlan(updated!.leadPlan)?.volumeTarget).toBe(1000);
    expect(parseLeadPlan(getProject(db, created.id)!.leadPlan)?.status).toBe(
      "approved"
    );
    db.close();
  });
});
