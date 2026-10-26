---
description: "Tasks for A-13 Explorer UI with its hub, legal, catalog and Coming soon pages"
---

# Tasks: Explorer UI with its hub, legal, catalog and Coming soon pages

**Input**: `specs/013-explorer-and-pages/` (spec.md, plan.md, research.md, data-model.md, contracts/, quickstart.md, agent-design.md)

**Tests**: MANDATORY (constitution X, XXI, XXII). In every phase the test tasks come first and must be shown failing before the implementation tasks run.

**Builder**: every implementation task is delegated to `soofi-xyz-team-kit:metagross` (constitution XV), one subagent per builder group, loading build-frontend-backends, frontend-bug-fix, responsive-design-tests and apply-engineering-guidelines.

**Format**: `- [ ] T### [P?] [US?] (group · metagross · est.) Description — files owned`. `[P]` = no shared file with another open task. `⏳` = test task that may be written while a long run goes (preview build, CI, deploy).

## Builder groups and file ownership (light lane L4)

No file is owned by two groups at the same time. Page stubs created by G1 in wave 1 are **handed over** to G2 (Part 1 pages) or G3 (Part 2 pages) at the start of their wave; G1 no longer touches them.

| Group | Owns | Wave |
| --- | --- | --- |
| **G1** Data and query layer | `packages/query-core/**`, `packages/shared/**`, `apps/api/src/routers/{explore,index}.ts`, `apps/api/test/explore*.test.ts`, `apps/web/src/data/{run-chain,run-events,coverage-rows,parquet-meta,site-links,verify-lane}.ts`, `apps/web/src/App.tsx`, `apps/web/src/components/AppShell.*`, `apps/web/src/routes/route-list.ts`, `apps/web/src/content/coming-soon.ts`, `apps/web/test/{app-shell,data-*}.test.ts(x)`, `apps/web/package.json` | 1 |
| **G2** Explorer pages (tracks A–E) | `apps/web/src/routes/{Runs,RunsCompare,Coverage,DataManifest,DataVerify,Explore,ExploreFilters,ExploreSql,PropertyDrawer,HelpMcp}.*`, `apps/web/src/components/{FilterSheet,ResultRow,PermitChip,ContractorBadge,VerifyLane}.*`, `apps/web/test/{runs,compare,coverage,manifest,verify,explore-*,property,help-mcp}.test.tsx` | 2 |
| **G3** Content pages (tracks F–I; J not approved, D-7) | `apps/web/src/routes/{Hub,DataCatalog,RunsLog,LegalData,LegalPrivacy,LegalTerms,ComingSoon}.*`, `apps/web/src/components/{ComingSoonSkeleton,CountySelect}.*`, `apps/web/src/content/legal.ts`, `apps/web/test/{hub,catalog,runs-log,legal,coming-soon,county-select}.test.tsx` | 3 (after every Part 1 task is green) |
| **G4** Tests and infra | `tests/e2e/**` (incl. `A-13-*.spec.ts`, `fixtures/prototype-placeholders.json`, `runs.spec.ts` TC-061/TC-014 fixes), `infra/src/web-stack.ts`, `infra/test/**`, `amplify.yml`, `scripts/bundle-size.ts` | 1–3 |

---

## Phase 1: Setup (wave 1)

- [x] T001 (G1 · metagross · 5m) Add `hyparquet` **1.31.2** exactly (no caret) to `apps/web/package.json`; `pnpm install`; confirm the lockfile resolves 1.31.2 — `apps/web/package.json`, `pnpm-lock.yaml`
- [x] T002 [P] (G1 · metagross · 5m) Add subpath exports `./gazetteer` and `./builders` and `"sideEffects": false` to `packages/query-core/package.json` (research R2) — `packages/query-core/package.json`
- [x] T003 [P] (G4 · metagross · 10m) Fix A-03 TC-061: choose the evidence file from the deployed `build.json.branch` (`/^(\d{3})-/` → `docs/evidence/A-{NN}.md`), `test.skip` with a reason on `feature/oracle-pipeline` or a non-story branch; update TC-014 step 4 so it no longer depends on a "Permits" nav link (research R11; PO R2) — `tests/e2e/runs.spec.ts`

---

## Phase 2: Foundational (wave 1, blocks every user story)

### Tests first

- [x] T004 [P] (G1 · metagross · 15m) Vitest for `exploreSearchSql`: bbox prefilter then haversine (A-oracle § 9), roof/permit/openYrs/tenure/ooa/sort/limit bounds, `total_within_r`, `tenure_unknown`, close matches "up to 10 nearest rows outside the radius and within 2 × r", no `LIKE '%ROOF%'` (P0-9); one fixture test + one test over the published run with its expected count range — `packages/query-core/test/explore.test.ts`
- [x] T005 [P] (G1 · metagross · 5m) Vitest for `resolvePlace` over `travis-places@1.0.0`: "Pflugerville" → "Pflugerville city · Census 2024 Gazetteer · 30.447765, −97.602116" — `packages/query-core/test/places.test.ts`
- [x] T006 [P] (G1 · metagross · 10m) Vitest for `explore.search`: Zod input bounds from contracts/explore-search.md (`radius_mi` 0.25..25, `roof` 0..120, `openYrs` 0..60, `tenure` 0..100, `limit` 1..1000 default 200), `as_of` from the bound run, `BAD_REQUEST` on bad input, plain message on engine error — `apps/api/test/explore.test.ts`
- [x] T007 [P] (G1 · metagross · 10m) Vitest for the web data modules: `run-chain` (follows `previousManifestCid`), `run-events` (startedAt, each `sources[].captured_at`, finishedAt + limitations, time-ordered across runs), `coverage-rows` (unknown keys tolerated; missing `source_total:*` → "denominator not in this run's manifest"), `site-links` (https only, invalid = hidden), `verify-lane` (state machine of data-model.md; ✓ only when size and digest match; 429 and network-error labels; backoff 2/4/8 s, 3 tries; never the CID copy) — `apps/web/test/data-modules.test.ts`
- [x] T008 [P] (G1 · metagross · 5m) Update `app-shell.test.tsx`: destinations Explore, Runs, Coverage, Data, More; app-bar title links to `/`; every route in `route-list.ts` renders a heading — `apps/web/test/app-shell.test.tsx`
- [x] T009 [P] ⏳ (G4 · metagross · 10m) CDK assertion tests: Web stack sets Amplify variables `VITE_PINATA_GATEWAY_HOST`, `CRM_URL`, `DEMO_VIDEO_URL`, `PR_URL` (empty defaults from context); Api stack unchanged except the new procedure's code — `infra/test/web-stack.test.ts`
- [x] T010 [P] (G4 · metagross · 10m) Bundle check test: initial graph of `/` ≤ 150 KB gzipped (target) and all non-duckdb chunks ≤ 300 KB gzipped; fails if a `duckdb`/`.wasm` asset is in the Hub graph — `scripts/bundle-size.ts`

### Implementation

- [x] T011 (G1 · metagross · 20m) `exploreSearchSql(input)` and `resolvePlace(text)` in query-core (contracts/explore-search.md, data-model.md ExploreResult) — `packages/query-core/src/explore.ts`, `packages/query-core/src/places.ts`, `packages/query-core/src/index.ts`
- [x] T012 (G1 · metagross · 10m) Additive `explore.search` procedure with Powertools log `procedure = explore.search`, `queryDurationMs`, X-Ray subsegment `duckdb.query` — `apps/api/src/routers/explore.ts`, `apps/api/src/routers/index.ts`
- [x] T013 [P] (G1 · metagross · 10m) Every fixed string of contracts/ui-routes.md (both tables) in one module; tests import, never retype — `packages/shared/src/labels.ts`, `packages/shared/src/urls.ts`
- [x] T014 [P] (G1 · metagross · 15m) Web data modules (research R3, R5, R6, R10) — `apps/web/src/data/{run-chain,run-events,coverage-rows,parquet-meta,site-links,verify-lane}.ts`
- [x] T015 (G1 · metagross · 15m) Shell and routes: `route-list.ts` (all routes of contracts/ui-routes.md, lazy loaders), `App.tsx`, `AppShell` (Explore, Runs, Coverage, Data, More; More sheet at 390 lists the Coming soon items; title → `/`), `content/coming-soon.ts` (the D-7 list: Builder mode, other counties and states, Street View, AI-user sign-in (not linked), saved searches, Similar properties, SQL checks, pipeline diagram and Gantt, area matrix, timeline scrubber, gateway race — id, title, one sentence; no numbers, rows or CIDs); stub page files (heading only) for every route, handed to G2/G3 — `apps/web/src/App.tsx`, `apps/web/src/components/AppShell.*`, `apps/web/src/routes/route-list.ts`, `apps/web/src/content/coming-soon.ts`, stubs
- [x] T016 [P] (G4 · metagross · 10m) Web stack variables and `amplify.yml` writing `public/site-links.json` next to `build.json` (contracts/site-links.md) — `infra/src/web-stack.ts`, `amplify.yml`
- [x] T017 [P] (G4 · metagross · 15m) Hosted e2e harness for A-13: helpers that fetch `runs/index.json` and manifests (by CID from Pinata), the real-CID allowlist, and the denylist `fixtures/prototype-placeholders.json` (research R8) — `tests/e2e/lib/a13.ts`, `tests/e2e/fixtures/prototype-placeholders.json`

**Checkpoint (end of wave 1):** integration check — `pnpm test`, `pnpm typecheck`, `pnpm lint`, bundle-size green; commit `A-13: wave 1 data and query layer`.

---

## Phase 3: US1 Runs, Compare and Coverage (P1, track A + B, wave 2) · AC-1, AC-2 · D-2, D-3, D-7

**Independent test**: `/runs`, `/runs/compare`, `/tx/travis/coverage` counts equal the latest manifest's coverage section.

- [x] T018 [P] [US1] (G2 · metagross · 10m) Tests: Runs shows sources, counts, UTC times, per-source deltas from `sources[].added/changed/removed`, limitations, "Next sync: none · scheduler off by default"; first run → "first run · nothing to compare against"; Compare with one run explains why; with two, both CIDs + `previousManifestCid` link and "old manifest still resolves on Pinata and Filebase" only after both answered; index/manifest unreadable → the exact error texts; a read served by Filebase shows the "fallback" chip (FR-016) — `apps/web/test/runs.test.tsx`, `apps/web/test/compare.test.tsx`
- [x] T019 [P] [US1] (G2 · metagross · 5m) Tests: Coverage row per record kind with count, `derivation`, collected time, source table, `<Provenance/>`; absent kind → reason; denominator → "denominator not in this run's manifest · A-01 source {name}" — `apps/web/test/coverage.test.tsx`
- [x] T020 [US1] (G2 · metagross · 15m) Runs (extend) and RunsCompare with run chain — `apps/web/src/routes/Runs.*`, `apps/web/src/routes/RunsCompare.*`
- [x] T021 [US1] (G2 · metagross · 10m) Coverage page — `apps/web/src/routes/Coverage.*`

## Phase 4: US2 Manifest and Verify (P1, track C, wave 2) · AC-3, AC-7 · D-5, D-6

- [x] T022 [P] [US2] (G2 · metagross · 10m) Tests: Manifest lists every artifact (CID, name, codec, size, SHA-256, CAR) and the run chain; Verify lanes Pinata + Filebase with exact URLs; ✓ only on match; mismatch shows both values; 429 → "rate-limited, retrying"; network error → "no readable response (rate-limited or blocked), retrying"; directory or > 50 MB → "Verify via CAR"; no request to the CID copy; the manifest read via Filebase shows the "fallback" chip (FR-016) — `apps/web/test/manifest.test.tsx`, `apps/web/test/verify.test.tsx`
- [x] T023 [US2] (G2 · metagross · 20m) DataManifest, DataVerify and the VerifyLane component — `apps/web/src/routes/DataManifest.*`, `apps/web/src/routes/DataVerify.*`, `apps/web/src/components/VerifyLane.*`

## Phase 5: US3 Lead finder: old roofs near a place (P1, track D, wave 2) · AC-4, AC-7 · D-8

- [x] T024 [P] [US3] (G2 · metagross · 10m) Tests: place search shows the gazetteer label; header "{n} within {r} mi of {place} · roof ≥ {years} yrs"; row fields (address, roof age, `roof_age_basis`, `roof_age_confidence`, Mi + bearing, Lat, lon, Source with run and table CID); 5 → 3 mi updates without reload (250 ms debounce); URL state per contracts/ui-routes.md, `view=map` → list; zero results → Close matches with "+{miles_outside} mi"; every gap shows the exact missing-reason text; engine line "DuckDB on the server · same views" — `apps/web/test/explore-filters.test.tsx`
- [x] T025 [US3] (G2 · metagross · 30m) Explore shell, Filters (FilterSheet collapses into a sheet at 390), ResultRow with `<Provenance/>` and `<MissingReason/>`, PropertyDrawer (`sel=`) — `apps/web/src/routes/{Explore,ExploreFilters,PropertyDrawer}.*`, `apps/web/src/components/{FilterSheet,ResultRow}.*`

## Phase 6: US4 Long-open roofing permits (P1, track D, wave 2) · AC-5 · D-9

- [x] T026 [P] [US4] (G2 · metagross · 5m) Tests: open/stalled + openYrs ≥ 5 sorted open longest; "Stalled {x} yrs · source status not published · no lexicon carrier" while `status_raw` has no carrier; contractor "not published · no lexicon carrier" + resolution badge (AD-24: resolved/unresolved); BBB reason texts; empty → "no open roofing permits in this radius on the current run" — `apps/web/test/explore-permits.test.tsx`
- [x] T027 [US4] (G2 · metagross · 15m) PermitChip and ContractorBadge, wired into ResultRow's permit column — `apps/web/src/components/{PermitChip,ContractorBadge}.*`

## Phase 7: US5 SQL panel and scale (P1, track E, wave 2) · AC-6 · D-4

- [x] T028 [P] [US5] (G2 · metagross · 5m) Tests: `?mode=sql` lazy-imports the engine (no import elsewhere); progress bar on first load; "DuckDB-WASM in your browser · read-only"; write refused with "Read-only: only SELECT, WITH, DESCRIBE and SHOW run here"; error → "{first line} · Try: {fix}", no stack trace — `apps/web/test/explore-sql.test.tsx`
- [x] T029 [US5] (G2 · metagross · 15m) ExploreSql route over the existing `engine/duckdb-wasm` adapter — `apps/web/src/routes/ExploreSql.*`

## Phase 8: US6 Tenure, out-of-area owners, Help · MCP (P1, tracks D + E, wave 2) · AC-8

- [x] T030 [P] [US6] (G2 · metagross · 5m) Tests: tenure > 10 and `ooa` (preset `ooa78753`) show `tenure_years`, `tenure_basis`, `owner_area_class`, a one-line definition of each filter, "tenure unknown: {n}"; Help · MCP lists the six AD-21 tools and "Try a tool" says why it is not available yet, never a sample response — `apps/web/test/explore-owner.test.tsx`, `apps/web/test/help-mcp.test.tsx`
- [x] T031 [US6] (G2 · metagross · 10m) Owner filters in FilterSheet/ResultRow; HelpMcp page — `apps/web/src/routes/HelpMcp.*` (FilterSheet/ResultRow already G2)

### Part 1 hosted specs (G4, wave 2)

- [x] T032 [P] [US1–US6] ⏳ (G4 · metagross · 25m) Playwright specs for TC-001…TC-042 Part 1 of `testplans/A-13-test-cases.md` (one test per TC, `@scenario:A-13-TC-nnn`, checkpoint screenshots to `docs/evidence/img/A-13-TC-{nnn}-{step}.png`; Verify cases on one worker; `page.route()` fault injection) — `tests/e2e/A-13-explorer.spec.ts`, `tests/e2e/A-13-verify.spec.ts`
- [x] T033 [P] [US5] ⏳ (G4 · metagross · 10m) Perf spec: 20 timed runs each of radius + roof and open-permit (input change → header), p95; first load ≤ 8 s with progress bar; one SQL `count(*)` (no p95); 0 `duckdb`/`.wasm` requests on `/` — `tests/e2e/A-13-perf.spec.ts`

**Checkpoint (end of wave 2):** integration check green; every Part 1 task ticked; commit `A-13: wave 2 explorer pages`. Wave 3 starts only now.

---

## Phase 9: US7 Hub (P3, track F, wave 3) · AC-9 · D-1

- [x] T034 [P] [US7] (G3 · metagross · 5m) Tests: CountyLens card (Open → Explore, What can I ask?); CRM card "Coming soon · Not deployed yet" with disabled button, live link when `crmUrl` set; chip "Run {n} · {YYYY-MM-DD HH:mm UTC}" from `runs/index.json`; Watch demo and PR links hidden until set; no query-core barrel or DuckDB import — `apps/web/test/hub.test.tsx`
- [x] T035 [US7] (G3 · metagross · 15m) Hub page with fixed-size chip skeleton and card min-heights (CLS, research R9) — `apps/web/src/routes/Hub.*`

## Phase 10: US8 Catalog and Legal (P3, tracks G + H, wave 3) · AC-10, AC-11

- [x] T036 [P] [US8] (G3 · metagross · 10m) Tests: Catalog row per table from manifest artifacts, columns from Parquet footers (lazy hyparquet chunk), "rows in the published file", `published_rows` where mapped, CID → `/data/verify/{cid}`; "table export not in this run's manifest"; unreachable → "Catalog unavailable · {reason}" + manifest link; Legal lists the seven sources with terms or licence links and the four access rules — `apps/web/test/catalog.test.tsx`, `apps/web/test/legal.test.tsx`
- [x] T037 [US8] (G3 · metagross · 15m) DataCatalog page — `apps/web/src/routes/DataCatalog.*`
- [x] T038 [US8] (G3 · metagross · 15m) Legal pages and content from `docs/sources.md` (facts with links, no legal advice, D-8); record each of the seven sources' official terms or licence page (public page, checked HTTP 200, with access date; TCAD, Travis County GIS, City of Austin open-data terms for `3syk-w9eu`, TX Comptroller open-data terms for `9cir-efmm`, BBB terms of use, Overture attribution/licence, US Census Gazetteer) in `content/legal.ts`; never invent a link; the PO reads the final text at A-2 — `apps/web/src/routes/Legal{Data,Privacy,Terms}.*`, `apps/web/src/content/legal.ts`

## Phase 11: US9 Runs · Log (P3, track H, wave 3) · AC-12

- [x] T039 [P] [US9] (G3 · metagross · 5m) Tests: every event of every manifest (from `run-events`) in time order with run ID — `apps/web/test/runs-log.test.tsx`
- [x] T040 [US9] (G3 · metagross · 10m) RunsLog page — `apps/web/src/routes/RunsLog.*`

## Phase 12: US10 Coming soon and no sample data (P3, track I, wave 3) · AC-13, AC-14

- [x] T041 [P] [US10] (G3 · metagross · 5m) Tests: `ComingSoonSkeleton` has no text nodes, `aria-hidden`, no animation/transition; each item shows "Coming soon" + one sentence; county selector → "CountyLens has data for Travis County, TX only"; `/tx/{other}/…` renders the same message with a link to `/tx/travis/explore` — `apps/web/test/coming-soon.test.tsx`, `apps/web/test/county-select.test.tsx`
- [x] T042 [US10] (G3 · metagross · 15m) ComingSoonSkeleton, ComingSoon route, CountySelect (in the shell's location chip slot via route-list) — `apps/web/src/components/{ComingSoonSkeleton,CountySelect}.*`, `apps/web/src/routes/ComingSoon.*`

### Part 2 hosted specs (G4, wave 3)

- [x] T043 [P] [US7–US10] ⏳ (G4 · metagross · 20m) Playwright specs for TC-050…TC-086 (Hub, Catalog, Legal, Runs log, each Coming soon item, More sheet at 390, other county, no-sample-data scan over every route in `route-list.ts`, web vitals under the Lighthouse mobile profile median of 5, JS size, WCAG, every route renders) — `tests/e2e/A-13-pages.spec.ts`, `tests/e2e/A-13-scan.spec.ts`, `tests/e2e/A-13-vitals.spec.ts`

**Checkpoint (end of wave 3):** integration check green; commit `A-13: wave 3 content pages`.

---

## Phase Z: Prove on the hosted runtime (mandatory, always last)

- [x] TZ01 Run the reviewer agents `metagross` and `audino` read-only with `/code-review medium`; record scores in `docs/reviews/CR-A-13.md` (each ≥ 75) — Outcome: `metagross` 77, `audino` 82 (both at least 75 before fixes), `/code-review medium` 8 findings, 0 Critical; recorded in `docs/reviews/CR-A-13.md`.
- [x] TZ02 Deploy the Amplify branch preview (after D-13: `cdk deploy CountyLensApi` then `CountyLensWeb` from the laptop with profile `assess`, then `git push origin 013-explorer-and-pages`); record `https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com` once `/build.json` shows the head SHA — Outcome: deployed after D-13; preview https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com, `/build.json` sha 2e14516 (final build; first complete suite on 015fbf9).
- [x] TZ03 Run Playwright on the hosted URL: one test per TC in `testplans/A-13-test-cases.md` (`@scenario:A-13-TC-nnn`), covering D-1 to D-9 in order plus every Part 2 route and Coming soon item; screenshots to `docs/evidence/img/` — Outcome: 71 of 73 hosted cases pass on 2e14516 (general 59 + 1 skipped, verify 8/8, vitals 2/2, TC-041 and TC-082 pass); TC-015 skipped (A-11); TC-040 failed on a slow link (11.2 to 25.7 s) and passes at 1.4 MB/s or faster (PO decision: keep 8 s, record both measurements). The earlier 72 of 73 was on 015fbf9.
- [x] TZ04 Run `smeargle` responsive-design-tests at 390 / 768 / 1440 on every page of the hosted URL — Outcome: smeargle run 3 on 015fbf9: 80 of 81 cells; N3 (/help/mcp at 390) fixed in 34c8eaf and re-measured (main 390 / 688 / 1360); later changes (Coverage cards, index.html hints, fonts) not re-run, icons checked visually on 2e14516 (`docs/evidence/A-13-smeargle.md`).
- [x] TZ05 Run the independent test: Playwright demo lines 1–8 (D-2 to D-9), every page and Coming soon item renders, the no-sample-data scan finds 0 placeholder values; record the D-11 demo area (open/stalled reroof counts per gazetteer place via `explore.search`) in `docs/evidence/A-13-open-permits.md` — Outcome: D-1 to D-9 pass on the hosted URL; TC-073 scan 0 hits on every route; demo area Austin city recorded in `docs/evidence/A-13-open-permits.md` (TC-009 now runs it).
- [x] TZ06 Write `docs/reports/A-13-test-report.md`, `docs/evidence/A-13.md` (+ `A-13-duckdb.md`, `A-13-roof-age.md`, `A-13-open-permits.md`, `A-13-pages.md`), the A-13 and A-18 rows of `docs/traceability.md`, one `docs/kit-usage.md` line — Outcome: written and refreshed for 2e14516: `docs/reports/A-13-test-report.md`, `docs/evidence/A-13.md`, `A-13-duckdb.md`, `A-13-roof-age.md`, `A-13-open-permits.md`, `A-13-pages.md`, `A-13-smeargle.md`, traceability and kit-usage rows.

---

## Phase N: Polish & cross-cutting (after Phase Z results)

- [x] T044 (G2/G3 by file owner · metagross · 10m) Tune only what TZ03/TZ04 measured over budget: route-level code splitting, image/icon sizing, CLS guards (research R9) — files of the owning group — Outcome: tuning done: ERR-44 (run-index preload and CID-copy preconnect), ERR-45 (preload only on data routes), ERR-46 (self-hosted fonts); TC-081 data pages 2.28 to 2.41 s median LCP.
- [x] T045 [P] (G4 · metagross · 5m) Run `quickstart.md` end to end on the hosted URL and record the result in `docs/evidence/A-13.md` — `docs/evidence/A-13.md` — Outcome: quickstart.md run on the hosted URL: unit 1,484 passed, bundle 220.9 KB of 300 and hub 124.6 KB of 150; hosted suite 71 pass, 1 skipped, 1 failed (TC-040, slow link); demo D-1 to D-9 pass; scan 0 hits; axe 0 violations on 25 routes; smeargle 80 of 81 then N3 fixed; step 7 waits for A-11 (`docs/evidence/A-13.md`).

---

## Dependencies & Execution Order

- **Wave 1** (parallel): G1 (T001, T002, T004–T008, T011–T015) and G4 (T003, T009, T010, T016, T017). Inside G1: T004–T008 before T011–T015.
- **Wave 2**: G2 (T018–T031) after the wave-1 checkpoint; G4 writes T032–T033 in parallel (⏳, also during preview builds and CI).
- **Wave 3**: G3 (T034–T042) only after every Part 1 task is green; G4 writes T043 in parallel.
- **Phase Z**: after wave 3 and the review round; TZ02 needs D-13; hosted proofs of AC-1 (3 runs), AC-2/AC-3 full county, AC-6 scale, AC-10 export and AC-12 multi-run wait for A-11 (PO D-1/D-2).

### Critical path

T004 (15) → T011 (20) → T012 (10) → T015 (15) → wave-1 check (5) → T024 (10) → T025 (30) → T026 (5) → T027 (15) → wave-2 check (5) → T036 (10) → T037 (15) → wave-3 check (5) → review round (32) → TZ02 (10) → TZ03 (20) → TZ04 (0, parallel) → TZ06 (7) ≈ **229 min**. Group totals (work, not wall clock): G1 ≈ 145 min, G2 ≈ 195 min, G3 ≈ 125 min, G4 ≈ 110 min.

## Parallel examples

```text
Wave 1, one message:  metagross[G1] T001,T002,T004–T008 → T011–T015   ||   metagross[G4] T003,T009,T010,T016,T017
Wave 2, one message:  metagross[G2] T018–T031                          ||   metagross[G4] T032,T033
Wave 3, one message:  metagross[G3] T034–T042                          ||   metagross[G4] T043
```

## Implementation strategy

MVP = Part 1 (US1–US6) green on the hosted preview (D-2 to D-9). Part 2 (US7–US10) follows in wave 3 and is the cut line (D-12). No sample data at any point; a page without its data shows the reason.

---

## Phase 13: Convergence (speckit-converge, 2026-10-22)

Assessment of the code on build 34c8eaf against spec.md, plan.md and tasks.md: 0 CRITICAL, 0 HIGH, 1 MEDIUM, 2 LOW. Gaps that wait for other stories (A-04, A-07, A-11, A-14) are not findings; see docs/evidence/A-13.md "Known gaps".

- [x] T046 (G2 · metagross · 20m) Show each record kind's denominator inside that kind's card on Coverage, or "denominator not in this run's manifest · A-01 source {name}" when the manifest carries none (look it up through the kind's source in `Coverage.kinds.ts`); keep the separate Denominators card only if it adds the A-01 source and date, never a number typed into the page — `apps/web/src/routes/Coverage.tsx`, `apps/web/src/routes/Coverage.kinds.ts`, `apps/web/test/coverage.test.tsx` per FR-002, US1/AC2 (partial)
- [x] T047 (G1 · metagross · 5m) Remove the unused `RUNS_TEXTS.completedRun` constant (the "completed run" rule of contracts/ui-routes.md is a data rule, not on-screen text: every entry of `runs/index.json` is a completed run), and its test — `packages/shared/src/texts.ts`, `packages/shared/test/a13-labels.test.ts` per contracts/ui-routes.md "Completed run" (unrequested)
- [x] T048 Tick TZ01–TZ06, T044 and T045 with their recorded outcomes (CR-A-13.md, A-13-test-report.md, A-13.md, quickstart result) and record the converge result — `specs/013-explorer-and-pages/tasks.md` per tasks bookkeeping (partial) — Outcome: all ticked with outcomes; `speckit-converge` once: 3 findings (1 MEDIUM, 2 LOW), T046 and T047 built, T048 bookkeeping.
