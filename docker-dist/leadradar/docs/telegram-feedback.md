# Telegram feedback via Hermes `clarify`

LeadRadar does **not** talk to the Telegram Bot API. Hermes owns the Telegram gateway and the built-in [`clarify`](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram) tool (inline Good/Bad buttons). Our backend only:

1. Selects **top scored** leads still awaiting feedback
2. Formats clarify message text + choices `["Good", "Bad"]`
3. Exposes MCP so Hermes can fetch picks and call `record_feedback` after a tap

## Prerequisites

- Hermes Telegram gateway configured (see Hermes docs)
- LeadRadar MCP registered (see [hermes-mcp.md](./hermes-mcp.md))
- Project has leads with `status=scored` (run `npm run score -- <projectId>` first)

## This machine (Pixel Punch)

| Item | Value |
|---|---|
| Bot | `@lead_agent_hermes_bot` |
| Hermes env | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALLOWED_USERS` in `D:\PixelPunch\hermes\.env` |
| Allowlisted user | `5691449303` (Sawan) |
| Start gateway | `hermes gateway run` (keep running) |

**Quick test:** open Telegram → message the bot → you should get a Hermes reply (not “unauthorized”).

**Review top picks (required phrase):**

```text
Review LeadRadar top picks for project 1
```

or:

```text
Use leadradar-review for project 1
```

Hermes must call MCP `get_top_picks`, show **company + score** in text, then `clarify` with choices **Good** / **Bad**. After you tap, it calls `record_feedback` with `source: "telegram"`.

If you only see “Is this a good lead?” with no company name, stop — that is a bug (skill/MCP not applied). Restart gateway after skill changes: `hermes gateway stop` then `hermes gateway run`.

## CLI (manual / paste into Hermes)

```bash
# Default: top 5
npm run top-picks -- 1

# Custom limit
npm run top-picks -- 1 --limit 3
```

Each pick prints the clarify text, choices, and the `record_feedback` payload to use after Good/Bad.

## MCP tool: `get_top_picks`

| Arg | Type | Required | Notes |
|---|---|---|---|
| `project_id` | number | yes | Project to review |
| `limit` | number | no | Default `5` |

Returns:

```json
{
  "picks": [
    {
      "lead": { "id": 12, "company": "…", "score": 92, "status": "scored", "…": "…" },
      "clarify": {
        "text": "Top pick for …\nCompany: …\n…",
        "choices": ["Good", "Bad"],
        "leadId": 12,
        "projectId": 1
      }
    }
  ]
}
```

Reuse existing `record_feedback` with `source: "telegram"`:

| Arg | Notes |
|---|---|
| `project_id` | Same project |
| `lead_id` | From `clarify.leadId` |
| `good` | `true` for Good, `false` for Bad |
| `notes` | Optional |
| `reviewed_by` | Optional Telegram handle / name |
| `source` | `"telegram"` |

## Example Hermes skill / prompt

Use this as a skill or system instruction when reviewing a project over Telegram:

```text
You help review LeadRadar top picks over Telegram.

For project_id=<PROJECT_ID>:
1. Call MCP tool get_top_picks with { "project_id": <PROJECT_ID>, "limit": 5 }.
2. For each pick, call clarify with:
   - question / message = pick.clarify.text
   - choices = pick.clarify.choices  (exactly ["Good", "Bad"])
3. When the user taps a choice:
   - Good → record_feedback({ project_id, lead_id: pick.clarify.leadId, good: true, source: "telegram" })
   - Bad  → record_feedback({ project_id, lead_id: pick.clarify.leadId, good: false, source: "telegram" })
4. Do not invent leads. Only review picks returned by get_top_picks.
5. After all picks are reviewed (or the user stops), briefly summarize how many Good vs Bad.
```

## Flow

```
score gated leads → status=scored
        │
get_top_picks / npm run top-picks
        │
Hermes clarify (Good / Bad) on Telegram
        │
record_feedback(source="telegram") → approved | rejected + RAG sync
```

## Notes

- Only `status=scored` leads appear; approved/rejected are excluded automatically.
- Top picks are ordered by score descending.
- Dashboard feedback still uses `source: "dashboard"`; Telegram must pass `"telegram"`.
