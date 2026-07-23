# LeadRadar — Design Spec

**Date:** 2026-07-10
**Status:** Approved design (pre-implementation)

---

## 1. Purpose

LeadRadar is a **multi-project (multi-tenant) AI lead-generation platform**. You onboard client
businesses one at a time — each is an isolated **project** (e.g. Pixel Punch = project 1) — and for
each project the system generates, cleans, scores, and surfaces leads, improving over time from your
feedback.

The core loop for every project:

```
onboard project → ingest leads (multiple sources) → validate → Hermes scores vs the project's ICP
→ team reviews (dashboard + Telegram) → feedback → per-project RAG learns → next run is smarter
```

Outreach/email sending is intentionally **out of scope for this phase** (parked).

---

## 2. Key principles

- **Deterministic code owns data integrity.** Scraping, mapping, dedup, validation, DB writes, and
  (later) sending are plain, testable code. The LLM is never responsible for data correctness.
- **Hermes owns judgment only.** Scoring and (later) drafting, plus conversational feedback. It
  reaches into our data through a small, fixed tool surface.
- **Everything is project-scoped.** Leads, feedback, RAG, and scoring are isolated per project.
- **Sources are adapters.** Adding a lead source (or a new client project) is additive, never a
  rearchitecture.
- **SQLite is the source of truth.** The RAG index is derived from it and rebuildable at any time.

---

## 3. Components

| Component | Role |
|---|---|
| **Node.js backend** | Owns the pipeline, all data, the dashboard, and the MCP tool interface |
| **SQLite** | Source of truth for projects, leads, feedback, outreach, users |
| **Hermes (Nous open-source agent)** | Hybrid role: scores leads vs project ICP; handles Telegram feedback; hosts the RAG |
| **Hermes `knowledge_base` (ChromaDB)** | Per-project semantic RAG over labeled past leads; local free embeddings |
| **LeadRadar dashboard** | Team web app (Google sign-in): review, approve/reject, run scoring, CSV import/export |
| **Telegram (via Hermes `clarify`)** | Quick approve/reject on top picks per run — no custom bot |
| **Email platform** *(parked)* | Bulk sending + deliverability + tracking, behind a swappable adapter |

### Hermes usage decisions (from research)
- Hermes' **core memory** (MEMORY.md/USER.md + SQLite FTS5) is keyword-only, **not** semantic — so
  it is **not** used for lead similarity.
- Hermes' **`knowledge_base`** feature *is* true semantic RAG (ChromaDB, `hermes docs add/list/remove`,
  auto-retrieval). This is what powers "find similar past leads." One **collection per project**.
- Backend↔Hermes uses **MCP**: the backend exposes an MCP server; Hermes consumes it (config).
- Hermes' Telegram gateway supports inline buttons + the built-in **`clarify`** tool (designed for
  "get post-task feedback") — used for mobile approve/reject.
- Hermes native email (IMAP/SMTP, AgentMail) is a **future** candidate for *reply-handling*, not for
  bulk cold sending.

---

## 4. The `Project` entity (first-class tenant)

Each project holds:
- **Business profile** — name, website, description
- **Ideal Customer Profile (ICP)** — defines a "good lead" for this business; drives both source
  targeting and Hermes scoring
- **Source config** — which adapters + which queries/filters this project uses
- Its own **leads, feedback, outreach**, and **RAG collection**

Isolation model: **logical** — one shared DB, every row carries `project_id`, all queries scoped by
project. Dedup happens **within** a project (the same company can be a lead for two projects
independently).

---

## 5. Pipeline (per project, on-demand — no cron)

```
Onboard project → define ICP + sources
        │
1. INGEST     Each source adapter: fetch → map to canonical shape        [deterministic]
        │
2. MERGE      Combine all sources into one pool for the project
        │
3. VALIDATE   Run ONCE on the aggregate: canonicalize → dedup (within + across sources)
   (aggregate) → MX email check → quality-gate (reject junk before any LLM)   [deterministic]
        │        (only the promising leads pass — caps LLM cost)
4. SCORE      Backend loops gated leads (Pattern B) → Hermes scores each vs the project's ICP,
        │     retrieving similar leads from the project's knowledge_base → save score + reasons
        │                                                                 [Hermes = judgment]
5. REVIEW     Dashboard (project selector) + Telegram clarify (top picks)
        │
6. FEEDBACK   Approve/reject stored with project_id → refreshes that project's RAG collection
        │     → the next run scores better
        ▼
   (OUTREACH — parked)
```

**Validation runs on the aggregate, not per source** (owner decision): this is the only way to catch
**cross-source duplicates** (same company from Product Hunt *and* Google) and it runs expensive checks
(MX, fuzzy match) once per unique lead. Per-source work is limited to cheap field mapping.

**Scoring loop = Pattern B** (backend drives the loop; Hermes is a per-lead score function). Most
deterministic/debuggable; the quality-gate keeps call volume low. Identical 4-tool contract means we
can switch to Hermes-batched (Pattern A) later with no other changes.

---

## 6. Data model (SQLite — logical isolation)

- **`projects`** — id, name, website, description, **icp**, source_config, status, created_at
- **`leads`** — **project_id**, company, canonical_domain, email, sources[], votes, status
  (`raw`/`gated`/`scored`/`approved`/`rejected`), score, reasons, created_at
- **`feedback`** — **project_id**, lead_id, good (bool), notes, reviewed_by, source
  (`dashboard`/`telegram`), created_at
- **`outreach`** *(parked)* — **project_id**, lead_id, sent_at, replied, bounced, campaign_id
- **`users`** — Google identity, allowlisted (team; everyone equal)

Every query scoped by `project_id`.

---

## 7. Backend ↔ Hermes interface (MCP — the entire boundary)

The backend exposes an MCP server with exactly four **project-scoped** tools:

```
get_pending_leads(project_id)                                     → leads needing scoring
save_score_and_draft(project_id, lead_id, score, reasons[, draft])→ write Hermes' judgment
record_feedback(project_id, lead_id, good, notes, reviewed_by)    → from dashboard or Telegram
get_feedback_stats(project_id, filters)                           → SQL aggregates as extra context
```

The `draft` argument on `save_score_and_draft` is **reserved and unused this phase** (drafting is
parked with outreach); the tool is named for forward-compatibility so the contract does not change
when drafting is added.

Hermes always receives the project's **ICP** as scoring context and retrieves from that project's
`knowledge_base` collection. Hermes never touches SQLite directly — only these four tools.

---

## 8. RAG (per-project, semantic)

- One Hermes `knowledge_base` **collection per project** (e.g. `project_{id}_feedback`).
- On feedback, the labeled lead (text + outcome) is embedded into that project's collection.
- Scoring retrieves similar past leads from the same collection → self-improving, **no cross-project
  bleed**.
- Local free embeddings (e.g. all-MiniLM via a custom embedding function). SQLite remains source of
  truth; collections are rebuildable from it.

---

## 9. Dashboard (team)

- **Auth:** Google sign-in (OAuth), restricted to an **email allowlist** (or Workspace domain).
- **Permissions:** everyone equal for v1 (allowlist is the gate).
- **Concurrency:** all leads visible to all; no locking; status shown live; last action wins.
- **Attribution:** feedback records who acted (`reviewed_by`); RAG uses feedback in aggregate.
- **Screens (lean core):**
  - Project selector (scopes everything below)
  - KPI strip (total leads, new this week, approval rate; reply rate shown but only populated once
    outreach tracking exists in a later phase)
  - Lead table (sort/filter by score, status, source)
  - Lead detail (score + reasons + approve/reject/edit)
  - "Run scoring" button (per project)
  - Onboarding screen (create project: profile + ICP + sources)
  - **CSV import/export**

### CSV import/export
- **Import = a manual "CSV source" adapter.** Upload → column mapping (headers → canonical fields) →
  flows through the **same** merge/validate/score pipeline. Bring-your-own lists get deduped,
  verified, and ranked against the project's ICP. v1 = one CSV upload point per project.
- **Export = download button.** Exports the current filtered table view, plus presets **"All"** and
  **"Emails only."** CSV, per project, straight from SQLite.

---

## 10. Sources (adapter pattern)

Each source is an adapter: `fetch → map to canonical shape`. Validation/dedup happens later on the
aggregate. Build order:

1. **CSV upload** (manual source — first, no external API)
2. **Product Hunt** (official API)
3. **Google Custom Search** (official API)
4. **Website enrichment crawler** (polite crawl of a lead's own site for email + context)
5. **Apify** — only where no official API exists

API-first was chosen for lowest cost, least breakage, and stability. Adding a source = one new adapter.

---

## 11. Scope

### In scope (this phase)
Multi-project onboarding; source adapters (CSV first) with aggregate validation; Hermes scoring vs
ICP; per-project RAG feedback loop; team dashboard with review + CSV import/export; Telegram feedback.

### Parked (later)
- Email **drafting** by Hermes (moves with the outreach phase)
- Outreach **sending** (cold-email platform adapter) + reply/bounce tracking
- Hermes native email for **reply-handling**
- Cron scheduling, charts/trends, admin/reviewer roles, per-project access control, physical isolation

---

## 12. Build workflow (phases)

- **Phase 0 — Setup:** install/configure Hermes; Node + SQLite; base tables with `project_id`.
- **Phase 1 — Onboarding + first leads:** create-project flow (profile + ICP); CSV upload + column
  mapping; aggregate validation (dedup + MX + quality-gate).
- **Phase 2 — Connect Hermes:** backend MCP server (4 tools); register in Hermes; Pattern B scoring
  loop vs ICP.
- **Phase 3 — Dashboard:** Google auth + allowlist; project selector + KPI strip + lead table; lead
  detail (score + approve/reject/edit); "Run scoring" button; CSV export.
- **Phase 4 — Feedback + RAG:** wire `record_feedback`; per-project `knowledge_base` collection;
  scoring retrieves from it.
- **Phase 5 — Telegram feedback:** Hermes Telegram gateway; `clarify` on top picks → `record_feedback`.
- **Phase 6 — More sources:** Product Hunt API; Google Custom Search; website enrichment crawler.
- **Phase 7 — Outreach (parked):** drafting; cold-email adapter; reply/bounce tracking; Hermes
  reply-handling.

**Resequencing vs. the owner's original list (with reasons):**
- **DB moved to Phase 0** — you can't store ingested leads without it; it's foundational. (RAG still
  comes later, in Phase 4, as originally ordered.)
- **CSV import is the first source (Phase 1)** — it reuses the whole validate→score pipeline and needs
  no external API, giving the earliest working end-to-end slice; scrapers slot in at Phase 6.
- **Validation on aggregate, not per source** (owner correction) — required to catch cross-source
  duplicates.

---

## 13. Scalability guarantees

- **New client** = create a project (profile + ICP + sources). Fully isolated; nothing else changes.
- **New lead source** = one new adapter; available to all projects.
- **Scale scoring** = switch the loop to Pattern A (Hermes batches) — same 4-tool contract.
- **Swap email provider** (later) = one adapter.
