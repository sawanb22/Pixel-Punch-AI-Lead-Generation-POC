# LeadRadar — Post-Hermes Install Verification Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish leftover work after Hermes sibling install: persist LeadRadar→Hermes API auth, prove real (non-mock) scoring on at least one gated lead, and document deferred follow-ups.

**Architecture:** Hermes install plan (`hermes_d_drive_setup`) is complete. LeadRadar already has `HermesScorer` + MCP. This plan only verifies wiring end-to-end and closes small env gaps. No new product features.

**Tech Stack:** Hermes gateway `:8642`, OpenRouter, LeadRadar CLI (`import-csv`, `score`), SQLite

---

## Already done (Hermes install checklist)

- [x] `D:\PixelPunch\hermes` + `HERMES_HOME`
- [x] Hermes v0.18.2 installed; `hermes` on PATH
- [x] OpenRouter key in Hermes `.env`; model `openai/gpt-4o-mini`
- [x] API server enabled on `127.0.0.1:8642`
- [x] MCP `leadradar` registered (5 tools)
- [x] `D:\PixelPunch\PixelPunch.code-workspace` multi-root
- [x] Docs updated in `docs/hermes-mcp.md`

## Deferred (do NOT do in this plan)

- Telegram gateway (`TELEGRAM_BOT_TOKEN` + Hermes gateway messaging)
- Migrate file RAG → Hermes `knowledge_base` / `hermes docs add`
- Phase 7 outreach

---

### Task 1: Persist LeadRadar Hermes API auth

**Files:**
- Modify: user env `HERMES_API_KEY` / `HERMES_API_BASE` (not committed secrets)
- Optionally create: `D:\Pixel Punch AIOS\.env` (gitignored) if project already uses dotenv

- [x] **Step 1:** Read `API_SERVER_KEY` from `D:\PixelPunch\hermes\config.yaml`
- [x] **Step 2:** Set user env `HERMES_API_KEY` to that value and `HERMES_API_BASE=http://127.0.0.1:8642`
- [x] **Step 3:** Confirm gateway `/health` returns ok

### Task 2: End-to-end real score (non-mock)

**Files:**
- Use: `sample.csv`, `npm run import-csv`, `npm run score`

- [x] **Step 1:** Ensure gateway is running
- [x] **Step 2:** Import `sample.csv` into project "Pixel Punch" (or reset a lead to gated if needed)
- [x] **Step 3:** Run `npm run score -- 3` **without** `--mock` (import created project id 3)
- [x] **Step 4:** Confirm at least one lead scored — **Scored: 1**

### Task 3: MCP re-check

- [x] **Step 1:** `hermes mcp test leadradar` → 5 tools
- [x] **Step 2:** Mark install verification complete

---

## Success criteria

1. `npm run score -- 1` uses HermesScorer and scores ≥1 lead without `--mock`
2. MCP tools still discoverable
3. Deferred items listed only in docs/plan, not half-implemented
