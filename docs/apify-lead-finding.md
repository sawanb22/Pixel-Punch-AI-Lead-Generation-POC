# Apify lead finding

Lead finding discovers **company name + website/domain** candidates. The dashboard **Find leads** path is **Apify-only**: Hermes (or a deterministic fallback) drafts a human-readable **lead plan**, and LeadRadar compiles that plan into Apify actor jobs. No Product Hunt / Jina / Google CSE on that path.

## One-click flow (recommended)

1. Set `APIFY_TOKEN` in `.env`.
2. Create a project with plain-English ICP + optional geography + volume (25–2000).
3. Optional: regenerate plan or send feedback (`POST /api/projects/:id/lead-plan/...`).
4. Click **Find leads** (`POST /api/projects/:id/ingest`) — uses the stored plan, not user JSON.
5. Inspect Activity via `GET /api/projects/:id/discovery/latest`.

Planner env (isolated from scoring):

```text
HERMES_PLAN_MODEL=hermes-lead-planner
HERMES_PLAN_API_BASE=   # optional; defaults to HERMES_API_BASE
HERMES_PLAN_API_KEY=    # optional; defaults to HERMES_API_KEY
```

## Environment

```text
APIFY_TOKEN=apify_api_...
LEADFINDING_MODE=apify_first
LEADFINDING_MAX_CANDIDATES=500
LEADFINDING_MAX_APIFY_JOBS=10
```

`APIFY_TOKEN` is required for **Find leads**. Missing token returns a clear `400`.

## Advanced: project `source_config.leadFinding`

Legacy / scripted runs can still pass explicit Apify sources in `source_config` (not shown in the dashboard UI):

```json
{
  "leadFinding": {
    "mode": "apify_first",
    "maxCandidates": 500,
    "maxApifyJobs": 10,
    "maxRuntimeSecondsPerJob": 600,
    "concurrency": 2,
    "sources": [
      {
        "id": "google-maps-restaurants-nyc",
        "type": "apify",
        "enabled": true,
        "actorId": "compass/crawler-google-places",
        "input": {
          "searchStringsArray": ["restaurants in New York"],
          "maxCrawledPlacesPerSearch": 100
        },
        "mapping": {
          "companyField": "title",
          "websiteField": "website",
          "sourceUrlField": "url"
        }
      }
    ]
  }
}
```

### Required mapping fields

| Field | Required | Purpose |
|-------|----------|---------|
| `companyField` | yes | Actor dataset path for company name (dot paths allowed, e.g. `place.name`) |
| `websiteField` | yes | Path for company website |
| `sourceUrlField` | no | Path for listing/profile URL |
| `locationField` | no | Reserved for future enrichment |
| `categoryField` | no | Reserved for future enrichment |

Use `taskId` instead of `actorId` when running a saved Apify task:

```json
{
  "id": "my-task",
  "type": "apify",
  "taskId": "username/task-name",
  "mapping": {
    "companyField": "name",
    "websiteField": "website",
    "sourceUrlField": "url"
  }
}
```

Set `allowCompanyOnly: true` only when the actor legitimately returns companies without websites.

## Source packs

If `sources` is empty but `pack` is set (or inferred later from ICP), starter templates are used. Pack IDs:

- `local_business`
- `saas_startup`
- `ecommerce`
- `b2b_general`
- `hiring_intent`

Pack actor IDs are **examples**. Replace them with verified [Apify Store](https://apify.com/store) actors or your own tasks before production spend.

Query templates support `{{niche}}`, `{{category}}`, `{{city}}`, and `{{role}}`.

## Find leads behavior

Dashboard **Find leads** (`POST /api/projects/:id/ingest`):

1. Ensure / load the project **lead plan**.
2. Compile plan → Apify jobs (Google search + Maps templates).
3. Run discovery; write `discovery_runs` / jobs / candidates; insert kept leads.

Discovery response includes:

- `runId`, `plan`, `sourcesRun`, `fetched`, `kept`, `rejected`, `duplicates`, `skippedExisting`, `costEstimate`, `errors[]`

One failed Apify job does not fail the whole run; its error is recorded in `errors` and `discovery_source_jobs`.

## Guardrails

- Volume steps: `25 / 50 / 100 / 250 / 500 / 1000 / 2000`
- Default max Apify jobs: `10`
- Default concurrency: `2`
- Default actor timeout: `10 minutes`
- Raw payloads are stored capped (~8KB) on `discovered_candidates`
- Noise filter drops social hosts, directories, job boards, and empty companies
- Dedupes by canonical domain (fallback: normalized company name)

## Adding a new Apify actor

1. Confirm the actor/task in Apify Console and note sample dataset fields.
2. Extend `compile-lead-plan.ts` (preferred) or add a `leadFinding.sources[]` entry for scripts.
3. Click **Find leads** and inspect Activity / `discovery_runs` if mapping looks wrong.
4. Tighten `input` limits (`maxItems`, places per search) before raising budgets.

## Official Apify references

- https://docs.apify.com/platform/actors
- https://docs.apify.com/platform/storage/dataset
- https://apify.com/store
