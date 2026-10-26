# Feature Specification: Explorer UI with its hub, legal, catalog and Coming soon pages

**Feature Branch**: `013-explorer-and-pages`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "Specify the story in stories/A-13-explorer-and-pages.md, a merged story with two parts: Part 1 Explorer (AC-1 to AC-8, Must) and Part 2 pages (AC-9 to AC-14, Should). Every acceptance criterion becomes at least one FR with the same numbers, and every edge case at least one FR. Keep each AC's "was" tag. […] The map and the CRM-preview toggle are out of scope. No technology choices. Verify uses Pinata and Filebase (ARD AM-01), not ipfs.io/dweb.link. A-11-dependent ACs (AC-1, AC-2, AC-3 full county, AC-6, AC-10, AC-12) are specified in full; their hosted proof waits for A-11 (PO D-1/D-2, 2026-10-21)."

**Story**: `stories/A-13-explorer-and-pages.md` (parts A-13 Explorer, A-18 pages) | **Evaluation point**: A5 (primary) · A1, A2, A3, A4 | **Demo line(s)**: D-1 (Hub), D-2, D-3, D-4, D-5, D-6, D-7, D-8, D-9

**Owner agents** (from the story front matter; used by the plan, not by this spec): design `metagross` · builder `metagross` · reviewers `metagross`, `audino` · verify Playwright demo lines 1–8; every page and Coming soon item renders; no sample data on the hosted site

> Every story acceptance criterion becomes at least one FR below, with the same number (AC-n → FR-0nn). Edge cases become FR-015 to FR-020. No technology choices in this file; they belong in plan.md. Names in quotes are on-screen strings; names in backticks are published column or file names fixed by the data contract (A-02, AD-07).

| Part | Was | Priority | ACs | FRs |
| --- | --- | --- | --- | --- |
| 1 Explorer | A-13 | Must (P1) | AC-1 to AC-8 | FR-001 to FR-008, FR-015 to FR-018 |
| 2 Hub, legal, catalog and Coming soon pages | A-18 | Should (P3): built after every Part 1 FR passes on the hosted URL; cut first (D-12) | AC-9 to AC-14 | FR-009 to FR-014, FR-019, FR-020 |

## Clarifications

### Session 2026-10-21

Answered from the story, `docs/02-design.md`, the ARD and the published manifest (walkthrough § 5); the PO confirms or overrides at round R2.

- Q: Where do Runs' per-source deltas come from? → A: From each manifest's `sources[].added`, `changed` and `removed` (published today); the first run with no previous run shows "first run · nothing to compare against" (FR-001).
- Q: What is a "run event" for Runs · Log when manifests carry no `events` list? → A: Every timestamped field of every manifest: `startedAt`, each `sources[].captured_at` (with its source name), `finishedAt`, and each limitation attached to the finish; any `events` list A-11 adds is listed too. Publish and verify times that exist only in docs are not shown (FR-012; 02-design § 2: events inside the manifest, never an extra IPFS artifact).
- Q: Where do the Catalog's columns come from, given `tables-export.json` is not published and lists no columns today? → A: From the published table files' own schema, read by CID; row count from the coverage section; while `tables-export.json` is not in the manifest, Catalog lists the tables from the manifest's artifacts and states "table export not in this run's manifest" (FR-010, FR-019).
- Q: Which number is {n} in the Hub chip "Run {n} · {finishedAt}"? → A: The 1-based position of the latest run in `runs/index.json` ordered by `finishedAt`; `finishedAt` shown in UTC (FR-009).
- Q (PO D-4, approved in R2 on 2026-10-21): Where do Coverage's denominators come from, given the manifest carries none? → A: only from the published manifest (A-11 adds them to the coverage or sources section); until then each row shows "denominator not in this run's manifest" with the A-01 source named, never a number typed into the page (FR-002).

## User Scenarios & Testing *(mandatory)*

The **evaluator** walks the README Demo Transcript D-1 to D-9 in order on the hosted URL. The **CRM developer** uses the same screens, the catalog and the legal pages to judge and reuse the data. Neither signs in.

### User Story 1 - See what the pipeline ran and how much it collected (Priority: P1) · AC-1, AC-2 · D-2, D-3, D-7

The evaluator opens Runs and sees the latest completed run: its sources, counts, UTC times, per-source change since the previous run and its limitations. Compare puts two runs side by side and shows the new manifest is linked to the old one, which still resolves. Coverage lists each record kind with its count, what it is counted against, when it was collected, how the count was derived and which published table it comes from.

**Why this priority**: D-2, D-3 and D-7 are the first evidence the evaluator reads (A1, A2, A3).

**Independent Test**: open `/runs`, `/runs/compare?a={n-1}&b={n}` and `/tx/travis/coverage` on the hosted URL; every count equals the matching field of the latest manifest's coverage section.

**Acceptance Scenarios**:

1. (AC-1, was A-13 AC-1) **Given** `runs/index.json` with Runs 1–3, **When** the evaluator opens Runs, **Then** the latest completed run shows its source list, counts, UTC timestamps, per-source deltas versus the previous run, limitations (for example "BBB: blocked · 403") and "Next sync: none · scheduler off by default"; Compare shows Run 3 vs Run 2 with distinct manifest CIDs, the `previousManifestCid` link, and "old manifest still resolves on Pinata and Filebase".
2. (AC-2, was A-13 AC-2) **Given** the manifest coverage section, **When** Coverage opens, **Then** each record kind (property, ownership, permit, contractor by its five states, BBB by status, business, places, coordinates) shows its published count, its denominator (TCAD certified roll; Austin `3syk-w9eu` total at watermark; Comptroller Travis total), collection time, `derivation` label and the published table it comes from.
3. **Given** a record kind the latest manifest's coverage section does not carry, **When** Coverage opens, **Then** its row shows the reason in words (for example "not in this run's coverage section") instead of a number.

---

### User Story 2 - Check a published file myself (Priority: P1) · AC-3, AC-7 (429) · D-5, D-6

The evaluator opens Data · Manifest, sees every published artifact with its CID, name, codec, size, SHA-256 and CAR, and clicks Verify. The browser fetches the file from two public gateways this project does not operate, hashes it locally and compares the size and digest with the manifest.

**Why this priority**: D-5 and D-6 prove A4 (content addressing).

**Independent Test**: on the hosted URL, Verify a file artifact ≤ 50 MB and see two ✓ lanes whose digests equal the manifest.

**Acceptance Scenarios**:

1. (AC-3, was A-13 AC-3) **Given** the Manifest page, **When** the evaluator clicks Verify on a file artifact ≤ 50 MB, **Then** the browser fetches it from Pinata and from Filebase (ARD AM-01), computes SHA-256 locally, and shows ✓ on both lanes with the exact URLs and the size and digest compared to the manifest; a directory shows "Verify via CAR".
2. (AC-7 second part, was A-13 AC-7) **Given** a gateway answers 429, **When** Verify runs, **Then** the lane shows "rate-limited, retrying", retries with backoff, and never shows ✓ without a matching digest.
3. **Given** a gateway returns bytes whose size or digest differs from the manifest, **When** Verify finishes, **Then** that lane shows a mismatch with both values and no ✓.

---

### User Story 3 - Find old roofs near a place (Priority: P1) · AC-4, AC-7 · D-8

The evaluator types a place, picks a radius and a roof-age threshold, and gets a list of matching properties with how the roof age was decided, how sure it is, distance and bearing, coordinates and a source link.

**Why this priority**: D-8 is the first roofing-lead question (A5).

**Independent Test**: search "Pflugerville", 5 mi, roof ≥ 15 years on the hosted Explore page; the header count equals the count of rows; changing the radius to 3 mi updates it without a reload.

**Acceptance Scenarios**:

1. (AC-4, was A-13 AC-4) **Given** Explore · Filters where the search box resolves "Pflugerville" through the A-02 gazetteer (showing "Pflugerville city · Census 2024 Gazetteer · 30.447765, −97.602116"), radius 5 mi and roof ≥ 15 years, **When** the search runs, **Then** the header reads "{n} within 5 mi of Pflugerville · roof ≥ 15 yrs", each row shows address, roof age, `roof_age_basis`, `roof_age_confidence`, distance and bearing, lat/lon, and a Source link with run and table CID, and changing the radius from 5 to 3 mi updates the count live.
2. (AC-7 first part, was A-13 AC-7) **Given** a result whose roof basis is `unknown`, whose contractor was not printed, whose BBB status is `blocked`, or whose tenure is unknown, **When** it renders, **Then** the missing-reason element shows the reason in words and nothing is blank or guessed.

---

### User Story 4 - Find long-open roofing permits (Priority: P1) · AC-5 · D-9

In the same area the evaluator asks for open or stalled roofing permits open at least 5 years, longest first, and sees each permit's status as the source printed it, the contractor as printed on the permit with its resolution badge, and the BBB rating or why it is missing.

**Why this priority**: D-9 is the second roofing-lead question (A5).

**Independent Test**: in the recorded demo area, the list equals the open and stalled reroofs counted for that area on the current run in `docs/evidence/A-13-open-permits.md`.

**Acceptance Scenarios**:

1. (AC-5, was A-13 AC-5) **Given** the same area with "open or stalled" and "open ≥ 5 years", sorted by open longest, **When** results load, **Then** stalled permits show "Stalled {x} yrs · source says Expired", open ones show "Open {x} yrs · source says {status_raw}", the contractor shows "as printed on permit" with its five-state badge, and BBB shows a rating or its status reason; for the recorded demo area the list matches the evidence file, and an empty open list says "no open roofing permits in this radius on the current run". Fields whose A-02 carrier verdict is "no carrier" show "not published · no lexicon carrier".
2. Dated reference (Austin permits, 2026-10-19, re-measured at run time): around Pflugerville (5 mi) the list holds 3 stalled reroofs (2004-011296 BP, about 22.6 years; 2018-111955 BP; 2022-098180 BP) and 0 open.

---

### User Story 5 - Query the data myself, fast, with no database server (Priority: P1) · AC-6 · D-4

The evaluator opens the SQL panel, runs a read-only query in their own browser and sees the engine line. Searches stay fast once the data has loaded.

**Why this priority**: D-4 proves A5/A4 (no Oracle-hosted database) and NFR-01.

**Independent Test**: run `SELECT count(*) FROM v_property` in the hosted SQL panel; time 20 runs of each search.

**Acceptance Scenarios**:

1. (AC-6, was A-13 AC-6; wording amended by the PO at G5, 2026-10-21) **Given** the full-county published tables, **When** the 5-mile radius + roof-age and open-permit searches each run 20 times on the hosted Explore page (server-side, AM-04/AM-06), **Then** p95 < 3 s from the input change to the updated header and the first load is ≤ 8 s with a progress bar; the SQL panel runs `SELECT count(*) FROM v_property` in the browser and shows "DuckDB-WASM in your browser · read-only".
2. **Given** a statement that would change data, **When** it is run, **Then** it is refused with a read-only message.

---

### User Story 6 - Filter by owner tenure and out-of-area owners (Priority: P1) · AC-8

**Why this priority**: roofing reps target long-tenure and absentee owners (backlog AC-39, AC-40, from A-04).

**Independent Test**: apply preset `ooa78753` with tenure > 10 years; every row shows `tenure_years`, `tenure_basis` and `owner_area_class`, and the excluded count is shown.

**Acceptance Scenarios**:

1. (AC-8, was A-13 AC-8) **Given** filters "tenure > 10 years" and "out-of-area owner" (preset `ooa78753`), **When** applied, **Then** results show `tenure_years` with `tenure_basis` and `owner_area_class`, with a one-line definition of each of the two filters on screen; properties with unknown tenure are excluded and counted as "tenure unknown: {n}".

---

### User Story 7 - Land on a front door that tells me what is live (Priority: P3, first of Part 2) · AC-9 · D-1

The visitor opens `/` and sees the CountyLens card, the Roofing CRM card marked Coming soon, and a chip naming the latest run.

**Why this priority**: the demo opens here (D-1). Part 2 is Should, built after Part 1.

**Independent Test**: open `/`; the chip's run number and time equal the last entry of `runs/index.json`.

**Acceptance Scenarios**:

1. (AC-9, was A-18 AC-1) **Given** the hosted app, **When** a visitor opens `/`, **Then** the Hub shows the CountyLens card linking to Explore, the Roofing CRM card as "Coming soon · Not deployed yet" with a disabled button, and a status chip "Run {n} · {finishedAt}" read from `runs/index.json`.

---

### User Story 8 - Know what each published table is and under which terms (Priority: P3) · AC-10, AC-11

**Independent Test**: open `/data/catalog` and `/legal/data`, `/legal/privacy`, `/legal/terms`.

**Acceptance Scenarios**:

1. (AC-10, was A-18 AC-2) **Given** the latest manifest (for example Run 3), **When** the visitor opens Data · Catalog, **Then** every published table appears with its columns from `tables-export.json`, its row count from the manifest coverage section (`published_rows`), its CID and size, and each CID links to Verify.
2. (AC-11, was A-18 AC-3) **Given** the Legal pages, **When** opened, **Then** each source used (TCAD, Travis County GIS, City of Austin `3syk-w9eu`, TX Comptroller `9cir-efmm`, BBB, Overture, US Census Gazetteer) is listed with its terms or licence link, and the access rules (public sources only, stop on 403, no CAPTCHA bypass, Query DB never exposed) are stated.

---

### User Story 9 - Read the run history as a log (Priority: P3) · AC-12

**Independent Test**: open `/runs/log` with at least 3 runs published.

**Acceptance Scenarios**:

1. (AC-12, was A-18 AC-4) **Given** a run history of at least 3 runs, **When** Runs · Log opens, **Then** every event from every manifest appears in time order with its run ID, and the page renders with LCP under 2.5 s on mobile 4G.

---

### User Story 10 - See the roadmap honestly, with no invented data anywhere (Priority: P3) · AC-13, AC-14

**Independent Test**: open each Coming soon item; run the no-sample-data scan over every route.

**Acceptance Scenarios**:

1. (AC-13, was A-18 AC-5) **Given** a Coming soon item (for example Builder mode or "Harris County"), **When** a visitor opens or selects it, **Then** it shows the planned layout as a static skeleton (grey placeholder blocks, not animated), a "Coming soon" label and one sentence on what it will do and why it is not live, with no example numbers, rows or CIDs; selecting another county shows "CountyLens has data for Travis County, TX only".
2. (AC-14, was A-18 AC-6) **Given** the full hosted site, **When** the no-sample-data scan runs, **Then** it finds 0 prototype placeholder values and 0 "not wired" toasts, and the ProtoBar is absent.

---

### Edge Cases

- Zero results in a radius → Close matches list (with miles outside) and the empty-state hint; never a blank table (FR-015).
- The CID copy is down → files are read from the Filebase gateway, labelled "fallback"; Verify is unaffected (FR-016).
- A SQL typo → one error line with its fix; no stack trace (FR-017).
- Phone width (390) → filters collapse into a sheet and Coming soon items sit in the More sheet; 48 px targets; no horizontal scroll (FR-018).
- `tables-export.json` unreachable → "Catalog unavailable · {reason}" and a link to the manifest; never a cached sample (FR-019).
- Task B goes live during review → the CRM card switches to its live URL through configuration, without a code change (FR-020).
- The run index or a manifest cannot be read → the page shows an explicit error state naming what failed (FR-021).
- A file artifact over 50 MB → Verify offers "Verify via CAR" instead of downloading (FR-003c).

## Requirements *(mandatory)*

### Functional Requirements

**Part 1 · Explorer (Must)**

- **FR-001** (AC-1; was A-13 FR-001): Runs MUST show the latest completed run from `runs/index.json` and its manifest (read by CID): source list, counts, UTC timestamps, per-source deltas versus the previous run, limitations, and "Next sync: none · scheduler off by default".
  - **FR-001a**: Compare (`/runs/compare?a=&b=`) MUST show both runs' manifest CIDs, the `previousManifestCid` link between them, and "old manifest still resolves on Pinata and Filebase" only after both gateways answered for the old CID.
  - **FR-001b**: With only one published run, Runs MUST show it and Compare MUST say why no comparison is possible, without inventing a second run.
- **FR-001c**: Per-source deltas MUST come from the manifest's `sources[].added`, `changed`, `removed`; a run without a previous run MUST show "first run · nothing to compare against".
- **FR-002** (AC-2; was A-13 FR-002): Coverage MUST read every count only from the manifest coverage section and show, per record kind, the count, denominator, collection time, `derivation` label and source table; a kind the section lacks MUST show its reason in words (FR-007). Denominators MUST come from the published manifest; until it carries them, each row shows "denominator not in this run's manifest" and names the A-01 source (PO D-4, 2026-10-21).
- **FR-003** (AC-3, AC-7; was A-13 FR-003): Verify MUST fetch a file artifact from Pinata and from Filebase with plain requests, hash it in the browser, and compare size and SHA-256 with the manifest, showing each lane's exact URL.
  - **FR-003a**: Verify MUST never fetch from the project's own CID copy (P0-14 as amended by AM-01).
  - **FR-003b**: On 429 a lane MUST show "rate-limited, retrying" and retry with backoff; ✓ appears only when the digest matches.
  - **FR-003c**: A directory artifact, or a file over 50 MB, MUST show "Verify via CAR".
  - **FR-003d**: Data · Manifest MUST list every artifact of the selected manifest with CID, name, codec, size, SHA-256 and CAR, and the run chain (latest → previous) with Verify and Copy CID per run.
- **FR-004** (AC-4; was A-13 FR-004): Explore · Filters MUST resolve a typed place through the A-02 gazetteer (or accept an `at` point), filter by radius and roof-age threshold, show the header "{n} within {r} mi of {place} · roof ≥ {years} yrs", and per row address, roof age, `roof_age_basis`, `roof_age_confidence`, distance and bearing, lat/lon and a Source link with run and table CID; changing the radius MUST update the count without a page reload.
  - **FR-004a**: Filter state MUST live in the URL (`at`, `r`, `roof`, `permit`, `openYrs`, `tenure`, `ooa`, `sort`, `sel`, `mode`, `place`, `view=list`); `view=map` MUST fall back to List.
  - **FR-004b**: Selecting a row MUST open the Property drawer with the record and its provenance.
- **FR-005** (AC-5; was A-13 FR-004): The open-permit filter MUST list open or stalled roofing permits with `openYrs` ≥ the threshold, sortable by open longest, showing "Stalled {x} yrs · source says Expired" or "Open {x} yrs · source says {status_raw}", the contractor "as printed on permit" with its five-state badge, and BBB rating or status reason; a field with no lexicon carrier MUST show "not published · no lexicon carrier"; an empty open list MUST say "no open roofing permits in this radius on the current run". While ADR-0002 gives `status_raw` and the printed contractor name no carrier, they show the no-carrier texts of `contracts/ui-routes.md` ("Stalled {x} yrs · source status not published · no lexicon carrier"; contractor "not published · no lexicon carrier" with the AD-24 resolved/unresolved badge); the "source says …" and "as printed on permit" texts appear once a carrier exists.
- **FR-006** (AC-6; was A-13 FR-004, NFR-001): The SQL panel MUST run read-only queries in the visitor's browser over the published views, show "DuckDB-WASM in your browser · read-only", and refuse data-changing statements; the first data load MUST show a progress bar.
  - **FR-006a** (ARD AM-04/AM-06; AC-6 wording approved by the PO at G5, 2026-10-21): Explore · Filters searches run on the server over the same published views and show "DuckDB on the server · same views"; the SQL panel alone runs in the browser. AC-6's p95 is timed from the input change to the updated header, whatever the engine; the SQL panel `count(*)` run has no p95 target.
- **FR-007** (AC-7; was A-13 FR-005): Every missing or unknown value MUST render a missing-reason element with the reason in words (roof basis `unknown`, contractor not printed, BBB `blocked` / `not_checked` / `not_found`, tenure unknown, coverage key absent); no blank cells, no guessed values.
- **FR-008** (AC-8; was A-13 FR-004): Tenure and out-of-area filters MUST show `tenure_years` with `tenure_basis` and `owner_area_class`, a one-line definition of each filter, exclude unknown tenure and show "tenure unknown: {n}".
- **FR-022** (P0-11, NFR-003): Every result row and card MUST carry provenance (run, table CID, source link).
- **FR-023** (D-12 support): Help · MCP MUST document the MCP tools and setup; until the agent and MCP story (A-14) is merged, "Try a tool" MUST say why it is not available yet and MUST NOT show a sample response.

**Part 2 · Hub, legal, catalog and Coming soon (Should)**

- **FR-009** (AC-9; was A-18 FR-001): The Hub at `/` MUST show the CountyLens card (Open, What can I ask?), the Roofing CRM card "Coming soon · Not deployed yet" with a disabled button, and the chip "Run {n} · {finishedAt}" from `runs/index.json` ({n} = 1-based position of the latest run ordered by `finishedAt`, time in UTC). Watch demo and PR links MUST come from configuration and stay hidden until set (decided at D-6).
- **FR-010** (AC-10; was A-18 FR-002): Data · Catalog MUST list one row per published table of the latest manifest with its columns (from `tables-export.json` when the manifest carries it, else from the table files' own published schema), row count (`published_rows` from the coverage section), CID and size, each CID linking to Verify, built only from published files; while the manifest has no table export it MUST state "table export not in this run's manifest".
- **FR-011** (AC-11; was A-18 FR-003): Legal pages (`/legal/data`, `/legal/privacy`, `/legal/terms`) MUST list the seven sources with their terms or licence link and state the access rules; static text, no legal advice.
- **FR-012** (AC-12; was A-18 FR-002): Runs · Log MUST list every event from every published manifest in time order with its run ID, built only from published files. An event is each timestamped manifest field (`startedAt`, each `sources[].captured_at` with its source, `finishedAt` with the run's limitations) plus any entry of an `events` list a manifest carries.
- **FR-013** (AC-13; was A-18 FR-004): Each Coming soon item (Builder mode, other counties and states, Street View, AI-user sign-in (not linked), saved searches, Similar properties, SQL checks, pipeline diagram and Gantt, area matrix; plus the timeline scrubber and gateway race unless approved at D-7) MUST show a static, non-animated skeleton, a "Coming soon" label and one sentence on what it will do and why it is not live, with no numbers, rows or CIDs; another county MUST show "CountyLens has data for Travis County, TX only".
- **FR-014** (AC-14; was A-18 FR-005): The hosted site MUST contain 0 prototype placeholder values, 0 "not wired" toasts and no ProtoBar; a scan MUST check every route, and every CID it accepts MUST appear in a real published manifest.

**Edge cases and cross-cutting**

- **FR-015** (edge 1): A zero-result radius search MUST show Close matches with miles outside the radius and the empty-state hint.
- **FR-016** (edge 2): When the CID copy is unreachable, reads MUST fall back to the Filebase gateway and the page MUST label them "fallback"; Verify is unchanged.
- **FR-017** (edge 3): A SQL error MUST show one plain error line with a suggested fix and no stack trace.
- **FR-018** (edge 4): At 390 px filters MUST collapse into a sheet and Coming soon items into the More sheet; every target ≥ 48 px; no horizontal scroll at 390, 768 or 1440.
- **FR-019** (edge 5): If `tables-export.json` (or the table list it provides) cannot be read, Catalog MUST show "Catalog unavailable · {reason}" and a link to the manifest; never a cached or sample list.
- **FR-020** (edge 6): The CRM card's state and URL MUST switch through configuration, without a code change.
- **FR-021**: When `runs/index.json` or a manifest cannot be read, every page that needs it MUST show an explicit error state naming what failed; never stale or sample values.
- **FR-024** (P0-12, constitution XI): Every value on screen MUST come from a published file (run index, manifest, published tables, gazetteer) or be static text.
- **FR-025**: The routes `/`, `/runs`, `/runs/compare`, `/runs/log`, `/tx/travis/coverage`, `/data/manifest`, `/data/verify/{cid}`, `/data/catalog`, `/legal/*`, `/help/mcp` and the Explore URL parameters MUST stay stable (A-14 and A-16 build on them).

### Non-functional requirements

- **NFR-001** (AC-6; was A-13 NFR-001): search p95 < 3 s once loaded (20 timed runs); first load ≤ 8 s with a progress bar (NFR-01).
- **NFR-002** (AC-1 to AC-14; was A-13 NFR-002, A-18 NFR-001): initial download ≤ 300 KB gzipped excluding the in-browser query engine, which the Hub never loads; LCP < 2.5 s, CLS < 0.1, INP < 200 ms on mobile 4G; WCAG 2.2 AA; Atlas tokens and components only; responsive at 390 / 768 / 1440 on every page (NFR-08).
- **NFR-003** (AC-4, AC-5; was A-13 NFR-003): 100% of result cards carry provenance (NFR-05).

### Traceability to the story

| Story FR (was) | Spec FR |
| --- | --- |
| FR-001 (A-13 FR-001) | FR-001, FR-001a, FR-001b |
| FR-002 (A-13 FR-002) | FR-002 |
| FR-003 (A-13 FR-003) | FR-003, FR-003a–d |
| FR-004 (A-13 FR-004) | FR-004, FR-005, FR-006, FR-008 |
| FR-005 (A-13 FR-005) | FR-007 |
| FR-006 (A-18 FR-001) | FR-009, FR-020 |
| FR-007 (A-18 FR-002) | FR-010, FR-012, FR-019 |
| FR-008 (A-18 FR-003) | FR-011 |
| FR-009 (A-18 FR-004) | FR-013 |
| FR-010 (A-18 FR-005) | FR-014, FR-024 |

### Key Entities

- **Run index**: the ordered list of published runs (run ID, manifest CID, finish time).
- **Run manifest**: one run's sources, coverage section (count, derivation, note per key), artifacts (CID, name, codec, size, SHA-256, CAR), limitations, timestamps and `previousManifestCid`.
- **Published table**: an elephant-cli output table (name, columns, row count, CID, size), queried through the frozen views `v_property`, `v_roofing_permit`, `v_contractor`, `v_run`.
- **Place**: a gazetteer entry (name, class, source, internal point) from `travis-places@1.0.0`.
- **Property result / Permit result**: one row with its values, missing reasons and provenance.
- **Run event**: a timestamped step of a run (start, publish, verify, finish, limitation) carried inside a manifest.
- **Coming soon item**: a roadmap entry with its skeleton layout and one-sentence description; holds no data.
- **Source**: a data source with its URL, terms or licence link and access status (Legal).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An evaluator completes demo lines D-1 to D-9 on the hosted URL in order, with one passing automated browser test per line.
- **SC-002**: 100% of counts on Runs, Coverage and Catalog equal the matching field of the latest published manifest; 0 disagreements between the three pages.
- **SC-003**: Verify shows two matching digests for a published file artifact, from two gateways the project does not operate.
- **SC-004**: Lead searches return in under 3 s at p95 over 20 runs once the data has loaded; the first load finishes within 8 s.
- **SC-005**: 0 blank cells and 0 placeholder values on every route (the no-sample-data scan); 100% of result rows carry provenance.
- **SC-006**: Every page passes the responsive check at 390, 768 and 1440 with no horizontal scroll, and LCP < 2.5 s, CLS < 0.1 on mobile 4G for the Hub, Catalog, Runs log and Legal pages.
- **SC-007**: Every Coming soon item renders with its label and sentence and contains no number, row or CID.

## Assumptions

- **Published data today (2026-10-21):** `runs/index.json` holds one run, `travis-202609-permits-20261021t103516z` (manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`, 35 Austin reroof permits, 14 parcels, 27 artifacts, `previousManifestCid` null). Build and unit tests use it; nothing is stubbed with invented values.
- **Waits for A-11** (PO D-1/D-2, 2026-10-21): Runs 1–3 and Compare (FR-001a), full-county coverage and artifacts (FR-002, FR-003), the scale test (FR-006, NFR-001), a published `tables-export.json` (FR-010) and run events inside the manifests (FR-012). Their hosted proof and G7 wait; until then each page shows the real single run or an explicit reason (FR-001b, FR-019, FR-021).
- **Waits for A-04 / A-07:** full property backbone, tenure and owner area (FR-004, FR-008: `owner_area_class` is `unknown` while address fields are `not_in_export`); contractor resolution and BBB status (FR-005: `bbb_status` is `not_checked` in today's views). These show their missing reasons until those stories publish.
- **Lexicon carriers (ADR-0002):** fields with a "no carrier" verdict show "not published · no lexicon carrier"; that list is read from ADR-0002, not decided here.
- **Gateways:** Verify uses Pinata (`gateway.pinata.cloud`, the independent one) and Filebase (`ipfs.filebase.io`) per ARD AM-01 and ADR-0001 D-4; ipfs.io and dweb.link retired on 2026-09-21.
- **Demo area:** chosen at D-11 from the published data (the gazetteer place with the most open or stalled reroofs) and recorded in `docs/evidence/A-13-open-permits.md`; A-14 reuses it.
- **Out of scope:** the map, markers, tiles and everything behind the "Map view (CRM preview)" toggle; admin sign-in, Start/Stop/Retry and Activity (A-16); the welcome tour and owner/contractor name search (cut).
- **Agent and MCP:** the AI tab and live MCP calls belong to A-14; this story provides the shell, the provenance and missing-reason elements and the Help · MCP page they build on.
- **Hosted only:** every proof runs on the Amplify preview of `013-explorer-and-pages` or `https://countylens.aldarraj.com`, never a local server.
