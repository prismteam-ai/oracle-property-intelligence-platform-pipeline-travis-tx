---
id: SPEC-A-03
type: feature-spec
parent: A-03
feature: FEAT-A03
branch: 003-walking-skeleton
plan: specs/003-walking-skeleton/plan.md
tests: testplans/A-03-test-cases.md
gate: G5
status: Approved
created: 2026-10-21
updated: 2026-10-21          # requirements-quality review (checklists/*.md); AC meanings unchanged
---

# Feature Specification: Publish one month of Austin roofing permits by CID and show them in the hosted UI

**Feature Branch**: `003-walking-skeleton`

**Created**: 2026-10-21

**Status**: Approved (G5 🛑 D-6 and G6 🛑 D-7, PO 2026-10-21 11:00 "Approve (Recommended)", run-log.md); refined 2026-10-21 by the requirements-quality review (`checklists/{constitution,acceptance,ux,publication}.md`): FRs made more specific than their ACs, no AC meaning changed.

**Input**: User description: "Specify the story in stories/A-03-walking-skeleton.md. Every acceptance criterion becomes at least one FR with the same numbers. Fill the spec header (story, evaluation point A4 · A5, demo lines D-1, D-2, D-4, owner agents) from the story front matter. Facts: ../assessment-guide/reference/A-oracle.md. No technology choices."

**Story**: `stories/A-03-walking-skeleton.md` | **Evaluation point**: A4 (primary) · A5 | **Demo line(s)**: D-1 (opening: data on IPFS, queryable in the browser), D-2 (Runs page), D-4 (query layer in the browser)

**Owner agents** (from the story front matter; used by the plan, not by this spec): design `metagross`, `oracle` · builder `metagross` (app), `oracle` (publish) · reviewers `metagross`, `oracle` · verify Playwright demo line 1 + `verify-manifest`

> Every story acceptance criterion becomes at least one FR below. No technology choices in this file; they belong in plan.md.

**Numbering.** FR-001 to FR-007 match AC-1 to AC-7 one to one. FR-008 onward carry the story's edge cases and the remaining requirements. The story's own REQ IDs are given in brackets, e.g. *(story FR-003)*. Product names that appear below (the publishing CLI, IPFS, the gateways, the in-browser engine line) are fixed by the story's acceptance text or the approved ARD; this spec does not choose them.

## Clarifications

### Session 2026-10-21

- Q: Which data and which read path does the AC-4 scale test use? → A: The full 2,380,725-row Austin permit table, read through a private signed path on the fast copy (never a public CID); the gateway legs (Filebase, ipfs.io, dweb.link) are measured on existing public CIDs now and on this run's own CIDs after the first upload. *(PO decision D-3, 2026-10-21.)*
- Q: Which columns does the Permits list show for status and contractor, given `status_raw` and the printed contractor have no lexicon carrier? → A: The frozen contract columns: `improvement_status` + `status_class`, `contractor_resolution`, and each `missing` reason shown as its human label. *(PO decision D-1, 2026-10-21; `contract/v1/README.md` "No-carrier and not-emitted fields"; ADR-0002, AD-24.)*
- Q: How are permits with no `tcad_id` shown, and which sources and data groups does the run carry? → A: They are not published; the Runs page shows the manifest count `permits_no_tcad_geoid` labelled "No TCAD id on source record". Runs lists both manifest sources, Austin first then TCAD; the run publishes the `county` and `property_improvement` groups. NFR-003 is checked in AC-2/AC-3 and NFR-004 in AC-7. *(PO decision D-1, 2026-10-21.)*
- Q: What is the "record count" shown on the Runs page? → A: Each source's `records` value from the manifest `sources[]`, shown per source, never recomputed in the browser. *(`contract/v1/README.md` `v_run.sources`; story AC-2 "the record count from the manifest".)*
- Q: Do the hosted Runs and Permits pages need sign-in? → A: No. Both are public and read-only; admin sign-in and run controls are out of scope (built last). *(Story "Out of scope"; ARD AD-12.)*
- Q: How and where are the browser performance numbers measured? → A: At least 20 timed runs, p95 written to the evidence (the spike's to `docs/decisions/0001-read-path.md`), measured on the hosted runtime, never localhost. *(ARD NFR-01 row; walkthrough § 5 "Browser"; CLAUDE.md "localhost is never evidence".)*

### Session 2026-10-21 (PO rounds R3–R4, after the read-path spike)

These answers amend the session above; earlier answers are kept as they were given. Where they differ (the ipfs.io / dweb.link gateway legs, the browser-only radius and roof-age path), the answers below win.

- Q: Does the read path the spike measured stand (D-4)? → A: "Accept (Recommended)": read the CloudFront CID copy first, the Filebase gateway as the labelled fallback; tables exported with part size 48m; Filebase Free for A-03, the Pro decision at A-11; radius and roof-age queries switch to the server-side (Lambda DuckDB) fallback over the same Parquet; the browser keeps first load, COUNT, small reads and free-form SQL; the in-browser engine is opened with range reads enabled (`{ allowFullHTTPReads: true, forceFullHTTPReads: false, reliableHeadRequests: false }`) and its WASM is served pre-compressed (Brotli). *(PO decision D-4, 2026-10-21; `docs/decisions/0001-read-path.md`.)*
- Q: Which gateways does Verify use, now that ipfs.io and dweb.link are retired? → A: "Pinata + Filebase (Recommended)": ipfs.io and dweb.link retired 2026-09-21 (every request 429, `Sunset: Mon, 21 Sep 2026 00:00:00 GMT`; re-confirmed 2026-10-21 07:29Z). `verify-manifest` uses Pinata's public gateway (the independent one) and the Filebase gateway, plain GETs, size + SHA-256; it still rejects the CloudFront copy and `w3s.link`. *(PO decision D-4, 2026-10-21; 0001 Finding 3.)*
- Q: How is the server-side fallback's in-region p95 proved? → A: "Private prefix + direct invoke (Recommended)": the full-size Austin Parquet goes under a private prefix of the data bucket that the CDN does not serve; 20 timed direct invocations (never through the public API) measure the in-region p95; the file is deleted afterwards and the deletion is recorded in the evidence. *(PO decision D-4, 2026-10-21.)*
- Q: When does the page fall back, and which labels does it use (D-2)? → A: "Approve all three (Recommended)": fall back when the CID copy errors, returns non-200 or takes over 4 s; "Contractor not printed on permit" only for a contractor field whose reason is `source_missing`; the 21 labels in the Missing-reason labels table as written. *(PO decision D-2, 2026-10-21.)*
- Q: How is the capture code shaped for A-03 (D-5)? → A: "Adapter module now (Recommended)": the A-02 capture code is promoted into a Socrata adapter module in the vendored runtime's Travis folder and driven directly by a run script; durable-workflow wiring comes in A-05/A-06. *(PO decision D-5, 2026-10-21.)*
- Q: How can Verify hash a CAR file, whose root CID is the DAG root, not the file's bytes (D-5)? → A: "Approve additive carCid (Recommended)": each `.car` file is also added to IPFS as a plain file (raw-leaves CIDv1) and its `carCid` recorded on `car` artifacts; additive to `contract/v1`, no schema change. *(PO decision D-5, 2026-10-21; `contract/v1/README.md`.)*
- Q: What is the deploy order, and what is the 30-day "query log" (D-5)? → A: "Approve both (Recommended)": deploy order Data → Api → Web → Ops → Cert (Cert holds only the custom-domain association); the 30-day query log (AD-16) is the HTTP API JSON access log. *(PO decision D-5, 2026-10-21; ARD § 16.)*

### Session 2026-10-21 (requirements-quality review, after G5/G6)

The four checklists in `checklists/` found 63 requirements-quality gaps (run-log 11:23). The refinements below make FRs more specific than their ACs; no AC meaning changes (story AC text and G4 table untouched). Exact texts live in plan.md § "Fixed texts and config keys" and test plan § 3, verbatim in both.

- Q: What exactly is "no step skipped" (AC-1)? → A: six steps per data group in two phases (FR-001); no flag or environment variable can skip or reorder a step; the order test asserts the 12-step sequence (TC-001, TC-002).
- Q: Which Atlas components and states do the Runs page and the Permits list use, and at which width do cards become a table? → A: plan.md § "Atlas element map" (component, § 2.4 status and § 9 state per element); light theme only; cards below 600 px, the data table from 600 px; paged at 200 rows per page since A-11 (PO 2026-10-25); no sorting or sticky header in A-03 (NFR-003, FR-003).
- Q: Where do "Comptroller baseline not loaded (A-07)" and the TCAD confidentiality redaction count go? → A: manifest `sources[0].limitations` and `sources[1].limitations` (FR-001), repeated in the evidence; TC-003 reads them.
- Q: What does the capture do on a 403 or a bot challenge? → A: FR-014: stop, `blocked` receipt, exit 2, no retry, no evasion; TC-006 (build-time).
- Q: Which coverage counts carry their `derivation` label on the Runs page? → A: all of them (FR-005(b), FR-009; AD-28), as visible helper text with fixed wording (TC-031).
- Q: What does the page show when `runs/index.json` cannot be read, or when `permits_emitted` is 0? → A: fixed error and empty-state texts (FR-002, FR-008; TC-014, TC-029).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the run that published the data (Priority: P1)

A CRM developer (or the evaluator) opens the hosted Runs page and sees one real publication run: its ID, start and finish time in UTC, the sources it read, the number of records it published, and the content address (CID) of its manifest. From that CID they can check every published file on two independent public gateways.

**Why this priority**: The evaluator scores only what runs on the hosted URL. A run with a verifiable manifest is the proof that the source → publish → hosted path works end to end (evaluation point A4, demo line D-2).

**Independent Test**: Open `https://countylens.aldarraj.com/runs` (or the Amplify branch URL) and see the run with both sources, the record count and the manifest CID; then run `verify-manifest` against that manifest and see `ALL ARTIFACTS VERIFIED`.

**Acceptance Scenarios**:

1. **Given** September 2026 Austin reroof permits captured through the kit runtime, **When** the publication sequence runs, **Then** each step runs in order with none skipped, and the manifest lists every artifact with a CIDv1, name, codec, size and SHA-256, and the tables directory has a CAR CID. *(AC-1)*
2. **Given** the hosted site, **When** the evaluator opens Runs, **Then** it shows the run ID, UTC start and finish, every manifest source (Austin first, then the TCAD 2026 certified export), the record count from the manifest and the manifest CID, and the page passes at 390, 768 and 1440 px with Atlas tokens only. *(AC-2)*
3. **Given** the run's manifest, **When** `verify-manifest` fetches every artifact from the Pinata and Filebase public gateways, **Then** sizes and SHA-256 match and it prints `ALL ARTIFACTS VERIFIED`. *(AC-6; gateways amended 2026-10-21, D-4: ipfs.io and dweb.link retired 2026-09-21.)*

---

### User Story 2 - List the published permits in the browser, with provenance (Priority: P1)

The CRM developer opens the Permits list. The browser itself reads the published tables (no database server) and lists every published September 2026 reroof permit with its status, contractor state and provenance. Every absent value says why it is absent.

**Why this priority**: It proves the zero-idle-cost read path and the "every value shows where it came from; missing data says why" rule before the full county depends on them (evaluation point A5, demo lines D-1 and D-4).

**Independent Test**: Open the Permits list on the hosted URL, see the September 2026 rows with provenance and labelled missing reasons, and see the engine line "DuckDB-WASM in your browser · read-only".

**Acceptance Scenarios**:

1. **Given** the Permits list, **When** it loads, **Then** every published September 2026 reroof permit is listed with permit number, `improvement_status`, `status_class`, `issue_date`, `contractor_resolution` and provenance (source URL, capture time, table CID, run), and each absent field shows the human label of its reason. *(AC-3)*
2. **Given** the published permits, **When** they are listed, **Then** every row shows a label for each of its `missing` reasons, never a blank. *(AC-5)*
3. **Given** the fast copy of the published files is unreachable (it errors, returns non-200 or takes over 4 s), **When** the page loads, **Then** it reads through the Filebase gateway and labels the result "fallback". *(AC-5; trigger added 2026-10-21, D-2.)*
4. **Given** the in-browser engine is still starting, **When** the page loads, **Then** a progress bar shows and no empty table flashes. *(edge case)*

---

### User Story 3 - Know what was left out, and why (Priority: P1)

The Runs page tells the reader how many captured permits were not published because the source record has no TCAD id, so nothing is silently dropped.

**Why this priority**: Data honesty (constitution: missing data says why) and the demo's "never pad, never hide" rule.

**Independent Test**: On the Runs page, read the count labelled "No TCAD id on source record" and compare it with the manifest's `permits_no_tcad_geoid`.

**Acceptance Scenarios**:

1. **Given** a captured permit with no `tcad_id`, **When** the run is published, **Then** that permit is not published and the Runs page shows the manifest count `permits_no_tcad_geoid` labelled "No TCAD id on source record". *(AC-5)*

---

### User Story 4 - Trust the read path at full scale (Priority: P1)

Before the full county is built on the browser read path, a time-boxed spike proves that browser queries over a full-size Austin permit table stay fast enough, or switches the design to the server-side fallback.

**Why this priority**: The read path decides the Explorer's architecture (RISK-08); it must be proven before Stage 3.

**Independent Test**: Read `docs/decisions/0001-read-path.md` and see p50/p95 over 20 timed runs for COUNT, radius and roof-age queries, plus the first-load time.

**Acceptance Scenarios**:

1. **Given** the spike's full-size Parquet of the 2,380,725-row Austin permit table, **When** 20 timed runs query it through the fast copy, **Then** COUNT, bounding-box + haversine radius and roof-age filters each have p95 < 3 s and the first load is ≤ 8 s with a progress bar; otherwise the decision record switches to the server-side fallback before Stage 3. *(AC-4)*
2. **Given** the decision record switched radius and roof-age to the server-side fallback (D-4, 2026-10-21), **When** 20 timed direct invocations of the hosted fallback query a private copy of the full table, **Then** radius and roof-age each have an in-region p95 < 3 s, and the private copy is deleted afterwards with the deletion recorded in the evidence. *(AC-4, amended 2026-10-21)*

---

### User Story 5 - Operate the hosted API with evidence (Priority: P2)

An operator can see, for one hosted request, a structured log line, a trace that includes the query, and a query-duration metric; failures raise an alarm by email; spend is capped by a budget alert.

**Why this priority**: Required observability for every later story (NFR-03); not visible in the demo but checked by the reviewers.

**Independent Test**: Load the hosted Runs page once; find the log line, the trace ID and the metric; see the trace ID in `docs/evidence/A-03.md`.

**Acceptance Scenarios**:

1. **Given** the deployed API and operations stacks, **When** the Runs page calls the API once, **Then** one JSON log line with the request's correlation ID, a trace with the query as a sub-step and a `QueryDurationMs` metric are written, and the infrastructure assertions for retention, dead-letter alarms and the budget pass. *(AC-7)*

---

### Edge Cases

- Fewer than 42 permits survive the profile (on 2026-10-20 the frozen profile accepted 38; the other 4 are trade sub-permits) → the pages show the manifest's count; nothing is padded.
- A captured permit has no `tcad_id` (1 of 38 on 2026-10-20) → not published; counted as `permits_no_tcad_geoid` on the Runs page.
- The custom-domain certificate is still pending → the Amplify branch URL is the hosted runtime (ASM-8); the evidence names which URL was used.
- The account's total function concurrency limit is 10 → no reserved concurrency (AD-11); the API throttles only, at 10 requests/s with a burst of 20 (FR-007, TC-053).
- The in-browser engine is still initialising → progress bar, no empty-table flash.
- The fast copy is unreachable (errors, returns non-200 or delivers no first byte within 4 s; D-2, 2026-10-21) → read through the Filebase gateway, labelled "fallback".
- A row carries a reason the UI has no label for → this must not happen: the label table below covers the whole closed list, and a test fails on any unlabelled reason.
- `runs/index.json` is missing, not JSON, fails the index schema, or lists zero runs at the site origin → the Runs page shows the fixed error text (`Run index could not be read from this site`, or `No runs published yet` for an empty index), never an empty card (FR-002, TC-014).
- The manifest's `permits_emitted` count is 0 → the Permits list shows the empty state `No permits published in this run` (FR-008, TC-029); it is never confused with loading (FR-008) or with the count mismatch (FR-009).
- The source answers 403 or a bot challenge during the capture → `blocked` receipt, run stops with exit 2, nothing is published (FR-014, TC-006).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** *(AC-1; story FR-001)*: System MUST publish the September 2026 Austin reroof slice only as publishing-CLI output, through the fixed sequence of six steps per data group in two phases: phase 1, for both groups, validate → hash with CAR output → validate the CAR → export tables; phase 2, only after both groups passed phase 1, upload the CAR → upload the tables, each upload followed by readback (root digest, part count, every part's size and SHA-256), so one group's CAR is never published alone. No step is skipped on any run size, no flag or environment variable can skip or reorder a step, a failed step stops every later step, and an automated test asserts the exact 12-step sequence (TC-001, TC-002). The run's manifest (`runs/{runId}/manifest.json`) MUST list every artifact with a CIDv1 (`bafy…`), name, codec, size and SHA-256, and the tables directory MUST carry a `carCid`. *(Added 2026-10-21, D-5:)* each `.car` file MUST also be added to IPFS as a plain file (raw-leaves CIDv1) and its file CID recorded as `carCid` on the manifest's `car` artifacts, so Verify can hash the file (TC-004 checks `directory` and `car` artifacts alike). The manifest's `sources[0].limitations` (Austin) MUST carry exactly `Comptroller baseline not loaded (A-07)` (why every permit is `contractor_unresolved`, addendum A5) and `sources[1].limitations` (TCAD) MUST carry `Confidential owner records redacted (Texas Tax Code §25.025): {n}` with the count of records redacted before `validate` (ARD § 7, P0-15); the evidence repeats both (TC-003). The run index (`runs/index.json`) MUST list the run and is append-only in the pipeline: an entry is never removed and its `manifestCid` never altered (a withdrawn run is the ARD § 11 git revert of the index commit, a PO decision listed in the PR, never a pipeline write).
- **FR-002** *(AC-2; story FR-002, NFR-003)*: The hosted Runs page MUST read the run index and the manifest by CID and show the run ID, UTC start and finish, every manifest source in manifest order (first "City of Austin Issued Construction Permits (3syk-w9eu)", then the TCAD 2026 certified export `tcad-2026-certified-json`), the record count from the manifest (each source's `records` from manifest `sources[]`, per source, never recomputed), the published count `coverage.permits_emitted` labelled `Permits published`, the manifest CID, and each published data group (`county`, `property_improvement`) with the CID of its tables directory from the manifest's `directory` artifacts (TC-013). The run MUST publish the `county` group (the TCAD parcels the slice's permits match) and the `property_improvement` group, as in the A-02 pilot. The page MUST state the publication state with exactly `Public by CID · Atlas registration pending` and MUST never say "published to Atlas" (P0-4; a grep gate fails the build on that phrase in `apps/web/src` and `docs/evidence/`). CIDs are shown middle-truncated in the mono face with a copy button that copies the full value; the full CID is the element's `data-cid` attribute (plan.md § "Atlas element map"). If `runs/index.json` is missing, not JSON or fails the index schema, the page MUST show exactly `Run index could not be read from this site`; if it lists zero runs, exactly `No runs published yet` (TC-014); never an empty card. The page's elements follow plan.md § "Atlas element map" and MUST pass at 390, 768 and 1440 px using Atlas tokens only (NFR-003), checked by a hosted browser test (demo line D-2).
- **FR-003** *(AC-3; story FR-003, FR-004, NFR-003)*: The Permits list MUST query the published tables in the browser over the fast copy, with no database server, and list every published September 2026 reroof permit with `permit_number`, `improvement_status`, `status_class` (open / stalled / closed), `issue_date`, `contractor_resolution` and provenance (source URL, capture time, table CID, run). Each absent field MUST show the human label of its reason from the row's `missing` list (see the label table) as visible text, never only a tooltip. The engine line MUST read "DuckDB-WASM in your browser · read-only". The list uses the Atlas data table from 600 px (the Atlas compact bound) and cards below it, ordered by `permit_number` and paged, 200 rows per page (PO 2026-10-25, A-11: at full-county scale one page built about 947,000 DOM elements and froze slow browsers): the ready state shows a pager (`nav` "Permits pages") with the count line "Showing 1–200 of 15,025" (the total is the manifest-validated row count) and Previous page / Next page buttons, so every row stays reachable; only the current page's rows are in the DOM. No sorting, sticky header or column controls in A-03 (A-13 adds them with the Explorer and reuses the pager). The page's elements follow plan.md § "Atlas element map" and MUST pass at 390, 768 and 1440 px using Atlas tokens only (NFR-003).
- **FR-004** *(AC-4; story NFR-001)*: The read-path spike MUST measure, over 20 timed runs on a full-size table of the 2,380,725-row Austin permit dataset read through a private signed path on the fast copy, COUNT, bounding-box + haversine radius and roof-age filters, and the first load with a progress bar; it MUST record p50/p95, the gateway legs, the Filebase plan limits, the projected full-county size and the chosen table part size in `docs/decisions/0001-read-path.md`. If any p95 ≥ 3 s, the record MUST switch to the server-side fallback before Stage 3. The full-size table is a private spike asset and is never published as a public CID. The gateway legs are measured on existing public CIDs now and on this run's own CIDs after the first upload. *(Amended 2026-10-21, D-4:)* the record switched radius and roof-age to the server-side fallback over the same Parquet; the browser keeps first load, COUNT, small reads and free-form SQL. A-03 MUST prove the fallback's in-region p95 < 3 s for radius and roof-age over 20 timed direct invocations (never through the public API) on a full-size copy kept under a private prefix the CDN does not serve, then delete that copy and record the deletion in the evidence. The in-browser engine MUST be opened with range reads enabled and its WASM served pre-compressed (0001 Findings 1–2).
- **FR-005** *(AC-5; story FR-004)*: System MUST (a) show a label for every `missing` reason on every listed row, never a blank; (b) not publish a captured permit with no `tcad_id`, and show the manifest coverage count `permits_no_tcad_geoid` on the Runs page labelled "No TCAD id on source record" together with its manifest `derivation` label as visible helper text (AD-28; `aggregate_match` reads `From the run's internal match (not recomputable from public data)`; TC-031); (c) when the fast copy is unreachable, read through the Filebase gateway and label the result "fallback". *(Added 2026-10-21, D-2:)* "unreachable" means the fast-copy request errors, returns a non-200 status or has delivered no first byte within 4 s, judged per request; the manifest request decides the host for the page load and the table-part reads are bound to the same host (no mixed reads within one load; a part failure after binding is the error state). The label is the word `fallback` followed by the gateway host (`fallback · ipfs.filebase.io`, from config). When the fallback also fails, the page MUST show exactly `Data could not be reached from the CID copy or the Filebase gateway` as an error state, never a blank page or an empty table (TC-032 step 5).
- **FR-006** *(AC-6; story FR-001)*: A `verify-manifest` command MUST fetch every artifact in a run manifest from the Pinata public gateway and the Filebase gateway with plain GETs (never from the fast copy, never `w3s.link`), check size and SHA-256 against the manifest (for `car` artifacts, against the `carCid` file), and print `ALL ARTIFACTS VERIFIED` only when every artifact matches on both gateways. *(Amended 2026-10-21, D-4: was "from ipfs.io and dweb.link"; both retired 2026-09-21, 0001 Finding 3.)*
- **FR-007** *(AC-7; story FR-005, NFR-002, NFR-004)*: One hosted API call from the Runs page MUST produce one structured JSON log line carrying the request's correlation ID, one trace with the query as a sub-step, and a `QueryDurationMs` metric, plus the business metrics `ItemsProcessed` (rows returned) and `ItemsFailed` (failed queries; emitted as 0 on success so the datapoint exists), each with the dimension `procedure` (constitution VIII; TC-050 checks all three). Log lines, trace annotations and every evidence excerpt MUST carry identifiers and counts only (correlation ID, trace ID, manifest CID, procedure, durations, row counts): never row contents such as owner names or addresses, never presigned URLs, never credentials. Logs MUST be kept 14 days (query log 30 days; the query log is the HTTP API JSON access log, D-5 2026-10-21); every queue MUST have a dead-letter queue with one self-resolving alarm that emails the operator; a $10 budget alert MUST exist. The HTTP API stage MUST throttle at 10 requests/s with a burst of 20, and no function sets reserved or provisioned concurrency (AD-11; TC-053). Infrastructure assertions MUST check all of these, and the trace ID MUST be written to `docs/evidence/A-03.md`.
- **FR-008** *(edge case)*: While the in-browser engine initialises, the Permits list MUST show a linear progress bar (`role="progressbar"`, accessible name `Loading permits`, `aria-valuetext` = the stage text) with skeleton rows that are not a data table (a `role="status" aria-busy="true"` container with no data cells) and MUST NOT show an empty table or the empty state. When the engine is ready and the manifest's `coverage.permits_emitted.count` is 0 with 0 rows listed, the list MUST show the empty state `No permits published in this run` with the run ID and manifest CID (TC-029); 0 rows with `permits_emitted` > 0, or any other mismatch, is the count-mismatch error of FR-009, not the empty state.
- **FR-009** *(edge case)*: Every count shown MUST come from the manifest; no count is padded, estimated or taken from sample or prototype data. Every coverage count shown MUST carry its manifest `derivation` label as visible helper text with the fixed wording for `published_rows`, `capture_receipt` and `aggregate_match` (AD-28), so readers can tell counts recomputable from public data from internal aggregates. A row count that differs from `coverage.permits_emitted.count` MUST show exactly `Row count does not match the manifest: {rows} listed, {count} published`. The API's "Server check" line is secondary text with its own "from the API" provenance and never replaces a manifest count.
- **FR-010** *(edge case)*: When the custom domain is not ready, the Amplify branch URL MUST serve as the hosted runtime, and the evidence MUST name the URL used. localhost is never evidence.
- **FR-011** *(AC-3, AC-5; G4 note C-06)*: The UI MUST map every reason in the contract's closed list to exactly the label in the **Missing-reason labels** table below; a test MUST fail if any reason in the closed list lacks a label.
- **FR-012** *(story Description; ARD AD-02, A2)*: The fast copy MUST hold only byte-for-byte copies of publishing-CLI output, keyed by CID, written only after a size and SHA-256 match, never overwritten. Nothing else (no internal reconciliation store, no side files) is public.
- **FR-013** *(Out of scope; AD-12)*: The hosted Runs and Permits pages MUST be public and read-only, with no sign-in and no run controls.
- **FR-014** *(AC-1 "captured through the kit runtime"; Task A addendum A6; P0-7; ARD § 8)*: The capture MUST stop on the first HTTP 403 or bot challenge from the source: it writes a `blocked` receipt for that request, makes no retry of it, stops the run with exit code 2, and never rotates user agents or IPs, never bypasses a CAPTCHA, bot check or rate limit. Backoff applies only to 429 and 5xx. A build-time test asserts this (TC-006).

### Missing-reason labels

The closed list is `contract/v1/README.md` line 131 (`columns.json` `missingReasons`, 21 reasons). The contract defines no human labels, so these are new UI wording derived from the README's meaning for each reason; adding a reason is additive (README "Change rule") and must add a row here.

| Reason code | Label shown in the UI | Where it occurs (contract) |
| --- | --- | --- |
| `no_lexicon_carrier` | No place for this field in the published data model | `status_raw`, `expiry_date`, `contractor_name_raw`, `description`, `work_class_raw`, `bbb_rating`, `bbb_url` |
| `not_in_export` | Not included in the published tables | address fields, `source_url` |
| `source_missing` | Not on the source record | `permit_number`, `issue_date`, `permit_close_date`, `final_inspection_date`, … |
| `no_coordinates` | No coordinates for this parcel | location columns |
| `no_roof_date` | No roof date found | roof age |
| `basis_unmatched` | No roof-age basis matched | roof-age basis |
| `no_dated_sale` | No dated sale to read the owner from | `owner_name` |
| `no_owner_record` | No owner on the latest sale | `owner_name` |
| `no_mailing_address` | No owner mailing address | owner area |
| `zip_not_zcta` | ZIP is not a Census ZIP area | ZIP lookups |
| `not_open` | Permit is not open | `open_days` |
| `not_closed` | Permit is not closed | `final_date` |
| `contractor_unresolved` | Contractor not matched to a company | `contractor_company_cid`, `bbb_status_reason` |
| `bbb_blocked` | BBB blocked the lookup | BBB fields |
| `bbb_not_found` | No BBB profile found | BBB fields |
| `needs_review` | Needs review: could not be derived | `status_class`, `jurisdiction`, `final_date`, `open_days`, `contractor_company_cid` (several edges), `owner_name` |
| `first_run` | First run: no previous manifest | `previous_manifest_cid` (v_run) |
| `out_of_scope` | Outside Travis County | place / ZIP lookups |
| `enum_lacks_value` | Status has no matching value (e.g. Expired) | `improvement_status` |
| `owner_unparsed` | Owner name could not be parsed | `owner_name` |
| `owner_confidential` | Owner is confidential (TCAD) | `owner_name` |

Story labels: "No TCAD id on source record" is the label of the Runs-page coverage count `permits_no_tcad_geoid` (that is a manifest count, not a row reason, because such permits are never published). "Contractor not printed on permit" applies to a contractor field whose reason is `source_missing` (the source record printed no contractor; 0 of 38 on 2026-10-20); it replaces the generic `source_missing` label for contractor fields only.

### Non-functional requirements

- **NFR-001** *(story NFR-001; verified by FR-004)*: Browser query p95 < 3 s; first load ≤ 8 s with a progress bar. *(2026-10-21, D-4:)* radius and roof-age meet p95 < 3 s on the server-side fallback, measured in-region.
- **NFR-002** *(story NFR-002; verified by FR-007 for the budget)*: $0.00 fixed cost per month while idle; no hosted DNS zone (AD-13); budget alert at $10. Idle $0.00 is proven in A-16.
- **NFR-003** *(story NFR-003; verified by FR-002, FR-003)*: Responsive at 390 / 768 / 1440 px with Atlas tokens only. Pass criteria (TC-NF-03): no horizontal page scroll at any of the three widths; tap targets ≥ 48 px at 390; computed colour, font family, spacing and border radius resolve only to `tokens.css` values (method in plan.md § "Atlas element map"); one screenshot per width per page; light theme only (dark theme is A-13); the Permits list shows cards at 390 and the data table at 768 and 1440 (switch at 600 px, the Atlas compact bound). Deferred to A-13 (Explorer) with the ARD § 10 "Web app" row: LCP < 2.5 s, CLS < 0.1, INP < 200 ms, WCAG 2.2 AA via axe in Playwright, Lighthouse CI; A-03 keeps the ≤ 300 KB gzipped initial-JS gate.
- **NFR-004** *(story NFR-004; verified by FR-007)*: JSON logs; tracing on 100% of hosted requests; logs 14 days, query log 30 days; one alarm per dead-letter queue; API p95 < 1 s warm; cold start including query-engine init < 3 s.

### Key Entities

- **Run**: one publication of the slice; ID, UTC start and finish, sources, record counts, coverage counts (including `permits_no_tcad_geoid`), manifest CID.
- **Run manifest**: the per-run list of published artifacts (CIDv1, name, codec, size, SHA-256), the tables directory with its CAR CID, sources in order, coverage; itself addressed by CID.
- **Run index**: the committed list of runs with their manifest CIDs, read by the hosted site.
- **Source**: a captured public source with its label, URL, capture time and record count (Austin `3syk-w9eu`; TCAD 2026 certified export).
- **Roofing permit row**: one `v_roofing_permit` row from the frozen contract, with status, contractor state, provenance and its `missing` list.
- **Missing entry**: `{field, reason}`, reason from the closed list of 21, shown through its label.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The publication-order test passes (12 steps, two phases, no skip switch), and 100% of manifest artifacts carry a CIDv1, name, codec, size and SHA-256.
- **SC-002**: The hosted Runs page shows both sources, the manifest's record count and its CID, and passes at 3 of 3 widths.
- **SC-003**: The hosted Permits list shows exactly the manifest's published permit count, with provenance on 100% of rows and 0 blank absent fields.
- **SC-004**: COUNT, radius and roof-age queries each have p95 < 3 s over 20 runs on the full-size table; first load ≤ 8 s (or the decision record switches to the fallback). *(2026-10-21, D-4:)* the record switched radius and roof-age; the fallback's in-region p95 < 3 s over 20 direct invocations, and the private copy's deletion is in the evidence.
- **SC-005**: The Runs-page "No TCAD id on source record" count equals the manifest's `permits_no_tcad_geoid`; a blocked fast copy (error, non-200 or > 4 s) yields a page labelled "fallback".
- **SC-006**: `verify-manifest` prints `ALL ARTIFACTS VERIFIED` for 100% of artifacts on both gateways (Pinata and Filebase since D-4, 2026-10-21).
- **SC-007**: One hosted request yields one log line, one trace ID (recorded in the evidence) and one metric; warm API p95 < 1 s; cold start < 3 s; all infrastructure assertions pass.
- **SC-008**: 21 of 21 closed-list reasons have a label; 0 unlabelled reasons appear on any page.
- **SC-009**: The capture's stop-on-403 test passes (TC-006); the Runs page's run-index error texts and the Permits list's empty state show their fixed wording (TC-014, TC-029); every coverage count on the Runs page shows its derivation label (TC-031).

## Assumptions

- The frozen contract `contract/v1` (A-02) and the profile `travis-austin@1.0.0` are used unchanged; any rename needs `contract/v2`.
- The TCAD 2026 certified JSON export located in A-01 supplies the parcels the slice's permits match; no new source story is needed.
- The read-path spike (Stage 2S) runs before Stage 3 and its decision record exists before the plan relies on the read path.
- Prototype screens (`Runs1440`, `Runs390`, `Runs768`, `ExploreQ-sqlperm`, `ExploreQ390-sqlperm`, `ShellStates` under `design/prototype/`) are layout references only; their numbers and CIDs are placeholders and never appear on the hosted site. `Runs390` is the compact reference (Atlas § 14.1 "design at 390 first"); `Runs768` renders `Runs1440` at tablet width; the Permits list at 390 follows the design system (cards) with `ExploreQ390-sqlperm` as the only compact reference.
- The Pinata public gateway (`gateway.pinata.cloud`, unauthenticated) serves the ≈ 35 plain GETs of one `verify-manifest` run within its public rate limit; its limits are not published, so `verify-manifest` honours `Retry-After` (5 attempts, ≤ 2 concurrent per gateway, 120 s timeout). Demo-day fallback: run Verify at least one hour before the demo and keep the full output in the evidence; if Pinata throttles live, show the recorded run while the Filebase lane completes live. A second gateway is never substituted for Pinata (AM-01: Filebase is also the pin host, so Pinata is the independent one). *(plan.md risk R5.)*
- Out of scope: full-county data, coverage page, Verify button (A-04 … A-13); admin sign-in and run controls (AD-12); the second independent pin and the GitHub Release CARs of AD-22 (A-11, after the Filebase plan decision); dark theme, sorting / sticky header (paging moved into A-11, PO 2026-10-25), LCP / CLS / INP, axe and Lighthouse CI (A-13); the Atlas rate-limited countdown, partial and offline states (A-04 Verify UI, A-08 BBB).
