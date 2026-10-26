---
id: DES-A
type: design-map
title: "CountyLens: demo line → screen → state"
parent: FL-A
status: Approved         # Design Checkpoint, PO sign-off 2026-10-19
version: 1.5             # final export checked (Step 4b): #113, #117, #118, #120, #121 incorporated; no open Blocking item, 2026-10-19
created: 2026-10-18
sources: README.md (Demo Transcript), docs/01-intent.md, docs/decisions/0000-agent-architecture.md (AD-01…AD-16, § 5), design/HANDOFF.md (106 boards), design/design-review-log.md
---

# CountyLens: demo line → screen → state

**Scope rule.** CountyLens (Task A) is what gets built. CountyLens has no view switcher. Every board below is read with the prototype "Map view (CRM preview)" toggle **off**. The map, and everything that appears only with the toggle on, is a Roofing CRM prototype and is **not Task A scope** (§ 3).

**Precedence.** The architecture decisions AD-01…AD-16 override the design and the HANDOFF. Where a board still disagrees with a decision, the decision is what gets built, and the review log has a Blocking row for it.

**Sample data (PO, 2026-10-19, #123).** Totals, counts, CIDs, sizes, sample rows and their states on the boards are placeholders, not real data. Reviews don't count or compare them, and Claude Design gets no instructions about which data to show. The boards fix layout, states, copy and components; the build fills every value from the published manifest and the elephant-cli tables (build rules in § 2).

## 1. Demo map

`#n` points to a row in [design-review-log.md](../design/design-review-log.md). "—" means the board covers the line as drawn.

| Demo line (README) | Screen · route | Board | State to show | Open items |
| --- | --- | --- | --- | --- |
| D-1 Opening: data loaded, DuckDB, IPFS, UI and agent | App shell on Explore · `/tx/travis/explore` | `Explore1440`, `ShellStates` | Populated. Location chip; badge "Run 3 · {date}" opens Runs | — |
| D-2 Pipeline run summary | Runs · `/runs` (public) | `Runs1440` | Completed: 8 sources, counts, UTC timestamps, "99.4% of roll", limitations (BBB blocked, 403), "Next sync: none · scheduler off by default" (AD-15) | Run 4 and Running are sample data, cut in the build (#29). Counts come from the manifest coverage section, contractors split by the five AD-05 states (#110, #115) |
| D-3 Records by source with timestamps and provenance | Coverage · `/tx/travis/coverage` | `Coverage1440` | Loaded: one row per record kind with its denominator; every count's source is "Run manifest · coverage section" (AD-04); collected time, provenance link | Provenance names the real elephant-cli table (#111) |
| D-4 DuckDB-backed query layer | Explore · SQL · `?mode=sql` | `ExploreQ-sql`, `ExploreQ-sqlperm`, `SqlStates` | Success with the engine line (DuckDB-WASM in your browser, read-only, CID copy, MB read); AD-07 column names; one typo error with its fix; "Run it yourself" (`duckdb -init views.sql`) | — |
| D-5 Artifact manifest | Data · Manifest · `/data/manifest` | `DataManifest1440` (with `RunChain`) | Run chain first (Run 3 → Run 2 → Run 1, each with Verify and Copy CID), then 13 artifacts: CID, name, codec (file / directory), size, SHA-256, CAR. No IPNS (AD-03) | — |
| D-6 Fetch from two public gateways | Data · Verify · `/data/verify/{cid}` | `DataVerify1440`, `DataStates` | 38.2 MB `bafybei…` file; ipfs.io and dweb.link lanes Verified, with exact URLs and operator; size and digest match; a directory shows "Verify via CAR" | Gateway test early in A-02 (#69) |
| D-7 New CID; old one intact; (IPNS if used); CAR | Runs · Compare · `/runs/compare?a=2&b=3` | `RunsCompare1440`, `RunsCompare768`, `RunsCompare390` | New manifest CID linked to the old one (`previousManifestCid`); both in `runs/index.json`; "old manifest still resolves on ipfs.io and dweb.link" pill; CAR available. IPNS is not used: the run chain and run index replace it (AD-03) | CAR link and run window wired at implementation (#52); sizes summed from the manifest (#114) |
| D-8 Radius + roof > 15 yrs, basis, coordinates, source | Explore · Filters · `?r=5&roof=15`, List view | `ExploreQ-roof15` | Header "128 within 5 mi of Pflugerville city hall · roof ≥ 15 yrs"; columns Address · Roof · Basis · Conf. · Mi + bearing · Permit · Lat, lon · Source; Sort Nearest; change 5 → 3 mi live; Close matches; Why view | — |
| D-9 Open roofing permits, longest open, contractor, BBB | Explore · Filters in the D-8 area → Property drawer | `ExploreQ-permits5`, `Property1440` | Roof ≥ 15, open or stalled, open ≥ 5 yrs, sorted by open longest; permit chips "Stalled 6.4 yrs · source says Expired" (AD-08); contractor "as printed on permit" with its five-state badge, mostly Candidate (AD-05); "BBB: Blocked · 403"; no licence line (AD-06) | Badge state and status word come from the data (#112, #116) |
| D-10 Agent: roofs > 15 yrs within 5 mi of {city} | Explore · AI · `?mode=ai`, Answer tab | `ExploreQ-ai` (populated); `ExploreQ-aiworking` = the AD-09 Working… state for any question; `HelperStates` | Working… (elapsed timer, Cancel), then the answer with all steps at once (AD-09); "How I read this", editable chips, citations [n] ↔ numbered rows; "n of 10 AI questions left this session" | #38 |
| D-11 Agent: long-open permits near that area, contractor | Explore · AI, second turn | `ExploreQ-aicontractor`; `ExploreQ-aislow` = the AD-09 Took too long state for any question | "Earlier in this conversation"; "that area" reused; "Open ≥ 5 yrs" chip (editable to 3); contractors as printed with badges; BBB missing-data note. At 25 s: Took too long, with Try again and Use Filters instead | #38 |
| D-12 MCP-ready | Help · MCP · `/help/mcp`, then MCP Inspector | `HelpMcp1440` | "Bearer token required, shared privately with reviewers"; six tools with AD-07 schemas; `Authorization: Bearer <token>` in the Desktop, Code and Inspector snippets; Try a tool `search_properties` "through the CountyLens API, which adds the token" (AD-10) | Sample Try response must not ship (#44) |
| SC-2 Duplicates merged (no demo line) | Coverage · Reconciliation; Property · "Merged from" | `Coverage1440`, `PropertyDetail` | Merge counts from the manifest coverage section (numbers only, AD-04); owner "merged from 2 records"; contractor shown as a Candidate cluster, not a Resolved merge | Resolved (#89–#92); provenance build rule (#111) |
| SC-4 Zero idle cost (no demo line) | Coverage · Cost | `Coverage1440` | "$0.00 fixed per month" plus usage in cents; S3 copy of published files listed; no Route 53 hosted zone (AD-13); last bill explained; budget alert | — |
| SC-5 Tenure > 10 yrs, out-of-area owners (no demo line) | Explore · Filters | `ExploreQ-ooa78753` | Out-of-area and tenure > 10 both on (`ooa78753` preset), with the definitions shown | — |

## 2. Screens → tRPC procedures → data

Follows AD-01…AD-16. **W** = runs in the browser (DuckDB-WASM), **L** = Lambda (tRPC, plus MCP's own handler), **D** = direct fetch of an immutable artifact by CID. All call the same `query-core` functions.

| Screen | Procedures | Engine | Data |
| --- | --- | --- | --- |
| Shell, Hub status chip | `meta.latest` | L (cached) or D | `runs/index.json` (git + release) → latest `manifest.json` by CID |
| Search box | `search.suggest` (places, addresses, permits) | L | gazetteer, `v_property`, `v_roofing_permit` |
| Explore · Filters (Builder later) | `explore.search {area, radius_mi, roof, permit, openYrs, tenure, ooa, sort: nearest \| open_desc \| roof_desc, page}` → `{total_within_r, rows[{index, property_cid, address, dist_mi, bearing, lat, lon, roof, basis, conf, permit, source_url, run, cid}]}`; `explore.closeMatches` → `[{row, miles_outside}]` | W (L for agent and MCP) | elephant-cli tables through `views.sql` (`v_property` ⋈ `v_roofing_permit` ⋈ `v_contractor`); bounding-box prefilter, then the exact radius (AD-01) |
| Explore · SQL | `sql.run` | **W only** | the views + `dist_mi()` |
| Explore · AI | `agent.ask`, one response through API Gateway (no streaming) → `{answer, how, steps[], matches[] (citation n → row n), query {area, radius_mi, roof, permit, openYrs}, missing[], outcome: answered \| failed \| paused \| throttled \| timed_out \| cancelled}`; client sends the last 4 turns + context | L + Vercel AI SDK, provider set by `AI_PROVIDER`; ≤ 6 tool steps, ≤ 3 model calls, ≤ 1,500 output tokens, hard stop at 25 s (AD-09) | query-core tools |
| Explore · AI status | `ai.status` → `{paused, resetsAt}`. The 10-per-session count lives in `sessionStorage`; only `answered` counts | L | daily spend counter |
| Property detail | `property.get` (`mergedFrom[]` only if A-02 finds a published field for it, #92); `property.similar` (rule defined in implementation, #63) | W or L | the views; no lineage file |
| Runs, Compare, Log | `runs.list`, `runs.get`, `runs.compare`, `cid.check`, `runs.events`, `runs.live` | D (+ live gateway checks) | `runs/index.json`, manifests (`previousManifestCid`); run events inside the manifest or as a release asset, not an extra IPFS artifact; `runs/live.json` is an admin S3 status object |
| Runs · admin | `admin.me`, `admin.runs.start / stop / retry` → SQS (15 min expiry, cancel by command ID) → local bridge next to Restate → `runs/live.json` | L (Cognito JWT, admin group) | SQS queue, one S3 status object. **Built last** (AD-12) |
| Coverage | `coverage.get` (with `merge`, `cost`) | D | run manifest · coverage section (counts and aggregate merge counts only, AD-04); `cost.json` is a release asset built at deploy time |
| Data · Manifest, Verify, Catalog | `manifest.get`, `runs.chain`, `verify.fetch` (labelled fallback), `schema.get` | D; L for the fallback | `manifest.json` + `previousManifestCid`, ipfs.io and dweb.link (plain file URLs), `tables-export.json` |
| Help · MCP | Own handler `POST /mcp` (stateless Streamable HTTP, bearer token from SSM, 401 without it, 429 when throttled, CORS + Origin check); Try a tool goes through a tRPC procedure that adds the token on the server (AD-10) | L | query-core Zod schemas |
| Activity (admin) | `admin.activity.summary`, `admin.activity.list` | L, Logs Insights cached 5 min | `/countylens/query-log` (server events only). **Built last** (AD-12) |
| Publication (pipeline) | Manifest builder writes `runs/<runId>/manifest.json` (with `previousManifestCid`) and `runs/index.json` (committed and released). No IPNS (AD-03) | pipeline | elephant-cli output only |

**Sample data → build rules (#110–#116, #123).** (1) Every count on Runs, Coverage and `get_coverage` comes from the manifest `coverage` section, so the screens can't disagree. (2) Contractors are counted as names on permits, split by the five AD-05 states; nothing is labelled "resolved" unless the registry identifier matched. (3) Each provenance chip names the elephant-cli table the field is published in, with that table's CID from the manifest: printed contractor names → `property_improvement`; only Resolved contractors → `company` + `property_improvement_has_contractor`; roof age → `structure`. There is no derived file (AD-01). (4) Run and CAR sizes are summed from the manifest artifacts. (5) The permit status word is the record's `status_raw` (AD-08).

**Data path (AD-02).** W and L read a byte-for-byte S3 + CloudFront copy of the elephant-cli files stored under each CID (checked at upload), with a public gateway as fallback; a server fetch is labelled "via server". Verify (D-6) always uses the public gateways, never the copy. No map library, basemap, tiles or OSM attribution.

**View columns (AD-07, frozen against a real `tables-export.json` in A-02).** `v_property`: `roof_age_years`, `last_sale_date`, `tenure_years` + `tenure_basis`, `owner_is_out_of_area` + `owner_area_class`, `coordinate_source`. `v_roofing_permit`: `status_raw`, `status_class` (`open` / `stalled` / `closed`), `issue_date`, `expiry_date`, `final_date`, `open_days`, `contractor_company_cid`. `v_contractor`: `resolution` (five AD-05 states), `bbb_status` (`rated` / `not_found` / `blocked` / `not_checked`).

**URL state.** `area` in the procedures = `place` or `at` in the URL. Parameters: `at`, `r`, `roof`, `permit`, `openYrs`, `tenure`, `ooa`, `sort`, `sel`, `mode`, `place`, `view=list`. There is no `z` (zoom), and `view=map` falls back to List.

**Limits (AD-09, AD-11, AD-16).** API Gateway stage throttle on `/mcp` and `agent.ask`; no Function URL streaming. Reserved concurrency of 3–5 only if the account limit allows it (check before A-03). AI spend cap $3 a day, alarm at 80%. No per-IP limits.

**Hosted state, $0.00 fixed per month (AD-13, AD-15).** DNS stays at Namecheap (no Route 53 hosted zone). Cognito (admin sign-in only), the SQS run-command queue and `runs/live.json`, the S3 + CloudFront CID copy (cents of storage), CloudWatch Logs, one on-demand DynamoDB counter item per UTC day for AI spend, and EventBridge Scheduler created **disabled**, pointing at a Fargate task. There is no query database.

**Cost traps.** SSM SecureString, not Secrets Manager. No customer KMS key, WAF or provisioned concurrency. Logs kept 14 days; the query log 30 days (AD-16). No metric filters.

## 3. Scope decisions

Principle: build what proves a demo line, polish what the evaluator touches, and show the rest as **Coming soon**, so the extra ideas are visible without being faked. Build D-1 to D-12 before any "Build, light" item, and the admin pieces last (AD-12).

| Item | Decision | Effort | User benefit |
| --- | --- | --- | --- |
| Runs, Compare, Manifest + run chain, Verify, Coverage, Explore Filters + SQL + AI, Property, Why view, Help · MCP | **Build** | L | High |
| List view with the Area + radius block, live "n within r mi" header, Mi + bearing, Lat, lon, Sort Nearest, Close matches | **Build** | S–M | High |
| Agent Answer tab (Working…, How I read this, steps at once, citations ↔ rows, follow-up, Took too long) | **Build** | M | High |
| Contractor badge (five states, "as printed on permit") and raw permit status ("source says …") | **Build** | S | High |
| Run timeline scrubber, gateway race | **Build** | M | High |
| SQL checks, pipeline diagram + Gantt (real run events only), area matrix, Runs log, Catalog, Legal, saved searches, "Open in OpenStreetMap" link | **Build, light** | S–M each | Med |
| Hub landing page (CRM card "Coming soon"; the "Preview Explore with the map" link is prototype only, #87) | **Build, light** (#15); wire Watch demo and PR links at release | S | Low |
| Similar properties | **Keep**, last in the build order (#63) | M | Low |
| AI quota: 10 per session, server spend caps, paused state | **Build** (#66, #79) | S | Med |
| Admin: sign-in, Start / Stop / Retry run, Activity | **Build, light, last** (#18, #19, AD-12) | M | Low |
| Builder mode | **Coming soon** (#21) | – | Low |
| Other counties, Street View | **Coming soon** (#17, #20) | – | Low |
| AI-user sign-in | **Coming soon**, not linked (#66) | – | Low |
| Owner and contractor name search, welcome tour | **Cut** (#33, #47) | – | – |
| IPNS, serving Parquet, streamed agent steps, contractor licence line, Route 53 zone | **Cut by AD-01, 03, 06, 09, 13** | – | – |
| Simulated Running run, Run 4 sample, fake Try response, "not wired" toasts, ProtoBar | **Prototype only, must not ship** (#29) | – | – |

**Not Task A scope (do not build, do not mark as missing).** The map view and everything that appears only with the prototype "Map view (CRM preview)" toggle on: map, markers, ring and handle, map count chip, legend, Layers, hexagons, coverage-gap hatch, map controls and keyboard, map accessibility rules (A-4 to A-7), OSM credits, `tiles/`, the `ExploreQ-crmmap` board, and the toggle itself. CountyLens has no view switcher and no "Soon" marker for any map item (PO, round 5, #74). Story specs, `smeargle` responsive tests, G4–G7 checks and reviewers must not count any of these as missing scope.

**Presenting the breadth.** 106 boards, admin sign-in, the Hub and Activity are each light, but together they are a lot. In the PR and the demo video, present the app as **Must vs Coming soon**, so the extra ideas read as a deliberate roadmap and not as unfinished work.

**Decision:** ☑ Approved ☐ Approved with changes · HebaGaber · 2026-10-19
