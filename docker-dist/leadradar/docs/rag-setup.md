# LeadRadar — Feedback RAG setup

LeadRadar keeps **SQLite as the source of truth**. The per-project feedback RAG corpus is
**derived** and rebuildable at any time.

## File-backed corpus (default)

On approve/reject, LeadRadar upserts a markdown document under:

```
data/rag/project_{id}/lead_{leadId}.md
```

Retrieval for scoring uses a pure-JS bag-of-words cosine similarity over that corpus (no native
deps, no Chroma required for CI or local tests).

Override the base directory with `RAG_DIR`. Disable automatic sync with `RAG_SYNC=0`.

### Rebuild from SQLite

```bash
npm run rag:rebuild -- <projectId>
```

This clears `data/rag/project_{id}/` and re-upserts one doc per lead that has feedback (latest row).

## Optional Hermes knowledge_base

When Hermes is installed, you can point its semantic `knowledge_base` at the same folder so Hermes
can retrieve labeled past leads with real embeddings:

```bash
# After feedback has been written (or after rag:rebuild):
hermes docs add data/rag/project_1/
```

Or set `HERMES_DOCS_SYNC=1` so LeadRadar best-effort runs `hermes docs add <projectDir>` after each
feedback upsert (ignored if the `hermes` CLI is missing).

Configure Hermes `knowledge_base` / collection settings to use that directory (or re-run
`hermes docs add` after rebuilds). Use **one collection (or docs root) per project** —
`data/rag/project_N/` — so feedback never crosses tenants.

## Scoring integration

`runScoring` queries the file RAG for top-k similar past leads and passes them as optional context
into the scorer. `MockScorer` boosts scores when a similar **approved** lead exists; `HermesScorer`
appends a "Similar past leads:" section to the prompt.
