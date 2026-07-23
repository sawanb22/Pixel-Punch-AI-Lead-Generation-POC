# Apify lead finding

Lead finding discovers **company name + website/domain** candidates. The dashboard **Find leads** path is **Apify-only** and uses the **Strategic Payload Generator**:

1. Hermes (or a deterministic fallback) drafts a **strategic payload** — Apify actor keys + input JSON + reasoning.
2. Code **validates** the payload against the project's **enabled actor pool**.
3. Jobs run on Apify; results are filtered, deduped, and inserted into the **active lead list**.
4. The **Operations Console** shows planner input, raw Hermes output, validated payload, and compiled jobs.

Design: [docs/superpowers/specs/2026-07-11-strategic-payload-generator-design.md](superpowers/specs/2026-07-11-strategic-payload-generator-design.md) · Plan: [codex_plans/PLAN-3.md](../codex_plans/PLAN-3.md)

## One-click flow (recommended)

1. Set `APIFY_TOKEN` in `.env`.
2. Create a project with plain-English ICP + optional geography + volume (25–2000).
3. In **Project settings**, pick **Enabled lead sources** (Maps, Wellfound, Google Search, LinkedIn jobs). Agency default: Maps + Wellfound.
4. Optional: regenerate plan or send feedback (`POST /api/projects/:id/lead-plan/...`).
5. Optional: create a **Lead list** for a new campaign (keeps prior hunts intact).
6. Click **Find leads** (`POST /api/projects/:id/ingest`).
7. Inspect **Operations** via `GET /api/projects/:id/discovery/latest` (or pick a past run).

Planner env (isolated from scoring):

```text
HERMES_PLAN_MODEL=hermes-lead-planner
HERMES_PLAN_API_BASE=   # optional; defaults to HERMES_API_BASE
HERMES_PLAN_API_KEY=    # optional; defaults to HERMES_API_KEY
```

## Actor catalog

| Key | Actor ID | Best for |
|-----|----------|----------|
| `google_maps` | `compass/crawler-google-places` | Local SMBs |
| `google_search` | `apify/google-search-scraper` | Narrow intent queries only |
| `wellfound_startups` | `radeance/wellfound-job-listings-scraper` | US startups / hiring |
| `linkedin_jobs` | `curious_coder/linkedin-jobs-scraper` | Role-intent / hiring |

Catalog code: [`src/discovery/actor-catalog.ts`](../src/discovery/actor-catalog.ts). Hermes may only pick keys from the project's `lead_strategy.enabledActorKeys`.

## Lead lists

Within a project:

- `GET/POST /api/projects/:id/lead-lists`
- `POST .../lead-lists/:listId/activate`
- `POST .../lead-lists/:listId/clear`
- `DELETE .../lead-lists/:listId`

Leads, discovery runs, and Operations history are scoped to the **active** list. Domain dedupe is per-list.

## Operations Console APIs

| Endpoint | Purpose |
|----------|---------|
| `GET .../discovery/latest` | Full observability for active list's latest run |
| `GET .../discovery/runs` | Last 10 runs (picker) |
| `GET .../discovery/runs/:runId` | Full detail for one run |
| `GET .../lead-plan` | Plan + strategy + website summary |

Snapshot columns on `discovery_runs`: `planner_input_json`, `planner_raw_json`, `payload_json`, `compiled_jobs_json`, `validation_notes`.

## Environment

```text
APIFY_TOKEN=apify_api_...
LEADFINDING_MODE=apify_first
LEADFINDING_MAX_CANDIDATES=500
LEADFINDING_MAX_APIFY_JOBS=10
```

`APIFY_TOKEN` is required for **Find leads**. Missing token returns a clear `400`.

## Advanced: project `source_config.leadFinding`

Legacy / scripted runs can still pass explicit Apify sources in `source_config` (not shown in the dashboard UI). Prefer strategic payload + enabled sources for dashboard Find leads.

## Find leads behavior

1. Refresh cached `website_summary` if stale (>7 days).
2. If the list plan is **ready**, Find leads **executes the locked stored payload** (same hunt contract). Check **Force replan** to regenerate with Hermes.
3. On **Force replan**, a compact **revision brief** from the latest completed list hunt (job summaries, fetch/keep/reject stats, top rejection reasons, circuit-breaker flag) is added to the Hermes prompt so the new plan can avoid repeating junk patterns. No raw leads are sent. If there is no prior completed run, replan behaves like a fresh generate.
4. Otherwise Hermes generates a strategic payload from ICP + enabled actors + feedback.
5. Validator allowlists actors, applies negatives, caps volume; falls back if needed.
6. Run Apify jobs sequentially with a **quality circuit breaker** (stops further jobs if junk ratio is too high).
7. **Hard Shield** drops known junk (media, platforms, directories, gov/edu, listicles).
8. **Buyer Evidence Gate** scores survivors → `gated` (fit), `provisional` (maybe), or reject.
9. Insert kept leads into the active lead list; store observability snapshots.
10. Reject / discard flywheel appends domains and note tokens to list plan negatives.

## Guardrails

- Volume steps: `25 / 50 / 100 / 250 / 500 / 1000 / 2000`
- Max jobs per payload: 3–6 by volume
- Hard shield drops social hosts, directories, job boards, vendor/media/platforms, gov/edu, and plan negatives
- Buyer evidence gate quarantines mid-ICP matches as `provisional` (Promote / Discard in UI)
- Wellfound profile domains allowed only when the job `actorKey` is `wellfound_startups`
- Dedupes by canonical domain within the active lead list
- Circuit breaker trips when rejected/(kept+rejected) > 60% after ≥8 decisions

## Adding a new Apify actor

1. Confirm the actor/task in Apify Console and note sample dataset fields.
2. Add an entry to `actor-catalog.ts` with mapping + `descriptionForPlanner`.
3. Enable the key on a project and run Find leads; inspect Operations Console.
4. Tighten input limits before raising budgets.

## Official Apify references

- https://docs.apify.com/platform/actors
- https://docs.apify.com/platform/storage/dataset
- https://apify.com/store
