# LeadRadar — Phase 5 (Telegram Feedback via Hermes) Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans.

**Goal:** Enable per-run Telegram feedback on **top picks** without a custom bot: select top scored leads, format Hermes `clarify` prompts (Good/Bad), expose MCP tools so Hermes can fetch picks and record feedback after button taps, plus a CLI that prints the prompts for manual/Hermes use.

**Architecture:** No Telegram Bot API in our codebase. Hermes Telegram gateway + `clarify` owns the UI ([Hermes Telegram docs](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram)). Our backend adds:
1. `selectTopPicks(db, projectId, limit)` — scored leads not yet approved/rejected, highest score first
2. `formatClarifyMessage(lead, project)` — text + choices `["Good", "Bad"]`
3. MCP tools: `get_top_picks`, reuse `record_feedback`
4. CLI `npm run top-picks -- <projectId> [--limit 5]`
5. Docs: Hermes skill/prompt to post clarify for each pick and call `record_feedback`

**Out of scope:** Custom bot, posting every lead (top picks only), outreach.

---

## Tasks

### Task 1: Top picks selection + format
- Files: `src/telegram/top-picks.ts`, `tests/telegram/top-picks.test.ts`
- `selectTopPicks`: status=`scored`, order by score DESC, limit N (default 5)
- `formatClarifyMessage`: includes company, score, reasons, website; choices Good/Bad
- Commit: `feat: add top-picks selection and clarify message formatter`

### Task 2: MCP tools + CLI + docs
- Extend `src/mcp/tools.ts` + `server.ts` with `get_top_picks({ project_id, limit? })`
- CLI `src/cli/top-picks.ts` + package.json script
- `docs/telegram-feedback.md` — Hermes config + example skill text
- Tests for MCP handler
- Commit: `feat: expose get_top_picks MCP tool and Telegram feedback docs`

## Definition of done
- Unit tests for selection/format/MCP
- Full suite green
- Docs explain Hermes clarify → record_feedback flow

## Verification
1. `npm test`
2. Seed scored leads → `npm run top-picks -- 1` prints messages
3. MCP tool returns same picks
