import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type DB } from "../../src/db/database.js";
import { createApp } from "../../src/dashboard/app.js";
import { MockScorer } from "../../src/scoring/mock-scorer.js";
import { insertLeads, listLeads, listGatedLeads } from "../../src/leads/leads.repo.js";
import { createProject, getProject } from "../../src/projects/projects.repo.js";
import { getActiveLeadListId, listLeadLists } from "../../src/leads/lead-lists.repo.js";
import { isAllowlisted } from "../../src/users/users.repo.js";
import { resetDefaultFeedbackRag, recordFeedback } from "../../src/feedback/feedback.repo.js";
import { defaultAgencyLeadPlan } from "../../src/discovery/lead-plan.js";
import { defaultStrategicPayload } from "../../src/discovery/strategic-payload.js";
import type { HermesLeadPlanner } from "../../src/discovery/hermes-lead-planner.js";

const mockLeadPlanner = {
  async generatePlan(input) {
    return {
      plan: defaultAgencyLeadPlan(input),
      fromFallback: true,
    };
  },
  async generateStrategicPayload(input) {
    const payload = defaultStrategicPayload(input);
    if (input.listFocus) {
      payload.goal = `List plan: ${input.listFocus}`;
    }
    return {
      payload,
      raw: null,
      fromFallback: true,
      plannerInput: {
        name: input.name,
        enabledActorKeys: input.enabledActorKeys,
        listFocus: input.listFocus ?? null,
      },
    };
  },
} as Pick<
  HermesLeadPlanner,
  "generatePlan" | "generateStrategicPayload"
> as HermesLeadPlanner;

describe("dashboard API", () => {
  let db: DB;
  let prevBypass: string | undefined;
  let prevRagSync: string | undefined;
  let prevRagDir: string | undefined;
  let ragDir: string;

  beforeEach(() => {
    prevBypass = process.env.LEADRADAR_AUTH_BYPASS;
    prevRagSync = process.env.RAG_SYNC;
    prevRagDir = process.env.RAG_DIR;
    process.env.LEADRADAR_AUTH_BYPASS = "1";
    ragDir = mkdtempSync(join(tmpdir(), "leadradar-dash-rag-"));
    process.env.RAG_DIR = ragDir;
    process.env.RAG_SYNC = "1";
    resetDefaultFeedbackRag();
    db = openDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
    if (prevBypass === undefined) delete process.env.LEADRADAR_AUTH_BYPASS;
    else process.env.LEADRADAR_AUTH_BYPASS = prevBypass;
    if (prevRagSync === undefined) delete process.env.RAG_SYNC;
    else process.env.RAG_SYNC = prevRagSync;
    if (prevRagDir === undefined) delete process.env.RAG_DIR;
    else process.env.RAG_DIR = prevRagDir;
    resetDefaultFeedbackRag();
    rmSync(ragDir, { recursive: true, force: true });
  });

  function app() {
    return createApp({
      db,
      scorer: new MockScorer(),
      leadPlanner: mockLeadPlanner,
      allowlist: ["dev@local"],
      mxResolver: async () => [{ exchange: "mx.test", priority: 10 }],
    });
  }

  it("health is public", async () => {
    const res = await request(app()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.bypass).toBe(true);
  });

  it("returns me under bypass", async () => {
    const res = await request(app()).get("/api/me");
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("dev@local");
  });

  it("rejects unauthenticated API when bypass off", async () => {
    delete process.env.LEADRADAR_AUTH_BYPASS;
    const res = await request(
      createApp({ db, scorer: new MockScorer(), allowlist: [] })
    ).get("/api/me");
    expect(res.status).toBe(401);
  });

  it("create project → import → list → score → approve → export", async () => {
    const agent = request(app());

    const created = await agent
      .post("/api/projects")
      .send({ name: "Pixel Punch", icp: "software" });
    expect(created.status).toBe(201);
    const projectId = created.body.id as number;

    const csv = [
      "Company,Website,Email,Votes",
      "Acme Soft,https://acme.com,hello@acme.com,20",
      "Beta Co,https://beta.com,team@beta.com,4",
    ].join("\n");

    const imported = await agent
      .post(`/api/projects/${projectId}/import.csv`)
      .send({ csv });
    expect(imported.status).toBe(201);
    expect(imported.body.kept).toBeGreaterThanOrEqual(1);

    const listed = await agent.get(`/api/projects/${projectId}/leads`);
    expect(listed.status).toBe(200);
    expect(listed.body.length).toBeGreaterThanOrEqual(1);

    const scored = await agent.post(`/api/projects/${projectId}/score`);
    expect(scored.status).toBe(200);
    expect(scored.body.scored).toBeGreaterThanOrEqual(1);

    const afterScore = await agent.get(
      `/api/projects/${projectId}/leads?status=scored`
    );
    expect(afterScore.body.length).toBeGreaterThanOrEqual(1);
    const leadId = afterScore.body[0].id as number;

    const approved = await agent
      .post(`/api/projects/${projectId}/leads/${leadId}/approve`)
      .send({ notes: "good fit" });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
    expect(existsSync(join(ragDir, `project_${projectId}`, `lead_${leadId}.md`))).toBe(
      true
    );

    const stats = await agent.get(`/api/projects/${projectId}/stats`);
    expect(stats.status).toBe(200);
    expect(stats.body.totalLeads).toBeGreaterThanOrEqual(1);
    expect(stats.body.approvalRate).toBeGreaterThan(0);
    expect(stats.body.replyRate).toBeNull();

    const exported = await agent.get(
      `/api/projects/${projectId}/export.csv?preset=emails_only`
    );
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toMatch(/text\/csv/);
    expect(exported.text).toContain("company,email,score");
    expect(exported.text).toMatch(/@/);

    const exportedAlias = await agent.get(
      `/api/projects/${projectId}/export.csv?preset=emails`
    );
    expect(exportedAlias.status).toBe(200);
    expect(exportedAlias.text).toContain("company,email,score");
  });

  it("keeps approve/export isolated across projects", async () => {
    const p1 = createProject(db, { name: "P1" });
    const p2 = createProject(db, { name: "P2" });
    insertLeads(db, p1.id, [
      {
        company: "Only P1",
        website: "p1.com",
        canonicalDomain: "p1.com",
        email: "a@p1.com",
        votes: 1,
        source: "csv",
        sources: ["csv"],
      },
    ]);
    const [lead] = listLeads(db, p1.id);

    const agent = request(app());
    const bad = await agent
      .post(`/api/projects/${p2.id}/leads/${lead.id}/approve`)
      .send({});
    expect(bad.status).toBe(404);

    const exportP2 = await agent.get(
      `/api/projects/${p2.id}/export.csv?preset=all`
    );
    expect(exportP2.status).toBe(200);
    expect(exportP2.text).not.toContain("Only P1");
  });

  it("create and PATCH project fields without requiring source JSON", async () => {
    const agent = request(app());
    const created = await agent.post("/api/projects").send({
      name: "Hunt UI",
      website: "https://pixelpunch.example",
      icp: "AI integrations and websites for SMBs",
      geography: "US",
      volumeTarget: 100,
    });
    expect(created.status).toBe(201);
    const projectId = created.body.id as number;
    const initialPlan = await agent.get(`/api/projects/${projectId}/lead-plan`);
    expect(initialPlan.body.plan).toBeTruthy();

    const patched = await agent.patch(`/api/projects/${projectId}`).send({
      icp: "AI agents for restaurants",
      volumeTarget: 250,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.icp).toBe("AI agents for restaurants");
    const planAfter = await agent.get(`/api/projects/${projectId}/lead-plan`);
    expect(planAfter.body.plan.volumeTarget).toBe(250);
  });

  it("ingest returns 400 when APIFY_TOKEN missing for Find leads", async () => {
    const agent = request(
      createApp({
        db,
        scorer: new MockScorer(),
        leadPlanner: mockLeadPlanner,
        allowlist: ["dev@local"],
        ingestEnv: {},
      })
    );
    const created = await agent.post("/api/projects").send({
      name: "No Token",
      icp: "AI websites for SMBs",
    });
    expect(created.status).toBe(201);
    const ingested = await agent.post(
      `/api/projects/${created.body.id}/ingest`
    );
    expect(ingested.status).toBe(400);
    expect(ingested.body.error).toMatch(/APIFY_TOKEN/);
  });

  it("Find leads one-click uses Apify via lead plan without source JSON", async () => {
    const mockClient = {
      runActorAndGetItems: async () => ({
        runId: "run-dash",
        datasetId: "ds-dash",
        status: "SUCCEEDED",
        items: [
          {
            title: "Dash Co",
            website: "https://dash.example",
            url: "https://dash.example",
          },
          {
            title: "Noise",
            website: "https://linkedin.com/company/noise",
            url: "https://linkedin.com/company/noise",
          },
        ],
      }),
    };

    const agent = request(
      createApp({
        db,
        scorer: new MockScorer(),
        leadPlanner: mockLeadPlanner,
        allowlist: ["dev@local"],
        mxResolver: async () => [{ exchange: "mx.test", priority: 10 }],
        apifyClient: mockClient as never,
        ingestEnv: { APIFY_TOKEN: "test" },
      })
    );

    const created = await agent.post("/api/projects").send({
      name: "Apify Project",
      icp: "We build AI agents and websites for local businesses",
      geography: "Austin",
      volumeTarget: 50,
    });
    expect(created.status).toBe(201);
    const projectId = created.body.id as number;
    const initialPlan = await agent.get(`/api/projects/${projectId}/lead-plan`);
    expect(initialPlan.body.plan).toBeTruthy();

    const ingested = await agent.post(
      `/api/projects/${projectId}/ingest`
    );
    expect(ingested.status).toBe(201);
    expect(ingested.body.runId).toBeGreaterThan(0);
    expect(ingested.body.kept).toBeGreaterThanOrEqual(1);
    expect(ingested.body.plan).toBeTruthy();

    const activity = await agent.get(
      `/api/projects/${created.body.id}/discovery/latest`
    );
    expect(activity.status).toBe(200);
    expect(activity.body.run).toBeTruthy();
    expect(activity.body.timeline.length).toBeGreaterThan(0);
  });

  it("POST enrich-companies returns summary and stays project-scoped", async () => {
    const fetchMock = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("robots.txt")) {
        return new Response("User-agent: *\nAllow: /\n", { status: 200 });
      }
      return new Response(
        `<html><head><title>Scoped Co</title><meta name="description" content="desc" /></head>
         <body><a href="mailto:hi@scoped.example">x</a></body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    };

    const agent = request(
      createApp({
        db,
        scorer: new MockScorer(),
        leadPlanner: mockLeadPlanner,
        allowlist: ["dev@local"],
        enrichFetch: fetchMock,
      })
    );

    const p1 = await agent.post("/api/projects").send({ name: "P1" });
    const p2 = await agent.post("/api/projects").send({ name: "P2" });
    expect(p1.status).toBe(201);

    insertLeads(db, p1.body.id, [
      {
        company: "Scoped Co",
        website: "https://scoped.example",
        canonicalDomain: "scoped.example",
        email: null,
        votes: null,
        source: "csv",
        sources: ["csv"],
      },
    ]);
    insertLeads(db, p2.body.id, [
      {
        company: "Other Co",
        website: "https://other.example",
        canonicalDomain: "other.example",
        email: null,
        votes: null,
        source: "csv",
        sources: ["csv"],
      },
    ]);

    const enriched = await agent.post(
      `/api/projects/${p1.body.id}/enrich-companies`
    );
    expect(enriched.status).toBe(201);
    expect(enriched.body.runId).toBeGreaterThan(0);
    expect(enriched.body.companiesEnriched).toBe(1);
    expect(enriched.body.emailsFound).toBeGreaterThanOrEqual(1);

    const missing = await agent.post(`/api/projects/99999/enrich-companies`);
    expect(missing.status).toBe(404);

    const empty = await agent.post(
      `/api/projects/${p2.body.id}/enrich-companies`
    );
    // p2 has a website — should enrich too unless we clear. Use a third empty project.
    const p3 = await agent.post("/api/projects").send({ name: "P3" });
    const noSites = await agent.post(
      `/api/projects/${p3.body.id}/enrich-companies`
    );
    expect(noSites.status).toBe(400);
    expect(noSites.body.error).toMatch(/no eligible/i);

    // Ensure p1 enrichment did not create profile for p2 domain via wrong scope
    const { getCompanyProfile } = await import(
      "../../src/enrichment/enrichment.repo.js"
    );
    expect(getCompanyProfile(db, p1.body.id, "scoped.example")).toBeTruthy();
    expect(getCompanyProfile(db, p1.body.id, "other.example")).toBeUndefined();
  });

  it("lead lists: create, list, activate, clear, delete", async () => {
    const agent = request(app());

    const created = await agent.post("/api/projects").send({
      name: "List Test Co",
      icp: "agency clients",
    });
    expect(created.status).toBe(201);
    const projectId = created.body.id as number;

    const initial = await agent.get(`/api/projects/${projectId}/lead-lists`);
    expect(initial.status).toBe(200);
    expect(initial.body.lists).toHaveLength(1);
    expect(initial.body.activeLeadListId).toBeTruthy();
    const defaultListId = initial.body.activeLeadListId as number;

    insertLeads(db, projectId, [
      {
        company: "Default Co",
        website: "https://default.example",
        canonicalDomain: "default.example",
        email: null,
        votes: null,
        source: "test",
        sources: ["test"],
      },
    ]);

    const createdList = await agent
      .post(`/api/projects/${projectId}/lead-lists`)
      .send({
        name: "mobile app build leads",
        description: "list for mobile apps",
        activate: true,
      });
    expect(createdList.status).toBe(201);
    expect(createdList.body.list.name).toBe("mobile app build leads");
    expect(createdList.body.activeLeadListId).toBe(createdList.body.list.id);

    const afterCreate = await agent.get(`/api/projects/${projectId}/lead-lists`);
    expect(afterCreate.body.lists).toHaveLength(2);

    const listed = await agent.get(`/api/projects/${projectId}/leads`);
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(0);

    await agent
      .post(`/api/projects/${projectId}/lead-lists/${defaultListId}/activate`)
      .send({});
    const switched = await agent.get(`/api/projects/${projectId}/leads`);
    expect(switched.body).toHaveLength(1);

    const cleared = await agent
      .post(`/api/projects/${projectId}/lead-lists/${defaultListId}/clear`)
      .send({});
    expect(cleared.status).toBe(200);
    expect(cleared.body.deletedLeads).toBeGreaterThanOrEqual(1);

    const deleted = await agent.delete(
      `/api/projects/${projectId}/lead-lists/${createdList.body.list.id}`
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.lists).toHaveLength(1);
  });

  it("lead plan is scoped to active lead list", async () => {
    const agent = request(app());

    const created = await agent.post("/api/projects").send({
      name: "Scoped Co",
      icp: "general agency services",
    });
    expect(created.status).toBe(201);
    const projectId = created.body.id as number;

    const mobileList = await agent
      .post(`/api/projects/${projectId}/lead-lists`)
      .send({
        name: "mobile app build leads",
        description: "funded startups needing apps",
        activate: true,
      });
    expect(mobileList.status).toBe(201);
    const mobileListId = mobileList.body.list.id as number;

    const mobilePlan = await agent.post(
      `/api/projects/${projectId}/lead-plan/generate`
    );
    expect(mobilePlan.status).toBe(200);
    expect(mobilePlan.body.leadListId).toBe(mobileListId);
    expect(mobilePlan.body.plan.goal).toContain("mobile app build leads");

    const fintechList = await agent
      .post(`/api/projects/${projectId}/lead-lists`)
      .send({
        name: "fintech SMB leads",
        description: "payment integrations",
        activate: true,
      });
    expect(fintechList.status).toBe(201);

    const fintechPlan = await agent.post(
      `/api/projects/${projectId}/lead-plan/generate`
    );
    expect(fintechPlan.status).toBe(200);
    expect(fintechPlan.body.plan.goal).toContain("fintech SMB leads");

    await agent
      .post(`/api/projects/${projectId}/lead-lists/${mobileListId}/activate`)
      .send({});

    const switched = await agent.get(`/api/projects/${projectId}/lead-plan`);
    expect(switched.status).toBe(200);
    expect(switched.body.leadListId).toBe(mobileListId);
    expect(switched.body.plan.goal).toContain("mobile app build leads");
    expect(switched.body.plan.goal).not.toContain("fintech SMB leads");
  });

  it("GET lead-plan returns Apify jobs after generate", async () => {
    const agent = request(app());
    const created = await agent.post("/api/projects").send({
      name: "Jobs Co",
      icp: "agency builds",
    });
    const projectId = created.body.id as number;

    const generated = await agent.post(
      `/api/projects/${projectId}/lead-plan/generate`
    );
    expect(generated.status).toBe(200);
    expect(Array.isArray(generated.body.jobs)).toBe(true);
    expect(generated.body.jobs.length).toBeGreaterThan(0);
    expect(generated.body.jobs[0].actorLabel).toBeTruthy();
    expect(generated.body.leadListDisplayName).toBe("Project list");

    const fetched = await agent.get(`/api/projects/${projectId}/lead-plan`);
    expect(fetched.body.jobs.length).toBe(generated.body.jobs.length);
  });

  it("PATCH lead list settings updates name and description", async () => {
    const agent = request(app());
    const created = await agent.post("/api/projects").send({ name: "Patch Co" });
    const projectId = created.body.id as number;

    const list = await agent
      .post(`/api/projects/${projectId}/lead-lists`)
      .send({ name: "mobile apps", description: "startups", activate: true });
    const listId = list.body.list.id as number;

    const patched = await agent
      .patch(`/api/projects/${projectId}/lead-lists/${listId}`)
      .send({ name: "mobile app builds", description: "funded startups" });
    expect(patched.status).toBe(200);
    expect(patched.body.list.name).toBe("mobile app builds");
    expect(patched.body.list.description).toBe("funded startups");
  });

  it("GET lead-plan returns null plan for list without its own plan", async () => {
    const agent = request(app());
    const created = await agent.post("/api/projects").send({
      name: "Empty List Co",
      icp: "agency",
    });
    const projectId = created.body.id as number;

    await agent.post(`/api/projects/${projectId}/lead-plan/generate`);
    const lists = await agent.get(`/api/projects/${projectId}/lead-lists`);
    const defaultListId = lists.body.activeLeadListId as number;

    const other = await agent
      .post(`/api/projects/${projectId}/lead-lists`)
      .send({ name: "verify list", description: "smoke", activate: true });
    expect(other.status).toBe(201);

    const planRes = await agent.get(`/api/projects/${projectId}/lead-plan`);
    expect(planRes.status).toBe(200);
    expect(planRes.body.plan).toBeNull();
    expect(planRes.body.resolvedHuntConfig).toBeTruthy();

    await agent
      .post(`/api/projects/${projectId}/lead-lists/${defaultListId}/activate`)
      .send({});
    const defaultPlan = await agent.get(`/api/projects/${projectId}/lead-plan`);
    expect(defaultPlan.body.plan).not.toBeNull();
  });

  it("PATCH project hunt defaults regenerates Default list not active list", async () => {
    const agent = request(app());
    const created = await agent.post("/api/projects").send({
      name: "Default Target Co",
      icp: "agency",
      geography: "USA",
      volumeTarget: 100,
    });
    const projectId = created.body.id as number;

    const lists = await agent.get(`/api/projects/${projectId}/lead-lists`);
    const defaultListId = lists.body.activeLeadListId as number;

    const other = await agent
      .post(`/api/projects/${projectId}/lead-lists`)
      .send({ name: "other list", activate: true });
    const otherListId = other.body.list.id as number;

    await agent.post(`/api/projects/${projectId}/lead-plan/generate`);
    const otherBefore = await agent.get(`/api/projects/${projectId}/lead-plan`);
    expect(otherBefore.body.leadListId).toBe(otherListId);
    const otherGoal = otherBefore.body.plan?.goal;

    await agent.patch(`/api/projects/${projectId}`).send({
      geography: "DACH",
      volumeTarget: 250,
      regeneratePlan: true,
    });

    await agent
      .post(`/api/projects/${projectId}/lead-lists/${otherListId}/activate`)
      .send({});
    const otherAfter = await agent.get(`/api/projects/${projectId}/lead-plan`);
    expect(otherAfter.body.plan?.goal).toBe(otherGoal);

    await agent
      .post(`/api/projects/${projectId}/lead-lists/${defaultListId}/activate`)
      .send({});
    const defaultAfter = await agent.get(`/api/projects/${projectId}/lead-plan`);
    expect(defaultAfter.body.plan).not.toBeNull();
    expect(defaultAfter.body.resolvedHuntConfig.geography).toBe("DACH");
  });

  it("PATCH lead list hunt config updates resolved settings", async () => {
    const agent = request(app());
    const created = await agent.post("/api/projects").send({ name: "List Hunt Co" });
    const projectId = created.body.id as number;

    const list = await agent
      .post(`/api/projects/${projectId}/lead-lists`)
      .send({ name: "niche list", activate: true });
    const listId = list.body.list.id as number;

    const patched = await agent
      .patch(`/api/projects/${projectId}/lead-lists/${listId}`)
      .send({
        geography: "UK",
        volumeTarget: 50,
        enabledActorKeys: ["wellfound_startups"],
      });
    expect(patched.status).toBe(200);
    expect(patched.body.list.resolvedHuntConfig.geography).toBe("UK");
    expect(patched.body.list.resolvedHuntConfig.volumeTarget).toBe(50);
    expect(patched.body.list.resolvedHuntConfig.enabledActorKeys).toEqual([
      "wellfound_startups",
    ]);
  });

  it("plan feedback is isolated per active lead list", async () => {
    const agent = request(app());
    const created = await agent.post("/api/projects").send({
      name: "Feedback Co",
      icp: "agency",
    });
    const projectId = created.body.id as number;

    const initial = await agent.get(`/api/projects/${projectId}/lead-lists`);
    const defaultListId = initial.body.activeLeadListId as number;

    await agent.post(`/api/projects/${projectId}/lead-plan/feedback`).send({
      feedback: "focus on mobile startups",
    });

    const listB = await agent.post(`/api/projects/${projectId}/lead-lists`).send({
      name: "fintech SMB leads",
      description: "payments",
      activate: true,
    });
    expect(listB.status).toBe(201);

    await agent.post(`/api/projects/${projectId}/lead-plan/feedback`).send({
      feedback: "focus on payment integrations only",
    });

    const planB = await agent.get(`/api/projects/${projectId}/lead-plan`);
    expect(planB.body.plan.feedbackNotes).toContain("payment integrations");

    await agent
      .post(`/api/projects/${projectId}/lead-lists/${defaultListId}/activate`)
      .send({});

    const planA = await agent.get(`/api/projects/${projectId}/lead-plan`);
    expect(planA.body.plan.feedbackNotes).toContain("mobile startups");
    expect(planA.body.plan.feedbackNotes).not.toContain("payment integrations");
  });

  it("stats approval rate is scoped to active lead list", async () => {
    const agent = request(app());
    const created = await agent.post("/api/projects").send({ name: "Stats Co" });
    const projectId = created.body.id as number;

    const lists = await agent.get(`/api/projects/${projectId}/lead-lists`);
    const defaultListId = lists.body.activeLeadListId as number;

    const listB = await agent.post(`/api/projects/${projectId}/lead-lists`).send({
      name: "List B",
      activate: false,
    });
    const listBId = listB.body.list.id as number;

    insertLeads(
      db,
      projectId,
      [
        {
          company: "A Co",
          website: "https://a.example",
          canonicalDomain: "a.example",
          email: null,
          votes: null,
          source: "test",
          sources: ["test"],
        },
      ],
      defaultListId
    );
    insertLeads(
      db,
      projectId,
      [
        {
          company: "B Co",
          website: "https://b.example",
          canonicalDomain: "b.example",
          email: null,
          votes: null,
          source: "test",
          sources: ["test"],
        },
        {
          company: "C Co",
          website: "https://c.example",
          canonicalDomain: "c.example",
          email: null,
          votes: null,
          source: "test",
          sources: ["test"],
        },
      ],
      listBId
    );

    const defaultLeads = listGatedLeads(db, projectId, defaultListId);
    const bLeads = listGatedLeads(db, projectId, listBId);
    recordFeedback(db, {
      projectId,
      leadId: defaultLeads[0].id,
      leadListId: defaultListId,
      good: true,
      notes: null,
      reviewedBy: "dev@local",
      source: "dashboard",
    });
    recordFeedback(db, {
      projectId,
      leadId: bLeads[0].id,
      leadListId: listBId,
      good: false,
      notes: null,
      reviewedBy: "dev@local",
      source: "dashboard",
    });
    recordFeedback(db, {
      projectId,
      leadId: bLeads[1].id,
      leadListId: listBId,
      good: false,
      notes: null,
      reviewedBy: "dev@local",
      source: "dashboard",
    });

    const statsDefault = await agent.get(`/api/projects/${projectId}/stats`);
    expect(statsDefault.body.approvalRate).toBe(1);

    await agent
      .post(`/api/projects/${projectId}/lead-lists/${listBId}/activate`)
      .send({});

    const statsB = await agent.get(`/api/projects/${projectId}/stats`);
    expect(statsB.body.approvalRate).toBe(0);
  });

  it("lead lists: returns JSON 404 when project missing", async () => {
    const agent = request(app());
    const res = await agent
      .post("/api/projects/99999/lead-lists")
      .send({ name: "ghost list" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("project not found");
  });

  it("GET /api/version exposes list-scoped API version", async () => {
    const res = await request(app()).get("/api/version");
    expect(res.status).toBe(200);
    expect(res.body.version).toBeGreaterThanOrEqual(2);
    expect(res.body.features).toContain("list-scoped-routes");
  });

  it("list-scoped lead-plan never returns another list plan", async () => {
    const agent = request(app());
    const created = await agent.post("/api/projects").send({
      name: "Scoped Routes Co",
      icp: "agency",
    });
    const projectId = created.body.id as number;
    const lists = await agent.get(`/api/projects/${projectId}/lead-lists`);
    const defaultListId = lists.body.activeLeadListId as number;

    await agent.post(
      `/api/projects/${projectId}/lead-lists/${defaultListId}/lead-plan/generate`
    );

    const other = await agent
      .post(`/api/projects/${projectId}/lead-lists`)
      .send({ name: "verify list", description: "smoke", activate: false });
    const otherListId = other.body.list.id as number;

    const otherPlan = await agent.get(
      `/api/projects/${projectId}/lead-lists/${otherListId}/lead-plan`
    );
    expect(otherPlan.status).toBe(200);
    expect(otherPlan.body.plan).toBeNull();
    expect(otherPlan.body.planState).toBe("none");
    expect(otherPlan.body.leadListId).toBe(otherListId);

    const defaultPlan = await agent.get(
      `/api/projects/${projectId}/lead-lists/${defaultListId}/lead-plan`
    );
    expect(defaultPlan.body.plan).not.toBeNull();
    expect(defaultPlan.body.leadListId).toBe(defaultListId);
  });

  it("PATCH list hunt settings marks only that list stale", async () => {
    const agent = request(app());
    const created = await agent.post("/api/projects").send({
      name: "Stale Co",
      icp: "agency",
    });
    const projectId = created.body.id as number;

    const defaultList = await agent.get(`/api/projects/${projectId}/lead-lists`);
    const defaultListId = defaultList.body.activeLeadListId as number;
    await agent.post(
      `/api/projects/${projectId}/lead-lists/${defaultListId}/lead-plan/generate`
    );

    const other = await agent
      .post(`/api/projects/${projectId}/lead-lists`)
      .send({ name: "niche", activate: false });
    const otherListId = other.body.list.id as number;
    await agent.post(
      `/api/projects/${projectId}/lead-lists/${otherListId}/lead-plan/generate`
    );

    await agent
      .patch(`/api/projects/${projectId}/lead-lists/${otherListId}`)
      .send({ description: "changed focus only for niche" });

    const nichePlan = await agent.get(
      `/api/projects/${projectId}/lead-lists/${otherListId}/lead-plan`
    );
    expect(nichePlan.body.planState).toBe("stale");

    const defaultPlan = await agent.get(
      `/api/projects/${projectId}/lead-lists/${defaultListId}/lead-plan`
    );
    expect(defaultPlan.body.planState).toBe("ready");
  });

  it("Save & regenerate updates only targeted list", async () => {
    const agent = request(app());
    const created = await agent.post("/api/projects").send({
      name: "Regen Co",
      icp: "agency",
    });
    const projectId = created.body.id as number;

    const lists = await agent.get(`/api/projects/${projectId}/lead-lists`);
    const defaultListId = lists.body.activeLeadListId as number;
    await agent.post(
      `/api/projects/${projectId}/lead-lists/${defaultListId}/lead-plan/generate`
    );
    const defaultBefore = await agent.get(
      `/api/projects/${projectId}/lead-lists/${defaultListId}/lead-plan`
    );

    const other = await agent
      .post(`/api/projects/${projectId}/lead-lists`)
      .send({ name: "other", activate: false });
    const otherListId = other.body.list.id as number;

    await agent
      .patch(`/api/projects/${projectId}/lead-lists/${otherListId}`)
      .send({
        description: "new niche",
        regeneratePlan: true,
      });

    const otherPlan = await agent.get(
      `/api/projects/${projectId}/lead-lists/${otherListId}/lead-plan`
    );
    expect(otherPlan.body.plan).not.toBeNull();
    expect(otherPlan.body.planState).toBe("ready");

    const defaultAfter = await agent.get(
      `/api/projects/${projectId}/lead-lists/${defaultListId}/lead-plan`
    );
    expect(defaultAfter.body.plan?.goal).toBe(defaultBefore.body.plan?.goal);
  });

  it("list-scoped ingest rejects when plan is not ready", async () => {
    const agent = request(app());
    const created = await agent.post("/api/projects").send({
      name: "Ingest Gate Co",
      icp: "agency",
    });
    const projectId = created.body.id as number;

    const other = await agent
      .post(`/api/projects/${projectId}/lead-lists`)
      .send({ name: "empty list", activate: false });
    const otherListId = other.body.list.id as number;

    const blocked = await agent.post(
      `/api/projects/${projectId}/lead-lists/${otherListId}/ingest`
    );
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/plan/i);
  });

  it("DELETE /projects/:id removes project and related data", async () => {
    const agent = request(app());
    const project = createProject(db, { name: "To Delete" });
    const listId = getActiveLeadListId(db, project.id);
    insertLeads(
      db,
      project.id,
      [
        {
          company: "Acme Co",
          website: "https://acme.example",
          canonicalDomain: "acme.example",
          email: null,
          votes: 1,
          source: "test",
          sources: ["test"],
        },
      ],
      listId
    );

    expect(listLeads(db, project.id).length).toBe(1);
    expect(listLeadLists(db, project.id).length).toBeGreaterThan(0);

    const del = await agent.delete(`/api/projects/${project.id}`);
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);
    expect(getProject(db, project.id)).toBeUndefined();
    expect(listLeads(db, project.id).length).toBe(0);
    expect(listLeadLists(db, project.id).length).toBe(0);

    const listed = await agent.get("/api/projects");
    expect(listed.body.some((p: { id: number }) => p.id === project.id)).toBe(
      false
    );
  });

  it("DELETE /projects/:id returns 404 for missing project", async () => {
    const res = await request(app()).delete("/api/projects/99999");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("isAllowlisted rejects non-listed email", () => {
    expect(isAllowlisted("outsider@evil.com", ["dev@local", "team@x.com"])).toBe(
      false
    );
  });
});
