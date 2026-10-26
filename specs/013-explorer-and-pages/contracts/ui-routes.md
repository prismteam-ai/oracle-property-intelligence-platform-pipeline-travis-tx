# Contract: routes, URL parameters and fixed strings

Stable for A-14 and A-16 (FR-025).

| Route | Screen | Part |
| --- | --- | --- |
| `/` | Hub | 2 |
| `/runs` · `/runs/compare?a=&b=` · `/runs/log` | Runs · Compare · Log | 1 · 1 · 2 |
| `/tx/travis/coverage` | Coverage | 1 |
| `/tx/travis/explore` (`?mode=sql`, `sel=`) | Explore Filters / SQL / Property drawer | 1 |
| `/data/manifest` · `/data/verify/:cid` · `/data/catalog` | Manifest · Verify · Catalog | 1 · 1 · 2 |
| `/help/mcp` | Help · MCP | 1 |
| `/legal/data` · `/legal/privacy` · `/legal/terms` | Legal | 2 |
| `/soon/:item` | Coming soon item (also in the More sheet at 390) | 2 |
| `/permits` | A-03 Permits (kept) | — |

URL parameters: `at`, `r`, `roof`, `permit`, `openYrs`, `tenure`, `ooa`, `sort`, `sel`, `mode`, `place`, `view=list` (no `z`; `view=map` → list).

Fixed strings live in `packages/shared/src/labels.ts` and are imported by tests: "Next sync: none · scheduler off by default"; "old manifest still resolves on Pinata and Filebase"; "rate-limited, retrying"; "no readable response (rate-limited or blocked), retrying"; "Verify via CAR"; "{n} within {r} mi of {place} · roof ≥ {years} yrs"; "Stalled {x} yrs · source says Expired"; "Open {x} yrs · source says {status_raw}"; "as printed on permit"; "not in the published data model (status is derived from the permit dates)"; "no open roofing permits in this radius on the current run"; "tenure unknown: {n}"; "DuckDB-WASM in your browser · read-only"; "DuckDB on the server · same views"; "Coming soon · Not deployed yet"; "Coming soon"; "CountyLens has data for Travis County, TX only"; "Catalog unavailable · {reason}"; "table export not in this run's manifest"; "denominator not in this run's manifest"; "first run · nothing to compare against".

## Additional fixed strings and rules (closes test-plan GAP-4, GAP-5, 2026-10-21)

| Situation | Exact text / rule |
| --- | --- |
| Run index unreadable | "Run index unavailable · {reason}" + link to `/runs/index.json` |
| Manifest unreadable | "Manifest unavailable · {cid} · {reason}" |
| Compare with one run | "first run · nothing to compare against" (also the delta column of a first run) |
| SQL write refused | "Read-only: only SELECT, WITH, DESCRIBE and SHOW run here" |
| SQL error | "{engine message, first line} · Try: {fix}" — no stack trace |
| Zero results | "No properties within {r} mi · {k} close matches just outside" then Close matches: up to 10 nearest rows outside the radius and within 2 × r, each with "+{miles_outside} mi" |
| Roof basis unknown | "roof age unknown · no permit, new-construction or built-year record" |
| Contractor name / status_raw (no carrier, ADR-0002) | "not in the published data model (status is derived from the permit dates)" (PO 2026-10-26: plain words; was "not published · no lexicon carrier") |
| Stalled permit | "Stalled {x} yrs · open past expiry, never closed" while `status_raw` has no carrier (PO 2026-10-26: an expired permit reads as stalled); "Stalled {x} yrs · source says Expired" once a carrier exists (AC-5 last sentence) |
| BBB not_checked / blocked / not_found | "BBB not checked · {bbb_status_reason}" / "BBB blocked · 403 challenge, not harvested" / "BBB: no profile found" |
| Tenure unknown | "tenure unknown · no dated sale on record" |
| Owner area unknown | "owner area unknown · mailing address not in the published export" |
| Hub chip | "Run {n} · {finishedAt as YYYY-MM-DD HH:mm UTC}" |
| Completed run | data rule, no on-screen text: every entry of `runs/index.json` is a completed run (the pipeline writes the index only after finish) |
| Other county URL (`/tx/{other}/…`) | renders the Travis-only message "CountyLens has data for Travis County, TX only" with a link to `/tx/travis/explore`; no data |
| CRM config key | `crmUrl` in `public/site-links.json` (contracts/site-links.md) |
| Open permit (no carrier) | "Open {x} yrs · within its permit period" while `status_raw` has no carrier (PO 2026-10-26) |
| Verify mismatch | "Mismatch · size {got} vs {expected} · SHA-256 {got4}…{got4} vs {exp4}…{exp4}" — no ✓ |
| Help · MCP "Try a tool" before A-14 | "Not available yet · the agent and MCP server arrive with story A-14" — no sample response |
