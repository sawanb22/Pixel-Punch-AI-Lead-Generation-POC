# Strategic Payload Generator — Design Spec

**Date:** 2026-07-11  
**Status:** Approved — ready to implement  
**Full implementation plan:** [codex_plans/PLAN-3.md](../../../codex_plans/PLAN-3.md)

---

## What we're building

Replace the current Find leads pipeline (Hermes writes Google search strings → rigid compile → mostly Google Search) with:

1. **AI Strategic Payload Generator** — Hermes picks Apify actors + input JSON per project ICP
2. **Per-project actor pools** — each project enables Maps, Wellfound, LinkedIn, Google, etc.
3. **Operations Console** — dashboard shows planner input, raw Hermes output, validated payload, compiled jobs in separate fields
4. **Lead Lists** — multiple named lead campaigns inside one project (switch / new / clear / delete)
5. **Website summary** — optional fetch of `project.website` to enrich planning

---

## Why

Current runs return payment vendors, blogs, and big brands (Visa, Razorpay) because Google topic queries rank articles about services, not buyers who need agency builds.

---

## Architecture (one paragraph)

User configures project (ICP, enabled actors, website). On Find leads, system loads active **lead list**, builds planner input (ICP + website summary + feedback), Hermes returns strategic payload with 1–3 Apify jobs, code validates actor keys and banned keywords, runs Apify, maps/filters/dedupes, inserts leads into **active list only**. Full JSON snapshots stored on discovery run for Operations Console.

---

## Key data additions

| Table / column | Purpose |
|----------------|---------|
| `projects.lead_strategy` | `enabledActorKeys`, `buyerMode`, geography |
| `projects.website_summary` | Cached homepage summary for planner |
| `projects.active_lead_list_id` | Which list is active |
| `lead_lists` | Named campaigns per project |
| `leads.lead_list_id` | Scope leads to list |
| `discovery_runs.*_json` | Planner input, raw Hermes, validated payload, compiled jobs |

---

## Phase 1 vs Phase 2

| Phase 1 (this build) | Phase 2 (later) |
|----------------------|-----------------|
| Manual Lead Plan feedback | `scraping_feedback` auto-learn from rejects |
| Per-project actor pools | Per-list strategy override |
| Operations Console | — |
| Lead Lists | — |

---

## Success criteria

See checklist in [PLAN-3.md](../../../codex_plans/PLAN-3.md).

---

## Open at implementation time

- Verify exact Apify `actorId` for Wellfound and LinkedIn actors (smoke test in Apify Console)
- Confirm Wellfound mapping fields from sample dataset
