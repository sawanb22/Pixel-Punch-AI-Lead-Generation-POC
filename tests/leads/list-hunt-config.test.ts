import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import {
  createProject,
  getProject,
  updateProject,
} from "../../src/projects/projects.repo.js";
import {
  createLeadList,
  getLeadList,
  updateLeadListPlan,
} from "../../src/leads/lead-lists.repo.js";
import {
  huntConfigTemplateFromProject,
  mergeListHuntConfig,
  projectDefaultHuntConfig,
  resolveListHuntConfig,
  resolveListPlan,
  serializeListHuntConfig,
} from "../../src/leads/list-hunt-config.js";
import {
  defaultAgencyLeadPlan,
  serializeLeadPlan,
} from "../../src/discovery/lead-plan.js";
import {
  serializeLeadStrategy,
  defaultLeadStrategy,
} from "../../src/discovery/lead-strategy.js";
import { leadPlanResponseForList } from "../../src/discovery/lead-plan-response.js";

function defaultListId(db: ReturnType<typeof openDatabase>, projectId: number) {
  const row = db
    .prepare(
      `SELECT id FROM lead_lists WHERE project_id = ? AND name = 'Default' LIMIT 1`
    )
    .get(projectId) as { id: number };
  return row.id;
}

describe("list-hunt-config", () => {
  it("Default list merges project defaults with list overrides", () => {
    const db = openDatabase(":memory:");
    createProject(db, { name: "Co", icp: "agency" });
    const project = getProject(db, 1)!;
    updateProject(db, project.id, {
      leadStrategy: serializeLeadStrategy(
        defaultLeadStrategy({
          enabledActorKeys: ["google_maps", "google_search"],
          defaultGeography: "USA",
        })
      ),
      leadPlan: serializeLeadPlan(
        defaultAgencyLeadPlan({
          name: "Co",
          geography: "USA",
          volumeTarget: 100,
        })
      ),
    });
    const fullProject = getProject(db, project.id)!;

    const defaults = projectDefaultHuntConfig(fullProject);
    expect(defaults.geography).toBe("USA");
    expect(defaults.volumeTarget).toBe(100);
    expect(defaults.enabledActorKeys).toEqual([
      "google_maps",
      "google_search",
    ]);

    const resolvedDefault = resolveListHuntConfig(fullProject, {
      name: "Default",
      huntConfigRaw: serializeListHuntConfig({ geography: "DACH" }),
    });
    expect(resolvedDefault.geography).toBe("DACH");
    expect(resolvedDefault.enabledActorKeys).toEqual([
      "google_maps",
      "google_search",
    ]);

    const resolvedOther = resolveListHuntConfig(fullProject, {
      name: "fintech list",
      huntConfigRaw: serializeListHuntConfig({
        geography: "UK",
        volumeTarget: 50,
        enabledActorKeys: ["wellfound_startups"],
      }),
    });
    expect(resolvedOther.geography).toBe("UK");
    expect(resolvedOther.volumeTarget).toBe(50);
    expect(resolvedOther.enabledActorKeys).toEqual(["wellfound_startups"]);
    db.close();
  });

  it("resolveListPlan returns null for non-default list without plan", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, { name: "Co" });
    const list = createLeadList(db, {
      projectId: project.id,
      name: "mobile apps",
    });
    const plan = defaultAgencyLeadPlan({ name: "Co" });
    updateProject(db, project.id, {
      leadPlan: serializeLeadPlan(plan),
    });
    const refreshed = getProject(db, project.id)!;

    expect(resolveListPlan(db, refreshed, list.id, list.name)).toBeNull();
    expect(
      resolveListPlan(db, refreshed, defaultListId(db, project.id), "Default")
    ).not.toBeNull();
    db.close();
  });

  it("huntConfigTemplateFromProject seeds new lists", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, { name: "Co" });
    updateProject(db, project.id, {
      leadStrategy: serializeLeadStrategy(
        defaultLeadStrategy({ enabledActorKeys: ["linkedin_jobs"] })
      ),
    });
    const full = getProject(db, project.id)!;
    const template = huntConfigTemplateFromProject(full);
    expect(template.enabledActorKeys).toEqual(["linkedin_jobs"]);
    db.close();
  });

  it("mergeListHuntConfig patches stored config", () => {
    const merged = mergeListHuntConfig(
      serializeListHuntConfig({ geography: "USA", volumeTarget: 100 }),
      { volumeTarget: 250 }
    );
    expect(JSON.parse(merged).volumeTarget).toBe(250);
    expect(JSON.parse(merged).geography).toBe("USA");
  });

  it("leadPlanResponseForList does not bleed project plan to other lists", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, { name: "Co", icp: "agency" });
    const defaultList = getLeadList(db, defaultListId(db, project.id))!;
    const other = createLeadList(db, {
      projectId: project.id,
      name: "verify list",
      description: "smoke",
    });
    const projectPlan = defaultAgencyLeadPlan({ name: "Co", icp: "agency" });
    updateLeadListPlan(db, defaultList.id, serializeLeadPlan(projectPlan));
    const refreshed = getProject(db, project.id)!;

    const otherView = leadPlanResponseForList(db, refreshed, other.id);
    expect(otherView?.plan).toBeNull();

    const defaultView = leadPlanResponseForList(db, refreshed, defaultList.id);
    expect(defaultView?.plan?.goal).toBe(projectPlan.goal);
    db.close();
  });
});
