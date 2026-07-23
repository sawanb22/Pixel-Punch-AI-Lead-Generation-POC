import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { createProject } from "../../src/projects/projects.repo.js";
import { insertLeads, listGatedLeads } from "../../src/leads/leads.repo.js";
import { createLeadList } from "../../src/leads/lead-lists.repo.js";
import { recordFeedback, getFeedbackStats } from "../../src/feedback/feedback.repo.js";

describe("feedback.repo", () => {
  it("records feedback and returns stats", () => {
    const db = openDatabase(":memory:");
    const p = createProject(db, { name: "P1" });
    insertLeads(db, p.id, [
      { company: "A", website: "a.com", canonicalDomain: "a.com", email: "a@a.com", votes: null, source: "csv", sources: ["csv"] },
      { company: "B", website: "b.com", canonicalDomain: "b.com", email: "b@b.com", votes: null, source: "csv", sources: ["csv"] },
    ]);
    const leads = listGatedLeads(db, p.id);
    recordFeedback(db, {
      projectId: p.id,
      leadId: leads[0].id,
      good: true,
      notes: "Great fit",
      reviewedBy: "alice@x.com",
      source: "dashboard",
    });
    recordFeedback(db, {
      projectId: p.id,
      leadId: leads[1].id,
      good: false,
      notes: "Wrong niche",
      reviewedBy: "bob@x.com",
      source: "telegram",
    });
    const stats = getFeedbackStats(db, p.id);
    expect(stats.total).toBe(2);
    expect(stats.good).toBe(1);
    expect(stats.bad).toBe(1);
    expect(stats.approvalRate).toBeCloseTo(0.5);
    db.close();
  });

  it("getFeedbackStats filters by lead list when leadListId provided", () => {
    const db = openDatabase(":memory:");
    const p = createProject(db, { name: "P1" });
    const listA = createLeadList(db, { projectId: p.id, name: "List A" });
    const listB = createLeadList(db, { projectId: p.id, name: "List B" });
    insertLeads(
      db,
      p.id,
      [
        {
          company: "A",
          website: "a.com",
          canonicalDomain: "a.com",
          email: "a@a.com",
          votes: null,
          source: "csv",
          sources: ["csv"],
        },
      ],
      listA.id
    );
    insertLeads(
      db,
      p.id,
      [
        {
          company: "B",
          website: "b.com",
          canonicalDomain: "b.com",
          email: "b@b.com",
          votes: null,
          source: "csv",
          sources: ["csv"],
        },
        {
          company: "C",
          website: "c.com",
          canonicalDomain: "c.com",
          email: "c@c.com",
          votes: null,
          source: "csv",
          sources: ["csv"],
        },
      ],
      listB.id
    );
    const leadsA = listGatedLeads(db, p.id, listA.id);
    const leadsB = listGatedLeads(db, p.id, listB.id);
    recordFeedback(db, {
      projectId: p.id,
      leadId: leadsA[0].id,
      leadListId: listA.id,
      good: true,
      notes: null,
      reviewedBy: "alice",
      source: "dashboard",
    });
    recordFeedback(db, {
      projectId: p.id,
      leadId: leadsB[0].id,
      leadListId: listB.id,
      good: false,
      notes: null,
      reviewedBy: "bob",
      source: "dashboard",
    });
    recordFeedback(db, {
      projectId: p.id,
      leadId: leadsB[1].id,
      leadListId: listB.id,
      good: false,
      notes: null,
      reviewedBy: "bob",
      source: "dashboard",
    });

    expect(getFeedbackStats(db, p.id, listA.id).approvalRate).toBe(1);
    expect(getFeedbackStats(db, p.id, listB.id).approvalRate).toBe(0);
    expect(getFeedbackStats(db, p.id).approvalRate).toBeCloseTo(1 / 3);
    db.close();
  });

  it("rejects feedback for lead in another project", () => {
    const db = openDatabase(":memory:");
    const p1 = createProject(db, { name: "P1" });
    const p2 = createProject(db, { name: "P2" });
    insertLeads(db, p1.id, [
      { company: "A", website: "a.com", canonicalDomain: "a.com", email: null, votes: null, source: "csv", sources: ["csv"] },
    ]);
    const [lead] = listGatedLeads(db, p1.id);
    expect(() =>
      recordFeedback(db, {
        projectId: p2.id,
        leadId: lead.id,
        good: true,
        notes: null,
        reviewedBy: "x",
        source: "dashboard",
      })
    ).toThrow(/not found|project/i);
    db.close();
  });
});
