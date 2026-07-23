# LeadRadar — Source APIs (Phase 6)

Configure Product Hunt, Google Custom Search, and optional website enrichment per project.

For **Apify-first company discovery** (recommended production lead finding), see [apify-lead-finding.md](./apify-lead-finding.md).

## Environment variables

| Variable | Required for | Description |
|---|---|---|
| `APIFY_TOKEN` | Apify lead finding | Apify API token. See [apify-lead-finding.md](./apify-lead-finding.md). |
| `PRODUCTHUNT_TOKEN` | Product Hunt source | Developer token or OAuth access token. Sent as `Authorization: Bearer …` to `https://api.producthunt.com/v2/api/graphql`. |
| `GOOGLE_CSE_KEY` | Google Custom Search | Google Cloud API key with Custom Search API enabled. **Closed to new customers** — prefer Jina for new setups. |
| `GOOGLE_CSE_ID` | Google Custom Search | Programmable Search Engine ID (`cx`). |
| `JINA_API_KEY` | Jina Search source | Key from [jina.ai](https://jina.ai/?sui=apikey). Used as Bearer token for `https://s.jina.ai/`. |

Adapters throw a clear error if an enabled source is missing credentials. Unit/integration tests always inject a mock `fetch` and never hit the network.

## Product Hunt setup

1. Create an app at [Product Hunt API](https://api.producthunt.com/v2/docs) and copy a **developer token** (or obtain an OAuth access token).
2. Set `PRODUCTHUNT_TOKEN=…`.
3. Enable in the project's `source_config` (see below).

## Jina Search setup (recommended web search)

Google Custom Search JSON API is **closed to new customers**. Use [Jina Search](https://jina.ai/reader/) instead:

1. Create an API key at [jina.ai/?sui=apikey](https://jina.ai/?sui=apikey).
2. Set `JINA_API_KEY=…` in `.env`.
3. Enable in `source_config` with a `query` string (see below).

Request: `POST https://s.jina.ai/` with `{ "q": "…", "num": 10 }` and `Authorization: Bearer …`.

## Google Custom Search setup (legacy / existing CSE only)

1. In Google Cloud Console, enable **Custom Search API** and create an API key → `GOOGLE_CSE_KEY`.
2. Create a [Programmable Search Engine](https://programmablesearchengine.google.com/) (search the whole web or selected sites) → copy the Search Engine ID → `GOOGLE_CSE_ID`.
3. Enable in `source_config` with a `query` string.

Request shape used by the adapter:

`GET https://www.googleapis.com/customsearch/v1?key=…&cx=…&q=…`

## Project `source_config` JSON

Stored on `projects.source_config` (string column). Example:

```json
{
  "producthunt": { "enabled": true, "first": 20 },
  "jina": { "enabled": true, "query": "B2B SaaS AI startups", "num": 10 },
  "enrich": true
}
```

| Field | Meaning |
|---|---|
| `producthunt.enabled` | Include Product Hunt posts (default true when the `producthunt` object is present). |
| `producthunt.first` | How many posts to request (default 20). |
| `jina.enabled` | Include Jina web search results (default true when the `jina` object is present). |
| `jina.query` | **Required** search query when Jina is enabled. |
| `jina.num` | Results per request (default 10). |
| `google.enabled` | Legacy Google CSE (default true when the `google` object is present). |
| `google.query` | **Required** search query when Google is enabled. |
| `google.num` | Results per request (1–10; default 10). |
| `enrich` | When `true`, after merge fetch each lead website and fill `mailto:` emails before validation. |

## Run ingest

### Dashboard (preferred)

1. Open the project → **Project settings** (or set sources when creating).
2. Enable Product Hunt and/or Jina, set the Jina query, optionally enable enrich.
3. Click **Find leads**.

### CLI

```bash
npm run ingest -- <projectId>
```

This loads the project, builds sources from `source_config` + env, optionally enriches websites, then runs aggregate validate → persist gated leads (same pipeline as the dashboard **Find leads** button and CSV import).

CSV upload remains available via `npm run import-csv` and the dashboard; it does not require `source_config`.
