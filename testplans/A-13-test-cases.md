---
id: QC-TC-A-13
type: test-cases
title: Build the Explorer UI with its hub, legal, catalog and Coming soon pages
parent: [FEAT-A13, FEAT-A18]
story: stories/A-13-explorer-and-pages.md
spec: specs/013-explorer-and-pages/spec.md
owner: HebaGaber             # QC Lead
status: Approved             # Draft → In Review → Approved
gate: G6
version: v0.2
created: 2026-10-21
updated: 2026-10-21          # v0.2 aligned with plan.md, research.md, data-model.md, contracts/*, FR-006a and the coordinator's GAP-1…GAP-5 decisions
runtime_url: "RUNTIME_URL = https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com (Amplify preview) or https://countylens.aldarraj.com (never localhost)"
reviewed_code: "TBD (set when the build is deployed; read from {RUNTIME_URL}/build.json)"
qc_signoff: true
---

# Test Cases: A-13 Build the Explorer UI with its hub, legal, catalog and Coming soon pages

> **v0.1, 2026-10-21.** Drafted with `developmentsupport-testcases` from the G4-ready story's Given / When / Then ACs (AC-1 … AC-14), its six edge cases, the spec's FR-001 … FR-025 (with the 2026-10-21 Clarifications), NFR-001 … NFR-003, `docs/02-design.md` § 1–3 and ARD AM-01 / AM-06. **`tasks.md` was not read**, so the cases stay independent of the implementation.
>
> Every case starts from `RUNTIME_URL` and maps one-to-one to one Playwright test titled `@scenario:A-13-TC-{nnn}` (`npx playwright test -g "A-13-TC-nnn"` with `RUNTIME_URL` set), in the six suite files `tests/e2e/A-13-explorer.spec.ts`, `A-13-verify.spec.ts`, `A-13-perf.spec.ts`, `A-13-pages.spec.ts`, `A-13-scan.spec.ts` and `A-13-vitals.spec.ts` (file names only were taken from `tasks.md`; no case content). Cases TC-001 … TC-009 follow demo lines D-1 … D-9 in order, then the Part 1 detail cases, then every Part 2 route and Coming soon item, then the cross-cutting and NFR cases.
>
> **Expected values are read at run time** from `{RUNTIME_URL}`'s `runs/index.json` and the manifest it points to (by CID), never hard-coded. The only fixed numbers are the story's dated reference ranges, always labelled "2026-10-19, re-measured at run time", and the story's fixed strings.
>
> **v0.2, 2026-10-21.** Re-checked against `plan.md`, `research.md`, `data-model.md`, `contracts/ui-routes.md` (incl. "Additional fixed strings and rules"), `contracts/explore-search.md`, `contracts/site-links.md` and spec FR-006a. Decisions applied (spec FR-005 now states the no-carrier wording): GAP-1 → ADR-0002 and AC-5's last sentence win (`status_raw` and the printed contractor name show "not published · no lexicon carrier"; stalled shows "Stalled {x} yrs · source status not published · no lexicon carrier"); GAP-2 → Filters run on the server (`explore.search`, "DuckDB on the server · same views"), SQL only in the browser, p95 timed input → header, SQL `count(*)` has no p95 (PO confirms AC-6 wording at R3); GAP-3 → denominators only from the manifest, else "denominator not in this run's manifest · A-01 source {name}" (PO approved); CRM key `crmUrl` in `/site-links.json`; Hub at `/` is D-1 (story wins over 02-design § 1); Verify accepts both retry labels. Every negative case now asserts the exact string from `packages/shared/src/labels.ts` / `contracts/ui-routes.md`. New case: TC-043 (Filters engine and server call).
>
> **Waits for A-11 (PO D-1/D-2, 2026-10-21).** Cases whose expected values need Runs 1–3, the full county, `tables-export.json`, run events or scale carry that label. Each says what it checks today on the single published run; its full assertion switches on when `runs/index.json` holds ≥ 3 runs (the harness checks `runs.length` and the presence of `tables-export.json` in the latest manifest and reports which branch it ran).

## 1. Feature overview

A-13 is the visible half of the demo: one hosted CountyLens explorer (Runs, Compare, Coverage, Data · Manifest / Verify, Explore · Filters / SQL, Property drawer, Help · MCP) plus the Hub, Legal, Data · Catalog and Runs · Log pages, with every planned feature shown as a static Coming soon skeleton. The value validated: an evaluator can check every demo claim (D-1 … D-9) on real Travis County records in the browser, verify bytes on two public gateways the project does not operate, and nowhere sees sample, prototype or invented data.

## 2. Requirement mapping

| Source | Reference | Covered by |
| --- | --- | --- |
| Acceptance criterion | A-13-AC-1 (Runs, Compare) | TC-002, TC-007, TC-010, TC-011, TC-012, TC-013, TC-014, TC-015 |
| Acceptance criterion | A-13-AC-2 (Coverage) | TC-003, TC-016, TC-017 |
| Acceptance criterion | A-13-AC-3 (Verify on Pinata + Filebase) | TC-005, TC-006, TC-018, TC-019, TC-021, TC-022, TC-024 |
| Acceptance criterion | A-13-AC-4 (radius + roof age) | TC-008, TC-025, TC-026, TC-027, TC-028, TC-029, TC-030, TC-043 |
| Acceptance criterion | A-13-AC-5 (open / stalled permits) | TC-009, TC-031, TC-032, TC-034, TC-035 |
| Acceptance criterion | A-13-AC-6 (scale, SQL) | TC-004, TC-038, TC-040, TC-041, TC-043 |
| Acceptance criterion | A-13-AC-7 (missing data, 429) | TC-020, TC-033 |
| Acceptance criterion | A-13-AC-8 (tenure, out-of-area) | TC-036, TC-037 |
| Acceptance criterion | A-13-AC-9 (Hub) | TC-001, TC-050, TC-051, TC-052 |
| Acceptance criterion | A-13-AC-10 (Catalog) | TC-053, TC-054 |
| Acceptance criterion | A-13-AC-11 (Legal) | TC-055, TC-056 |
| Acceptance criterion | A-13-AC-12 (Runs · Log, scale) | TC-057, TC-058 |
| Acceptance criterion | A-13-AC-13 (Coming soon, other county) | TC-060 … TC-070, TC-071, TC-072 |
| Acceptance criterion | A-13-AC-14 (no-sample-data scan) | TC-073, TC-074 |
| Edge case | Zero results → Close matches with miles outside | TC-028 |
| Edge case | CID copy down → Filebase "fallback", Verify unaffected | TC-023 |
| Edge case | SQL typo → error line with fix, no stack trace | TC-039 |
| Edge case | 390 → filter sheet, Coming soon in More sheet, 48 px, no h-scroll | TC-072, TC-080 |
| Edge case | `tables-export.json` unreachable → "Catalog unavailable · {reason}" | TC-054 |
| Edge case | Task B live → CRM card switches through config | TC-050 |
| Edge case (spec) | Run index or manifest unreadable → explicit error (FR-021) | TC-012, TC-013 |
| Edge case (spec) | File artifact > 50 MB → "Verify via CAR" (FR-003c) | TC-019 |
| Edge case (caller) | Single published run → Compare explains why | TC-014 |
| Edge case (caller) | Skeleton shows no numbers, rows or CIDs | TC-060 … TC-070 |
| Edge case (caller) | Another county (picker or `/tx/{other}/…` URL) → Travis-only message | TC-071 |
| FR | FR-001 (Runs) | TC-002, TC-011 |
| FR | FR-001a (Compare, resolve pill) | TC-007, TC-015 |
| FR | FR-001b (single run) | TC-014 |
| FR | FR-001c (per-source deltas) | TC-010 |
| FR | FR-002 (Coverage) | TC-003, TC-016, TC-017 |
| FR | FR-003 (Verify, two lanes, local hash) | TC-006, TC-021 |
| FR | FR-003a (never the CID copy) | TC-022 |
| FR | FR-003b (429) | TC-020 |
| FR | FR-003c (directory / > 50 MB) | TC-018, TC-019 |
| FR | FR-003d (Manifest list, run chain) | TC-005, TC-024 |
| FR | FR-004 (place, radius, roof, header, row fields, live radius) | TC-008, TC-025, TC-026, TC-027 |
| FR | FR-004a (URL state, `view=map` → List) | TC-029 |
| FR | FR-004b (Property drawer) | TC-030 |
| FR | FR-005 (open / stalled, contractor, BBB, no carrier, empty open list) | TC-009, TC-031, TC-032, TC-034, TC-035 |
| FR | FR-006 (SQL in browser, read-only, progress bar) | TC-004, TC-038, TC-040 |
| FR | FR-006a (Filters on the server, engine line, p95 input → header, no SQL p95) | TC-004, TC-008, TC-041, TC-043 |
| FR | FR-007 (missing-reason element) | TC-017, TC-033 |
| FR | FR-008 (tenure, out-of-area) | TC-036, TC-037 |
| FR | FR-009 (Hub) | TC-001, TC-051 |
| FR | FR-010 (Catalog) | TC-053 |
| FR | FR-011 (Legal) | TC-055, TC-056 |
| FR | FR-012 (Runs · Log) | TC-057 |
| FR | FR-013 (Coming soon skeletons, other county) | TC-060 … TC-071 |
| FR | FR-014 (no prototype values, CIDs in a real manifest) | TC-073, TC-074 |
| FR | FR-015 (Close matches) | TC-028 |
| FR | FR-016 (CID copy fallback, "fallback" chip) | TC-002, TC-005, TC-023 |
| FR | FR-017 (SQL error line) | TC-039 |
| FR | FR-018 (390 sheets, 48 px, no h-scroll) | TC-072, TC-080 |
| FR | FR-019 (Catalog unavailable) | TC-054 |
| FR | FR-020 (CRM card by config) | TC-050 |
| FR | FR-021 (index / manifest unreadable) | TC-012, TC-013 |
| FR | FR-022 (provenance on every row) | TC-026, TC-032 |
| FR | FR-023 (Help · MCP) | TC-042 |
| FR | FR-024 (every value from a published file or static text) | TC-016, TC-053, TC-073 |
| FR | FR-025 (stable routes and URL parameters) | TC-029, TC-086 |
| NFR | NFR-001 (p95 < 3 s, first load ≤ 8 s) | TC-040, TC-041, TC-043 |
| NFR | NFR-002 (≤ 300 KB JS, LCP / CLS / INP, WCAG 2.2 AA, Atlas, 390/768/1440) | TC-052, TC-058, TC-080, TC-081, TC-082, TC-083 |
| NFR | NFR-003 (100% provenance) | TC-026 |
| Harness rule | Playwright refuses localhost | TC-085 |

## 3. Assumptions

- **Run oracle.** `{RUNTIME_URL}/runs/index.json` (schema `oracle-travis-runs-index.v1`, entries `{runId, manifestCid, finishedAt}`) is the list of published runs; "latest" = greatest `finishedAt`; Run {n} = 1-based position in `finishedAt` order (spec Clarification). Each manifest is fetched by CID from the Pinata gateway by the harness (not from the CID copy) so the oracle is independent of the app's read path.
- **Gateway hosts** (AM-01): Pinata `gateway.pinata.cloud` (independent) and Filebase `ipfs.filebase.io`. Forbidden on every Verify and "still resolves" request: `ipfs.io`, `dweb.link`, `w3s.link` and the CID copy host (`CID_COPY_HOST` from the deployed config). The fallback label reads `fallback · ipfs.filebase.io` (A-03 wording, unchanged).
- **Fault injection.** 429s, unreachable files and CID-copy outages are produced with Playwright `page.route()` in the evaluator's own browser on the hosted page (the request leaves the page and is answered by the harness). Nothing on the server or IPFS is changed.
- **Derivation labels** (AD-28, fixed in A-03): `published_rows` → "Counted from published rows"; `capture_receipt` → "From the capture receipt"; `aggregate_match` → "From the run's internal match (not recomputable from public data)".
- **Fixed strings** are imported by the tests from `packages/shared/src/labels.ts` (`contracts/ui-routes.md`) and asserted verbatim; `{…}` placeholders are filled from `M` or the row under test. The full list used here:

| Situation | Exact text |
| --- | --- |
| Run index unreadable | "Run index unavailable · {reason}" + link to `/runs/index.json` |
| Manifest unreadable | "Manifest unavailable · {cid} · {reason}" |
| First run / Compare with one run | "first run · nothing to compare against" |
| Next sync | "Next sync: none · scheduler off by default" |
| Compare pill | "old manifest still resolves on Pinata and Filebase" |
| Coverage kind absent | "not in this run's coverage section" |
| Denominator absent | "denominator not in this run's manifest · A-01 source {name}" |
| Verify retry | "rate-limited, retrying" (readable 429) or "no readable response (rate-limited or blocked), retrying" (unreadable error) |
| Verify directory / > 50 MB | "Verify via CAR" |
| Search header | "{n} within {r} mi of {place} · roof ≥ {years} yrs" |
| Zero results | "No properties within {r} mi · {k} close matches just outside"; each Close match "+{miles_outside} mi" |
| Filters engine | "DuckDB on the server · same views" |
| SQL engine | "DuckDB-WASM in your browser · read-only" |
| SQL write refused | "Read-only: only SELECT, WITH, DESCRIBE and SHOW run here" |
| SQL error | "{engine message, first line} · Try: {fix}" |
| Stalled permit (no `status_raw` carrier) | "Stalled {x} yrs · source status not published · no lexicon carrier" |
| `status_raw`, printed contractor name | "not published · no lexicon carrier" |
| Empty open list | "no open roofing permits in this radius on the current run" |
| Roof basis unknown | "roof age unknown · no permit, new-construction or built-year record" |
| BBB | "BBB not checked · {bbb_status_reason}" / "BBB blocked · 403 challenge, not harvested" / "BBB: no profile found" |
| Tenure unknown (cell) / excluded count | "tenure unknown · no dated sale on record" / "tenure unknown: {n}" |
| Owner area unknown | "owner area unknown · mailing address not in the published export" |
| Hub | "Coming soon · Not deployed yet"; chip "Run {n} · {finishedAt as YYYY-MM-DD HH:mm UTC}" |
| Coming soon / other county | "Coming soon" / "CountyLens has data for Travis County, TX only" |
| Catalog | "Catalog unavailable · {reason}" / "table export not in this run's manifest" |
- **No-carrier list** is read at run time from `docs/decisions/0002-lexicon-carriers.md` § "Decision" (today: 8 no-carrier fields incl. printed contractor name, `status_raw`, `expiry_date`, BBB rating, BBB URL, per-permit contractor state, `roof_age_basis`, `roof_age_confidence`; every `address`-sourced column is `no_carrier_not_emitted`).
- **Mobile 4G** = Lighthouse mobile profile (research R9: 150 ms RTT, 1.6 Mbps down, 4× CPU slowdown, 390 px) through CDP throttling + `PerformanceObserver`, at least 3 runs per page (the plan runs 5); pass = the **median** LCP < 2.5 s and CLS < 0.1 (INP < 200 ms measured with Playwright interaction timing); all runs recorded.
- **Engines** (FR-006a, research R1): Filters searches call `explore.search` (`/api/trpc/explore.search`) and show "DuckDB on the server · same views"; only `?mode=sql` loads DuckDB-WASM. AC-6 p95 is timed from the input change to the updated header (debounce 250 ms included); the SQL `count(*)` run has no p95 target.
- **Verify** (research R3): plain CORS GET, `credentials: "omit"`, no Range, no custom headers, 30 s per lane; backoff 2 / 4 / 8 s (honouring `Retry-After`), 3 tries; ✓ only on matching size and digest.
- **Completed run:** every entry of `runs/index.json` is a completed run (the pipeline writes the index only after finish).
- **Hub links config** (`contracts/site-links.md`): `{RUNTIME_URL}/site-links.json` = `{ "crmUrl", "demoVideoUrl", "prUrl" }`, each `""` (hidden) or an `https://` URL; invalid = hidden. A real switch is a Web-stack deploy + Amplify rebuild with no code change; the test simulates it by answering `/site-links.json` through `page.route()` and checks the build `sha` is unchanged.
- **Coming soon routes:** `/soon/:item`; item ids are read from the deployed route list (`route-list.ts`, exposed through the shell's More sheet links).
- **"Live" radius update** = the count and rows change without a document navigation (no new `navigation` performance entry, same `window` identity marker) within 3 s (NFR-001 p95 bound).
- **Today's published data** (2026-10-21): one run; most Explore assertions today therefore exercise the honest empty or missing states, and the dated Pflugerville references apply once A-11 publishes the full county.

## 4. Scope

- **In scope:** demo lines D-1 … D-9 on the hosted URL; every Part 1 route (`/runs`, `/runs/compare`, `/tx/travis/coverage`, `/data/manifest`, `/data/verify/{cid}`, Explore `?mode=filters|sql`, Property drawer `?sel=`, `/help/mcp`); every Part 2 route (`/`, `/legal/data`, `/legal/privacy`, `/legal/terms`, `/data/catalog`, `/runs/log`); every Coming soon item; the six edge cases plus the spec's extra edges; responsive 390/768/1440; LCP, CLS, INP, bundle size, WCAG 2.2 AA; the no-sample-data scan.
- **Out of scope:** the map, markers, tiles and everything behind "Map view (CRM preview)" (02-design § 3, #74; not counted as missing); Explore · AI and live MCP calls (A-14, D-10 … D-12); admin sign-in, Start/Stop/Retry, Activity (A-16); welcome tour and owner/contractor name search (cut); timeline scrubber and gateway race as built features (Could; tested as Coming soon unless approved at D-7).

## 5. Test data

- **Data snapshot today:** `runs/index.json` holds one run, `travis-202609-permits-20261021t103516z`, manifest CID `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`, `finishedAt` 2026-10-21T10:40:04.543Z, `previousManifestCid` null, 27 artifacts, two sources (`austin-3syk-w9eu` records 42, `tcad-2026-certified-json` records 14), coverage `permits_emitted` 35, `parcels_published` 14, `permits_emitted_stalled` 0, `contractor_unresolved` 35. These values are context only; every case reads them from the manifest at run time.
- **Verify file artifact:** the largest artifact with codec `raw` and size ≤ 50 MB in the latest manifest, picked at run time (today `tables/county/structure/part-00000.parquet`, 10,298 B). **Directory artifact:** the first artifact whose name is a `tables/{group}` directory (today `tables/county`).
- **Demo area (2026-10-19, re-measured at run time):** Pflugerville city, GEOID 4857176, internal point 30.447765, −97.602116 (A-02 gazetteer `travis-places@1.0.0`). Within 5 mi: 44 Austin reroof permits, 41 `Final`, **3 `Expired`** (2004-011296 BP, open about 22.6 years; 2018-111955 BP; 2022-098180 BP), **0 open**. The presenter's recorded area in `docs/evidence/A-13-open-permits.md` overrides Pflugerville if it differs; the case reads the area from that file.
- **County-wide reference (2026-10-19, re-measured at run time):** oldest open reroof 1982-012866 BP (`Suspended`).
- **Prototype placeholders that must never appear:** "SAMPLE, JORDAN A", "128 within 5 mi", "Run 4", "city hall", any `bafy…` / `bafk…` / `bagu…` string not present in a manifest reachable from `runs/index.json`, "not wired", the ProtoBar.
- **Other-county probe:** "Harris County" (from AC-13).

## 6. Environment, risks and dependencies

- `RUNTIME_URL` = `https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com` (story branch preview) or `https://countylens.aldarraj.com`. Never localhost (TC-085). No sign-in.
- Browser: Playwright Chromium, private (fresh) context per case, light theme, viewport 1440 × 900 unless the case names 390 or 768.
- Public gateways may be slow or rate-limit; real (not injected) 429s during TC-006 are allowed to retry, and a lane may only end ✓ with a matching digest.
- **Dependencies:** A-11 for Runs 1–3, full county, `tables-export.json`, run events and scale; A-04 for tenure and owner area; A-07 / A-08 for contractor resolution and BBB. Until then the cases run their "today" branch.
- Evidence: screenshots and timings under `docs/evidence/img/A-13-*` and `docs/evidence/A-13*.md`.

## 7. Coverage matrix

| TC ID | Title | Priority | Tags | Type | Requirement(s) | Playwright test |
| --- | --- | --- | --- | --- | --- | --- |
| A-13-TC-001 | D-1 Hub: CountyLens card, CRM Coming soon, run chip | P1 | @smoke @demo | UI | AC-9, FR-009 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-001` |
| A-13-TC-002 | D-2 Runs: latest completed run summary | P1 | @demo | UI | AC-1, FR-001, FR-016 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-002` |
| A-13-TC-003 | D-3 Coverage: counts, denominators, time, derivation, table | P1 | @demo | UI | AC-2, FR-002 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-003` |
| A-13-TC-004 | D-4 SQL count in the browser, engine line | P1 | @demo | UI | AC-6, FR-006 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-004` |
| A-13-TC-005 | D-5 Manifest: every artifact, run chain | P1 | @demo | UI | AC-3, FR-003d, FR-016 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-005` |
| A-13-TC-006 | D-6 Verify: two ✓ lanes, Pinata + Filebase, digest match | P1 | @demo | UI | AC-3, FR-003 | `tests/e2e/A-13-verify.spec.ts @scenario:A-13-TC-006` |
| A-13-TC-007 | D-7 Compare latest vs previous run | P1 | @demo @waits-a11 | UI | AC-1, FR-001a | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-007` |
| A-13-TC-008 | D-8 Pflugerville 5 mi, roof ≥ 15 yrs | P1 | @demo @waits-a11 | UI | AC-4, FR-004 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-008` |
| A-13-TC-009 | D-9 Open or stalled ≥ 5 yrs, longest first | P1 | @demo @waits-a11 | UI | AC-5, FR-005 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-009` |
| A-13-TC-010 | Per-source deltas; first run says so | P1 | @edge | UI | AC-1, FR-001c | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-010` |
| A-13-TC-011 | Limitations and "Next sync" line | P1 | @missing-data | UI | AC-1, FR-001 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-011` |
| A-13-TC-012 | Run index unreadable → explicit error | P1 | @negative @error | UI | AC-1, FR-021 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-012` |
| A-13-TC-013 | Manifest unreadable → explicit error naming the CID | P1 | @negative @error | UI | AC-1, FR-021 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-013` |
| A-13-TC-014 | Single published run → Compare explains why | P1 | @edge @missing-data | UI | AC-1, FR-001b | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-014` |
| A-13-TC-015 | "Still resolves" pill only after both gateways answer | P1 | @negative @waits-a11 | UI | AC-1, FR-001a | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-015` |
| A-13-TC-016 | Coverage counts equal the manifest, with labels and table CID | P1 | @integration | UI | AC-2, FR-002, FR-024 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-016` |
| A-13-TC-017 | Coverage kinds or denominators missing → reason in words | P1 | @missing-data | UI | AC-2, FR-002, FR-007 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-017` |
| A-13-TC-018 | Directory artifact → "Verify via CAR" | P1 | @edge | UI | AC-3, FR-003c | `tests/e2e/A-13-verify.spec.ts @scenario:A-13-TC-018` |
| A-13-TC-019 | File artifact > 50 MB → "Verify via CAR" | P2 | @edge @waits-a11 | UI | AC-3, FR-003c | `tests/e2e/A-13-verify.spec.ts @scenario:A-13-TC-019` |
| A-13-TC-020 | 429 during Verify → "rate-limited, retrying", no false ✓ | P1 | @negative @error | UI | AC-7, FR-003b | `tests/e2e/A-13-verify.spec.ts @scenario:A-13-TC-020` |
| A-13-TC-021 | Gateway bytes differ → mismatch, no ✓ | P1 | @negative | UI | AC-3, FR-003 | `tests/e2e/A-13-verify.spec.ts @scenario:A-13-TC-021` |
| A-13-TC-022 | Verify hosts only Pinata + Filebase, plain GET | P1 | @security | UI | AC-3, FR-003a, AM-01 | `tests/e2e/A-13-verify.spec.ts @scenario:A-13-TC-022` |
| A-13-TC-023 | CID copy down → Filebase "fallback"; Verify unaffected | P1 | @negative @error | UI | Edge 2, FR-016 | `tests/e2e/A-13-verify.spec.ts @scenario:A-13-TC-023` |
| A-13-TC-024 | Run chain Verify and Copy CID | P2 | @integration | UI | AC-3, FR-003d | `tests/e2e/A-13-verify.spec.ts @scenario:A-13-TC-024` |
| A-13-TC-025 | Place search resolves Pflugerville through the gazetteer | P1 | @integration | UI | AC-4, FR-004 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-025` |
| A-13-TC-026 | Every row has its fields and provenance (100%) | P1 | @integration | UI | AC-4, FR-004, FR-022, NFR-003 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-026` |
| A-13-TC-027 | Radius 5 → 3 mi updates the count live | P1 | @edge | UI | AC-4, FR-004 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-027` |
| A-13-TC-028 | Zero results → Close matches with miles outside | P1 | @edge @missing-data | UI | Edge 1, FR-015 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-028` |
| A-13-TC-029 | URL state restores filters; `view=map` → List | P1 | @integration | UI | AC-4, FR-004a, FR-025 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-029` |
| A-13-TC-030 | Row opens the Property drawer with provenance | P1 | @integration | UI | AC-4, FR-004b | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-030` |
| A-13-TC-031 | Stalled / open chips, sorted by open longest | P1 | @integration @waits-a11 | UI | AC-5, FR-005 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-031` |
| A-13-TC-032 | Contractor "as printed on permit" + badge; BBB rating or reason | P1 | @missing-data | UI | AC-5, FR-005, FR-022 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-032` |
| A-13-TC-033 | MissingReason for roof basis, contractor, BBB, tenure | P1 | @missing-data | UI | AC-7, FR-007 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-033` |
| A-13-TC-034 | No-carrier fields → "not published · no lexicon carrier" | P1 | @missing-data | UI | AC-5, FR-005 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-034` |
| A-13-TC-035 | Empty open list → exact message | P1 | @negative @missing-data | UI | AC-5, FR-005 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-035` |
| A-13-TC-036 | Tenure > 10 + `ooa78753`: fields and definitions | P1 | @integration | UI | AC-8, FR-008 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-036` |
| A-13-TC-037 | Unknown tenure excluded and counted | P1 | @missing-data | UI | AC-8, FR-008 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-037` |
| A-13-TC-038 | SQL write statement refused (read-only) | P1 | @negative @security | UI | AC-6, FR-006 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-038` |
| A-13-TC-039 | SQL typo → one error line with fix, no stack trace | P1 | @negative @error | UI | Edge 3, FR-017 | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-039` |
| A-13-TC-040 | First DuckDB load ≤ 8 s with a progress bar | P1 | @perf @waits-a11 | UI | AC-6, FR-006, NFR-001 | `tests/e2e/A-13-perf.spec.ts @scenario:A-13-TC-040` |
| A-13-TC-041 | 20 timed runs per search, p95 < 3 s | P1 | @perf @waits-a11 | UI | AC-6, NFR-001 | `tests/e2e/A-13-perf.spec.ts @scenario:A-13-TC-041` |
| A-13-TC-042 | Help · MCP: tools, setup, no sample response | P2 | @integration | UI | FR-023 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-042` |
| A-13-TC-043 | Filters run on the server with "DuckDB on the server · same views" | P1 | @integration | UI | AC-4, AC-6, FR-006a | `tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-043` |
| A-13-TC-050 | CRM card switches to a live URL through config | P2 | @edge | UI | AC-9, Edge 6, FR-020 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-050` |
| A-13-TC-051 | Watch demo and PR links hidden until configured | P2 | @edge | UI | AC-9, FR-009 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-051` |
| A-13-TC-052 | Hub never loads the query engine | P2 | @perf | UI | AC-9, NFR-002 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-052` |
| A-13-TC-053 | Catalog: one row per table, columns, rows, CID, size | P2 | @integration @waits-a11 | UI | AC-10, FR-010, FR-024 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-053` |
| A-13-TC-054 | Table list unreachable → "Catalog unavailable · {reason}" | P2 | @negative @error | UI | AC-10, Edge 5, FR-019 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-054` |
| A-13-TC-055 | Legal · Data: seven sources, terms links, access rules | P2 | @content | UI | AC-11, FR-011 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-055` |
| A-13-TC-056 | Legal · Privacy and Terms render static text | P2 | @content | UI | AC-11, FR-011 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-056` |
| A-13-TC-057 | Runs · Log: every event in time order with run ID | P2 | @integration @waits-a11 | UI | AC-12, FR-012 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-057` |
| A-13-TC-058 | Runs · Log LCP < 2.5 s on mobile 4G | P2 | @perf @waits-a11 | UI | AC-12, NFR-002 | `tests/e2e/A-13-vitals.spec.ts @scenario:A-13-TC-058` |
| A-13-TC-060 | Coming soon · Builder mode | P2 | @coming-soon | UI | AC-13, FR-013 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-060` |
| A-13-TC-061 | Coming soon · Other counties and states | P2 | @coming-soon | UI | AC-13, FR-013 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-061` |
| A-13-TC-062 | Coming soon · Street View | P2 | @coming-soon | UI | AC-13, FR-013 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-062` |
| A-13-TC-063 | Coming soon · AI-user sign-in (not linked) | P2 | @coming-soon | UI | AC-13, FR-013 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-063` |
| A-13-TC-064 | Coming soon · Saved searches | P2 | @coming-soon | UI | AC-13, FR-013 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-064` |
| A-13-TC-065 | Coming soon · Similar properties | P2 | @coming-soon | UI | AC-13, FR-013 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-065` |
| A-13-TC-066 | Coming soon · SQL checks | P2 | @coming-soon | UI | AC-13, FR-013 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-066` |
| A-13-TC-067 | Coming soon · Pipeline diagram and Gantt | P2 | @coming-soon | UI | AC-13, FR-013 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-067` |
| A-13-TC-068 | Coming soon · Area matrix | P2 | @coming-soon | UI | AC-13, FR-013 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-068` |
| A-13-TC-069 | Coming soon · Run timeline scrubber (unless approved at D-7) | P2 | @coming-soon | UI | AC-13, FR-013 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-069` |
| A-13-TC-070 | Coming soon · Gateway race (unless approved at D-7) | P2 | @coming-soon | UI | AC-13, FR-013 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-070` |
| A-13-TC-071 | Another county (picker or URL) → "CountyLens has data for Travis County, TX only" | P2 | @negative @edge | UI | AC-13, FR-013 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-071` |
| A-13-TC-072 | 390: filter sheet, Coming soon in the More sheet, 48 px | P1 | @responsive @edge | UI | AC-13, Edge 4, FR-018 | `tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-072` |
| A-13-TC-073 | No-sample-data scan over every route | P1 | @scan @security | UI | AC-14, FR-014, FR-024 | `tests/e2e/A-13-scan.spec.ts @scenario:A-13-TC-073` |
| A-13-TC-074 | No "not wired" toast and no ProtoBar on any control | P1 | @scan | UI | AC-14, FR-014 | `tests/e2e/A-13-scan.spec.ts @scenario:A-13-TC-074` |
| A-13-TC-080 | Every page at 390 / 768 / 1440, Atlas tokens only (smeargle) | P1 | @responsive | UI | NFR-002, FR-018 | `tests/e2e/A-13-scan.spec.ts @scenario:A-13-TC-080` |
| A-13-TC-081 | LCP < 2.5 s, CLS < 0.1, INP < 200 ms on mobile 4G | P1 | @perf | UI | NFR-002 | `tests/e2e/A-13-vitals.spec.ts @scenario:A-13-TC-081` |
| A-13-TC-082 | Initial JS ≤ 300 KB gzipped excluding DuckDB | P1 | @perf | UI | NFR-002 | `tests/e2e/A-13-perf.spec.ts @scenario:A-13-TC-082` |
| A-13-TC-083 | WCAG 2.2 AA (axe) on every route | P1 | @a11y | UI | NFR-002 | `tests/e2e/A-13-scan.spec.ts @scenario:A-13-TC-083` |
| A-13-TC-085 | Harness refuses localhost | P1 | @harness @negative | CLI | Harness rule | `tests/e2e/A-13-scan.spec.ts @scenario:A-13-TC-085` |
| A-13-TC-086 | Every route loads directly, on refresh and as a deep link | P1 | @smoke | UI | FR-025 | `tests/e2e/A-13-scan.spec.ts @scenario:A-13-TC-086` |

## 8. Functional test cases

Common step 0 for every case: **open** `{RUNTIME_URL}/runs/index.json` in the same private context; **read** the latest entry (greatest `finishedAt`) and fetch its manifest from `https://gateway.pinata.cloud/ipfs/{manifestCid}` as the oracle `M`. Steps below refer to `M`, `M.coverage`, `M.artifacts`, `M.sources`.

### Demo lines D-1 … D-9

#### A-13-TC-001: D-1 Hub: CountyLens card, CRM Coming soon, run chip (happy path)

- **Priority / tags:** P1 · `@smoke @demo`
- **Maps to:** AC-9, FR-009 · demo line D-1
- **Steps:**
  1. **Open** `{RUNTIME_URL}/` in a private window. → Hub renders.
  2. **Verify** the CountyLens card shows the buttons "Open" and "What can I ask?".
  3. **Verify** the Roofing CRM card reads "Coming soon · Not deployed yet" and its button has `disabled` (or `aria-disabled="true"`) and no `href`.
  4. **Verify** the status chip reads "Run {n} · {YYYY-MM-DD HH:mm} UTC" where {n} = the 1-based position of the latest run in `runs/index.json` ordered by `finishedAt` (today 1) and the time is that entry's `finishedAt` in UTC, minutes precision.
  5. **Click** "Open" on the CountyLens card. → URL path is `/tx/travis/explore`.
- **Expected result:** both cards and the chip as above; the chip matches `runs/index.json` exactly (today "Run 1 · 2026-10-21 10:40 UTC"); Open lands on Explore. No number on the Hub other than the chip's. D-1 opens on the Hub (story wins over 02-design § 1).

#### A-13-TC-002: D-2 Runs: latest completed run summary (happy path)

- **Priority / tags:** P1 · `@demo` · **Waits for A-11 (PO D-1/D-2, 2026-10-21)** for Runs 1–3 and the BBB limitation.
- **Maps to:** AC-1, FR-001 · D-2
- **Steps:**
  1. **Open** `{RUNTIME_URL}/runs` in a private window. → progress bar, then the latest run card.
  2. **Verify** the card names `M.runId` and shows `M.startedAt` and `M.finishedAt` in UTC (suffix "UTC" or "Z").
  3. **Verify** one row per `M.sources[]` entry with its name, `records`, `captured_at` (UTC) and `watermark`.
  4. **Verify** the per-source delta columns show `added` / `changed` / `removed` from `M.sources[]` (see TC-010 for the first-run case).
  5. **Verify** the limitations list (TC-011) and the line "Next sync: none · scheduler off by default".
  6. **Verify** the data-source chip: when the run index or manifest read was served by the CID copy, no "fallback" chip; when it was served by Filebase (response URL host `ipfs.filebase.io`), the chip "fallback · ipfs.filebase.io" (FR-016; forced in TC-023).
- **Expected result:** every value equals `M`; the "fallback" chip appears exactly when a read was served by Filebase. Today: 1 run, 2 sources (`austin-3syk-w9eu`, `tcad-2026-certified-json`). With A-11: the latest of ≥ 3 runs, its sources incl. BBB with "BBB: blocked · 403" if `M` records it.

#### A-13-TC-003: D-3 Coverage: counts, denominators, time, derivation, table (happy path)

- **Priority / tags:** P1 · `@demo` · **Waits for A-11 (PO D-1/D-2, 2026-10-21)** for the full-county kinds and denominators.
- **Maps to:** AC-2, FR-002 · D-3
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/coverage` in a private window.
  2. **Verify** rows exist for property, ownership, permit, contractor (five rows: resolved, candidate, ambiguous, conflicting, unresolved), BBB by status, business, places and coordinates.
  3. **Verify** each row with a matching `M.coverage` key shows that key's `count`, its derivation label (§ 3), the collection time (`captured_at` of the source behind it) and the elephant-cli table name with its CID from `M.artifacts`.
  4. **Verify** each denominator comes from a `source_total:{source}` coverage key in `M` (TCAD certified roll; Austin `3syk-w9eu` total at watermark; Comptroller Travis total), or shows the TC-017 reason.
- **Expected result:** every count equals `M.coverage[key].count`. Today: e.g. permits = `permits_emitted` (35), contractor unresolved = `contractor_unresolved` (35, "From the run's internal match (not recomputable from public data)"); BBB, business, places, coordinates and every denominator show their reasons (TC-017).

#### A-13-TC-004: D-4 SQL count in the browser, engine line (happy path)

- **Priority / tags:** P1 · `@demo`
- **Maps to:** AC-6, FR-006 · D-4
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore?mode=sql` in a private window; start recording network requests.
  2. **Wait** for the progress bar (`role="progressbar"`) to finish.
  3. **Type** `SELECT count(*) FROM v_property` in the SQL editor.
  4. **Click** "Run".
  5. **Verify** the result grid shows one row, one integer.
  6. **Verify** the engine line reads "DuckDB-WASM in your browser · read-only".
  7. **Verify** no request was sent to `/api/` or any `/trpc/` path between steps 4 and 5.
- **Expected result:** the integer equals `M.coverage.parcels_published.count` (today 14); engine line exact; the query ran in the browser (no server request). No timing target applies to this run (FR-006a); the elapsed time is recorded only.

#### A-13-TC-005: D-5 Manifest: every artifact, run chain (happy path)

- **Priority / tags:** P1 · `@demo`
- **Maps to:** AC-3, FR-003d · D-5
- **Steps:**
  1. **Open** `{RUNTIME_URL}/data/manifest` in a private window.
  2. **Verify** the run chain appears first: one entry per run from latest to oldest following `previousManifestCid`, each with "Verify" and "Copy CID".
  3. **Verify** the artifact table has `M.artifacts.length` rows (today 27).
  4. **Verify** each row's CID (`data-cid`), name, codec, size, SHA-256 and CAR (`carCid` where present) equal the matching `M.artifacts[]` entry.
  5. **Verify** the data-source chip: "fallback · ipfs.filebase.io" shown exactly when the manifest read was served by Filebase (response URL host), absent when served by the CID copy (FR-016).
  6. **Reload** with the CID-copy host aborted (`page.route`). → the same rows, now with the "fallback · ipfs.filebase.io" chip.
- **Expected result:** exact match row by row in both reads; the chip matches the host that served the read; no IPNS name anywhere; today the chain has one entry with "previous: none".

#### A-13-TC-006: D-6 Verify: two ✓ lanes on Pinata and Filebase (happy path)

- **Priority / tags:** P1 · `@demo`
- **Maps to:** AC-3, FR-003, AM-01 · D-6
- **Test data:** the largest `raw` artifact ≤ 50 MB in `M` (today `tables/county/structure/part-00000.parquet`).
- **Steps:**
  1. **Open** `{RUNTIME_URL}/data/manifest` in a private window.
  2. **Click** "Verify" on the test-data artifact row. → URL `/data/verify/{cid}`; two lanes.
  3. **Wait** up to 60 s for both lanes to finish.
  4. **Verify** lane 1 shows the URL `https://gateway.pinata.cloud/ipfs/{cid}` and lane 2 `https://ipfs.filebase.io/ipfs/{cid}`, each with its operator name.
  5. **Verify** each lane shows the bytes received, the SHA-256 computed in the page and the manifest's size and SHA-256 side by side, and "✓".
- **Expected result:** two ✓ lanes; computed size = `artifact.size`, computed SHA-256 = `artifact.sha256` on both; no other gateway shown (TC-022 checks the network). A real rate limit on the way may show "rate-limited, retrying" or "no readable response (rate-limited or blocked), retrying" before ✓; the case fails only if a lane ends without ✓.

#### A-13-TC-007: D-7 Compare latest vs previous run (happy path)

- **Priority / tags:** P1 · `@demo` · **Waits for A-11 (PO D-1/D-2, 2026-10-21)**: needs ≥ 2 runs (Run 3 vs Run 2).
- **Maps to:** AC-1, FR-001a · D-7
- **Steps:**
  1. **Open** `{RUNTIME_URL}/runs/compare?a={n-1}&b={n}` in a private window ({n} = latest run position).
  2. **Verify** two columns with two distinct manifest CIDs equal to `runs/index.json` entries n-1 and n.
  3. **Verify** run n's `previousManifestCid` is shown as a link to run n-1's CID.
  4. **Wait** for the pill "old manifest still resolves on Pinata and Filebase".
  5. **Verify** the CAR link per run and the sizes summed from each manifest's artifacts.
- **Expected result (A-11):** CIDs distinct; link equals `M.previousManifestCid`; pill shown only after both gateways answered 200 for the old CID (TC-015). **Today (single run):** the test runs the TC-014 branch: `/runs/compare` shows "first run · nothing to compare against", and the single manifest CID resolves on both gateways.

#### A-13-TC-008: D-8 Pflugerville 5 mi, roof ≥ 15 yrs (happy path)

- **Priority / tags:** P1 · `@demo` · **Waits for A-11 (PO D-1/D-2, 2026-10-21)** for full-county rows.
- **Maps to:** AC-4, FR-004 · D-8
- **Test data:** "Pflugerville"; r = 5; roof = 15. Dated reference (2026-10-19, re-measured at run time): 44 Austin reroof permits within 5 mi of 30.447765, −97.602116.
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore` in a private window.
  2. **Type** "Pflugerville" in the search box. → suggestion "Pflugerville city · Census 2024 Gazetteer · 30.447765, −97.602116".
  3. **Select** that suggestion.
  4. **Set** Radius to 5 mi and Roof age to ≥ 15 years.
  5. **Verify** the header reads "{n} within 5 mi of Pflugerville · roof ≥ 15 yrs".
  6. **Verify** the engine line reads "DuckDB on the server · same views" and the response of `/api/trpc/explore.search` has `total_within_r` = {n}.
  7. **Verify** {n} equals the number of List rows (all pages) and equals the SQL-panel count of the same filter (`v_property`, `dist_mi(...) <= 5`, `roof_age_years >= 15`) run in a second tab.
  8. **Verify** each row's fields (TC-026).
- **Expected result:** header and engine line exact; {n} consistent three ways (server, list, browser SQL). With A-11: {n} > 0 and rows sorted Nearest. Today: {n} is whatever the single run holds within 5 mi (may be 0, then the TC-028 zero-results line and Close matches show).

#### A-13-TC-009: D-9 Open or stalled ≥ 5 yrs, longest first (happy path)

- **Priority / tags:** P1 · `@demo` · **Waits for A-11 (PO D-1/D-2, 2026-10-21)** for permit history.
- **Maps to:** AC-5, FR-005 · D-9
- **Test data:** the area recorded in `docs/evidence/A-13-open-permits.md` (default Pflugerville, 5 mi). Dated reference (2026-10-19, re-measured at run time): 3 stalled (2004-011296 BP, about 22.6 yrs; 2018-111955 BP; 2022-098180 BP), 0 open.
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore?place=pflugerville&r=5&roof=15` in a private window.
  2. **Turn on** "Open or stalled" and set "Open ≥" to 5 years.
  3. **Select** Sort "Open longest".
  4. **Verify** each stalled row shows the chip "Stalled {x} yrs · source status not published · no lexicon carrier" (TC-031; `status_raw` has no carrier, ADR-0002 #2), the contractor name "not published · no lexicon carrier" and the BBB line of TC-032.
  5. **Verify** the open-permit section; with no open permits it reads "no open roofing permits in this radius on the current run".
  6. **Verify** the stalled and open counts equal the counts for this area on the current run in `docs/evidence/A-13-open-permits.md`.
- **Expected result (A-11):** list equals the evidence file; within the dated range 3 stalled ordered 2004-011296 BP first (chip "Stalled 22.6 yrs · source status not published · no lexicon carrier", re-measured at run time); open list empty with the exact message. **Today:** the run holds September 2026 permits only, so no permit is open ≥ 5 years: zero rows and the exact empty message.

### Part 1 · Runs and Compare

#### A-13-TC-010: Per-source deltas; first run says so (edge)

- **Priority / tags:** P1 · `@edge`
- **Maps to:** AC-1, FR-001c
- **Steps:**
  1. **Open** `{RUNTIME_URL}/runs` in a private window.
  2. **Read** each source row's delta cells.
  3. **Verify** when the latest run has a previous run: cells equal `M.sources[i].added`, `changed`, `removed`.
  4. **Verify** when it has none (`M.previousManifestCid` null): the delta area reads "first run · nothing to compare against".
- **Expected result:** today step 4 applies (exact string); no delta number shown as a comparison to a non-existent run.

#### A-13-TC-011: Limitations and "Next sync" line (missing data)

- **Priority / tags:** P1 · `@missing-data`
- **Maps to:** AC-1, FR-001
- **Steps:**
  1. **Open** `{RUNTIME_URL}/runs` in a private window.
  2. **Verify** every string in `M.limitations` and every `M.sources[].limitations` entry appears verbatim under Limitations.
  3. **Verify** "Next sync: none · scheduler off by default".
- **Expected result:** today includes "Comptroller baseline not loaded (A-07)" and "Confidential owner records redacted (Texas Tax Code §25.025): 0"; with A-11 / A-08, "BBB: blocked · 403" if the manifest records it. No limitation invented by the page.

#### A-13-TC-012: Run index unreadable → explicit error (negative)

- **Priority / tags:** P1 · `@negative @error`
- **Maps to:** AC-1, FR-021
- **Steps:**
  1. **Route** `**/runs/index.json` to abort (`net::ERR_FAILED`), then repeat with a 200 response body `{"runs":` (invalid JSON).
  2. **Open** `{RUNTIME_URL}/runs` in a private window, then `{RUNTIME_URL}/`.
  3. **Verify** each page shows "Run index unavailable · {reason}" with a link to `/runs/index.json`, and no run card, count, CID or chip value.
- **Expected result:** exact text with a non-empty {reason} (network failure for the abort, invalid JSON for the second response); the Hub chip area shows the same line, not a stale run; no stack trace.

#### A-13-TC-013: Manifest unreadable → explicit error naming the CID (negative)

- **Priority / tags:** P1 · `@negative @error`
- **Maps to:** AC-1, FR-021
- **Steps:**
  1. **Route** every request whose URL contains `M` manifest CID (CID copy and Filebase) to return 503.
  2. **Open** `{RUNTIME_URL}/runs` in a private window.
  3. **Open** `{RUNTIME_URL}/tx/travis/coverage`.
- **Expected result:** both pages show "Manifest unavailable · {cid} · {reason}" with {cid} = `M` CID (full value in `data-cid`) and a non-empty {reason}; no counts, no sample values.

#### A-13-TC-014: Single published run → Compare explains why (edge)

- **Priority / tags:** P1 · `@edge @missing-data`
- **Maps to:** AC-1, FR-001b
- **Steps:**
  1. **Route** `**/runs/index.json` to return only its first entry (a real published run), so the case also runs after A-11.
  2. **Open** `{RUNTIME_URL}/runs/compare?a=1&b=2` in a private window.
  3. **Verify** the page shows "first run · nothing to compare against" and links to that run.
  4. **Open** `{RUNTIME_URL}/runs`; **verify** the single run is shown.
- **Expected result:** exact text with the one real run CID; no second column, no invented run, no empty grid.

#### A-13-TC-015: "Still resolves" pill only after both gateways answer (negative)

- **Priority / tags:** P1 · `@negative` · **Waits for A-11 (PO D-1/D-2, 2026-10-21)**: needs two runs. Today: skipped with reason "1 run published".
- **Maps to:** AC-1, FR-001a
- **Steps:**
  1. **Route** `https://ipfs.filebase.io/ipfs/{old manifest CID}*` to return 504.
  2. **Open** `{RUNTIME_URL}/runs/compare?a={n-1}&b={n}`.
  3. **Verify** the pill "old manifest still resolves on Pinata and Filebase" is absent and the Filebase check shows its failure (or "no readable response (rate-limited or blocked), retrying" while it retries).
  4. **Remove** the route; **click** the re-check control. → pill appears.
- **Expected result:** pill appears only when both Pinata and Filebase returned 200; every check request goes to those two hosts only.

### Part 1 · Coverage

#### A-13-TC-016: Coverage counts equal the manifest, with labels and table CID (integration)

- **Priority / tags:** P1 · `@integration`
- **Maps to:** AC-2, FR-002, FR-024
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/coverage` in a private window.
  2. **For each** displayed count, **read** its `data-coverage-key`.
  3. **Verify** the number equals `M.coverage[key].count` and the label equals the derivation label of `M.coverage[key].derivation`.
  4. **Verify** each source-table chip names an elephant-cli table whose CID is in `M.artifacts`.
  5. **Open** `{RUNTIME_URL}/runs`; **verify** any count shown on both pages is identical.
- **Expected result:** 0 disagreements between Coverage, Runs and `M`; 0 counts without a coverage key.

#### A-13-TC-017: Coverage kinds or denominators missing → reason in words (missing data)

- **Priority / tags:** P1 · `@missing-data`
- **Maps to:** AC-2, FR-002, FR-007
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/coverage` in a private window.
  2. **For each** required record kind with no key in `M.coverage`, **verify** its row reads "not in this run's coverage section".
  3. **For each** denominator without a `source_total:{source}` key in `M`, **verify** the row reads "denominator not in this run's manifest · A-01 source {name}" with {name} the A-01 source (TCAD certified roll; City of Austin `3syk-w9eu`; TX Comptroller `9cir-efmm`).
- **Expected result:** today BBB, business, places and coordinates show "not in this run's coverage section" and every denominator shows the exact denominator line; no number typed into the page.

### Part 1 · Data · Manifest and Verify

#### A-13-TC-018: Directory artifact → "Verify via CAR" (edge)

- **Priority / tags:** P1 · `@edge`
- **Maps to:** AC-3, FR-003c
- **Steps:**
  1. **Open** `{RUNTIME_URL}/data/manifest` in a private window.
  2. **Find** the row of the first `tables/{group}` directory artifact (today `tables/county`).
  3. **Verify** its action reads "Verify via CAR" and links to its `carCid`, and no "Verify" lane fetch of the directory CID happens.
- **Expected result:** "Verify via CAR" exact; no gateway request for the directory CID.

#### A-13-TC-019: File artifact > 50 MB → "Verify via CAR" (edge)

- **Priority / tags:** P2 · `@edge` · **Waits for A-11 (PO D-1/D-2, 2026-10-21)**: full-county artifacts.
- **Maps to:** AC-3, FR-003c
- **Steps:**
  1. **Open** `{RUNTIME_URL}/data/manifest`.
  2. **Find** every file artifact with `size` > 52,428,800 in `M`.
  3. **Verify** each shows "Verify via CAR" and no in-browser download.
- **Expected result (A-11):** every > 50 MB file shows "Verify via CAR". **Today:** the test asserts no artifact in `M` exceeds 50 MB, records "no > 50 MB artifact in this run" and checks that every ≤ 50 MB file row shows "Verify".

#### A-13-TC-020: 429 during Verify → "rate-limited, retrying", never a false ✓ (negative)

- **Priority / tags:** P1 · `@negative @error`
- **Maps to:** AC-7, FR-003b
- **Steps:**
  1. **Route** `https://gateway.pinata.cloud/ipfs/{cid}` to answer a readable 429 (with `Access-Control-Allow-Origin: *`, no `Retry-After`) the first 2 times, then pass through; record each request time.
  2. **Open** `{RUNTIME_URL}/data/verify/{cid}` (test-data file artifact) in a private window.
  3. **Verify** the Pinata lane shows "rate-limited, retrying" and no ✓ while it retries.
  4. **Verify** the waits are about 2 s then 4 s (each ±0.5 s), i.e. growing backoff.
  5. **Wait** for the lane to finish. → ✓ with digest = `artifact.sha256`.
  6. **Repeat** with the Filebase route aborted (`net::ERR_FAILED`, an unreadable response) for the first 2 tries. → the Filebase lane shows "no readable response (rate-limited or blocked), retrying", then ✓.
  7. **Repeat** with the Pinata route answering 429 every time.
- **Expected result:** steps 3 and 6 texts exact; backoff 2 / 4 s; ✓ only after a matching digest; with permanent 429 the lane stops after 3 tries in the failed state with no ✓ and no digest claimed; the other lane is unaffected (✓).

#### A-13-TC-021: Gateway bytes differ → mismatch, no ✓ (negative)

- **Priority / tags:** P1 · `@negative`
- **Maps to:** AC-3, FR-003
- **Steps:**
  1. **Route** `https://ipfs.filebase.io/ipfs/{cid}` to return the real bytes with the last byte flipped.
  2. **Open** `{RUNTIME_URL}/data/verify/{cid}` in a private window.
  3. **Verify** the Filebase lane shows a mismatch with the computed SHA-256 and the manifest SHA-256 side by side.
- **Expected result:** Filebase lane in state `mismatch` (`data-model.md` VerifyLane; the lane's `data-state="mismatch"`), both digests shown and unequal, no ✓; Pinata lane ✓. The lane text matches "Mismatch · size {got} vs {expected} · SHA-256 {got4}…{got4} vs {exp4}…{exp4}" (`contracts/ui-routes.md`, closes GAP-8).

#### A-13-TC-022: Verify hosts only Pinata and Filebase, plain GET (security)

- **Priority / tags:** P1 · `@security`
- **Maps to:** AC-3, FR-003a, AM-01
- **Steps:**
  1. **Record** all requests of the page context.
  2. **Open** `{RUNTIME_URL}/data/verify/{cid}` in a private window; wait for both lanes.
  3. **Collect** every request whose URL contains `{cid}`.
- **Expected result:** hosts ⊆ {`gateway.pinata.cloud`, `ipfs.filebase.io`}; 0 requests to `ipfs.io`, `dweb.link`, `w3s.link` or the CID copy host; every request is `GET` with no `Range` header, no custom request header, no cookies (`credentials: "omit"`) and no `OPTIONS` preflight.

#### A-13-TC-023: CID copy down → Filebase "fallback"; Verify unaffected (negative)

- **Priority / tags:** P1 · `@negative @error`
- **Maps to:** Edge 2, FR-016
- **Steps:**
  1. **Route** every request to the CID copy host (`CID_COPY_HOST` from the deployed config) to abort.
  2. **Open** `{RUNTIME_URL}/runs` in a private window. → run card renders.
  3. **Verify** a label "fallback · ipfs.filebase.io" on the data read.
  4. **Open** `{RUNTIME_URL}/tx/travis/explore?mode=sql`; run `SELECT count(*) FROM v_property`; **verify** the same count as TC-004 and the "fallback" label.
  5. **Open** `{RUNTIME_URL}/data/verify/{cid}`. → two ✓ lanes as TC-006.
- **Expected result:** pages work from Filebase with the visible "fallback" label; Verify unchanged (Pinata + Filebase, two ✓); no request reached the aborted host after the first failure per file.

#### A-13-TC-024: Run chain Verify and Copy CID (integration)

- **Priority / tags:** P2 · `@integration`
- **Maps to:** AC-3, FR-003d
- **Steps:**
  1. **Open** `{RUNTIME_URL}/data/manifest` in a private window with clipboard permission.
  2. **Click** "Copy CID" on the latest run in the chain.
  3. **Verify** the clipboard equals the latest `manifestCid` in `runs/index.json`.
  4. **Click** "Verify" on that run. → `/data/verify/{manifestCid}` with two lanes.
- **Expected result:** clipboard exact; Verify lanes as TC-006 for the manifest file.

### Part 1 · Explore · Filters and Property

#### A-13-TC-025: Place search resolves Pflugerville through the gazetteer (integration)

- **Priority / tags:** P1 · `@integration`
- **Maps to:** AC-4, FR-004
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore` in a private window.
  2. **Type** "Pflug" in the search box.
  3. **Verify** the suggestion "Pflugerville city · Census 2024 Gazetteer · 30.447765, −97.602116".
  4. **Select** it.
  5. **Verify** the URL has `place=` for Pflugerville (or `at=30.447765,-97.602116`) and the area block names Pflugerville.
- **Expected result:** suggestion text exact; coordinates equal the `travis-places@1.0.0` entry.

#### A-13-TC-026: Every row has its fields and provenance (integration)

- **Priority / tags:** P1 · `@integration`
- **Maps to:** AC-4, FR-004, FR-022, NFR-003
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore?at=30.2672,-97.7431&r=25&roof=0&view=list` in a private window (wide area so today's run returns rows).
  2. **For each** row, **verify** cells: address, roof age, `roof_age_basis`, `roof_age_confidence`, distance (mi) with bearing, "lat, lon", Source.
  3. **Verify** each Source link names the run ID and a table CID present in `M.artifacts`.
- **Expected result:** 100% of rows carry provenance; every cell holds a value or a `<MissingReason/>` (today address cells show "not published · no lexicon carrier" per ADR-0002 R7, and basis / confidence follow TC-034).

#### A-13-TC-027: Radius 5 → 3 mi updates the count live (edge)

- **Priority / tags:** P1 · `@edge`
- **Maps to:** AC-4, FR-004
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore?place=pflugerville&r=5&roof=15` in a private window; set `window.__tcMarker = 1`.
  2. **Read** the header count {n5}.
  3. **Change** the radius control from 5 to 3 mi.
  4. **Verify** within 3 s the header reads "{n3} within 3 mi of Pflugerville · roof ≥ 15 yrs", URL has `r=3`, `window.__tcMarker` is still 1 and no new navigation entry exists.
- **Expected result:** {n3} ≤ {n5}; {n3} = row count; no page reload.

#### A-13-TC-028: Zero results → Close matches with miles outside (edge)

- **Priority / tags:** P1 · `@edge @missing-data`
- **Maps to:** Edge 1, FR-015
- **Test data:** `at` = 30.447765, −97.602116, r = 0.5, roof = 15; precondition: the SQL panel count for that filter is 0 (if not, the harness halves r until it is, minimum 0.1).
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore?at=30.447765,-97.602116&r=0.5&roof=15` in a private window.
  2. **Verify** the line "No properties within 0.5 mi · {k} close matches just outside", with {k} = `close_matches.length` of the `explore.search` response.
  3. **Verify** the Close matches list: {k} ≤ 10 rows, each showing "+{miles_outside} mi" with 0 < miles_outside and distance ≤ 2 × r (1.0 mi), ordered nearest first, each with provenance.
- **Expected result:** exact line; no blank table; {k} = 0 is allowed (then the line reads "… · 0 close matches just outside" and no list).

#### A-13-TC-029: URL state restores filters; `view=map` → List (integration)

- **Priority / tags:** P1 · `@integration`
- **Maps to:** AC-4, FR-004a, FR-025
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore?place=pflugerville&r=5&roof=15&permit=open_stalled&openYrs=5&tenure=10&ooa=1&sort=open_desc&mode=filters&view=list` in a private window.
  2. **Verify** every control shows its URL value.
  3. **Reload**; **verify** the same state.
  4. **Open** the same URL with `view=map`.
- **Expected result:** state survives reload; `view=map` shows the List view and no map, marker or tile request.

#### A-13-TC-030: Row opens the Property drawer with provenance (integration)

- **Priority / tags:** P1 · `@integration`
- **Maps to:** AC-4, FR-004b
- **Steps:**
  1. **Open** the TC-026 URL in a private window.
  2. **Click** the first row. → drawer opens, URL gains `sel=`.
  3. **Verify** the drawer shows the property's fields with provenance (run, table CID, source link) and missing reasons where empty.
  4. **Reload**. → the drawer is open on the same property.
- **Expected result:** drawer values equal the row's; provenance present; deep link works.

#### A-13-TC-031: Stalled / open chips, sorted by open longest (integration)

- **Priority / tags:** P1 · `@integration` · **Waits for A-11 (PO D-1/D-2, 2026-10-21)** for permits ≥ 5 years old.
- **Maps to:** AC-5, FR-005
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore?at=30.2672,-97.7431&r=25&permit=open_stalled&openYrs=5&sort=open_desc` in a private window.
  2. **For each** permit chip, **verify** the text matches `^Stalled \d+(\.\d)? yrs · source status not published · no lexicon carrier$` while ADR-0002 lists `status_raw` as no carrier (`^Stalled \d+(\.\d)? yrs · source says Expired$` once a carrier exists); an open chip starts `Open {x} yrs` and its status part reads "not published · no lexicon carrier" (see § 10).
  3. **Verify** {x} values are non-increasing down the list and {x} = `open_days` / 365.25 to one decimal.
- **Expected result (A-11):** county-wide list headed by the oldest open or stalled reroof; dated reference (2026-10-19, re-measured at run time) oldest open 1982-012866 BP (`Suspended` at the source, shown as "not published · no lexicon carrier" while `status_raw` has no carrier). **Today:** `M.coverage.permits_emitted_stalled` = 0 and no permit is ≥ 5 years open, so the list is empty with the TC-035 message.

#### A-13-TC-032: Contractor "as printed on permit" + badge; BBB rating or reason (missing data)

- **Priority / tags:** P1 · `@missing-data`
- **Maps to:** AC-5, FR-005, FR-022
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore?at=30.2672,-97.7431&r=25&permit=any` in a private window.
  2. **Open** the first permit row's drawer.
  3. **Verify** the contractor name reads "not published · no lexicon carrier" (ADR-0002 #1; "as printed on permit" appears only once a carrier exists) with the AD-24 resolved / unresolved badge from the row's `contractor.resolution` (spec FR-005).
  4. **Verify** the BBB line: a rating, or exactly "BBB not checked · {bbb_status_reason}" / "BBB blocked · 403 challenge, not harvested" / "BBB: no profile found".
- **Expected result:** today every contractor is Unresolved (`contractor_unresolved` = 35) and `bbb_status` is `not_checked`, so each drawer shows the no-carrier name, the badge "Unresolved" and "BBB not checked · {reason}" with a non-empty reason; no licence line (AD-06); no blank cell.

#### A-13-TC-033: MissingReason for roof basis, contractor, BBB, tenure (missing data)

- **Priority / tags:** P1 · `@missing-data`
- **Maps to:** AC-7, FR-007
- **Steps:**
  1. **Open** the TC-026 URL in a private window; enable all optional columns (tenure, owner area, contractor, BBB).
  2. **Find** rows (via the SQL panel IDs) where `roof_age_basis` = `unknown`, contractor not printed, `bbb_status` ∈ {`blocked`, `not_checked`, `not_found`}, `tenure_years` null.
  3. **Verify** each such cell's `<MissingReason/>` text exactly: roof basis → "roof age unknown · no permit, new-construction or built-year record"; contractor name → "not published · no lexicon carrier"; BBB → "BBB not checked · {bbb_status_reason}" / "BBB blocked · 403 challenge, not harvested" / "BBB: no profile found"; tenure → "tenure unknown · no dated sale on record"; owner area → "owner area unknown · mailing address not in the published export".
  4. **Scan** every result cell.
- **Expected result:** exact strings as step 3; 0 empty cells; 0 cells whose whole text is "null", "undefined", "NaN", "—" or "-". A state with no row in today's data is recorded as "not present in this run", not passed silently.

#### A-13-TC-034: No-carrier fields → "not published · no lexicon carrier" (missing data)

- **Priority / tags:** P1 · `@missing-data`
- **Maps to:** AC-5, FR-005
- **Steps:**
  1. **Read** the no-carrier list from `docs/decisions/0002-lexicon-carriers.md` at the deployed `sha` (`{RUNTIME_URL}/build.json`).
  2. **Open** the TC-031 URL with `permit=any` in a private window; open one row's drawer.
  3. **For each** no-carrier field shown on screen without a documented view fallback (AD-24 / AD-25), incl. `status_raw` and the printed contractor name, **verify** the text "not published · no lexicon carrier".
- **Expected result:** exact string on each such field; no invented value (e.g. no status word, no contractor name, no BBB grade, no expiry date).

#### A-13-TC-035: Empty open list → exact message (negative)

- **Priority / tags:** P1 · `@negative @missing-data`
- **Maps to:** AC-5, FR-005
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore?place=pflugerville&r=5&permit=open&openYrs=5` in a private window.
  2. **Verify** the SQL-panel count of open (`status_class = 'open'`) reroofs with `open_days` ≥ 1,826 within that area is 0 (dated reference 2026-10-19: 0 open).
  3. **Verify** the list area.
- **Expected result:** "no open roofing permits in this radius on the current run" exact; no blank table.

#### A-13-TC-036: Tenure > 10 + `ooa78753`: fields and definitions (integration)

- **Priority / tags:** P1 · `@integration` · values wait for A-04 (owner area) and A-11.
- **Maps to:** AC-8, FR-008
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore` in a private window.
  2. **Select** the preset `ooa78753`. → "tenure > 10 years" and "out-of-area owner" on.
  3. **Verify** one line of definition under each of the two filters.
  4. **Verify** each row shows `tenure_years` with `tenure_basis` and `owner_area_class`.
- **Expected result:** two definitions visible; fields present or with reasons (today `owner_area_class` is `unknown` because address fields are not emitted: "owner area unknown · mailing address not in the published export"); no row with tenure ≤ 10.

#### A-13-TC-037: Unknown tenure excluded and counted (missing data)

- **Priority / tags:** P1 · `@missing-data`
- **Maps to:** AC-8, FR-008
- **Steps:**
  1. **Open** the TC-036 state in a private window.
  2. **Read** "tenure unknown: {n}".
  3. **Run** in the SQL panel the count of `v_property` rows in the same area with `tenure_years IS NULL`.
- **Expected result:** {n} equals the SQL count; no listed row has unknown tenure.

### Part 1 · SQL and Help

#### A-13-TC-038: SQL write statement refused (negative)

- **Priority / tags:** P1 · `@negative @security`
- **Maps to:** AC-6, FR-006
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore?mode=sql` in a private window.
  2. **Run** `DELETE FROM v_property`, then `CREATE TABLE t AS SELECT 1`.
  3. **Run** `SELECT count(*) FROM v_property`.
- **Expected result:** both refused with exactly "Read-only: only SELECT, WITH, DESCRIBE and SHOW run here"; step 3 equals TC-004's count.

#### A-13-TC-039: SQL typo → one error line with fix, no stack trace (negative)

- **Priority / tags:** P1 · `@negative @error`
- **Maps to:** Edge 3, FR-017
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore?mode=sql` in a private window.
  2. **Run** `SELEC count(*) FROM v_property`.
  3. **Run** `SELECT count(*) FROM v_propety`.
- **Expected result:** each shows exactly one error line matching `^.+ · Try: .+$` ("{engine message, first line} · Try: {fix}"), the fix naming `SELECT` for step 2 and `v_property` for step 3; no text matching `/\bat .+:\d+:\d+/`, `.ts:` / `.js:` frames or "Error:" stacks; the editor keeps the query.

#### A-13-TC-042: Help · MCP: tools, setup, no sample response (content)

- **Priority / tags:** P2 · `@integration`
- **Maps to:** FR-023
- **Steps:**
  1. **Open** `{RUNTIME_URL}/help/mcp` in a private window.
  2. **Verify** the six tools with their schemas and the Desktop, Code and Inspector snippets with `Authorization: Bearer <token>`.
  3. **Click** "Try a tool".
- **Expected result:** until A-14 merges, Try a tool shows exactly "Not available yet · the agent and MCP server arrive with story A-14" (`contracts/ui-routes.md`, closes GAP-8); no sample JSON response anywhere on the page.

#### A-13-TC-043: Filters run on the server with "DuckDB on the server · same views" (integration)

- **Priority / tags:** P1 · `@integration`
- **Maps to:** AC-4, AC-6, FR-006a
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore?place=pflugerville&r=5&roof=15` in a private window; record requests.
  2. **Verify** the engine line reads "DuckDB on the server · same views".
  3. **Verify** one request to `/api/trpc/explore.search` per search, its response has `engine: "server"` and `as_of.manifestCid` = `M` CID, and no `duckdb*.wasm` request was made.
  4. **Switch** to `?mode=sql`. → the engine line becomes "DuckDB-WASM in your browser · read-only" and DuckDB-WASM loads now.
- **Expected result:** Filters never load DuckDB-WASM; SQL alone does; both engine lines exact; `as_of` names the latest run.

### Part 2 · Hub

#### A-13-TC-050: CRM card switches to a live URL through config (edge)

- **Priority / tags:** P2 · `@edge`
- **Maps to:** AC-9, Edge 6, FR-020
- **Steps:**
  1. **Open** `{RUNTIME_URL}/build.json`; **read** `sha`.
  2. **Open** `{RUNTIME_URL}/site-links.json`; **verify** today `crmUrl` is `""`.
  3. **Route** `{RUNTIME_URL}/site-links.json` to return `{ "crmUrl": "https://crm.example.invalid/", "demoVideoUrl": "", "prUrl": "" }`.
  4. **Open** `{RUNTIME_URL}/` in a private window.
  5. **Verify** the CRM card is enabled and links to `https://crm.example.invalid/`, without "Coming soon · Not deployed yet".
  6. **Repeat** with `crmUrl` = `http://crm.example.invalid/` (not https). → card stays "Coming soon · Not deployed yet", button disabled.
  7. **Verify** `build.json` `sha` is unchanged.
- **Expected result:** the card's state and link come from `site-links.json` only (https only, invalid = hidden); same build. Without the route, TC-001's Coming soon state.

#### A-13-TC-051: Watch demo and PR links hidden until configured (edge)

- **Priority / tags:** P2 · `@edge`
- **Maps to:** AC-9, FR-009
- **Steps:**
  1. **Open** `{RUNTIME_URL}/` in a private window.
  2. **Verify** "Watch demo" and "PR" links are absent while `demoVideoUrl` and `prUrl` are `""` in `/site-links.json`, and present with the configured `https://` URLs when set (route as TC-050).
- **Expected result:** no dead or placeholder link (`#`, empty `href`).

#### A-13-TC-052: Hub never loads the query engine (perf)

- **Priority / tags:** P2 · `@perf`
- **Maps to:** AC-9, NFR-002
- **Steps:**
  1. **Open** `{RUNTIME_URL}/` in a private window; record requests until network idle.
- **Expected result:** 0 requests for `duckdb*.wasm` or DuckDB worker scripts; 0 Parquet requests.

### Part 2 · Catalog, Legal, Runs · Log

#### A-13-TC-053: Catalog: one row per table, columns, rows, CID, size (integration)

- **Priority / tags:** P2 · `@integration` · **Waits for A-11 (PO D-1/D-2, 2026-10-21)** for `tables-export.json`.
- **Maps to:** AC-10, FR-010, FR-024
- **Steps:**
  1. **Open** `{RUNTIME_URL}/data/catalog` in a private window.
  2. **Verify** one row per published table in `M.artifacts` (`tables/{group}/{table}`), with its CID and size.
  3. **Verify** columns (name, type) equal `tables-export.json` (when `M` lists it) or the table parts' Parquet footers read by CID.
  4. **Verify** "rows in the published file" equals the summed Parquet row counts, and `published_rows` from `M.coverage` is shown beside it where a coverage key maps to the table.
  5. **Click** a CID. → `/data/verify/{cid}`.
- **Expected result (A-11):** columns from `tables-export.json`. **Today:** the notice "table export not in this run's manifest" and columns from each Parquet's schema; 23 table rows today (16 `tables/county/*`, 7 `tables/property_improvement/*`; counted from `M` at run time).

#### A-13-TC-054: Table list unreachable → "Catalog unavailable · {reason}" (negative)

- **Priority / tags:** P2 · `@negative @error`
- **Maps to:** AC-10, Edge 5, FR-019
- **Steps:**
  1. **Route** `**/tables-export.json*` and the Parquet schema reads (the table artifacts' CIDs on every host) to 503.
  2. **Open** `{RUNTIME_URL}/data/catalog` in a private window.
- **Expected result:** exactly "Catalog unavailable · {reason}" with a non-empty {reason} naming what failed, a link to `/data/manifest`; 0 table rows, no cached or sample list.

#### A-13-TC-055: Legal · Data: seven sources, terms links, access rules (content)

- **Priority / tags:** P2 · `@content`
- **Maps to:** AC-11, FR-011
- **Steps:**
  1. **Open** `{RUNTIME_URL}/legal/data` in a private window.
  2. **Verify** seven sources: TCAD, Travis County GIS, City of Austin `3syk-w9eu`, TX Comptroller `9cir-efmm`, BBB, Overture, US Census Gazetteer, each with a terms or licence link (`https://` href).
  3. **Verify** the access rules: public sources only; stop on 403; no CAPTCHA bypass; Query DB never exposed.
- **Expected result:** all seven named, seven links, four rules stated.

#### A-13-TC-056: Legal · Privacy and Terms render static text (content)

- **Priority / tags:** P2 · `@content`
- **Maps to:** AC-11, FR-011
- **Steps:**
  1. **Open** `{RUNTIME_URL}/legal/privacy`, then `{RUNTIME_URL}/legal/terms`, in a private window.
  2. **Verify** each has a heading, static text, a link to `/legal/data` and no data request (no Parquet or manifest fetch).
- **Expected result:** both render; no numbers or CIDs from data.

#### A-13-TC-057: Runs · Log: every event in time order with run ID (integration)

- **Priority / tags:** P2 · `@integration` · **Waits for A-11 (PO D-1/D-2, 2026-10-21)**: ≥ 3 runs and any `events` list.
- **Maps to:** AC-12, FR-012
- **Steps:**
  1. **Open** `{RUNTIME_URL}/runs/log` in a private window.
  2. **Build** the expected list from every manifest in `runs/index.json`: `startedAt`, each `sources[].captured_at` (with source), `finishedAt` (with the run's limitations), plus each `events[]` entry.
  3. **Verify** the page lists exactly these events, ascending by time, each with its run ID.
- **Expected result (A-11):** all events of ≥ 3 runs. **Today:** 4 events for run `travis-202609-permits-20261021t103516z` (start, `austin-3syk-w9eu` capture, `tcad-2026-certified-json` capture, finish with 3 limitations).

#### A-13-TC-058: Runs · Log LCP < 2.5 s on mobile 4G (perf)

- **Priority / tags:** P2 · `@perf` · **Waits for A-11 (PO D-1/D-2, 2026-10-21)**: measured with ≥ 3 runs; today measured on 1 run and recorded as provisional.
- **Maps to:** AC-12, NFR-002
- **Steps:**
  1. **Run** Lighthouse (mobile 4G, § 3) on `{RUNTIME_URL}/runs/log` at least 3 times.
- **Expected result:** median LCP < 2,500 ms, median CLS < 0.1; all runs saved to `docs/evidence/A-13-pages.md`.

### Part 2 · Coming soon items (TC-060 … TC-070)

Each case has the same steps and expected result, with its own entry point:

- **Steps:**
  1. **Open** the entry point in a private window at 1440.
  2. **Open or select** the item.
  3. **Verify** the label "Coming soon" and exactly one sentence saying what it will do and why it is not live.
  4. **Verify** the skeleton: `aria-hidden="true"`, no text nodes inside it, `element.getAnimations().length` = 0 and computed `animation-name` = `none` on every block; no `role="progressbar"` or `aria-busy="true"`.
  5. **Verify** the skeleton contains no digit, no string matching `/\b(baf|bag)[a-z2-7]{20,}/`, no `<table>`, `role="row"` or list of data items.
- **Expected result:** static grey blocks, label, one sentence; 0 numbers, rows or CIDs.

Every item also has a direct route `{RUNTIME_URL}/soon/{item}` (ids from the More sheet links); each case opens both its in-context entry point and that route.

| TC ID | Item | Entry point |
| --- | --- | --- |
| A-13-TC-060 | Builder mode (#21) | `{RUNTIME_URL}/tx/travis/explore`, mode switch "Builder" |
| A-13-TC-061 | Other counties and states (#20) | Location chip → county/state picker |
| A-13-TC-062 | Street View (#17) | Property drawer (TC-030) → Street View |
| A-13-TC-063 | AI-user sign-in (#66) | Not linked: assert no link to it on any route (TC-086 crawl); if it has a route, open it directly |
| A-13-TC-064 | Saved searches | Explore toolbar → Saved searches |
| A-13-TC-065 | Similar properties (#63) | Property drawer → Similar properties |
| A-13-TC-066 | SQL checks | Explore · SQL → SQL checks |
| A-13-TC-067 | Pipeline diagram and Gantt | `{RUNTIME_URL}/runs` → Pipeline |
| A-13-TC-068 | Area matrix | Explore → Area matrix |
| A-13-TC-069 | Run timeline scrubber (stays Coming soon, PO D-7) | `{RUNTIME_URL}/runs` |
| A-13-TC-070 | Gateway race (stays Coming soon, PO D-7) | `{RUNTIME_URL}/data/verify/{cid}` |

- **Priority / tags (all):** P2 · `@coming-soon` · **Maps to:** AC-13, FR-013.

#### A-13-TC-071: Another county → Travis-only message (negative)

- **Priority / tags:** P2 · `@negative @edge`
- **Maps to:** AC-13, FR-013
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore` in a private window.
  2. **Open** the county picker; **select** "Harris County".
  3. **Open** `{RUNTIME_URL}/tx/harris/explore` directly.
- **Expected result:** in both, "CountyLens has data for Travis County, TX only" exact; step 3 also links to `/tx/travis/explore`; the active county stays Travis; no Harris data, number or CID.

#### A-13-TC-072: 390: filter sheet, Coming soon in the More sheet, 48 px (responsive edge)

- **Priority / tags:** P1 · `@responsive @edge`
- **Maps to:** AC-13, Edge 4, FR-018
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore` at 390 × 844 in a private window.
  2. **Verify** the filters are behind a "Filters" button that opens a sheet.
  3. **Open** the More sheet; **verify** it lists the Coming soon items of TC-060 … TC-070 that belong to navigation.
  4. **Verify** every interactive element's bounding box ≥ 48 × 48 px and `document.documentElement.scrollWidth ≤ window.innerWidth`.
- **Expected result:** sheet and More sheet as described; 0 targets < 48 px; no horizontal scroll.

#### A-13-TC-073: No-sample-data scan over every route (scan)

- **Priority / tags:** P1 · `@scan @security`
- **Maps to:** AC-14, FR-014, FR-024
- **Steps:**
  1. **Collect** every manifest CID from `runs/index.json` and every artifact CID / `carCid` / `previousManifestCid` in those manifests (the allowed CID set).
  2. **Open** each route of TC-086 in a private window at 1440 and 390; wait for network idle; open every drawer, sheet and tab.
  3. **Scan** `document.body.innerText` and all `data-cid` / `href` attributes.
- **Expected result:** 0 hits for the denylist (`tests/e2e/fixtures/prototype-placeholders.json`: "SAMPLE, JORDAN A", "128 within 5 mi", "Run 4", "38.2 MB", "not wired", ProtoBar selectors; plus "city hall") and for every CID-shaped token found in `design/prototype/**`; every CID-shaped string (`/\b(baf|bag)[a-z2-7]{20,}/`, full or `{4}…{4}` truncated) in text, `data-cid`, `title` or `href` is in the allowed set; the scan output is saved to `docs/evidence/A-13-pages.md`.

#### A-13-TC-074: No "not wired" toast and no ProtoBar on any control (scan)

- **Priority / tags:** P1 · `@scan`
- **Maps to:** AC-14, FR-014
- **Steps:**
  1. **Open** each route of TC-086 in a private window.
  2. **Click** every enabled button and link that stays on the site (excluding destructive or external).
  3. **Watch** for toasts or snackbars.
- **Expected result:** 0 toasts containing "not wired" or "prototype"; no `[data-protobar]` or "ProtoBar" text; every click either works or is a disabled Coming soon control.

### Cross-cutting and NFR

#### A-13-TC-040: First DuckDB load ≤ 8 s with a progress bar (perf)

- **Priority / tags:** P1 · `@perf` · **Waits for A-11 (PO D-1/D-2, 2026-10-21)**: full-county tables; today measured on the single run, recorded as provisional.
- **Maps to:** AC-6, FR-006, NFR-001
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore?mode=sql` in a fresh private window (no cache), 5 times.
  2. **Measure** navigation start → engine ready; **verify** `role="progressbar"` with an accessible name was visible in between.
- **Expected result:** every cold load ≤ 8,000 ms with a progress bar; 5 timings in `docs/evidence/A-13-duckdb.md`.

#### A-13-TC-041: 20 timed runs per search, p95 < 3 s (perf)

- **Priority / tags:** P1 · `@perf` · **Waits for A-11 (PO D-1/D-2, 2026-10-21)**: full-county tables; today run on the single run, recorded as provisional.
- **Maps to:** AC-6, NFR-001
- **Steps:**
  1. **Open** `{RUNTIME_URL}/tx/travis/explore?place=pflugerville&r=5&roof=15` in a private window; wait for the first header.
  2. **Run** one untimed warm-up, then **apply** the search 20 times (toggle radius 5 → 3 → 5), timing from the input change to the updated header with `performance.now()` (250 ms debounce included, engine = server per FR-006a).
  3. **Repeat** for `permit=open_stalled&openYrs=5&sort=open_desc`.
  4. **Compute** p50 and p95 per search.
- **Expected result:** each p95 < 3,000 ms input → header; 40 timings, with the `queryDurationMs` of each `explore.search` log line, in `docs/evidence/A-13.md`. The SQL `count(*)` run is not timed against a target (FR-006a).

#### A-13-TC-080: Every page at 390 / 768 / 1440, Atlas tokens only (responsive)

- **Priority / tags:** P1 · `@responsive`
- **Maps to:** NFR-002, FR-018
- **Steps:**
  1. **Open** every route of TC-086 at 390, 768 and 1440 in a private window.
  2. **Verify** no horizontal scroll and, at 390, targets ≥ 48 px.
  3. **Verify** with `smeargle` that computed colours, fonts, spacing and radii come only from Atlas tokens (method as A-03-TC-NF-03).
  4. **Capture** a screenshot per route and width.
- **Expected result:** 0 overflow, 0 non-token values, screenshots in `docs/evidence/img/A-13-*`; smeargle report PASS.

#### A-13-TC-081: LCP < 2.5 s, CLS < 0.1, INP < 200 ms on mobile 4G (perf)

- **Priority / tags:** P1 · `@perf`
- **Maps to:** NFR-002
- **Steps:**
  1. **Run** Lighthouse mobile 4G (§ 3) at least 3 times on `{RUNTIME_URL}/`, `/data/catalog`, `/runs/log`, `/legal/data`, `/runs`, `/tx/travis/coverage`, `/data/manifest`, `/tx/travis/explore`.
  2. **Measure** INP in Playwright with 4G throttling: click the main control of each page 5 times.
- **Expected result:** per page median LCP < 2,500 ms and median CLS < 0.1; INP < 200 ms; all runs in `docs/evidence/A-13-pages.md`.

#### A-13-TC-082: Initial JS ≤ 300 KB gzipped excluding DuckDB (perf)

- **Priority / tags:** P1 · `@perf`
- **Maps to:** NFR-002
- **Steps:**
  1. **Open** `{RUNTIME_URL}/` and `{RUNTIME_URL}/tx/travis/explore` in a private window; record script responses until load.
  2. **Sum** transferred (`encodedBodySize`) bytes of JS, excluding DuckDB-WASM files and workers.
- **Expected result:** ≤ 307,200 bytes on each page.

#### A-13-TC-083: WCAG 2.2 AA on every route (a11y)

- **Priority / tags:** P1 · `@a11y`
- **Maps to:** NFR-002
- **Steps:**
  1. **Open** every route of TC-086 in a private window; run axe-core with tags `wcag2a, wcag2aa, wcag21aa, wcag22aa`.
  2. **Tab** through each page; **verify** a visible focus ring and logical order.
- **Expected result:** 0 serious or critical violations; focus visible on every control.

#### A-13-TC-085: Harness refuses localhost (harness)

- **Priority / tags:** P1 · `@harness @negative`
- **Maps to:** Harness rule (CLAUDE.md, "localhost is never evidence")
- **Steps:**
  1. **Open** `{RUNTIME_URL}/build.json`; **check out** its `sha`.
  2. **Run** `RUNTIME_URL=http://localhost:3000 npx playwright test -g "A-13" --list`, then with `http://127.0.0.1:3000`, then unset.
- **Expected result:** each exits non-zero with `RUNTIME_URL must be a hosted URL, not localhost: {value}` or `RUNTIME_URL is not set; set it to the hosted URL`; no test runs.

#### A-13-TC-086: Every route loads directly, on refresh and as a deep link (smoke)

- **Priority / tags:** P1 · `@smoke`
- **Maps to:** FR-025
- **Steps:**
  1. **Open** in a private window each of `/`, `/runs`, `/runs/compare?a=1&b=1`, `/runs/log`, `/tx/travis/coverage`, `/data/manifest`, `/data/verify/{latest manifest CID}`, `/data/catalog`, `/legal/data`, `/legal/privacy`, `/legal/terms`, `/help/mcp`, `/tx/travis/explore`, `/tx/travis/explore?mode=sql`, `/permits` (A-03, kept), and every `/soon/{item}`.
  2. **Verify** HTTP 200, the page heading and no console error.
  3. **Reload** each.
  4. **Crawl** all in-site links from those pages; **verify** none returns 404.
- **Expected result:** every listed route 200 with a heading; reload keeps the route; 0 broken in-site links; no link to AI-user sign-in.

## 9. Edge cases

- Zero results in a radius → Close matches with miles outside and the hint (TC-028).
- CID copy down → Filebase, labelled "fallback · ipfs.filebase.io"; Verify unaffected (TC-023).
- SQL typo → one error line with a fix, no stack trace (TC-039); write statement → read-only refusal (TC-038).
- 429 during Verify → "rate-limited, retrying", backoff, ✓ only with a matching digest (TC-020); byte mismatch → no ✓ (TC-021).
- Unknown roof basis, unprinted contractor, BBB blocked / not_checked / not_found, unknown tenure → reason in words (TC-033); no-carrier field → "not published · no lexicon carrier" (TC-034).
- Radius 5 → 3 mi → count updates live (TC-027).
- `tables-export.json` unreachable → "Catalog unavailable · {reason}" with manifest link (TC-054); not in manifest → "table export not in this run's manifest" (TC-053).
- Task B live → CRM card switches through config (TC-050).
- 390 → filter sheet, Coming soon in the More sheet, 48 px, no horizontal scroll (TC-072, TC-080).
- Another county, by picker or `/tx/{other}/…` URL → "CountyLens has data for Travis County, TX only" (TC-071).
- Coming soon skeleton → no numbers, rows or CIDs, not animated (TC-060 … TC-070).
- Single published run → Compare explains why (TC-014); first run → "first run · nothing to compare against" (TC-010).
- Run index or manifest unreadable → explicit error (TC-012, TC-013).
- Directory or > 50 MB file → "Verify via CAR" (TC-018, TC-019).
- 20 timed runs → p95 < 3 s (TC-041).

## 10. Gap-linked cases (expected to fail until fixed)

| TC ID | Asserts | Gap | Defect |
| --- | --- | --- | --- |
| A-13-TC-031 | Open-permit chip text | GAP-6 (new, minor): `contracts/ui-routes.md` fixes the stalled chip without a `status_raw` carrier but not the open chip ("Open {x} yrs · source says {status_raw}" cannot render). The case expects "Open {x} yrs" + "not published · no lexicon carrier"; plan.md should fix the exact open-chip string. No open permit ≥ 5 yrs exists today, so the case cannot fail on it today. | — |

Resolved 2026-10-21: GAP-1 (ADR-0002 + AC-5 last sentence win), GAP-2 (FR-006a: Filters on the server, SQL in the browser, PO confirms AC-6 wording at R3), GAP-3 (denominators from the manifest only, PO approved), GAP-4 and GAP-5 (`contracts/ui-routes.md` "Additional fixed strings and rules", `contracts/site-links.md`), GAP-7 (spec FR-005 now fixes the contractor text and the AD-24 resolved / unresolved badge).

## 11. Execution log (filled in Phase 5)

| TC ID | Run date | Build (sha) | Result | Evidence | Defect |
| --- | --- | --- | --- | --- | --- |
| A-13-TC-001 | | | | | |

---

## Gate G6: Test Case Approval

| # | Criterion | Status |
| --- | --- | --- |
| G6-1 | Every AC and every FR maps to at least one TC (§ 2 and § 7) | ☐ |
| G6-2 | Happy, negative, edge and missing-data paths covered | ☐ |
| G6-3 | NFRs have test cases with measurable pass criteria | ☐ |
| G6-4 | Every case is a complete sequence starting from the hosted URL | ☐ |
| G6-5 | Negative cases state the exact message or rejection behavior | ☐ |
| G6-6 | Test data and environment documented, with real records | ☐ |
| G6-7 | Every TC traces to the story and a requirement | ☐ |
| G6-8 | AI pre-check (`developmentsupport-g6-precheck`): PASS | ☐ |

**Decision:** ☐ Approved ☐ Returned, reason: {…} · {date}

## Open questions

- GAP-6 closed 2026-10-21: open chip = "Open {x} yrs · source status not published · no lexicon carrier" (`contracts/ui-routes.md`).
- GAP-8 closed 2026-10-21: mismatch and "Try a tool" strings fixed in `contracts/ui-routes.md`; TC-021 and TC-042 assert them.
- PO confirms the AC-6 wording at R3 (FR-006a); TC-004 and TC-041 follow FR-006a until then.
- `docs/evidence/A-13-open-permits.md` does not exist yet; TC-009 reads its area and counts once the presenter records them (Pflugerville by default).
