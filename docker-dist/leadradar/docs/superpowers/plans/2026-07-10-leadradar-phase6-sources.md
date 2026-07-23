# LeadRadar — Phase 6 (More Sources) Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans.

**Goal:** Add Product Hunt API, Google Custom Search API, and website enrichment crawler as source adapters. Each only `fetch → map to canonical`. Validation stays aggregate via existing `runIngest`.

**Architecture:**
- `ProductHuntSource` — GraphQL/API with injectable fetch; maps to CanonicalLead
- `GoogleSearchSource` — Custom Search JSON API; maps title/url/snippet
- `WebsiteEnricher` — given websites, fetch pages, extract mailto + title (not a Source for discovery; enrichment step after merge or as post-process)
- `createConfiguredSources(project)` — reads `source_config` JSON on project
- CLI: `npm run ingest -- <projectId>` runs configured sources + validateAggregate
- All HTTP via injectable `fetch` for tests (no live network in CI)

**Env:** `PRODUCTHUNT_TOKEN`, `GOOGLE_CSE_ID`, `GOOGLE_CSE_KEY` — adapters no-op or throw clear error if missing when used for real runs; tests always inject mock fetch.

**Out of scope:** Apify, LinkedIn, outreach, changing validation order.

---

## Tasks

### Task 1: Product Hunt adapter
- `src/sources/producthunt-source.ts` + tests with mock fetch
- Commit: `feat: add Product Hunt API source adapter`

### Task 2: Google Custom Search adapter
- `src/sources/google-search-source.ts` + tests
- Commit: `feat: add Google Custom Search source adapter`

### Task 3: Website enrichment
- `src/sources/website-enricher.ts` — input CanonicalLead[], output with emails filled when found
- Tests with mock HTML containing mailto:
- Commit: `feat: add website content enricher for emails`

### Task 4: Source registry + ingest CLI
- `src/sources/registry.ts` — build sources from project.sourceConfig
- `src/cli/ingest-project.ts` — fetch all → optional enrich → runIngest
- Update `docs/` with API key setup
- Integration test: mock sources → runIngest → gated leads
- Commit: `feat: add source registry and multi-source ingest CLI`

## Definition of done
- Mocked unit tests for all adapters
- Multi-source ingest test proves aggregate dedup still works
- Full suite green

## Verification
1. `npm test`
2. Integration test with two mock sources sharing a domain → one gated lead
