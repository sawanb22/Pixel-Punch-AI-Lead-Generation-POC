# LeadRadar — Phase 0 + 1 (Foundation + Ingestion) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the LeadRadar backend foundation and the first working slice — onboard a project, import a CSV of leads, and run the aggregate validation pipeline (canonicalize → dedup → email check → quality-gate) to produce clean, deduped, gated leads in SQLite.

**Architecture:** Deterministic Node/TypeScript backend. SQLite is the source of truth, everything scoped by `project_id`. Lead sources are adapters that only `fetch → map to canonical shape`; validation runs **once on the merged aggregate** (so cross-source duplicates are caught). No Hermes, no external APIs, no UI in this plan — all logic is unit-tested library code plus a small CLI to demo the slice.

**Tech Stack:** Node.js, TypeScript, `better-sqlite3`, `vitest`, `papaparse`. Package manager: npm.

---

## File Structure

```
package.json                    project manifest + scripts
tsconfig.json                   TypeScript config
vitest.config.ts                test runner config
src/
  domain/types.ts               shared types: CanonicalLead, Project, LeadStatus, Source
  db/database.ts                open DB + run migrations
  db/schema.sql                 table definitions (projects, leads, feedback, users)
  projects/projects.repo.ts     create/get projects
  leads/leads.repo.ts           insert/query leads for a project
  sources/source.ts             Source adapter interface
  sources/csv-source.ts         CSV parse + column mapping → CanonicalLead[]
  validation/canonicalize.ts    canonicalize domain/website
  validation/dedup.ts           dedup within + across sources
  validation/email-check.ts     email syntax + MX check (dns)
  validation/quality-gate.ts    reject junk before scoring
  validation/validate.ts        orchestrate aggregate validation
  ingest/run-ingest.ts          merge sources → validate → persist
  cli/import-csv.ts             CLI demo: create project + import a CSV
tests/                          mirrors src/ (vitest)
```

Each file has one responsibility. `validate.ts` composes the small validation units; `run-ingest.ts` composes sources + validation + persistence.

---

## Task 1: Initialize Node + TypeScript project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/smoke.ts`
- Test: `tests/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "leadradar",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "import-csv": "tsx src/cli/import-csv.ts"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "papaparse": "^5.4.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.0.0",
    "@types/papaparse": "^5.3.14",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Write the failing smoke test**

`tests/smoke.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { ping } from "../src/smoke.js";

describe("smoke", () => {
  it("returns pong", () => {
    expect(ping()).toBe("pong");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/smoke.js`.

- [ ] **Step 7: Write minimal implementation**

`src/smoke.ts`:
```typescript
export function ping(): string {
  return "pong";
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/smoke.ts tests/smoke.test.ts package-lock.json .gitignore
git commit -m "chore: initialize node+typescript project with vitest"
```

Note: create `.gitignore` containing `node_modules/`, `dist/`, `*.db` before committing.

---

## Task 2: Domain types

**Files:**
- Create: `src/domain/types.ts`
- Test: `tests/domain/types.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/domain/types.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { LEAD_STATUSES, isLeadStatus } from "../../src/domain/types.js";

describe("LeadStatus", () => {
  it("recognizes valid statuses", () => {
    expect(isLeadStatus("raw")).toBe(true);
    expect(isLeadStatus("gated")).toBe(true);
    expect(isLeadStatus("scored")).toBe(true);
  });
  it("rejects invalid statuses", () => {
    expect(isLeadStatus("banana")).toBe(false);
  });
  it("exposes the full status list", () => {
    expect(LEAD_STATUSES).toContain("approved");
    expect(LEAD_STATUSES).toContain("rejected");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/domain/types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/domain/types.ts`:
```typescript
export const LEAD_STATUSES = [
  "raw",
  "gated",
  "scored",
  "approved",
  "rejected",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(value);
}

export interface Project {
  id: number;
  name: string;
  website: string | null;
  description: string | null;
  icp: string | null;
  sourceConfig: string | null; // JSON string
  status: string;
  createdAt: string;
}

/** A lead as emitted by a source adapter, before validation/persistence. */
export interface CanonicalLead {
  company: string;
  website: string | null;
  email: string | null;
  votes: number | null;
  source: string; // e.g. "csv", "producthunt"
}

/** A lead after persistence. */
export interface Lead extends CanonicalLead {
  id: number;
  projectId: number;
  canonicalDomain: string | null;
  sources: string[];
  status: LeadStatus;
  score: number | null;
  reasons: string | null;
  createdAt: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/domain/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts tests/domain/types.test.ts
git commit -m "feat: add domain types and lead status guard"
```

---

## Task 3: Database + schema

**Files:**
- Create: `src/db/schema.sql`
- Create: `src/db/database.ts`
- Test: `tests/db/database.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/db/database.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/db/database.js";

describe("openDatabase", () => {
  it("creates all core tables in an in-memory db", () => {
    const db = openDatabase(":memory:");
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toContain("projects");
    expect(names).toContain("leads");
    expect(names).toContain("feedback");
    expect(names).toContain("users");
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/db/database.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  website TEXT,
  description TEXT,
  icp TEXT,
  source_config TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  company TEXT NOT NULL,
  website TEXT,
  canonical_domain TEXT,
  email TEXT,
  votes INTEGER,
  sources TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'raw',
  score INTEGER,
  reasons TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  good INTEGER NOT NULL,
  notes TEXT,
  reviewed_by TEXT,
  source TEXT NOT NULL DEFAULT 'dashboard',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_project ON leads(project_id);
CREATE INDEX IF NOT EXISTS idx_leads_domain ON leads(project_id, canonical_domain);
```

- [ ] **Step 4: Write minimal implementation**

`src/db/database.ts`:
```typescript
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export type DB = Database.Database;

export function openDatabase(path = "leadradar.db"): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = readFileSync(join(here, "schema.sql"), "utf-8");
  db.exec(schema);
  return db;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test tests/db/database.test.ts`
Expected: PASS.

Note: `schema.sql` must be readable at runtime. Since `tsx` runs TS directly from `src/`, the relative path resolves. (When a build step is added later, copy `schema.sql` into `dist/db/`.)

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.sql src/db/database.ts tests/db/database.test.ts
git commit -m "feat: add sqlite schema and database opener"
```

---

## Task 4: Projects repository

**Files:**
- Create: `src/projects/projects.repo.ts`
- Test: `tests/projects/projects.repo.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/projects/projects.repo.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { createProject, getProject } from "../../src/projects/projects.repo.js";

describe("projects.repo", () => {
  it("creates a project and reads it back", () => {
    const db = openDatabase(":memory:");
    const created = createProject(db, {
      name: "Pixel Punch",
      website: "https://pixelpunch.example",
      description: "Consultancy",
      icp: "SMBs needing software consulting",
    });
    expect(created.id).toBeGreaterThan(0);

    const fetched = getProject(db, created.id);
    expect(fetched?.name).toBe("Pixel Punch");
    expect(fetched?.icp).toBe("SMBs needing software consulting");
    db.close();
  });

  it("returns undefined for a missing project", () => {
    const db = openDatabase(":memory:");
    expect(getProject(db, 999)).toBeUndefined();
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/projects/projects.repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/projects/projects.repo.ts`:
```typescript
import type { DB } from "../db/database.js";
import type { Project } from "../domain/types.js";

export interface NewProject {
  name: string;
  website?: string | null;
  description?: string | null;
  icp?: string | null;
  sourceConfig?: string | null;
}

interface ProjectRow {
  id: number;
  name: string;
  website: string | null;
  description: string | null;
  icp: string | null;
  source_config: string | null;
  status: string;
  created_at: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    website: row.website,
    description: row.description,
    icp: row.icp,
    sourceConfig: row.source_config,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function createProject(db: DB, input: NewProject): Project {
  const result = db
    .prepare(
      `INSERT INTO projects (name, website, description, icp, source_config)
       VALUES (@name, @website, @description, @icp, @sourceConfig)`
    )
    .run({
      name: input.name,
      website: input.website ?? null,
      description: input.description ?? null,
      icp: input.icp ?? null,
      sourceConfig: input.sourceConfig ?? null,
    });
  return getProject(db, Number(result.lastInsertRowid))!;
}

export function getProject(db: DB, id: number): Project | undefined {
  const row = db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(id) as ProjectRow | undefined;
  return row ? toProject(row) : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/projects/projects.repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/projects/projects.repo.ts tests/projects/projects.repo.test.ts
git commit -m "feat: add projects repository (create/get)"
```

---

## Task 5: Source interface + CSV source

**Files:**
- Create: `src/sources/source.ts`
- Create: `src/sources/csv-source.ts`
- Test: `tests/sources/csv-source.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/sources/csv-source.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { parseCsvSource } from "../../src/sources/csv-source.js";

const CSV = `Company,Site,Email,Upvotes
Acme AI,https://acme.ai,founder@acme.ai,120
BetaCorp,betacorp.com,,45`;

describe("parseCsvSource", () => {
  it("maps columns to canonical leads", () => {
    const leads = parseCsvSource(CSV, {
      company: "Company",
      website: "Site",
      email: "Email",
      votes: "Upvotes",
    });
    expect(leads).toHaveLength(2);
    expect(leads[0]).toEqual({
      company: "Acme AI",
      website: "https://acme.ai",
      email: "founder@acme.ai",
      votes: 120,
      source: "csv",
    });
    expect(leads[1].email).toBeNull();
    expect(leads[1].votes).toBe(45);
  });

  it("skips rows with no company", () => {
    const csv = `Company,Email\n,x@y.com\nReal,r@x.com`;
    const leads = parseCsvSource(csv, { company: "Company", email: "Email" });
    expect(leads).toHaveLength(1);
    expect(leads[0].company).toBe("Real");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/sources/csv-source.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the source interface**

`src/sources/source.ts`:
```typescript
import type { CanonicalLead } from "../domain/types.js";

/** Every lead source implements this: produce canonical leads. */
export interface Source {
  readonly name: string;
  fetch(): Promise<CanonicalLead[]>;
}
```

- [ ] **Step 4: Write the CSV source implementation**

`src/sources/csv-source.ts`:
```typescript
import Papa from "papaparse";
import type { CanonicalLead } from "../domain/types.js";

export interface ColumnMapping {
  company: string;
  website?: string;
  email?: string;
  votes?: string;
}

function clean(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

export function parseCsvSource(csv: string, mapping: ColumnMapping): CanonicalLead[] {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  const rows = parsed.data;
  const leads: CanonicalLead[] = [];
  for (const row of rows) {
    const company = clean(row[mapping.company]);
    if (!company) continue; // skip rows with no company
    const votesRaw = mapping.votes ? clean(row[mapping.votes]) : null;
    const votes = votesRaw !== null ? Number(votesRaw) : null;
    leads.push({
      company,
      website: mapping.website ? clean(row[mapping.website]) : null,
      email: mapping.email ? clean(row[mapping.email]) : null,
      votes: votes !== null && Number.isFinite(votes) ? votes : null,
      source: "csv",
    });
  }
  return leads;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test tests/sources/csv-source.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sources/source.ts src/sources/csv-source.ts tests/sources/csv-source.test.ts
git commit -m "feat: add source interface and csv source with column mapping"
```

---

## Task 6: Canonicalize domain

**Files:**
- Create: `src/validation/canonicalize.ts`
- Test: `tests/validation/canonicalize.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/validation/canonicalize.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { canonicalDomain } from "../../src/validation/canonicalize.js";

describe("canonicalDomain", () => {
  it("strips protocol, www, path, query, and lowercases", () => {
    expect(canonicalDomain("https://www.Acme.ai/about?utm=x")).toBe("acme.ai");
    expect(canonicalDomain("http://acme.ai/")).toBe("acme.ai");
    expect(canonicalDomain("acme.ai")).toBe("acme.ai");
    expect(canonicalDomain("WWW.BetaCorp.COM")).toBe("betacorp.com");
  });
  it("returns null for empty/invalid input", () => {
    expect(canonicalDomain(null)).toBeNull();
    expect(canonicalDomain("")).toBeNull();
    expect(canonicalDomain("   ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/validation/canonicalize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/validation/canonicalize.ts`:
```typescript
export function canonicalDomain(website: string | null): string | null {
  if (!website) return null;
  let s = website.trim().toLowerCase();
  if (s.length === 0) return null;
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0];
  s = s.split("?")[0];
  s = s.split("#")[0];
  s = s.replace(/:\d+$/, ""); // strip port
  return s.length > 0 ? s : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/validation/canonicalize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/validation/canonicalize.ts tests/validation/canonicalize.test.ts
git commit -m "feat: add domain canonicalization"
```

---

## Task 7: Deduplication (within + across sources)

**Files:**
- Create: `src/validation/dedup.ts`
- Test: `tests/validation/dedup.test.ts`

Dedup merges leads that share a canonical domain (primary key) or, when no domain, an exact
normalized company name. Merged leads keep the union of their `source` values and prefer a non-null
email/votes.

- [ ] **Step 1: Write the failing test**

`tests/validation/dedup.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { dedup } from "../../src/validation/dedup.js";
import type { CanonicalLead } from "../../src/domain/types.js";

const lead = (p: Partial<CanonicalLead>): CanonicalLead => ({
  company: "X",
  website: null,
  email: null,
  votes: null,
  source: "csv",
  ...p,
});

describe("dedup", () => {
  it("merges leads with the same canonical domain across sources", () => {
    const input = [
      lead({ company: "Acme", website: "https://acme.ai", source: "csv" }),
      lead({ company: "Acme AI", website: "http://www.acme.ai/", email: "a@acme.ai", source: "producthunt" }),
    ];
    const result = dedup(input);
    expect(result).toHaveLength(1);
    expect(result[0].canonicalDomain).toBe("acme.ai");
    expect(result[0].sources.sort()).toEqual(["csv", "producthunt"]);
    expect(result[0].email).toBe("a@acme.ai"); // prefers non-null
  });

  it("merges domainless leads by normalized company name", () => {
    const input = [
      lead({ company: "Beta Corp", source: "csv" }),
      lead({ company: "beta corp", source: "google", votes: 10 }),
    ];
    const result = dedup(input);
    expect(result).toHaveLength(1);
    expect(result[0].votes).toBe(10);
  });

  it("keeps distinct companies separate", () => {
    const input = [
      lead({ company: "Acme", website: "acme.ai" }),
      lead({ company: "Beta", website: "beta.com" }),
    ];
    expect(dedup(input)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/validation/dedup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/validation/dedup.ts`:
```typescript
import type { CanonicalLead } from "../domain/types.js";
import { canonicalDomain } from "./canonicalize.js";

/** A deduped lead carries its computed domain and the set of contributing sources. */
export interface DedupedLead extends CanonicalLead {
  canonicalDomain: string | null;
  sources: string[];
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function keyFor(lead: CanonicalLead): string {
  const domain = canonicalDomain(lead.website);
  return domain ? `d:${domain}` : `n:${normalizeName(lead.company)}`;
}

function preferNonNull<T>(a: T | null, b: T | null): T | null {
  return a !== null && a !== undefined ? a : b;
}

export function dedup(leads: CanonicalLead[]): DedupedLead[] {
  const map = new Map<string, DedupedLead>();
  for (const lead of leads) {
    const key = keyFor(lead);
    const domain = canonicalDomain(lead.website);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...lead,
        canonicalDomain: domain,
        sources: [lead.source],
      });
    } else {
      existing.email = preferNonNull(existing.email, lead.email);
      existing.website = preferNonNull(existing.website, lead.website);
      existing.canonicalDomain = preferNonNull(existing.canonicalDomain, domain);
      existing.votes = preferNonNull(existing.votes, lead.votes);
      if (!existing.sources.includes(lead.source)) {
        existing.sources.push(lead.source);
      }
    }
  }
  return [...map.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/validation/dedup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/validation/dedup.ts tests/validation/dedup.test.ts
git commit -m "feat: add cross-source deduplication"
```

---

## Task 8: Email check (syntax + MX)

**Files:**
- Create: `src/validation/email-check.ts`
- Test: `tests/validation/email-check.test.ts`

MX lookups hit DNS, so the implementation takes an injectable resolver; the test injects a fake.

- [ ] **Step 1: Write the failing test**

`tests/validation/email-check.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { isValidSyntax, checkEmail } from "../../src/validation/email-check.js";

describe("isValidSyntax", () => {
  it("accepts well-formed emails", () => {
    expect(isValidSyntax("a@b.com")).toBe(true);
  });
  it("rejects malformed emails", () => {
    expect(isValidSyntax("nope")).toBe(false);
    expect(isValidSyntax("a@b")).toBe(false);
    expect(isValidSyntax("")).toBe(false);
  });
});

describe("checkEmail", () => {
  it("is invalid when syntax fails (no DNS call)", async () => {
    const resolver = async () => {
      throw new Error("should not be called");
    };
    const result = await checkEmail("bad", resolver);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("syntax");
  });

  it("is valid when syntax and MX both pass", async () => {
    const resolver = async () => [{ exchange: "mx.b.com", priority: 10 }];
    const result = await checkEmail("a@b.com", resolver);
    expect(result.valid).toBe(true);
  });

  it("is invalid when MX has no records", async () => {
    const resolver = async () => [];
    const result = await checkEmail("a@b.com", resolver);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("mx");
  });

  it("is invalid when MX lookup throws", async () => {
    const resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    const result = await checkEmail("a@nodomain.zzz", resolver);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("mx");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/validation/email-check.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/validation/email-check.ts`:
```typescript
import { resolveMx } from "node:dns/promises";

export type MxResolver = (hostname: string) => Promise<{ exchange: string; priority: number }[]>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidSyntax(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export interface EmailCheckResult {
  valid: boolean;
  reason: "ok" | "syntax" | "mx";
}

export async function checkEmail(
  email: string,
  resolver: MxResolver = resolveMx
): Promise<EmailCheckResult> {
  if (!isValidSyntax(email)) return { valid: false, reason: "syntax" };
  const domain = email.trim().split("@")[1];
  try {
    const records = await resolver(domain);
    if (!records || records.length === 0) return { valid: false, reason: "mx" };
    return { valid: true, reason: "ok" };
  } catch {
    return { valid: false, reason: "mx" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/validation/email-check.test.ts`
Expected: PASS (4 checkEmail cases + syntax cases).

- [ ] **Step 5: Commit**

```bash
git add src/validation/email-check.ts tests/validation/email-check.test.ts
git commit -m "feat: add email syntax + MX validation with injectable resolver"
```

---

## Task 9: Quality gate

**Files:**
- Create: `src/validation/quality-gate.ts`
- Test: `tests/validation/quality-gate.test.ts`

The gate rejects leads that aren't worth an LLM call: no website AND no email, or no company name.
It returns kept vs. rejected with reasons (deterministic, cheap).

- [ ] **Step 1: Write the failing test**

`tests/validation/quality-gate.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { qualityGate } from "../../src/validation/quality-gate.js";
import type { DedupedLead } from "../../src/validation/dedup.js";

const d = (p: Partial<DedupedLead>): DedupedLead => ({
  company: "X",
  website: null,
  email: null,
  votes: null,
  source: "csv",
  canonicalDomain: null,
  sources: ["csv"],
  ...p,
});

describe("qualityGate", () => {
  it("keeps a lead that has a website", () => {
    const { kept, rejected } = qualityGate([d({ website: "acme.ai", canonicalDomain: "acme.ai" })]);
    expect(kept).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });
  it("keeps a lead that has an email", () => {
    const { kept } = qualityGate([d({ email: "a@b.com" })]);
    expect(kept).toHaveLength(1);
  });
  it("rejects a lead with no website and no email", () => {
    const { kept, rejected } = qualityGate([d({ company: "Ghost" })]);
    expect(kept).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBe("no-contactable-signal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/validation/quality-gate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/validation/quality-gate.ts`:
```typescript
import type { DedupedLead } from "./dedup.js";

export interface RejectedLead {
  lead: DedupedLead;
  reason: string;
}

export interface QualityGateResult {
  kept: DedupedLead[];
  rejected: RejectedLead[];
}

export function qualityGate(leads: DedupedLead[]): QualityGateResult {
  const kept: DedupedLead[] = [];
  const rejected: RejectedLead[] = [];
  for (const lead of leads) {
    if (!lead.company || lead.company.trim().length === 0) {
      rejected.push({ lead, reason: "no-company" });
      continue;
    }
    const hasWebsite = !!lead.canonicalDomain;
    const hasEmail = !!lead.email;
    if (!hasWebsite && !hasEmail) {
      rejected.push({ lead, reason: "no-contactable-signal" });
      continue;
    }
    kept.push(lead);
  }
  return { kept, rejected };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/validation/quality-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/validation/quality-gate.ts tests/validation/quality-gate.test.ts
git commit -m "feat: add quality gate to reject junk before scoring"
```

---

## Task 10: Aggregate validation orchestrator

**Files:**
- Create: `src/validation/validate.ts`
- Test: `tests/validation/validate.test.ts`

Composes the units: dedup → (email check, marking invalid emails null) → quality gate. Runs on the
merged aggregate, exactly once.

- [ ] **Step 1: Write the failing test**

`tests/validation/validate.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { validateAggregate } from "../../src/validation/validate.js";
import type { CanonicalLead } from "../../src/domain/types.js";

const lead = (p: Partial<CanonicalLead>): CanonicalLead => ({
  company: "X",
  website: null,
  email: null,
  votes: null,
  source: "csv",
  ...p,
});

describe("validateAggregate", () => {
  it("dedups across sources, drops bad emails, and gates junk", async () => {
    const input = [
      lead({ company: "Acme", website: "https://acme.ai", source: "csv" }),
      lead({ company: "Acme AI", website: "www.acme.ai", email: "a@acme.ai", source: "producthunt" }),
      lead({ company: "Ghost", source: "csv" }), // no signal -> rejected
      lead({ company: "Beta", email: "bad-syntax", source: "google" }), // email nulled, no site -> rejected
    ];
    // MX passes for acme.ai only
    const resolver = async (host: string) =>
      host === "acme.ai" ? [{ exchange: "mx", priority: 10 }] : [];

    const { kept, rejected } = await validateAggregate(input, resolver);

    expect(kept).toHaveLength(1);
    expect(kept[0].canonicalDomain).toBe("acme.ai");
    expect(kept[0].email).toBe("a@acme.ai");
    expect(kept[0].sources.sort()).toEqual(["csv", "producthunt"]);
    expect(rejected.map((r) => r.lead.company).sort()).toEqual(["Beta", "Ghost"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/validation/validate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/validation/validate.ts`:
```typescript
import type { CanonicalLead } from "../domain/types.js";
import { dedup, type DedupedLead } from "./dedup.js";
import { checkEmail, type MxResolver } from "./email-check.js";
import { qualityGate, type QualityGateResult } from "./quality-gate.js";

/** Runs ONCE on the merged aggregate of all sources. */
export async function validateAggregate(
  leads: CanonicalLead[],
  resolver?: MxResolver
): Promise<QualityGateResult> {
  const deduped: DedupedLead[] = dedup(leads);

  for (const lead of deduped) {
    if (lead.email) {
      const result = await checkEmail(lead.email, resolver);
      if (!result.valid) lead.email = null; // keep the lead, drop the bad email
    }
  }

  return qualityGate(deduped);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/validation/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/validation/validate.ts tests/validation/validate.test.ts
git commit -m "feat: add aggregate validation orchestrator"
```

---

## Task 11: Leads repository + ingest run + CLI demo

**Files:**
- Create: `src/leads/leads.repo.ts`
- Create: `src/ingest/run-ingest.ts`
- Create: `src/cli/import-csv.ts`
- Test: `tests/leads/leads.repo.test.ts`
- Test: `tests/ingest/run-ingest.test.ts`

- [ ] **Step 1: Write the failing test for the leads repo**

`tests/leads/leads.repo.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { createProject } from "../../src/projects/projects.repo.js";
import { insertLeads, listLeads } from "../../src/leads/leads.repo.js";

describe("leads.repo", () => {
  it("inserts deduped leads scoped to a project and lists them", () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, { name: "P1" });
    insertLeads(db, project.id, [
      {
        company: "Acme",
        website: "acme.ai",
        canonicalDomain: "acme.ai",
        email: "a@acme.ai",
        votes: 10,
        source: "csv",
        sources: ["csv", "producthunt"],
      },
    ]);
    const leads = listLeads(db, project.id);
    expect(leads).toHaveLength(1);
    expect(leads[0].company).toBe("Acme");
    expect(leads[0].sources).toEqual(["csv", "producthunt"]);
    expect(leads[0].status).toBe("gated");
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/leads/leads.repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the leads repo**

`src/leads/leads.repo.ts`:
```typescript
import type { DB } from "../db/database.js";
import type { Lead } from "../domain/types.js";
import type { DedupedLead } from "../validation/dedup.js";

interface LeadRow {
  id: number;
  project_id: number;
  company: string;
  website: string | null;
  canonical_domain: string | null;
  email: string | null;
  votes: number | null;
  sources: string;
  status: string;
  score: number | null;
  reasons: string | null;
  created_at: string;
}

function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    projectId: row.project_id,
    company: row.company,
    website: row.website,
    canonicalDomain: row.canonical_domain,
    email: row.email,
    votes: row.votes,
    source: JSON.parse(row.sources)[0] ?? "unknown",
    sources: JSON.parse(row.sources),
    status: row.status as Lead["status"],
    score: row.score,
    reasons: row.reasons,
    createdAt: row.created_at,
  };
}

/** Inserts gated leads for a project. */
export function insertLeads(db: DB, projectId: number, leads: DedupedLead[]): void {
  const stmt = db.prepare(
    `INSERT INTO leads
       (project_id, company, website, canonical_domain, email, votes, sources, status)
     VALUES
       (@projectId, @company, @website, @canonicalDomain, @email, @votes, @sources, 'gated')`
  );
  const tx = db.transaction((rows: DedupedLead[]) => {
    for (const lead of rows) {
      stmt.run({
        projectId,
        company: lead.company,
        website: lead.website,
        canonicalDomain: lead.canonicalDomain,
        email: lead.email,
        votes: lead.votes,
        sources: JSON.stringify(lead.sources),
      });
    }
  });
  tx(leads);
}

export function listLeads(db: DB, projectId: number): Lead[] {
  const rows = db
    .prepare("SELECT * FROM leads WHERE project_id = ? ORDER BY id")
    .all(projectId) as LeadRow[];
  return rows.map(toLead);
}
```

- [ ] **Step 4: Run leads repo test to verify it passes**

Run: `npm test tests/leads/leads.repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the ingest run**

`tests/ingest/run-ingest.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { openDatabase } from "../../src/db/database.js";
import { createProject } from "../../src/projects/projects.repo.js";
import { listLeads } from "../../src/leads/leads.repo.js";
import { runIngest } from "../../src/ingest/run-ingest.js";
import type { Source } from "../../src/sources/source.js";

describe("runIngest", () => {
  it("merges sources, validates aggregate, and persists gated leads", async () => {
    const db = openDatabase(":memory:");
    const project = createProject(db, { name: "P1" });

    const csv: Source = {
      name: "csv",
      fetch: async () => [
        { company: "Acme", website: "https://acme.ai", email: null, votes: null, source: "csv" },
        { company: "Ghost", website: null, email: null, votes: null, source: "csv" },
      ],
    };
    const ph: Source = {
      name: "producthunt",
      fetch: async () => [
        { company: "Acme AI", website: "www.acme.ai", email: "a@acme.ai", votes: 99, source: "producthunt" },
      ],
    };

    const resolver = async () => [{ exchange: "mx", priority: 10 }];
    const summary = await runIngest(db, project.id, [csv, ph], resolver);

    expect(summary.kept).toBe(1);
    expect(summary.rejected).toBe(1);

    const leads = listLeads(db, project.id);
    expect(leads).toHaveLength(1);
    expect(leads[0].canonicalDomain).toBe("acme.ai");
    expect(leads[0].email).toBe("a@acme.ai");
    db.close();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test tests/ingest/run-ingest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Write the ingest run**

`src/ingest/run-ingest.ts`:
```typescript
import type { DB } from "../db/database.js";
import type { Source } from "../sources/source.js";
import type { CanonicalLead } from "../domain/types.js";
import type { MxResolver } from "../validation/email-check.js";
import { validateAggregate } from "../validation/validate.js";
import { insertLeads } from "../leads/leads.repo.js";

export interface IngestSummary {
  fetched: number;
  kept: number;
  rejected: number;
}

export async function runIngest(
  db: DB,
  projectId: number,
  sources: Source[],
  resolver?: MxResolver
): Promise<IngestSummary> {
  // 1. INGEST: fetch each source, map already done inside adapters
  const pools = await Promise.all(sources.map((s) => s.fetch()));
  const merged: CanonicalLead[] = pools.flat();

  // 2. VALIDATE ONCE on the aggregate
  const { kept, rejected } = await validateAggregate(merged, resolver);

  // 3. PERSIST gated leads
  insertLeads(db, projectId, kept);

  return { fetched: merged.length, kept: kept.length, rejected: rejected.length };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test tests/ingest/run-ingest.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the CLI demo (manual verification of the whole slice)**

`src/cli/import-csv.ts`:
```typescript
import { readFileSync } from "node:fs";
import { openDatabase } from "../db/database.js";
import { createProject, getProject } from "../projects/projects.repo.js";
import { parseCsvSource, type ColumnMapping } from "../sources/csv-source.js";
import { runIngest } from "../ingest/run-ingest.js";
import type { Source } from "../sources/source.js";

// Usage: npm run import-csv -- <projectName> <csvPath>
async function main() {
  const [, , projectName, csvPath] = process.argv;
  if (!projectName || !csvPath) {
    console.error("Usage: npm run import-csv -- <projectName> <csvPath>");
    process.exit(1);
  }
  const db = openDatabase("leadradar.db");
  const project = createProject(db, { name: projectName });
  const csv = readFileSync(csvPath, "utf-8");

  const mapping: ColumnMapping = {
    company: "Company",
    website: "Website",
    email: "Email",
    votes: "Votes",
  };
  const csvSource: Source = {
    name: "csv",
    fetch: async () => parseCsvSource(csv, mapping),
  };

  const summary = await runIngest(db, project.id, [csvSource]);
  console.log(`Project ${project.id} (${getProject(db, project.id)?.name})`);
  console.log(`Fetched: ${summary.fetched}, Kept: ${summary.kept}, Rejected: ${summary.rejected}`);
  db.close();
}

main();
```

- [ ] **Step 10: Manually verify the CLI**

Create `sample.csv`:
```
Company,Website,Email,Votes
Acme AI,https://acme.ai,founder@acme.ai,120
Ghost,,,
```
Run: `npm run import-csv -- "Pixel Punch" sample.csv`
Expected output: `Fetched: 2, Kept: 1, Rejected: 1` (Ghost rejected: no signal).

- [ ] **Step 11: Run the full test suite + typecheck**

Run: `npm test`
Expected: ALL tests pass.
Run: `npm run typecheck`
Expected: no type errors.

- [ ] **Step 12: Commit**

```bash
git add src/leads/leads.repo.ts src/ingest/run-ingest.ts src/cli/import-csv.ts tests/leads/leads.repo.test.ts tests/ingest/run-ingest.test.ts
git commit -m "feat: add leads repo, ingest run, and csv import CLI"
```

---

## Definition of done (Phase 0 + 1)

- `npm test` passes (all unit tests green) and `npm run typecheck` is clean.
- You can run `npm run import-csv -- "<Project>" <csv>` and see leads created, deduped across sources,
  bad emails dropped, and junk rejected — scoped to the new project in `leadradar.db`.
- The validation pipeline runs **once on the aggregate**, catching cross-source duplicates.

## What this plan deliberately does NOT include (next plans)
- Hermes MCP server + scoring loop (Phase 2)
- Dashboard, Google auth, CSV export UI (Phase 3)
- Feedback loop + per-project `knowledge_base` RAG (Phase 4)
- Telegram feedback (Phase 5)
- Product Hunt / Google / crawler sources (Phase 6)
- Outreach (Phase 7)
