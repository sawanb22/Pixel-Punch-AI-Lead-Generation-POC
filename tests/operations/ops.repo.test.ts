import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { createProject } from "../../src/projects/projects.repo.js";
import {
  createOpsRun,
  addLogToRun,
  completeOpsRun,
  updateOpsRunProgress,
  listOpsRuns,
  getOpsRun,
  listLogsForRun,
} from "../../src/operations/ops.repo.js";

describe("operations.repo", () => {
  it("manages operations runs and logs correctly", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, { name: "Test Project" });

    // 1. Create a run
    const run = createOpsRun(db, {
      projectId: project.id,
      runType: "enrichment",
      status: "running",
      progressInfo: "0/5 processed",
    });

    expect(run.id).toBeGreaterThan(0);
    expect(run.runType).toBe("enrichment");
    expect(run.status).toBe("running");
    expect(run.progressInfo).toBe("0/5 processed");

    // 2. Add logs
    addLogToRun(db, {
      runId: run.id,
      message: "Starting company scraper",
      level: "info",
    });
    addLogToRun(db, {
      runId: run.id,
      message: "API rate limit warning",
      level: "warning",
    });

    const logs = listLogsForRun(db, run.id);
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe("Starting company scraper");
    expect(logs[0].level).toBe("info");
    expect(logs[1].level).toBe("warning");

    // 3. Update progress
    updateOpsRunProgress(db, run.id, "3/5 processed");
    const updated = getOpsRun(db, run.id);
    expect(updated?.progressInfo).toBe("3/5 processed");

    // 4. List runs with filters
    const allRuns = listOpsRuns(db, project.id, "all");
    expect(allRuns).toHaveLength(1);
    expect(allRuns[0].runType).toBe("enrichment");

    const contactRuns = listOpsRuns(db, project.id, "contacts");
    expect(contactRuns).toHaveLength(0);

    // 5. Complete the run
    completeOpsRun(db, run.id);
    const finished = getOpsRun(db, run.id);
    expect(finished?.status).toBe("completed");
    expect(finished?.finishedAt).not.toBeNull();

    db.close();
  });
});
