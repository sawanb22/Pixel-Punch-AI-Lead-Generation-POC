# Company enrichment

HTTP-first crawler that enriches project leads with website evidence after lead finding. Does **not** find people/contacts yet.

## Trigger

Dashboard **Enrich companies** → `POST /api/projects/:id/enrich-companies`

Optional body: `{ "force": true }` to re-enrich domains that already have a profile.

## Config (`source_config`)

Paste into **Project settings → Advanced source config (JSON)**:

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

Defaults apply when omitted. Enrichment is manual by default (`autoAfterLeadFinding: false`).

## What it stores

- `company_enrichment_runs` / `company_enrichment_jobs`
- `company_pages` (homepage + about/contact/team/pricing/careers/blog/press)
- `company_profiles` (description, location/category hints, socials, email candidates, confidence)
- `company_evidence` (capped text snippets)
- `page_fetch_cache` (7-day URL cache)

Updates `leads.email` only when the lead has no email and a public company email is found.

## Behavior

- Skips blocked social/directory hosts
- Same-domain link discovery, max 8 pages / depth 1
- One failed company does not fail the run
- No Hermes / paid APIs / browser crawling in this phase
