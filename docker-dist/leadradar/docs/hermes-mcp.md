# Hermes MCP + Scoring wiring

LeadRadar exposes a stdio MCP server Hermes (or any MCP client) can call, and a CLI to score gated leads via Hermes' OpenAI-compatible HTTP API.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `LEADRADAR_DB` | `leadradar.db` | SQLite path for MCP server and score CLI |
| `HERMES_API_BASE` | `http://127.0.0.1:8642` | Hermes OpenAI-compatible base URL |
| `HERMES_API_KEY` | _(none)_ | Optional Bearer token for Hermes |

## Hermes home (this machine)

Hermes is installed as a **sibling** on D: (not inside this repo):

| Path | Role |
|---|---|
| `D:\Pixel Punch AIOS` | LeadRadar backend |
| `D:\PixelPunch\hermes` | `HERMES_HOME` (config, `.env`, sessions) |
| `D:\PixelPunch\hermes\hermes-agent` | Hermes agent install |
| `D:\PixelPunch\PixelPunch.code-workspace` | Cursor multi-root (leadradar + hermes) |

User env: `HERMES_HOME=D:\PixelPunch\hermes`. `hermes` is on PATH via `...\hermes-agent\venv\Scripts`.

## Register MCP in Hermes

Already registered on this machine via `hermes mcp add`. Equivalent `config.yaml` under `HERMES_HOME`:

```yaml
mcp_servers:
  leadradar:
    command: "npx"
    args: ["tsx", "D:/Pixel Punch AIOS/src/mcp/server.ts"]
    env:
      LEADRADAR_DB: "D:/Pixel Punch AIOS/leadradar.db"
```

Enable the OpenAI-compatible scoring API (port **8642**):

```bash
hermes config set API_SERVER_ENABLED true
hermes config set API_SERVER_KEY <local-secret>
hermes gateway
```

Then set LeadRadar `HERMES_API_KEY` to the same secret (and optionally `HERMES_API_BASE=http://127.0.0.1:8642`).

**Scoring note:** Hermes `api_server` should list `no_mcp` under `platform_toolsets` so `/v1/chat/completions` returns JSON scores instead of calling LeadRadar MCP tools. Telegram keeps MCP enabled by default.

```yaml
platform_toolsets:
  api_server:
    - no_mcp
```

Start the server manually for debugging:

```bash
npm run mcp
```

Logs go to **stderr** only — stdout is reserved for the MCP protocol.

## Tools

| Tool | Purpose |
|---|---|
| `get_pending_leads` | List gated leads for `project_id` |
| `save_score_and_draft` | Persist score/reasons (draft reserved) |
| `record_feedback` | Record good/bad feedback |
| `get_feedback_stats` | Approval rate stats for a project |
| `get_top_picks` | Top scored leads + Hermes clarify payloads |

Telegram clarify → feedback flow: see [telegram-feedback.md](./telegram-feedback.md).

## Score CLI

Pattern B: the backend loops gated leads and calls a Scorer.

```bash
# Mock scorer (no Hermes required)
npm run score -- 1 --mock

# Real Hermes HTTP API
npm run score -- 1
```

Import leads first if needed:

```bash
npm run import-csv -- "Pixel Punch" sample.csv
```
