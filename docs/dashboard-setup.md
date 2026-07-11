# LeadRadar Dashboard Setup

## Quick start (local / tests)

**Recommended (auth bypass + real Hermes scoring):**

```bash
# Loads .env (HERMES_*, PRODUCTHUNT_*, JINA_*), clears SCORE_MOCK, sets auth bypass
npm run dashboard:dev
```

Open http://localhost:3000 — signed in as `dev@local`. Scoring uses Hermes at `HERMES_API_BASE` (default `http://127.0.0.1:8642`). Keep `hermes gateway run` up.

### Dashboard lead hunt (no CLI)

1. **New project** — name, what you sell / who you help (ICP), optional geography, target volume (up to 2000).
2. Review the **Lead plan** card (auto-drafted by Hermes, or a deterministic fallback). Optionally regenerate or send feedback.
3. **Find leads** — compiles the plan to Apify jobs only (`APIFY_TOKEN` required). Watch the **Activity** panel for run status.
4. Review companies in the table / Export. Enrich and scoring stay under **More** when you need them.
5. **Project settings** — edit ICP, geography, and volume anytime (no JSON).

Auth stays on **`LEADRADAR_AUTH_BYPASS=1`** until you explicitly enable Google OAuth for production.

**Mock scoring only (unit/UI without Hermes):**

```bash
$env:LEADRADAR_AUTH_BYPASS="1"
$env:SCORE_MOCK="1"
npm run dashboard
```

Bash:

```bash
LEADRADAR_AUTH_BYPASS=1 SCORE_MOCK=1 npm run dashboard
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LEADRADAR_AUTH_BYPASS` | for local/tests | Set to `1` to skip Google and inject `dev@local` |
| `LEADRADAR_ALLOWLIST` | for Google auth | Comma-separated emails allowed to sign in |
| `GOOGLE_CLIENT_ID` | for Google auth | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | for Google auth | OAuth client secret |
| `GOOGLE_CALLBACK_URL` | optional | Default `/auth/google/callback` (absolute URL in Google console, e.g. `http://localhost:3000/auth/google/callback`) |
| `SESSION_SECRET` | recommended in prod | Session cookie secret |
| `SCORE_MOCK` | optional | `1` = MockScorer; otherwise HermesScorer |
| `HERMES_API_BASE` | for real scoring | Default `http://127.0.0.1:8642` |
| `HERMES_API_KEY` | optional | Bearer token for Hermes |
| `LEADRADAR_DB` | optional | SQLite path (default `leadradar.db`) |
| `PORT` | optional | Default `3000` |

## Google OAuth setup

1. Create an OAuth 2.0 Client ID in Google Cloud Console (Web application).
2. Add authorized redirect URI: `http://localhost:3000/auth/google/callback` (and production URL if any).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `LEADRADAR_ALLOWLIST=you@company.com,teammate@company.com`.
4. Do **not** set `LEADRADAR_AUTH_BYPASS` in production.
5. Visit `/login` → **Sign in with Google**. Non-allowlisted emails are rejected.

## What the dashboard can do

- Create / select projects
- View KPI strip (total leads, new this week, approval rate; reply rate is null for now)
- Filter / sort leads, open detail, Approve / Reject
- Run scoring, Export All / Export Emails, Import CSV
