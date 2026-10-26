---
id: CONTRACT-A-04-GIS-RUNNER
type: contract
parent: PLAN-A-04
created: 2026-10-21
---

# Contract: GIS runner (D-2)

## `.github/workflows/a04-gis-capture.yml` (G-GIS)

- `on.push.branches: [004-property-backbone]`, `on.push.paths: [.github/workflows/a04-gis-capture.yml, pipeline/oracle-runtime/travis/gis/runner-config.json]`. No `workflow_dispatch` (its inputs need the file on the default branch).
- `permissions: { contents: read }`; no `secrets.*` reference anywhere (a test greps the file); `concurrency: { group: gis-pages, cancel-in-progress: false }`; `timeout-minutes: 90`; `runs-on: ubuntu-latest`.
- Steps: checkout → setup-node 22 → log egress country (`curl -s https://www.cloudflare.com/cdn-cgi/trace | grep '^loc='`, only that line) → `npm ci` in `pipeline/oracle-runtime` → `actions/cache` restore `out/checkpoints` (key `gis-<snapshot sha>`) → `npx tsx travis/gis/runner-fetch.ts --config travis/gis/runner-config.json --out out` → `actions/cache` save (`if: always()`) → `actions/upload-artifact` `out/` (`retention-days: 7`, `if: always()`).
- No transform, no Query DB, no publish step. After the full run the job gets `if: false` (lead, Phase 7).

## `pipeline/oracle-runtime/travis/gis/runner-config.json` (Zod `RunnerConfig`)

```json
{ "mode": "pilot", "layerUrl": "https://gis.traviscountytx.gov/server1/rest/services/CIPStoryMap/Main_Location_Map2/MapServer/6",
  "outFields": ["OBJECTID", "<pID field>", "<geoID field>"], "bulkPageSize": 2000, "bulkConcurrency": 2,
  "userAgent": "<project UA from source-client>" }
```

`mode` ∈ {`pilot`, `full`} (the lead changes only this value and pushes). `pilot`: layer metadata `?f=json` (fields, `maxRecordCount`, ObjectId field, `supportsPagination`, `editingInfo.lastEditDate`), count, ids, 1 page. `full`: every page. `bulkPageSize` ≤ min(2000, `maxRecordCount`); `outFields` never contains an owner or address field (test).

## Artifact `out/` → `pipeline/data/raw/gis/us-runner-{RUN_ID_GH}/`

| File | Content |
| --- | --- |
| `egress.txt` | `loc=US` line only |
| `meta.json`, `count.json`, `ids.json` | raw bodies + sha256 |
| `pages/<pageKey>.json` | raw page body (`pageKey` = sha256 of the sorted objectIds) |
| `receipts.jsonl` | `{url, http_status, bytes, sha256, captured_at, outcome, attempts, ua, page_key, blocked_at?}` per request |
| `checkpoints/<pageKey>.json` | completed page marker for resume |
| `complete.json` | only when every page completed: `{mode, pages, features, started_at, finished_at, duration_s, features_per_s, snapshot_sha256}` |
| `blocked.json` | on give-up or 403: `{outcome: "blocked", http_status?, blocked_at, last_page_key}` |

Failure: 429/5xx/timeout → backoff 1 s base, 60 s cap, 5 attempts, full jitter; then `blocked` with `blocked_at`, partial pages uploaded, no `complete.json`. 403 / challenge → `blocked` at once, no retry, no further request to the host.
