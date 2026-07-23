# LeadStrategy (Phase 2) — Design Spec

**Date:** 2026-07-11  
**Status:** Approved for implementation (Option C)  
**Priority:** Lead quality + volume, low cost  
**Tracker:** [discovery-enrichment-roadmap.md](../plans/2026-07-11-discovery-enrichment-roadmap.md)

## Decision

Ship Phase 2 as **Option C**: store strategy JSON on projects, deterministic defaults, Hermes generate draft (not auto-save), API get/put/generate, dashboard JSON textarea editor. No fancy form UI.

Hermes drafts strategy only. Code owns schema validation, persistence, and later execution.

## Data

- Column: `projects.lead_strategy` TEXT (JSON), nullable  
- Migrate existing DBs via `migrateDatabase`  
- Validated with Zod (`LeadStrategy` v1)

## Shape

`niche`, `targetSegments[]`, `buyerRoles[]`, `negativeSegments[]`, `signals[]`, `sourceMix`, `queryTemplates[]`, `enrichmentPolicy`, `budgets`, `version: 1`

Defaults favor free sources (producthunt + jina on) and modest budgets.

## API

- `GET /projects/:id/strategy` — stored or default  
- `PUT /projects/:id/strategy` — validate + save  
- `POST /projects/:id/strategy/generate` — Hermes draft, return only (client saves)

## Out of scope

Wiring into ingest (Phase 3), crawler (Phase 4), contact resolver (Phase 5), learning (Phase 6), outreach (Phase 7).
