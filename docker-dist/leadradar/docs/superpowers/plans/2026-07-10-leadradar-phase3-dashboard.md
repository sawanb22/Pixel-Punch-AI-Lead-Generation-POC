# LeadRadar — Phase 3 (Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a lean team dashboard: Google OAuth + email allowlist, project selector, KPI strip, lead table (sort/filter), lead detail (approve/reject), Run scoring button, CSV export (filtered + presets), and CSV import wired to existing ingest.

**Architecture:** Express app serves JSON APIs + simple server-rendered HTML (or minimal static HTML + fetch). Auth via `passport-google-oauth20` + `express-session`. Allowlist from env `LEADRADAR_ALLOWLIST` (comma-separated emails). **Test/dev bypass:** when `LEADRADAR_AUTH_BYPASS=1`, middleware injects a fake user so unit/integration tests never need Google. All business logic stays in repos/services already built; dashboard is a thin UI + HTTP layer.

**Tech Stack:** `express`, `express-session`, `passport`, `passport-google-oauth20`, `supertest` (dev), existing vitest. Keep HTML simple (no React for v1 — one `public/` folder + EJS or plain HTML templates). Prefer **plain HTML + vanilla JS** in `public/` calling `/api/*` to avoid template engine complexity.

**Depends on:** Phase 0–2 (ingest, scoring, feedback, MCP tools).

**Out of scope:** RAG, Telegram, charts, roles, claim/assign, outreach.

---

## File Structure

```
src/
  users/users.repo.ts              upsert/find by email; allowlist check
  projects/projects.repo.ts        EXTEND: listProjects, updateProject
  leads/leads.repo.ts              EXTEND: listLeadsFiltered, updateLeadStatus
  export/csv-export.ts             build CSV from leads + presets
  dashboard/
    auth.ts                        passport setup + allowlist + bypass
    middleware.ts                  requireAuth
    api.ts                         Express Router for /api/*
    app.ts                         createApp() — express factory (testable)
    server.ts                      listen on PORT
  public/
    index.html                     SPA-ish single page
    app.js                         fetch API, render table/KPIs
    styles.css                     minimal clean CSS
tests/
  users/users.repo.test.ts
  projects/projects.list.test.ts
  leads/leads.filter.test.ts
  export/csv-export.test.ts
  dashboard/api.test.ts            supertest against createApp() with AUTH_BYPASS
docs/
  dashboard-setup.md               Google OAuth env vars + allowlist
```

---

## Task 1: Users repo + allowlist

**Files:** `src/users/users.repo.ts`, `tests/users/users.repo.test.ts`

- [ ] `upsertUser(db, { email, name })` — insert or update name
- [ ] `findUserByEmail(db, email)`
- [ ] `isAllowlisted(email, allowlist: string[])` — case-insensitive
- [ ] Tests for upsert + allowlist
- [ ] Commit: `feat: add users repo and allowlist helper`

---

## Task 2: Extend projects + leads for dashboard queries

**Files:** modify `projects.repo.ts`, `leads.repo.ts` + tests

- [ ] `listProjects(db): Project[]`
- [ ] `updateProject(db, id, { name?, website?, description?, icp? })`
- [ ] `listLeadsFiltered(db, projectId, { status?, minScore?, source?, q? })` — status exact, minScore >=, source contained in JSON sources, q matches company LIKE
- [ ] `approveLead` / `rejectLead` — or reuse `recordFeedback` from feedback.repo (prefer reuse)
- [ ] Tests
- [ ] Commit: `feat: add list/filter helpers for dashboard queries`

---

## Task 3: CSV export

**Files:** `src/export/csv-export.ts`, `tests/export/csv-export.test.ts`

- [ ] `exportLeadsCsv(leads, preset: "all" | "emails_only" | "current")`
  - `all` / `current`: columns company, website, email, score, status, sources, reasons
  - `emails_only`: only rows with email; columns company, email, score
- [ ] Escape CSV properly (quotes, commas, newlines)
- [ ] Tests with commas in company names
- [ ] Commit: `feat: add CSV export with presets`

---

## Task 4: Auth middleware (Google + bypass)

**Files:** `src/dashboard/auth.ts`, `src/dashboard/middleware.ts`, tests via api later

- [ ] Configure passport Google strategy when `GOOGLE_CLIENT_ID` set
- [ ] On verify: if email not allowlisted → fail; else upsertUser and done(null, user)
- [ ] Serialize/deserialize by email
- [ ] `LEADRADAR_AUTH_BYPASS=1` → `req.user = { email: "dev@local", name: "Dev" }` without Google
- [ ] `requireAuth` redirects HTML to `/login` or returns 401 for `/api/*`
- [ ] Commit: `feat: add Google OAuth auth with allowlist and test bypass`

---

## Task 5: API router + createApp

**Files:** `src/dashboard/api.ts`, `src/dashboard/app.ts`, `tests/dashboard/api.test.ts`

API endpoints (all require auth except `/auth/*` and `/health`):

```
GET  /health
GET  /api/me
GET  /api/projects
POST /api/projects                 { name, website?, description?, icp? }
GET  /api/projects/:id
GET  /api/projects/:id/stats       KPIs: totalLeads, newThisWeek, approvalRate, replyRate:null
GET  /api/projects/:id/leads       ?status&minScore&source&q
GET  /api/projects/:id/leads/:leadId
POST /api/projects/:id/leads/:leadId/approve   { notes? }
POST /api/projects/:id/leads/:leadId/reject    { notes? }
POST /api/projects/:id/score                   runs runScoring with MockScorer if SCORE_MOCK=1 else HermesScorer
GET  /api/projects/:id/export.csv              ?preset=all|emails_only&status&minScore&source&q
POST /api/projects/:id/import.csv              multipart or raw text body + JSON mapping
```

Use `createApp({ db, scorer?, allowlist })` factory so tests inject in-memory DB + MockScorer + AUTH_BYPASS.

- [ ] Write comprehensive `api.test.ts` with AUTH_BYPASS:
  - create project → import leads via API or seed → list → score → approve → export
- [ ] Commit: `feat: add dashboard API and createApp factory`

---

## Task 6: Frontend (public/) + server entry

**Files:** `src/public/index.html`, `app.js`, `styles.css`, `src/dashboard/server.ts`

UI requirements (lean):
1. Login page link to `/auth/google` (or auto-bypass banner in bypass mode)
2. Project selector dropdown + "New project" form (name + ICP)
3. KPI strip
4. Lead table with filters (status, min score) + sort by score
5. Click row → detail panel: reasons, Approve / Reject
6. Buttons: Run scoring, Export All, Export Emails, Import CSV (file input)
7. Minimal CSS — readable, not a design system

- [ ] `npm run dashboard` → `tsx src/dashboard/server.ts` on PORT 3000
- [ ] Manual smoke with AUTH_BYPASS=1
- [ ] Commit: `feat: add dashboard UI and server entrypoint`
- [ ] Add `docs/dashboard-setup.md`

---

## Definition of done (Phase 3)

- `npm test` all green including dashboard API tests
- `npm run typecheck` clean
- With `LEADRADAR_AUTH_BYPASS=1 npm run dashboard`, can: create project, see leads, score, approve/reject, export CSV, import CSV
- No RAG/Telegram code

## Verification checklist (controller)

1. Full `npm test` + typecheck
2. API integration test path: project → seed gated leads → score → approve → export contains email
3. Cross-project isolation still holds on approve/export
4. Allowlist rejects non-listed email in unit test of `isAllowlisted`
