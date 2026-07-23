# LeadRadar E2E Verification Checklist

**Date:** 2026-07-10  
**Spec:** [docs/superpowers/specs/2026-07-10-leadradar-design.md](../superpowers/specs/2026-07-10-leadradar-design.md)  
**Findings:** [2026-07-10-findings.md](./2026-07-10-findings.md)

**Status legend:** `pass` | `fail` | `skip` | `pending-user` | `gap`

## Deferred (not in this run)

- Hermes / OpenRouter LLM cost tracking
- Phase 7 outreach
- Hermes Chroma `knowledge_base` as primary RAG
- Real Google OAuth (bypass only today)
- Google CSE live ingest (replaced by Jina)

## Preflight

| Check | Result | Notes |
|---|---|---|
| Dashboard `:3000` health | pass | `{"ok":true,"bypass":true}` |
| Hermes `:8642` health | pass | hermes-agent 0.18.2 |
| `.env` keys present (names only) | pass | HERMES_API_BASE, HERMES_API_KEY, PRODUCTHUNT_TOKEN, JINA_API_KEY |
| `SCORE_MOCK` unset for real scoring | fail | Process had SCORE_MOCK=1 → F-001 |

---

## A. Automated regression

| ID | Case | Who | Result | Evidence |
|---|---|---|---|---|
| A1 | `npm test` all green | agent | pass | 113/113 |
| A2 | `npm run typecheck` clean | agent | pass | tsc --noEmit clean |
| A3 | DB / project_id isolation (suite) | agent | pass | Covered by repo tests + H1 |

## B. Phase 0–1 — Foundation + CSV

| ID | Case | Who | Result | Evidence |
|---|---|---|---|---|
| B1 | Create project with ICP | agent | pass | project id=4 |
| B2 | CSV import → validate (junk rejected) | agent | pass | kept=1 rejected=1 |
| B3 | Aggregate dedup | agent | fail | GoodCo 1→2; F-003 |

## C. Phase 2 — Hermes scoring + MCP

| ID | Case | Who | Result | Evidence |
|---|---|---|---|---|
| C1 | MCP tools discoverable (5 tools) | agent | pass | hermes mcp test leadradar |
| C2 | Real score without `--mock` | agent | pass | scored=2 via HermesScorer CLI path |
| C3 | Hermes `/v1/chat/completions` healthy | agent | pass | content=pong |
| C4 | Pattern B: backend owns loop/DB writes | agent | pass | runScoring → saveScore |

## D. Phase 3 — Dashboard

| ID | Case | Who | Result | Evidence |
|---|---|---|---|---|
| D1 | Auth bypass `/health` + `/api/me` | agent | pass | dev@local |
| D2 | Project selector (project 3) | agent + user visual | pass | API + user confirmed UI ok |
| D3 | Lead table filter/search | agent | pass | status=scored count=2; q=Acme → 1 |
| D4 | Approve/reject → feedback | agent | pass | POST …/approve → approved |
| D5 | Run scoring (Hermes, not mock) | agent | fail | MockScorer used; F-001 |
| D6 | CSV export All / Emails | agent | pass | export.csv all + emails_only; F-007 alias |
| D7 | CSV import via UI | user | pending-user | Optional file upload |

## E. Phase 4 — Feedback + RAG

| ID | Case | Who | Result | Evidence |
|---|---|---|---|---|
| E1 | `record_feedback` persists | agent | pass | stats total=1 |
| E2 | File RAG sync on feedback | agent | pass | lead_10.md written |
| E3 | Scoring uses similar-lead context | agent | fail | twin score errors=1; F-004 |
| E4 | Spec gap: file RAG vs Hermes KB | agent | gap | F-008 |

## F. Phase 5 — Telegram

| ID | Case | Who | Result | Evidence |
|---|---|---|---|---|
| F1 | Bot reachable (Hermes reply) | user | pass | User: bot replies correctly |
| F2 | `npm run top-picks -- 3` | agent | pass | 3 clarify payloads printed |
| F3 | Clarify → `feedback.source=telegram` | user | fail | Clarify lacked lead identity; user correctly refused blind tap — F-012 |

## G. Phase 6 — Sources

| ID | Case | Who | Result | Evidence |
|---|---|---|---|---|
| G1 | Product Hunt ingest | agent | pass | producthunt sources on project 3 |
| G2 | Jina ingest | agent | pass | jina sources on project 3 |
| G3 | Website enrich when enabled | agent | pass | enrich:true in config |
| G4 | Jina hit quality (noise) | agent | fail | 4 noise leads; F-005 |
| G5 | Google CSE skipped (intentional) | agent | gap | F-011 |

## H. Isolation / multi-project

| ID | Case | Who | Result | Evidence |
|---|---|---|---|---|
| H1 | Leads not visible across projects | agent | pass | no shared lead ids |
| H2 | Feedback/stats scoped per project | agent | pass | stats scoped by project_id |

## Summary (filled at end)

- Blockers: none (suite runnable; no hard stop)
- Majors: **F-001** (SCORE_MOCK on dashboard), **F-003** (no DB-aware dedup), **F-005** (Jina listicle/reddit noise)
- Minors: F-002, F-004, F-006, F-007
- Gaps / deferred: F-008 (file RAG vs Hermes KB), F-009 (Google OAuth), F-011 (CSE → Jina)
- Closed: F-010 (5 MCP tools intentional)

### Recommended fix order (next session)

1. F-001 — Ensure dashboard starts without SCORE_MOCK unless intended  
2. F-003 — Dedup ingest against existing project leads before insert  
3. F-005 — Filter Jina noise (blocklist hosts / listicle title heuristics)  
4. F-006 — Prefer Product Hunt product homepage URL  
5. F-007 — Accept `emails` alias or fix UI query param  
6. F-004 — Surface scoring errors (don’t leave lead gated silently)  
7. F-002 — Show `name (id)` in project selector  

### Still pending your input

- D7 (optional CSV import) — skip unless you want it
- F3 — **failed** (F-012 / F-013); no further Telegram taps needed for this run
