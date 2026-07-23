# LeadRadar — Phase 4 (Feedback + RAG) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Close the learning loop: every approve/reject writes a labeled feedback document into a **per-project RAG store**; scoring retrieves similar past leads and includes them in the scorer context so future scores improve. SQLite remains source of truth; RAG is derived and rebuildable.

**Architecture:**
- `FeedbackRag` interface: `upsert(doc)`, `similar(projectId, queryText, k)`, `rebuildFromDb(projectId)`.
- Default impl: **file-backed per-project corpus** at `data/rag/project_{id}/*.md` + **pure-JS bag-of-words cosine retrieval** (no native deps; fully unit-testable on Windows).
- On `recordFeedback`, also upsert a RAG doc (company, website, score, good/bad, notes).
- `runScoring` fetches top-k similar docs and passes them into `Scorer.scoreLead` via an optional `context` argument (extend Scorer interface carefully with optional 3rd param or options object — prefer options object to avoid breaking MockScorer).
- Docs explain how to point Hermes `knowledge_base` / `hermes docs add` at `data/rag/project_{id}/` for real semantic RAG when Hermes is installed.
- Optional sync: `HERMES_DOCS_SYNC=1` runs `hermes docs add <dir>` after upsert (best-effort; ignore if hermes missing).

**Tech:** existing stack only (+ maybe nothing new). No chromadb native install required for Phase 4 tests.

**Out of scope:** Telegram, new scrapers, real Chroma dependency in CI.

---

## File Structure

```
src/rag/types.ts
src/rag/feedback-rag.ts          interface
src/rag/file-feedback-rag.ts     file corpus + bag-of-words retrieval
src/rag/sync-feedback.ts         recordFeedback → upsert RAG; rebuildFromDb
src/scoring/scorer.ts            EXTEND ScoreContext optional
src/scoring/mock-scorer.ts       use context if present (mention in reasons)
src/scoring/hermes-scorer.ts     include similar leads in user prompt
src/scoring/run-scoring.ts       retrieve similar before scoreLead
src/feedback/feedback.repo.ts    call sync after insert (injectable rag)
tests/rag/*.test.ts
docs/rag-setup.md
```

---

## Task 1: RAG types + file-backed store

- [ ] `FeedbackDoc { projectId, leadId, company, website, email, score, good, notes, text }`
- [ ] `FileFeedbackRag(baseDir)` — upsert writes `lead_{id}.md`; similar() ranks by cosine of term vectors
- [ ] Tests: upsert two docs in project 1; query similar to one; project 2 isolation (no bleed)
- [ ] Commit: `feat: add per-project file-backed feedback RAG store`

## Task 2: Sync from feedback + rebuild

- [ ] `syncFeedbackToRag(db, rag, projectId, leadId)` — load lead+latest feedback → upsert
- [ ] `rebuildProjectRag(db, rag, projectId)` — clear project dir, re-upsert all feedback rows
- [ ] Hook: after `recordFeedback`, call sync (pass rag instance; default FileFeedbackRag)
- [ ] Tests
- [ ] Commit: `feat: sync feedback into RAG and support rebuild`

## Task 3: Wire scoring context

- [ ] Extend `Scorer.scoreLead(lead, project, context?: { similar: FeedbackDoc[] })`
- [ ] `runScoring` builds query from lead company+website+icp, calls `rag.similar`, passes context
- [ ] MockScorer: if similar has a `good:true` doc, boost score by +10 (cap 100) and mention in reasons
- [ ] HermesScorer: append "Similar past leads:" section to prompt
- [ ] Tests: with prior good feedback on similar company, MockScorer score increases
- [ ] Commit: `feat: scoring retrieves similar feedback for context`

## Task 4: Dashboard + MCP + docs

- [ ] Ensure approve/reject API path triggers RAG sync (via recordFeedback hook)
- [ ] CLI: `npm run rag:rebuild -- <projectId>`
- [ ] `docs/rag-setup.md` — Hermes knowledge_base pointing at `data/rag/project_N/`
- [ ] Full `npm test` + typecheck
- [ ] Commit: `feat: wire RAG into dashboard feedback path and document Hermes KB`

---

## Definition of done

- Unit tests prove per-project isolation and retrieval
- Scoring with prior good feedback changes MockScorer output
- Full suite green; no Telegram/scraper work

## Verification (controller)

1. `npm test` + typecheck
2. Seed project → score → approve a lead → ingest similar lead → score again → reasons/score reflect similar context
3. Confirm project 2 RAG empty when only project 1 has feedback
