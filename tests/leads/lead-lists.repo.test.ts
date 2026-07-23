import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { createProject } from "../../src/projects/projects.repo.js";
import {
  createLeadList,
  getLeadListPlan,
  getLeadListPayloadJson,
  updateLeadListPlan,
  saveLeadListPlanArtifacts,
  deriveListFocus,
} from "../../src/leads/lead-lists.repo.js";
import {
  serializeLeadPlan,
  defaultAgencyLeadPlan,
} from "../../src/discovery/lead-plan.js";
import { serializeStrategicPayload } from "../../src/discovery/strategic-payload.js";
import { defaultStrategicPayload } from "../../src/discovery/strategic-payload.js";

describe("lead-lists.repo plan storage", () => {
  it("getLeadListPlan returns null when list has no plan", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, { name: "Co" });
    const list = createLeadList(db, {
      projectId: project.id,
      name: "Mobile apps",
      description: "Startups needing apps",
    });
    expect(getLeadListPlan(db, list.id)).toBeNull();
    db.close();
  });

  it("updateLeadListPlan stores and retrieves plan JSON", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, { name: "Co" });
    const list = createLeadList(db, {
      projectId: project.id,
      name: "Mobile apps",
    });
    const plan = defaultAgencyLeadPlan({
      name: project.name,
      icp: "mobile app builds only",
    });
    updateLeadListPlan(db, list.id, serializeLeadPlan(plan));
    const loaded = getLeadListPlan(db, list.id);
    expect(loaded?.goal).toBe(plan.goal);
    db.close();
  });

  it("deriveListFocus combines name and description", () => {
    expect(
      deriveListFocus({
        name: "mobile app build leads",
        description: "funded startups",
      })
    ).toBe("mobile app build leads — funded startups");
    expect(deriveListFocus({ name: "NFT list", description: null })).toBe(
      "NFT list"
    );
  });

  it("saveLeadListPlanArtifacts stores payload_json on list", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, { name: "Co" });
    const list = createLeadList(db, {
      projectId: project.id,
      name: "Mobile apps",
    });
    const plan = defaultAgencyLeadPlan({ name: "Co" });
    const payload = defaultStrategicPayload({
      name: "Co",
      enabledActorKeys: ["google_maps"],
      listFocus: "mobile apps",
    });
    saveLeadListPlanArtifacts(db, list.id, {
      leadPlanJson: serializeLeadPlan(plan),
      payloadJson: serializeStrategicPayload(payload),
      compiledJobsJson: "[]",
    });
    expect(getLeadListPlan(db, list.id)?.goal).toBe(plan.goal);
    expect(getLeadListPayloadJson(db, list.id)).toContain("google_maps");
    db.close();
  });
});
