---
id: A-13
type: user-story
title: Build the Explorer UI for runs, coverage, manifest verification and roofing queries
parent: FEAT-A13
vision: VIS-A
ard: ARD-A
eval_point: A5
priority: P1
moscow: Must
branch: 013-explorer-ui
spec: specs/013-explorer-ui/
depends_on: [A-02, A-03]
size_days: 1.5
agents:
  design: [metagross]
  builder: metagross
  reviewers: [metagross, audino]
  verify: "Playwright demo lines 1–8"
skills: [build-frontend-backends, frontend-bug-fix, responsive-design-tests, apply-engineering-guidelines]
ui: true
status: Merged
merged_into: A-13
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---

# A-13 Build the Explorer UI for runs, coverage, manifest verification and roofing queries

> **Merged into A-13 on 2026-10-21.** This story is now part of [A-13 Build the Explorer UI with its hub, legal, catalog and Coming soon pages](../A-13-explorer-and-pages.md), branch `013-explorer-and-pages`. Its ACs and requirements are kept there with "was" tags. This file is kept for reference only: don't run the story loop on it.

| Field | Value |
| --- | --- |
| Evaluation point | A5 (primary) · A1, A2, A3, A4 |
| Demo line(s) | D-1, D-2, D-3, D-4, D-5, D-6, D-7, D-8, D-9 |
| Agents | design `metagross` · builder `metagross` · reviewers `metagross`, `audino` · verify Playwright demo lines 1–8 (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-02, A-03 (full-county values arrive with A-11 and A-12) |
| Size | 1.5 days |
| Branch | `013-explorer-ui`, merged into `feature/oracle-pipeline` |

## Context

Most demo lines are shown in this UI, so it carries the visible half of almost every evaluation point. The **evaluator** walks D-1 to D-9 in order on the hosted URL; the **CRM developer** uses the same screens to judge the data. Every value must come from the published manifest and elephant-cli tables, with provenance, and every gap must say why (P0-11, P0-12).

Real demo area (Austin permits, live 2026-10-19): within 5 miles of Pflugerville's Census internal point (GEOID 4857176, 30.447765, −97.602116, from the A-02 gazetteer) there are **44** Austin reroof permits: 41 `Final`, **3 `Expired`** (stalled: 2004-011296 BP, 2018-111955 BP, 2022-098180 BP) and **0 open**. Pflugerville's own permits come only if A-01 classifies its portal as supported. County-wide, the oldest open reroof is 1982-012866 BP (`Suspended`).

## Description

As the **evaluator** (and the CRM developer), I want **one hosted explorer that shows runs, coverage, the manifest with live two-gateway verification, a SQL panel, and roofing-lead searches by radius, roof age, open permits, tenure and out-of-area owners**, so that **I can check every demo claim on real Travis County records in the browser, with no Oracle-hosted database**.

When done: Atlas-only routes per `docs/02-design.md` § 1–2 — Runs (+ Compare, run chain), Coverage (counts vs denominators, limitations, merge statistic), Data · Manifest and Verify (plain GET to ipfs.io and dweb.link, SHA-256 in the browser, 429 → retry → clear state), Explore · Filters (area as a place or a point `at`, radius, roof-age threshold, open/stalled permits with `openYrs`, tenure > 10, out-of-area owners; List view with Mi + bearing, Lat, lon, Source), Explore · SQL, Property drawer, and Help · MCP. All queries come from `packages/query-core`. One Playwright test per demo line D-2 to D-9 on the hosted URL.

**Scope note:** the map, pin-drop markers and everything behind the prototype's "Map view (CRM preview)" toggle are not Task A scope (`docs/02-design.md` § 3, PO round 5 #74); the playbook's "Lead finder (map, pin/GPS)" is met by the `at` point and place area in List view. Verify uses ipfs.io and dweb.link only (P0-14).

**Independent test:** run the Playwright suite against `https://countylens.aldarraj.com` (or the Amplify branch URL); D-2 to D-9 pass, and `smeargle` passes at 390, 768 and 1440.

## Acceptance Criteria

1. **AC-1** · **Given** `runs/index.json` with Runs 1–3, **When** the evaluator opens Runs, **Then** the latest completed run shows its source list, counts, UTC timestamps, deltas, limitations (for example "BBB: blocked · 403") and "Next sync: none · scheduler off by default"; Compare shows Run 3 vs Run 2 with distinct manifest CIDs, the `previousManifestCid` link, and "old manifest still resolves on ipfs.io and dweb.link" (D-2, D-7). ☐ testable
2. **AC-2** · **Given** the manifest `coverage` section, **When** Coverage opens, **Then** each record kind (property, ownership, permit, contractor by five states, BBB by status, business, places, coordinates) shows its published count, its denominator (TCAD certified roll; Austin 3syk-w9eu total at watermark; Comptroller Travis total), collection time, `derivation` label and the elephant-cli table it comes from (D-3). ☐ testable
3. **AC-3** · **Given** the Manifest page, **When** the evaluator clicks Verify on a file artifact ≤ 50 MB, **Then** the browser fetches it from ipfs.io and from dweb.link, computes SHA-256 locally, and shows ✓ on both lanes with the exact URLs and the size and digest compared to the manifest; a directory shows "Verify via CAR" (D-5, D-6). ☐ testable
4. **AC-4** · **Given** Explore · Filters where the search box resolves "Pflugerville" through the A-02 gazetteer (`search.suggest`, showing "Pflugerville city · Census 2024 Gazetteer · 30.447765, −97.602116"), radius 5 mi and roof ≥ 15 years, **When** the search runs, **Then** the header reads "{n} within 5 mi of Pflugerville · roof ≥ 15 yrs", each row shows address, roof age, `roof_age_basis`, confidence, distance and bearing, lat/lon, and a Source link with run and table CID, and changing the radius from 5 to 3 mi updates the count live (D-8). ☐ testable
5. **AC-5** · **Given** the same area with "open or stalled" and "open ≥ 5 years", sorted by open longest, **When** results load, **Then** stalled permits show "Stalled {x} yrs · source says Expired" (AD-08), open ones show "Open {x} yrs · source says {status_raw}", the contractor shows "as printed on permit" with its five-state badge, and BBB shows a rating or its status reason; around Pflugerville this lists the stalled reroofs (2004-011296 BP, open about 22.6 years at 2026-10-19) and states that no open roofing permits exist in that radius on the current run (D-9). Fields whose A-02 carrier verdict is "no carrier" show "not published · no lexicon carrier" instead. ☐ testable
   - **Demo-area note:** the presenter picks the D-8/D-9 area from the published data (the area with the most open or stalled reroofs among the gazetteer places), records it in `docs/evidence/A-13-open-permits.md`, and uses the same area for D-10 and D-11.
6. **AC-6** (scale) · **Given** the full-county tables loaded in the browser, **When** the 5-mile radius + roof-age and open-permit searches each run 20 times on the hosted Explore page, **Then** p95 < 3 s once loaded and the first DuckDB load is ≤ 8 s with a progress bar (NFR-01); the SQL panel runs `SELECT count(*) FROM v_property` in the browser and shows "DuckDB-WASM in your browser · read-only" (D-4). ☐ testable
7. **AC-7** (missing data / error) · **Given** a result whose roof basis is `unknown`, whose contractor was not printed, whose BBB status is `blocked`, or whose tenure is unknown, **When** it renders, **Then** `<MissingReason/>` shows the reason in words and nothing is blank or guessed; **Given** a gateway answers 429 during Verify, **Then** the lane shows "rate-limited, retrying", retries with backoff, and never shows ✓ without a matching digest. ☐ testable
8. **AC-8** · **Given** filters "tenure > 10 years" and "out-of-area owner" (preset `ooa78753`), **When** applied, **Then** results show `tenure_years` with `tenure_basis` and `owner_area_class` with the definitions on screen; properties with unknown tenure are excluded and counted as "tenure unknown: {n}" (AC-39, AC-40). ☐ testable

## Edge cases (at least two)

- Zero results in a radius → Close matches list (with miles outside) and the empty-state hint; never a blank table.
- The CID copy is down → Filebase gateway fallback labelled "fallback"; Verify unaffected (public gateways only).
- A SQL typo → the error line with its fix, from `SqlStates`; no stack trace.
- Phone width (390) → filters collapse into the sheet; 48 px targets; no horizontal scroll.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | Runs and Compare MUST read `runs/index.json` and manifests by CID | AC-1 |
| FR-002 | Coverage MUST read counts only from the manifest coverage section | AC-2 |
| FR-003 | Verify MUST fetch from ipfs.io and dweb.link and hash in the browser | AC-3, AC-7 |
| FR-004 | Explore MUST run `query-core` SQL in DuckDB-WASM with provenance on every row | AC-4, AC-5, AC-6, AC-8 |
| FR-005 | Every missing value MUST render its reason | AC-7 |
| NFR-001 | Search p95 < 3 s; first load ≤ 8 s (NFR-01) | AC-6 |
| NFR-002 | Initial JS ≤ 300 KB gzipped excl. DuckDB; LCP < 2.5 s; WCAG 2.2 AA; Atlas only; responsive at 390/768/1440 (NFR-08) | AC-1 to AC-8 |
| NFR-003 | 100% of result cards carry `<Provenance/>` (NFR-05) | AC-4, AC-5 |

## Prototype reference (mandatory if the story has UI)

| Element | Value |
| --- | --- |
| Claude Design screen | `design/prototype/Runs1440.dc.html`, `RunsCompare1440.dc.html`, `RunChain.dc.html`, `Coverage1440.dc.html`, `DataManifest1440.dc.html`, `DataVerify1440.dc.html`, `ExploreQ-roof15.dc.html`, `ExploreQ-permits5.dc.html`, `ExploreQ-ooa78753.dc.html`, `ExploreQ-sql.dc.html`, `Property1440.dc.html`, `HelpMcp1440.dc.html` (with their 768 and 390 variants) |
| States covered | empty · loading · error · partial · populated · fallback · rate-limited (`ShellStates`, `CoverageStates`, `DataStates`, `ExploreStates`, `SqlStates`, `PropertyStates`, `RunsStates`) |
| Design system | `assessment-guide/design-system/` (Atlas, Material 3, mobile-first) |

## Demo Script

1. Presenter: "First, I am opening the pipeline run summary." → Expected: completed run, sources, coverage, counts, timestamps, limitations.
2. Presenter: "Show the total uploaded records by source." → Expected: property, permit, ownership, contractor (with BBB where available), business and coordinate counts with collection time and provenance.
3. Presenter: "Now I am opening the DuckDB-backed query layer." → Expected: SQL runs in the browser; no database server.
4. Presenter: "Show the published artifact manifest for this run." → Expected: CID, size, name, codec, digest; run chain.
5. Presenter: "Retrieve one published artifact by CID from a public gateway that this environment does not operate, then again from a second independent public gateway." → Expected: two ✓ lanes with matching digest.
6. Presenter: "Show that a later incremental publish produced a new CID without mutating the previous one." → Expected: Compare Run 3 vs Run 2.
7. Presenter: "Using the UI, show properties within a sample radius that have roofs older than 15 years." → Expected: results with basis, coordinates, source.
8. Presenter: "Show properties in that area with open roofing permits, prioritizing permits that have remained open for many years, including contractor and BBB rating where available." → Expected: permits by open duration, contractor badge, BBB or its reason.

## Out of scope

- Map, markers, tiles and every item behind the CRM-preview toggle (`docs/02-design.md` § 3).
- Admin sign-in, Start/Stop/Retry and Activity (A-17, built last per AD-12).
- Hub, Legal, Catalog, Runs log and every Coming soon page (A-18).

## Evidence to capture

- `docs/evidence/A-13-duckdb.md`, `A-13-roof-age.md`, `A-13-open-permits.md`: hosted URL, inputs, screenshots, counts, p95 timings, trace IDs.
- `smeargle` report at 390/768/1440; `testplans/A-13-test-cases.md` results; `docs/reviews/CR-A-13.md` (metagross, audino).

---

## Gate G4: Story ready for planning

| # | Criterion | Status |
| --- | --- | --- |
| G4-1 | Front matter complete (parent FEAT, eval point, branch, priority, **agents and skills from AGENT-MAP.md**) | ☐ |
| G4-2 | "As a / I want / So that" stated, with an independent test | ☐ |
| G4-3 | Every AC is Given / When / Then, and its testable box is ticked | ☐ |
| G4-4 | One scale AC and one missing-data or error AC | ☐ |
| G4-5 | At least two edge cases | ☐ |
| G4-6 | Every requirement traces to an AC; NFRs have thresholds | ☐ |
| G4-7 | Prototype screen linked (UI stories) | ☐ |
| G4-8 | Dependencies done, or stubbed with **real** sample data | ☐ |
| G4-9 | No `[NEEDS CLARIFICATION]` left | ☐ |
| G4-10 | AI pre-check (`developmentsupport-g4-precheck`): PASS | ☐ |

**Decision:** ☐ Ready ☐ Returned, reason: {…} · {date}
