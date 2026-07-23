# Operations console: stay-open disclosures + poll-while-running

## Goal

1. Operations JSON disclosures (Planner input, Raw Hermes output, etc.) stay open across activity re-renders until the user toggles them closed.
2. Auto-refresh Operations only while the selected discovery run status is `running`, then stop (no constant polling after completion).

## Context

`renderActivity()` rebuilds `#ops-fields` with `innerHTML`, which recreates closed `<details>`. Polling while a run is `running` makes open sections snap shut. The Refresh button remains for manual reload of completed runs.

## Design

### Open-state preservation

- Before replacing `#ops-fields` HTML, collect `pre[id]` ids under open `<details>`.
- After rebuild, set `details.open = true` for ids that still exist.
- No localStorage. Switching project/list clears the panel (starts closed). Switching run keeps open sections by id when labels match.

### Poll-while-running

- Interval: **5000 ms**.
- After each `loadActivity`, schedule the next poll iff `run.status === "running"`; otherwise clear the timer.
- Manual Refresh still calls `loadActivity` once and re-evaluates whether to keep polling.

### Module boundary

Pure helpers live in `src/public/ops-console-ui.js` (imported by `app.js` and unit-tested):

- `OPS_POLL_INTERVAL_MS`
- `shouldContinueOpsPoll(status)`
- `mergeOpenOpsFieldIds(previousOpen, availableIds)`

DOM collect/restore stays in `app.js` next to `renderActivity`.

## Out of scope

- Polling after run completion
- Page Visibility pause
- SSE / WebSocket
- Changing lead-plan job `<details>` behavior
