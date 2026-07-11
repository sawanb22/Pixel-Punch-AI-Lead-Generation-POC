import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type DB } from "../../src/db/database.js";
import { createApp } from "../../src/dashboard/app.js";
import { MockScorer } from "../../src/scoring/mock-scorer.js";
import { insertLeads, listLeads } from "../../src/leads/leads.repo.js";
import { createProject } from "../../src/projects/projects.repo.js";
import { isAllowlisted } from "../../src/users/users.repo.js";
import { resetDefaultFeedbackRag } from "../../src/feedback/feedback.repo.js";
import { defaultAgencyLeadPlan } from "../../src/discovery/lead-plan.js";
import type { HermesLeadPlanner } from "../../src/discovery/hermes-lead-planner.js";

const mockLeadPlanner = {
  async generatePlan(input) {
    return {
      plan: defaultAgencyLeadPlan(input),
      fromFallback: true,
    };
  },
} as Pick<HermesLeadPlanner, "generatePlan"> as HermesLeadPlanner;

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
    expect(created.body.leadPlan).toBeTruthy();
    const projectId = created.body.id as number;

    const patched = await agent.patch(`/api/projects/${projectId}`).send({
      icp: "AI agents for restaurants",
      volumeTarget: 250,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.icp).toBe("AI agents for restaurants");
    expect(patched.body.leadPlan).toContain("250");
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
            url: "https://dash.example",
          },
          {
            title: "Noise",
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
    expect(created.body.leadPlan).toBeTruthy();

    const ingested = await agent.post(
      `/api/projects/${created.body.id}/ingest`
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

  it("isAllowlisted rejects non-listed email", () => {
    expect(isAllowlisted("outsider@evil.com", ["dev@local", "team@x.com"])).toBe(
      false
    );
  });
});
