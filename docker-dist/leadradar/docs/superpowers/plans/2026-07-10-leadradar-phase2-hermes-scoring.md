# LeadRadar — Phase 2 (Hermes MCP + Scoring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect scoring to the backend: expose the 4 project-scoped MCP tools, implement Pattern B scoring (backend loops gated leads, calls a Scorer for each), persist scores, and provide a CLI to run scoring — with Hermes as a real Scorer implementation and a MockScorer for tests.

**Architecture:** Deterministic backend owns the loop and DB writes. A `Scorer` interface abstracts judgment. `MockScorer` powers unit/integration tests. `HermesScorer` calls Hermes' OpenAI-compatible API (`POST /v1/chat/completions`) with the project's ICP + lead fields and parses `{score, reasons}` JSON. An MCP stdio server exposes the same 4 tools Hermes can call (for later Telegram/skills); tool handlers are pure functions over the DB so they are unit-tested without spawning MCP.

**Tech Stack:** Existing Node/TS + `node:sqlite` + vitest. Add `@modelcontextprotocol/sdk` (or `@modelcontextprotocol/server` if that is the current package — prefer whatever `npm view @modelcontextprotocol/sdk version` resolves; use the stdio `McpServer` + `StdioServerTransport` pattern from the SDK docs). Add `zod` for tool input schemas.

**Hermes config (docs only, not auto-installed):** document in `docs/hermes-mcp.md` how to register our stdio MCP server in `~/.hermes/config.yaml` under `mcp_servers.leadradar`.

**Depends on:** Phase 0+1 complete (projects, leads, ingest, validation).

**Out of scope:** Dashboard UI, RAG/knowledge_base, Telegram, email drafting, real Hermes install in CI.

---

## File Structure

```
src/
  feedback/feedback.repo.ts       record + list feedback; stats
  leads/leads.repo.ts             EXTEND: listGatedLeads, saveScore, getLead
  scoring/scorer.ts               Scorer interface + ScoreResult
  scoring/mock-scorer.ts          deterministic mock for tests
  scoring/hermes-scorer.ts        HTTP client to Hermes /v1/chat/completions
  scoring/run-scoring.ts          Pattern B loop: gated → score → save
  mcp/tools.ts                    pure handlers for the 4 MCP tools
  mcp/server.ts                   stdio MCP server wiring
  cli/score-project.ts            CLI: npm run score -- <projectId>
docs/
  hermes-mcp.md                   how to register MCP + Hermes API env
tests/
  feedback/feedback.repo.test.ts
  leads/leads.scoring.test.ts
  scoring/mock-scorer.test.ts
  scoring/hermes-scorer.test.ts   (mock fetch)
  scoring/run-scoring.test.ts
  mcp/tools.test.ts
```

---

## Task 1: Extend leads repo for scoring

**Files:**
- Modify: `src/leads/leads.repo.ts`
- Create: `tests/leads/leads.scoring.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { createProject } from "../../src/projects/projects.repo.js";
import { insertLeads, listGatedLeads, saveScore, getLead } from "../../src/leads/leads.repo.js";

describe("leads scoring helpers", () => {
  it("lists only gated leads for a project", () => {
    const db = openDatabase(":memory:");
    const p = createProject(db, { name: "P1" });
    insertLeads(db, p.id, [
      { company: "A", website: "a.com", canonicalDomain: "a.com", email: null, votes: null, source: "csv", sources: ["csv"] },
    ]);
    const gated = listGatedLeads(db, p.id);
    expect(gated).toHaveLength(1);
    expect(gated[0].status).toBe("gated");
    db.close();
  });

  it("saveScore sets score, reasons, and status=scored", () => {
    const db = openDatabase(":memory:");
    const p = createProject(db, { name: "P1" });
    insertLeads(db, p.id, [
      { company: "A", website: "a.com", canonicalDomain: "a.com", email: "a@a.com", votes: 1, source: "csv", sources: ["csv"] },
    ]);
    const [lead] = listGatedLeads(db, p.id);
    saveScore(db, p.id, lead.id, 82, "Strong ICP fit");
    const updated = getLead(db, p.id, lead.id)!;
    expect(updated.score).toBe(82);
    expect(updated.reasons).toBe("Strong ICP fit");
    expect(updated.status).toBe("scored");
    db.close();
  });

  it("saveScore rejects cross-project lead ids", () => {
    const db = openDatabase(":memory:");
    const p1 = createProject(db, { name: "P1" });
    const p2 = createProject(db, { name: "P2" });
    insertLeads(db, p1.id, [
      { company: "A", website: "a.com", canonicalDomain: "a.com", email: null, votes: null, source: "csv", sources: ["csv"] },
    ]);
    const [lead] = listGatedLeads(db, p1.id);
    expect(() => saveScore(db, p2.id, lead.id, 50, "x")).toThrow(/not found|project/i);
    db.close();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (exports missing)**

Run: `npm test tests/leads/leads.scoring.test.ts`

- [ ] **Step 3: Implement `listGatedLeads`, `getLead`, `saveScore` in `leads.repo.ts`**

```typescript
export function listGatedLeads(db: DB, projectId: number): Lead[] {
  const rows = db
    .prepare("SELECT * FROM leads WHERE project_id = ? AND status = 'gated' ORDER BY id")
    .all(projectId) as unknown as LeadRow[];
  return rows.map(toLead);
}

export function getLead(db: DB, projectId: number, leadId: number): Lead | undefined {
  const row = db
    .prepare("SELECT * FROM leads WHERE project_id = ? AND id = ?")
    .get(projectId, leadId) as unknown as LeadRow | undefined;
  return row ? toLead(row) : undefined;
}

export function saveScore(
  db: DB,
  projectId: number,
  leadId: number,
  score: number,
  reasons: string,
  draft?: string | null
): Lead {
  if (score < 0 || score > 100 || !Number.isFinite(score)) {
    throw new Error("score must be 0–100");
  }
  const existing = getLead(db, projectId, leadId);
  if (!existing) throw new Error(`lead ${leadId} not found in project ${projectId}`);
  // draft reserved — ignore for now (column not in schema yet)
  void draft;
  db.prepare(
    `UPDATE leads SET score = ?, reasons = ?, status = 'scored' WHERE project_id = ? AND id = ?`
  ).run(Math.round(score), reasons, projectId, leadId);
  return getLead(db, projectId, leadId)!;
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/leads/leads.repo.ts tests/leads/leads.scoring.test.ts
git -c user.name="LeadRadar" -c user.email="leadradar@local" commit -m "feat: add listGatedLeads, getLead, saveScore to leads repo"
```

---

## Task 2: Feedback repository

**Files:**
- Create: `src/feedback/feedback.repo.ts`
- Create: `tests/feedback/feedback.repo.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { createProject } from "../../src/projects/projects.repo.js";
import { insertLeads, listGatedLeads } from "../../src/leads/leads.repo.js";
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
```

- [ ] **Step 2: Implement**

```typescript
import type { DB } from "../db/database.js";
import { getLead } from "../leads/leads.repo.js";

export interface NewFeedback {
  projectId: number;
  leadId: number;
  good: boolean;
  notes: string | null;
  reviewedBy: string | null;
  source: "dashboard" | "telegram";
}

export interface FeedbackStats {
  total: number;
  good: number;
  bad: number;
  approvalRate: number; // 0–1, 0 if total=0
}

export function recordFeedback(db: DB, input: NewFeedback): void {
  if (!getLead(db, input.projectId, input.leadId)) {
    throw new Error(`lead ${input.leadId} not found in project ${input.projectId}`);
  }
  db.prepare(
    `INSERT INTO feedback (project_id, lead_id, good, notes, reviewed_by, source)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    input.projectId,
    input.leadId,
    input.good ? 1 : 0,
    input.notes,
    input.reviewedBy,
    input.source
  );
  // Also flip lead status for convenience
  db.prepare(
    `UPDATE leads SET status = ? WHERE project_id = ? AND id = ?`
  ).run(input.good ? "approved" : "rejected", input.projectId, input.leadId);
}

export function getFeedbackStats(db: DB, projectId: number): FeedbackStats {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN good = 1 THEN 1 ELSE 0 END) AS good,
         SUM(CASE WHEN good = 0 THEN 1 ELSE 0 END) AS bad
       FROM feedback WHERE project_id = ?`
    )
    .get(projectId) as { total: number; good: number | null; bad: number | null };
  const total = Number(row.total) || 0;
  const good = Number(row.good) || 0;
  const bad = Number(row.bad) || 0;
  return { total, good, bad, approvalRate: total === 0 ? 0 : good / total };
}
```

- [ ] **Step 3: Tests PASS → Commit**

```bash
git add src/feedback tests/feedback
git -c user.name="LeadRadar" -c user.email="leadradar@local" commit -m "feat: add feedback repository and stats"
```

---

## Task 3: Scorer interface + MockScorer

**Files:**
- Create: `src/scoring/scorer.ts`
- Create: `src/scoring/mock-scorer.ts`
- Create: `tests/scoring/mock-scorer.test.ts`

- [ ] **Step 1: Types**

```typescript
// scorer.ts
import type { Lead, Project } from "../domain/types.js";

export interface ScoreResult {
  score: number; // 0–100
  reasons: string;
  draft?: string | null; // reserved
}

export interface Scorer {
  scoreLead(lead: Lead, project: Project): Promise<ScoreResult>;
}
```

- [ ] **Step 2: MockScorer** — score = min(100, 50 + (votes??0)/2); reasons mention ICP keyword if present in company/website

```typescript
export class MockScorer implements Scorer {
  async scoreLead(lead: Lead, project: Project): Promise<ScoreResult> {
    const base = 50 + Math.min(50, Math.floor((lead.votes ?? 0) / 2));
    const icp = (project.icp ?? "").toLowerCase();
    const hay = `${lead.company} ${lead.website ?? ""}`.toLowerCase();
    const fit = icp && hay.includes(icp.split(/\s+/)[0] ?? "") ? "ICP keyword match" : "generic fit";
    return { score: base, reasons: `${fit}; votes=${lead.votes ?? 0}` };
  }
}
```

- [ ] **Step 3: Test MockScorer returns 0–100 and includes reasons → Commit**

```bash
git commit -m "feat: add Scorer interface and MockScorer"
```

---

## Task 4: HermesScorer (HTTP, injectable fetch)

**Files:**
- Create: `src/scoring/hermes-scorer.ts`
- Create: `tests/scoring/hermes-scorer.test.ts`

Calls `POST {baseUrl}/v1/chat/completions` with:
- system: "You score B2B leads. Reply ONLY with JSON: {\"score\":0-100,\"reasons\":\"...\"}"
- user: project ICP + lead fields

Parse JSON from content (strip markdown fences if present). Validate score 0–100.

Env/config: `HERMES_API_BASE` (default `http://127.0.0.1:8642`), `HERMES_API_KEY` optional.

- [ ] **Step 1: Test with mock fetch** — happy path, bad JSON throws, out-of-range score throws

- [ ] **Step 2: Implement HermesScorer**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add HermesScorer HTTP client with injectable fetch"
```

---

## Task 5: Pattern B runScoring loop

**Files:**
- Create: `src/scoring/run-scoring.ts`
- Create: `tests/scoring/run-scoring.test.ts`

```typescript
export interface ScoringSummary {
  scored: number;
  skipped: number;
  errors: number;
}

export async function runScoring(
  db: DB,
  projectId: number,
  scorer: Scorer
): Promise<ScoringSummary> {
  const project = getProject(db, projectId);
  if (!project) throw new Error(`project ${projectId} not found`);
  const gated = listGatedLeads(db, projectId);
  let scored = 0, errors = 0;
  for (const lead of gated) {
    try {
      const result = await scorer.scoreLead(lead, project);
      saveScore(db, projectId, lead.id, result.score, result.reasons, result.draft);
      scored++;
    } catch {
      errors++;
    }
  }
  return { scored, skipped: 0, errors };
}
```

- [ ] **Test:** insert 2 gated leads → MockScorer → both status=scored, scores set; scorer that throws once → errors=1, scored=1

- [ ] **Commit:** `feat: add Pattern B runScoring loop`

---

## Task 6: MCP tool handlers (pure)

**Files:**
- Create: `src/mcp/tools.ts`
- Create: `tests/mcp/tools.test.ts`

Four handlers returning JSON-serializable objects (not MCP wire format yet):

```typescript
getPendingLeads(db, { project_id })
saveScoreAndDraft(db, { project_id, lead_id, score, reasons, draft? })
recordFeedbackTool(db, { project_id, lead_id, good, notes?, reviewed_by?, source? })
getFeedbackStatsTool(db, { project_id })
```

Validate inputs (project_id required number, score 0–100, good boolean). Unit-test each against in-memory DB.

- [ ] **Commit:** `feat: add MCP tool handlers for the 4 LeadRadar tools`

---

## Task 7: MCP stdio server + CLI score + docs

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/cli/score-project.ts`
- Create: `docs/hermes-mcp.md`
- Modify: `package.json` scripts:
  - `"mcp": "tsx src/mcp/server.ts"`
  - `"score": "tsx src/cli/score-project.ts"`

MCP server:
- Open DB from `LEADRADAR_DB` env (default `leadradar.db`)
- Register 4 tools with zod schemas via `@modelcontextprotocol/sdk`
- Log only to `console.error`
- Use StdioServerTransport

CLI `score-project.ts`:
```
Usage: npm run score -- <projectId> [--mock]
```
Default scorer = HermesScorer; `--mock` uses MockScorer.

`docs/hermes-mcp.md` example:
```yaml
mcp_servers:
  leadradar:
    command: "npx"
    args: ["tsx", "D:/Pixel Punch AIOS/src/mcp/server.ts"]
    env:
      LEADRADAR_DB: "D:/Pixel Punch AIOS/leadradar.db"
```

- [ ] **Manual smoke (no Hermes required):**
  1. `npm run import-csv -- "Pixel Punch" sample.csv` (or use existing db)
  2. `npm run score -- 1 --mock`
  3. Expect scored count ≥ 1

- [ ] **Full suite:** `npm test` + `npm run typecheck` all green

- [ ] **Commit:** `feat: add MCP stdio server, score CLI, and Hermes wiring docs`

---

## Definition of done (Phase 2)

- All new unit tests pass; full suite still green; typecheck clean
- `npm run score -- <id> --mock` scores gated leads without Hermes
- MCP tool handlers covered by unit tests; server entrypoint exists for Hermes config
- No dashboard/RAG/Telegram yet

## Verification checklist (controller runs after implementer)

1. `npm test` — all pass
2. `npm run typecheck`
3. Integration: import CSV → score with `--mock` → leads have status `scored` and numeric scores
4. MCP tools unit tests cover project isolation (cross-project save/feedback throws)
5. Confirm no accidental dashboard/RAG code landed
