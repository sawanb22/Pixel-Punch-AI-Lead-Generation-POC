# Production Lead Finding V1: Apify-First, Any-Project

## Summary

Build **lead finding only** as a production-ready discovery layer that turns any project ICP into candidate companies/domains. Apify becomes the primary acquisition engine, with existing sources like Product Hunt, Jina, Google CSE, and CSV kept as secondary adapters.

This phase stops at:

- company name
- website/domain
- source
- source URL
- discovery query/input
- raw evidence
- confidence/noise flags

This phase does **not** handle contact finding, email discovery, enrichment, Hermes scoring, or outreach.

## Key Changes

- Add a project-level `leadFindingConfig` inside `source_config`.
- Add an Apify integration as a generic source runner:
  - supports `actorId` or `taskId`
  - sends project-specific input
  - reads Apify dataset results
  - maps results into candidate company leads
  - records source metadata and errors
- Add a `discovery run` concept:
  - run id
  - project id
  - source jobs
  - fetched count
  - kept count
  - duplicate count
  - rejected/noise count
  - cost/credit estimate where available
  - status: `queued`, `running`, `completed`, `failed`
- Keep the existing `Source` adapter pattern, but introduce a richer internal discovery shape before converting to current `CanonicalLead`.

Minimum internal candidate shape:

```ts
interface DiscoveredCompanyCandidate {
  company: string;
  website: string | null;
  domain: string | null;
  source: string;
  sourceType: "apify" | "api" | "csv" | "search";
  sourceUrl: string | null;
  discoveryQuery: string | null;
  rawPayload: unknown;
  confidence: number;
  rejectionReason?: string;
}
```

Existing `CanonicalLead` remains the compatibility output for the rest of the current pipeline.

## Lead Finding Workflow

1. **Project Strategy Input**
   - Read project name, website, description, ICP, and `source_config`.
   - If explicit source config exists, use it.
   - If not, generate default source jobs from project ICP and target niche.

2. **Source Pack Selection**
   Use Apify-first source packs depending on project type:

   - **Any B2B/SaaS/startup project**
     - Product Hunt actors or existing Product Hunt API
     - startup directories
     - SaaS/tool directories
     - search result actors
     - GitHub/search sources if developer-related

   - **Local business project**
     - Google Maps-style Apify actors
     - local directory actors
     - category + city search actors

   - **Ecommerce/project needing store leads**
     - Shopify/store directory actors
     - marketplace actors
     - search result actors for niche stores

   - **Hiring/intent-based project**
     - job board actors
     - company career page search actors
     - Greenhouse/Lever-style public job sources where allowed

   - **General fallback**
     - broad search actors
     - Jina search
     - SearXNG later
     - CSV import

3. **Apify Job Execution**
   - For each source job, run Apify Actor/Task through API.
   - Use per-job limits:
     - max results
     - timeout
     - retry count
     - max cost/credits
   - Store run metadata and dataset id.
   - Pull dataset items after actor completion.
   - Fail one source job without failing the whole discovery run.

4. **Result Mapping**
   - Each Apify source config must define result mappings:
     - `companyField`
     - `websiteField`
     - `sourceUrlField`
     - optional `locationField`
     - optional `categoryField`
   - Normalize website/domain.
   - Drop rows without company and without website unless source is explicitly allowed to produce company-only leads.
   - Keep raw payload for debugging and future enrichment.

5. **Noise Filtering**
   Deterministically reject:
   - listicle pages
   - marketplaces/directories as the company itself
   - social-only URLs unless source config allows it
   - job pages as company websites
   - duplicate domains
   - blocked hosts like LinkedIn, Facebook, Reddit, YouTube as primary websites
   - empty company names
   - obvious non-business pages

6. **Deduplication**
   - Primary key: canonical domain.
   - Fallback key: normalized company name + source category.
   - Merge sources when the same company appears multiple times.
   - Prefer direct company website over directory/profile URL.
   - Keep all contributing source names and source URLs.

7. **Persist/Export to Current Pipeline**
   - Convert kept candidates to current `CanonicalLead`.
   - Insert as `gated/raw` leads using existing ingest path.
   - Preserve source names in `sources[]`.
   - Store richer source/evidence data in new discovery tables so production debugging is possible.

## Apify Configuration Shape

Add this shape under project `source_config`:

```json
{
  "leadFinding": {
    "mode": "apify_first",
    "maxCandidates": 500,
    "maxApifyJobs": 10,
    "maxRuntimeSecondsPerJob": 600,
    "sources": [
      {
        "id": "google-maps-restaurants-nyc",
        "type": "apify",
        "enabled": true,
        "actorId": "apify/google-maps-scraper",
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

Also support `taskId` for preconfigured Apify tasks:

```json
{
  "type": "apify",
  "taskId": "username/task-name",
  "mapping": {
    "companyField": "name",
    "websiteField": "website",
    "sourceUrlField": "url"
  }
}
```

Environment variables:

```text
APIFY_TOKEN=...
LEADFINDING_MODE=apify_first
LEADFINDING_MAX_CANDIDATES=500
LEADFINDING_MAX_APIFY_JOBS=10
```

## Production Guardrails

- Apify is primary, but every actor must be explicitly configured or selected by a known source pack.
- Do not hardcode one actor as universal.
- Do not depend on LinkedIn scraping as a core source.
- Keep source-specific mappers small and testable.
- Store raw payloads, but cap size per row.
- Add per-run and per-source budgets.
- Add retry with backoff for transient Apify/API failures.
- Add partial success behavior: one failed actor does not kill the entire run.
- Add source health stats so bad actors can be disabled.
- Add clear dashboard/API errors for missing `APIFY_TOKEN`, invalid actor input, empty dataset, or mapping failure.

## Implementation Steps

1. **Discovery Data Layer**
   - Add tables for discovery runs, source jobs, and discovered candidates.
   - Keep current `leads` table unchanged for compatibility.

2. **Apify Client**
   - Add a small client for:
     - run actor/task
     - poll run status
     - fetch dataset items
     - normalize Apify errors
   - Use injected fetch for tests.

3. **Generic Apify Source Adapter**
   - Implement `ApifyActorSource`.
   - Accept config, input, mapping, limits, and source id.
   - Return internal discovered candidates.

4. **Lead Finding Orchestrator**
   - Add `runLeadFinding(projectId)`.
   - Load project strategy/source config.
   - Build source jobs.
   - Run jobs with concurrency limit.
   - Normalize, filter, dedupe, persist candidates.
   - Convert kept candidates into current ingest-compatible leads.

5. **Source Packs**
   - Add starter packs:
     - `local_business`
     - `saas_startup`
     - `ecommerce`
     - `b2b_general`
     - `hiring_intent`
   - Each pack defines recommended Apify actor/task configs and query templates.

6. **Dashboard/API**
   - Existing “Find leads” button should trigger lead finding first.
   - Return run summary:
     - sources run
     - candidates fetched
     - kept
     - rejected
     - duplicates
     - errors
   - Show source-level failure messages.

7. **Docs**
   - Document how to add an Apify actor.
   - Document required mappings.
   - Document source pack examples.
   - Document cost/budget defaults.

## Test Plan

- Unit test Apify client with mocked fetch:
  - successful actor run
  - failed actor run
  - timeout
  - empty dataset
  - malformed dataset item

- Unit test result mapping:
  - maps company/website/source URL correctly
  - rejects missing required fields
  - supports nested field paths if implemented

- Unit test noise filters:
  - rejects directories as company websites
  - rejects blocked social hosts as primary websites
  - keeps valid company domains
  - dedupes by canonical domain

- Unit test orchestrator:
  - multiple source jobs
  - one source fails, run still completes
  - max candidates is respected
  - duplicate companies merge sources
  - candidates convert to current `CanonicalLead`

- Integration test:
  - project with Apify source config
  - mocked Apify dataset
  - `Find leads` creates leads through existing pipeline
  - run summary reports fetched/kept/rejected/errors

## Assumptions and Defaults

- User choice locked: **Apify-first**.
- User choice locked: **optimize for any project**, not only SaaS or local businesses.
- Existing Product Hunt, Jina, Google, and CSV sources remain available.
- This phase only improves lead finding; enrichment/contact finding comes later.
- Default max candidates per run: `500`.
- Default max Apify jobs per run: `10`.
- Default source job concurrency: `2`.
- Default actor timeout: `10 minutes`.
- Default behavior on source failure: record error and continue.
- Default dedupe key: canonical domain, then normalized company name.
- Official Apify references to follow during implementation:
  - https://docs.apify.com/platform/actors
  - https://docs.apify.com/platform/storage/dataset
  - https://apify.com/store
