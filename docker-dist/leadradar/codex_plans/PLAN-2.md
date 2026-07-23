# Next Phase Plan: Production Company Enrichment V1

## Summary

Checked the Apify lead-finding implementation: it matches the prior plan, `npm run typecheck` is clean, and `153` tests pass. One note: the Apify work is currently present as working-tree changes on `feat/apify-lead-finding-v1`, so commit it before starting this next phase.

Next phase should be **Company Enrichment**, not contact/person finding yet. Lead finding now gives candidate companies/domains; enrichment should prove what each company is, whether its website is usable, and collect evidence for later Hermes scoring and contact finding.

This phase enriches:

- company website health
- final canonical homepage URL
- title/meta description
- about/contact/team/pricing/careers/blog page URLs
- company description
- category/industry hints
- location hints
- social/profile links
- emails found on public company pages, but not person matching yet
- evidence snippets and confidence

## Key Changes

- Add a company enrichment module that runs after lead finding against existing project leads with websites.
- Keep the current `leads` table compatible, but add richer enrichment storage:
  - `company_enrichment_runs`
  - `company_enrichment_jobs`
  - `company_pages`
  - `company_profiles`
  - `company_evidence`
- Replace the old homepage-only `website-enricher` behavior with an HTTP-first crawler:
  - fetch homepage
  - follow same-domain links likely to be `about`, `contact`, `team`, `pricing`, `careers`, `blog`, `press`
  - max 8 pages per company by default
  - max depth 1 by default
  - timeout 10 seconds per page
  - concurrency 5 companies by default
- Use plain `fetch`/HTML parsing first. Add Crawlee/Playwright fallback later only for failed high-value domains; do not make browser crawling the default.
- Add `companyEnrichment` config under `source_config`:

```json
{
  "companyEnrichment": {
    "enabled": true,
    "maxCompanies": 100,
    "maxPagesPerCompany": 8,
    "concurrency": 5,
    "timeoutSeconds": 10,
    "respectRobots": true,
    "autoAfterLeadFinding": false
  }
}
```

- Add API route:
  - `POST /api/projects/:id/enrich-companies`
  - returns run summary: `runId`, `companiesQueued`, `companiesEnriched`, `pagesFetched`, `evidenceSaved`, `emailsFound`, `failed`, `errors[]`
- Dashboard can add a separate **Enrich companies** action after **Find leads**. Do not auto-run by default.

## Implementation Details

- Candidate selection:
  - project-scoped leads only
  - must have `website` or `canonical_domain`
  - skip already enriched domains unless `force: true`
  - skip blocked hosts/social/directories from discovery filters
- Page discovery:
  - start from normalized homepage
  - parse links from HTML
  - keep only same-domain links
  - rank URLs by path keywords: `about`, `contact`, `team`, `company`, `pricing`, `careers`, `jobs`, `blog`, `press`
  - dedupe URLs before fetch
- Extraction:
  - title
  - meta description
  - OpenGraph title/description
  - JSON-LD organization fields where present
  - visible text snippet
  - public emails from page text and `mailto:`
  - social links for LinkedIn/X/GitHub/Facebook/Instagram, stored as evidence only
  - location hints from schema/footer/contact text
- Profile output:
  - one `company_profiles` row per lead/domain
  - store best description, category hints, location hints, social links JSON, email candidates JSON, confidence
  - update current `leads.email` only when a direct public company email is found and the lead has no email
- Failure behavior:
  - one failed company does not fail the run
  - failed pages are recorded with status/error
  - failed domains can be retried later
  - HTTP non-HTML pages are skipped
  - redirects update final homepage URL when valid
- Cost/control:
  - no Hermes calls in this phase
  - no paid APIs in this phase
  - no person/contact inference in this phase
  - cache page fetches by URL for 7 days
  - cap stored raw text snippets to avoid DB bloat

## Test Plan

- Unit tests:
  - URL normalization and same-domain filtering
  - page link ranking
  - HTML title/meta/JSON-LD extraction
  - email extraction from `mailto:` and text
  - social link extraction
  - confidence calculation
- Repository tests:
  - create enrichment run
  - create/update enrichment jobs
  - insert/list company pages
  - upsert company profile by project/domain
  - store evidence snippets with capped text
- Orchestrator tests:
  - enriches multiple leads with mocked fetch
  - skips already enriched domains
  - handles one failed website without failing run
  - respects `maxCompanies`, `maxPagesPerCompany`, and concurrency
  - updates `leads.email` only when missing
- API tests:
  - `POST /api/projects/:id/enrich-companies` returns summary
  - returns `404` for missing project
  - returns `400` when no eligible company websites exist
  - keeps enrichment project-scoped
- Regression:
  - existing lead finding, ingest, scoring, feedback, and export tests continue passing
  - `npm run typecheck`
  - `npm test -- --run`

## Assumptions and Defaults

- The completed Apify lead-finding work should be committed before this phase starts.
- This phase is **company enrichment only**.
- Responsible person finding comes after this phase.
- Email verification comes after responsible person/contact modeling.
- Browser crawling is deferred; HTTP-first enrichment is the default for cost control.
- Default enrichment is manually triggered, not automatic after lead finding.
- Official references to use during implementation:
  - Crawlee: https://crawlee.dev/
  - Playwright: https://playwright.dev/docs/intro
  - Apify datasets, for compatibility with the previous phase: https://docs.apify.com/platform/storage/dataset
