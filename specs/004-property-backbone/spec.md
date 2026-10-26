---
id: SPEC-A-04
type: feature-spec
parent: A-04
parts: [A-04, A-05, A-06]
feature: [FEAT-A04, FEAT-A05, FEAT-A06]
branch: 004-property-backbone
plan: specs/004-property-backbone/plan.md
tests: testplans/A-04-test-cases.md
gate: G5
status: Draft
created: 2026-10-21
updated: 2026-10-21
---

# Feature Specification: Load the county backbone: TCAD properties and owners, coordinates, and permits from every jurisdiction

**Feature Branch**: `004-property-backbone`

**Created**: 2026-10-21

**Status**: Draft; Round 1 PO decisions applied 2026-10-21 (D-1 coverage denominator, D-5 load scope, D-7 confidentiality, D-4 anchors, D-2 GIS venue, D-8 no app token, D-9 contract wins names, NFR-002 numbers); no open markers

**Input**: User description: "Specify the story in stories/A-04-property-backbone.md (G4 wording fixes applied; docs/gates/G4-A-04-precheck.md): a merged story with three parts (A-04 TCAD, A-05 coordinates, A-06 permits), one user-story section per part. Every AC (AC-1 to AC-17) becomes at least one FR with the same number. Header from the story front matter. Facts: ../assessment-guide/reference/A-oracle.md § 4–5 and pipeline/docs/travis-sources.yaml, plus the Stage 0 re-measures of 2026-10-21. No technology choices. Frozen contract/v1 names."

**Story**: `stories/A-04-property-backbone.md` (parts A-04, A-05, A-06; merged 2026-10-21) | **Evaluation point**: A1 (primary) · A2 · A5 | **Demo line(s)**: D-3 (property, ownership, coordinate and permit records by source), D-8 (properties behind the radius search, with coordinates), D-9 (open roofing permits by open duration)

**Owner agents** (from the story front matter; used by the plan, not by this spec): design `oracle` · builder `oracle` · reviewers `oracle`, `donphan` · verify `monitoring-county-ingestion`; roll count matches · coverage SQL ≥ 99% · per-jurisdiction counts

> Every story acceptance criterion becomes at least one FR below. No technology choices in this file; they belong in plan.md.

**Numbering.** FR-001 to FR-017 match AC-1 to AC-17 one to one (the story's own REQ table numbers differ after FR-006; its IDs are given in brackets, e.g. *(story FR-007)*). FR-018 onward carry the story's edge cases and the project rules this story must keep. NFR-001 to NFR-006 keep the story's numbers. Product and kit names that appear below (the kit runtime and its stage skills, the publishing CLI's table export, the Query DB) are fixed by the story's acceptance text or the approved ARD; this spec does not choose them.

**Names.** Every public name is the frozen `contract/v1` name (`contract/v1/columns.json`, `README.md`): `latitude` / `longitude` (the story's `lat` / `lon`), `coordinate_source` ∈ {`gis_centroid`, `permit_point`, `none`}, and the closed `missing` reason list (21 reasons; a property without coordinates carries `no_coordinates`). Finer reasons used for counting and gap reports (`no_gis_feature`, `gis_null_geometry`, `no_permit_point`, `no_issue_date`, transform-failure classes, link-failure reasons) are internal Query DB / report reasons, never public column values; a new public name or a change of meaning needs `contract/v2` (a stop).

**Dated facts** (re-measure at run time and use the new figure with its date; the dated figures stay as baselines):

| Fact | Value | Measured |
| --- | --- | --- |
| TCAD certified roll N | 493,246 accounts: R 441,961 · P 39,536 · MH 11,744 · MN 5; inactive-flagged 0 | streaming count, 2026-10-19T21:33:41Z; export SHA-256 `6f7a7585…4c2346` re-verified 2026-10-21 |
| Real-estate (R) detail | 431,536 distinct geoIDs; 11,589 accounts share one; 380,461 have an export geometry point, 61,500 do not (A4 53,324 · O1 3,534 · F4 2,815 · other 1,827) | same export |
| Property key | `pID` (layout `prop_id`), integer 6–7 digits, distinct on all records | A-01 (`travis-sources.yaml`) |
| GIS layer `TCAD_PARCELS` | 373,683 features; ≤ 2,000 per request; gap to roll 119,563 (24.24%), 110,958 explained, 8,605 (1.74%) unexplained | US runner, 2026-10-20T07:31:05Z; PO exception `DEC-A-01-parcel-gap-exception.md` |
| Austin `3syk-w9eu` | 2,380,725 rows (63,019 no `tcad_id`) on 2026-10-19; 2,381,226 rows (63,021 no `tcad_id`) | 2026-10-21T18:54:53Z |
| Austin reroof candidates | 22,084 (21,694 AUSTIN FULL PURPOSE · 78 AUSTIN LTD · 50 AUSTIN 2 MILE ETJ · 3 WEST LAKE HILLS FULL PURPOSE · 6 OTHER · 250 none; these sum to 22,081, so re-measure); 508 with no `tcad_id` | 2026-10-19 |
| Status baseline (A-02 profile) | open 129 (Active 125, Suspended 2, Re Review 1, Pending Permit 1) · stalled 2,213 · closed 17,251 · exclude 2,491 | 2026-10-19 |
| Anchors | `0223120506` (permit 2000-000025 BP) → pID 221829 (R, A1, year built 1941, sale date, TX ZIP, situs, geometry); a second real anchor picked in the pilot from Austin reroof permits whose `tcad_id` resolves (logged). `0208011301` (permit 1982-012866 BP, `Suspended`, issued 1982-06-23) is **not in the export** (0 occurrences in any field): the documented negative (D-4) | Austin `tcad_id`; export read 2026-10-21T19:08Z |
| Export field facts | Every record carries a non-empty `geometry` string (vs 380,461 "with point" in `travis-sources.yaml`; the definition is determined and recorded in the build); year built `propertyProfile[0].imprvActualYearBuilt` (0 = missing), else `valuations[].details["cost-local"].improvements[]`; sale `sales[].saleDt` (none on 317,818, R 266,553); mailing `owners[].addrZip` / `addrCountry` / `addrInternational`; no owner-level §25.025 flag; `sales[].confidentialCode` on 15,410 R accounts | export read 2026-10-21T19:08Z |
| Jurisdictions | 23 classified in A-01: Austin `supported`, 22 `records request` | `travis-sources.yaml` `permits.jurisdictions` |

"TCAD id" in this spec means the TCAD geoID that Austin's `tcad_id` carries (`propertyIdentification[].geoID` in the export), which resolves to the property key `pID`.

## Clarifications

### Round 1 PO decisions (2026-10-21, run-log 22:22–22:33)

- Q: Are §25.025 confidential accounts subtracted from the loaded count (AC-2) or loaded with owner fields redacted (AC-5)? → A: Loaded with owner fields redacted, counted in the loaded count, their number reported separately (D-5, D-7). The export has no §25.025 owner marker, so the conservative A-02 rule is used: any `sales[].confidentialCode` / `confidentialSale` (15,410 R) → owner fields redacted before validation; limitation "source export carries no §25.025 marker; conservative suppression on sale-confidentiality codes".
- Q: Which denominator does the 99% coordinate coverage use? → A: The 441,961 real-estate (R) accounts (≥ 437,542); the 51,285 non-land accounts (P/MH/MN) are loaded, counted separately with a reason and published as `out_of_scope` (not emitted in the County group); condo / shared-geoID units get their building's point by a recorded rule; only frozen-contract reason and `coordinate_source` values are public (D-1, D-5).
- Q: What are the numeric source-etiquette limits? → A: One identified User-Agent; GIS concurrency ≤ 2; Austin ≤ 1 request/s, no app token (D-8); backoff 1 s base, 60 s cap, 5 attempts, full jitter; stop on the first 403 with no retry; no new TCAD download without a stop (NFR-002).
- Q: Anchor `0208011301` is not in the export: what do AC-1 and AC-7 test? → A: `0223120506` (→ pID 221829) plus a second real anchor picked in the pilot from Austin reroof permits whose `tcad_id` resolves (logged); `0208011301` stays as the documented negative (permit 1982-012866 BP kept and counted with `no_tcad_geoid`) (D-4).
- Q: Where does the GIS paging run? → A: A fetch-only workflow on a GitHub-hosted US runner, push-triggered, no secrets, minimal fields, artifact only, never the Query DB; one pilot push and one full push, then disabled (D-2).
- Q: Can a permit point appear in the public table? → A: Not in v1: the frozen `v_property` derivation would label it `gis_centroid` (P0-11). `permit_point` stays in the Query DB; the public row reads `none` / `no_coordinates` (D-9, oracle disagreement #2).

### Session 2026-10-21

Answered from the cited project sources, not asked of the PO.

- Q: Which moment is the run `as_of` that `open_days` is counted to? → A: The run's `finishedAt`, never the current clock; `open_days = as_of − issue_date`. *(source: `docs/architecture-constitution.md` § 5 "`as_of_date` (= run `finishedAt`, never `now()`)"; `WALKTHROUGH-A-04-property-backbone.md` § 5 "`open_days`".)*
- Q: Does the run download the TCAD export again, and what does the 403 stop guard? → A: No new download: the run uses the A-01 certified export, checked against the A-01 receipt's SHA-256 (`6f7a7585…4c2346`) before use and re-counted from the same file; a mismatch stops the run. A new download happens only after a stop, as one identified request; a 403 or timeout gives a `blocked` receipt and a stop waiting for a human, with no retry. *(source: `WALKTHROUGH` § 5 "Roll", "Source etiquette"; `pipeline/docs/travis-sources.yaml` `parcel.export_receipt`; ARD § 8 TCAD row; `DEC-A-01-parcel-gap-exception.md` "bound to these values".)*
- Q: Where are values with no public column checked (owner area class, raw status, internal gap reasons)? → A: In the Query DB and the run report. In the v1 public tables the mailing ZIP is not emitted, so `owner_area_class = unknown` and `owner_is_out_of_area` is null with `not_in_export`; the raw status has no lexicon carrier (`no_lexicon_carrier`). AC-3 and AC-14's raw-status check are Query DB checks; AC-7 to AC-10 are checked on both sides. *(source: `contract/v1/README.md` "`address` properties are not emitted" and the no-carrier table; ADR-0002; G4 pre-check fix-list item 5.)*
- Q: Which jurisdictions besides Austin does the run capture? → A: None. All 23 are classified: Austin `supported`; the other 22 `records request`, no request filed (PO decision 2026-10-20); each of the 22 is listed in the source limitations with its evidence URL. *(source: `pipeline/docs/travis-sources.yaml` `permits.jurisdictions`; `docs/decisions/DEC-A-01-source-access.md` D-4; `WALKTHROUGH` § 5 "Other jurisdictions".)*
- Q: Do stalled permits get `open_days`, or only open ones? → A: Both: `open_days = as_of − issue_date` for `open` and `stalled`; for any other class it is null with the public reason `not_open`. *(source: `contract/v1/README.md` `open_days` row; task guide § 5 "show stalled permits as a separate, clearly labelled lead signal".)*

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every TCAD account loaded with its owner, matching the certified roll (Part A-04, Priority: P1)

The roofing sales rep (through the CRM) needs every Travis County property with its owner name, mailing address, situs address and year built, and the evaluator checks that the loaded property count matches the appraisal district's certified roll. Every value carries its source, capture time and payload digest; every missing value says why. Confidential owners are never exposed.

**Why this priority**: Every lead starts from a property; owner tenure and out-of-area owners (later stories) depend on this backbone; it is the denominator of every coverage number (evaluation point A1, demo line D-3).

**Independent Test**: Run the 25-parcel pilot and then the full-county ingest; `monitoring-county-ingestion` reports the run complete; the Query DB property count equals N minus the classified differences, with 0 unexplained, and the two anchor properties show all mapped fields with provenance.

**Acceptance Scenarios**:

1. **Given** a 25-parcel pilot including TCAD id `0223120506` (pID 221829) and a second real anchor whose Austin `tcad_id` resolves (picked in the pilot, logged), **When** the transform runs, **Then** each pilot property has owner name, mailing address, situs address, year built (or a missing reason), the source URL, capture time and payload digest, and the transform coverage report shows every mapped field; TCAD id `0208011301` is not on the roll, so no property is invented and its permit 1982-012866 BP is kept and counted with `no_tcad_geoid`. *(AC-1)*
2. **Given** the full TCAD certified roll (N = 493,246), **When** the full-county ingest completes, **Then** the loaded count equals N minus proven dead/invalid accounts, every differing account is classified (dead, invalid, transform failure), the total difference is under 2% of N, and 0 are unexplained; confidential accounts are loaded and counted, never subtracted, and their number is reported separately. *(AC-2)*
3. **Given** owners whose mailing ZIP is outside the versioned Travis ZIP list, **When** the property is transformed, **Then** `owner_is_out_of_area = true` and `owner_area_class` is `regional` or `out_of_area`, with the list's SHA-256 stamped on the classification. *(AC-3)*
4. **Given** a property with no deed or sale date, **When** tenure is derived, **Then** `tenure_basis = unknown` and it is never counted as tenure > 10 years; **Given** a property with no year built, **Then** its roof-age basis stays `unknown` with that reason. *(AC-4)*
5. **Given** the export carries no §25.025 owner marker, **When** the run prepares data for validation, **Then** owner fields are redacted before validation on every account with a sale-confidentiality code (`sales[].confidentialCode` / `confidentialSale`), the property is still loaded and counted, the redacted count and the limitation "source export carries no §25.025 marker; conservative suppression on sale-confidentiality codes" go into the run's source limitations, and no confidential owner name reaches the Query DB, the export path, a log or evidence. *(AC-5)*
6. **Given** TCAD downloads are blocked (403) at ingest time, **When** the run starts, **Then** it stops waiting for a human with the blocked receipt and loads no partial or stale data as if complete. *(AC-6)*

---

### User Story 2 - A labelled coordinate on nearly every property (Part A-05, Priority: P1)

The CRM developer needs a coordinate on nearly every property, so radius searches ("within five miles of Pflugerville") return every eligible property, plus an honest reason for every property without one. Each coordinate says where it came from: the county GIS parcel centroid, or, as a fallback, the point on an Austin permit for the same TCAD id.

**Why this priority**: A property without coordinates is invisible to every radius query (evaluation points A1 and A5, demo line D-8).

**Independent Test**: Run the coverage SQL `SELECT avg((latitude IS NOT NULL)::int) FROM v_property` over `v_property` bound to a local table-export run (never uploaded), and the same count from the Query DB; both return ≥ 0.99 over the 441,961 R accounts (the County group emits R only), and the gap report lists every property without coordinates by reason, with the 51,285 non-land accounts counted separately.

**Acceptance Scenarios**:

1. **Given** TCAD id `0223120506` (pID 221829) and the second pilot anchor, **When** coordinates are attached, **Then** each has `latitude`, `longitude` and `coordinate_source = gis_centroid` with the GIS layer URL, capture time and digest as provenance; `0208011301` gets none (not on the roll). *(AC-7)*
2. **Given** the full roll from Part A-04, **When** the GIS layer is paged at 2,000 features per request, **Then** at least 99% of the 371,352 R accounts that are not condo-coded have coordinates (99.63% measured 2026-10-22; condo-coded accounts reported separately; PO exception `docs/decisions/DEC-A-04-coverage-exception.md`), the 51,285 non-land accounts are counted separately with a reason, condo / shared-geoID units get their building's point by a recorded rule, the GIS feature count and its difference from N are recorded, and page count, duration and throughput are recorded for `docs/source-limits.md`. *(AC-8)*
3. **Given** a property with no GIS feature but an Austin permit carrying its TCAD id and a latitude/longitude, **When** the fallback runs, **Then** the property gets that point with `coordinate_source = permit_point` and the permit's source URL in the Query DB; its public row follows the frozen contract (`none`, `no_coordinates`). *(AC-9)*
4. **Given** a property with neither a GIS feature nor a permit point, **When** coverage is reported, **Then** `latitude` / `longitude` stay null, the public row carries `coordinate_source = none` and reason `no_coordinates`, the gap report counts it under its internal reason (`no_gis_feature`, `gis_null_geometry`, `no_permit_point`), and no coordinate is geocoded or invented. *(AC-10)* **Amended 2026-10-25 (PO decision, ADR 0004):** one narrow exception, an exact and unique match of the situs to the City of Austin public address-point layer may give a point (rule `address_point`, lowest priority, never over a GIS point); nothing else is ever turned into a point and no geocoding service is used.
5. **Given** the GIS service times out, **When** the adapter pages, **Then** it retries with backoff (1 s base, 60 s cap, 5 attempts), resumes from the last completed page after a restart, and if it still fails records `blocked` with the timestamp instead of publishing partial coverage as complete. *(AC-11)*

---

### User Story 3 - Every permit from every jurisdiction, linked and classified (Part A-06, Priority: P1)

The roofing sales rep needs every permit with its status, dates and open duration, so long-open and stalled reroofs can be ranked as leads; the evaluator checks per-jurisdiction counts against each source. Austin is captured in full and then incrementally; every other jurisdiction is either captured or listed with the evidence that it has no public history.

**Why this priority**: Open and long-stalled roofing permits are the strongest lead signal the README names (evaluation points A1 and A2, demo line D-9).

**Independent Test**: After the backfill, the captured Austin row count equals the source's own count at the run watermark; the reroof candidates' link rate is ≥ 97% with every unmatched one counted by reason; the status-class split is reported against the 2026-10-19 baseline; every jurisdiction appears in the run's counts or its source limitations.

**Acceptance Scenarios**:

1. **Given** the Austin dataset at the run watermark (2,380,725 rows on 2026-10-19; 2,381,226 on 2026-10-21T18:54:53Z), **When** the full backfill completes, **Then** the captured row count equals the source count at that watermark, each row keeps its raw payload digest and source URL, and permits outside Travis County are counted separately, not dropped. *(AC-12)*
2. **Given** the 22,084 Austin reroof candidates, **When** linked to properties, **Then** the share linked to a roll property by TCAD id or exact address hash is reported with the link job id and watermark (88.36% of roofing permits measured on 2026-10-22; the 97% target is replaced by the PO exception `docs/decisions/DEC-A-04-permit-match-rate.md`), and every unmatched permit (for example the 508 with no `tcad_id`) is kept and counted with its reason. *(AC-13)*
3. **Given** the A-02 profile, **When** the reroof candidates are classified, **Then** the counts by `status_class` are reported against the 2026-10-19 baseline, and permit 1982-012866 BP shows raw status `Suspended`, `status_class = open`, `open_days` = run `as_of` − 1982-06-23. *(AC-14)*
4. **Given** each jurisdiction classified in A-01, **When** the run finishes, **Then** every supported one has a captured count with source total and timestamp, and every records-request or no-history one is listed in the run's source limitations with its evidence URL. *(AC-15)*
5. **Given** a permit with no `issue_date`, **When** `open_days` is derived, **Then** it is null, not zero, with the internal reason `no_issue_date` and the public reason `needs_review`; **Given** the source re-stamps every `:updated_at` in one republish, **When** the incremental run reads the window, **Then** the source-wide re-stamp is detected, only rows whose content digest changed are written, and "source bulk re-stamp; delta by content digest" is recorded as a limitation. *(AC-16)*
6. **Given** a 429 or 5xx from the source, **When** paging, **Then** the adapter backs off (1 s base, 60 s cap, 5 attempts), resumes from the last committed page after a stop, and never skips a page. *(AC-17)*

---

### Edge Cases

- One TCAD account with several improvements → one property; improvements kept as children; year built from the main improvement by a recorded rule (FR-018). *(A-04)*
- Two accounts with the same situs address → both kept, keyed by their own TCAD key; merges are decided later (A-07) (FR-019). *(A-04)*
- A supplemental export lands during the run → not mixed in; it is A-11's incremental source (FR-019). *(A-04)*
- Mailing address abroad or no ZIP → `owner_area_class = out_of_area` only with evidence, otherwise `unknown` (FR-003). *(A-04)*
- A parcel polygon whose centroid falls outside the polygon (L-shaped lots) → the interior point when the source offers one; which point was used is recorded (FR-020). *(A-05)*
- One TCAD id with several GIS features (split parcels) → one coordinate by a recorded rule; the others counted (FR-020). *(A-05)*
- A permit point more than 0.5 mi from the GIS centroid of the same parcel → keep GIS, flag the permit for review (FR-020). *(A-05)*
- A permit reappears on a later page with a new status → upsert by permit number + jurisdiction; history stays in the capture receipts (FR-021). *(A-06)*
- A row disappears from the source → found by the periodic key-set diff; written as a `source_removed` tombstone, never silently dropped (FR-021). *(A-06)*
- Austin-issued permits located in Lakeway (6,825), Bee Cave (4,822) or Pflugerville (1,117 full purpose + 592 ETJ) → kept as Austin-issued; never counted as those cities' own permits (FR-022). *(A-06)*
- A description matches both include and exclude terms ("REROOF AND SOLAR") → the profile rule decides; uncertain ones go to `needs_review` (FR-023). *(A-06)*
- A restart mid-run (GIS or Austin paging) → resumes from the last committed page; no page is fetched twice into the result or skipped (FR-011, FR-017).
- The export's SHA-256 differs from A-01's → a different or damaged file; the run stops (FR-006).

## Requirements *(mandatory)*

### Functional Requirements

**Part A-04: TCAD property and owner backbone**

- **FR-001** *(AC-1; story FR-001)*: System MUST transform, for every account in the TCAD certified export, owner name, mailing address, situs address, year built, improvements and sale date, each with its source URL, capture time and payload digest; a field the export lacks carries a missing reason, never a blank or a guess. A 25-parcel pilot that includes TCAD id `0223120506` (pID 221829) and a second real anchor (an Austin reroof permit whose `tcad_id` resolves to a roll geoID, picked in the pilot and logged) runs first, and its transform coverage report MUST show every mapped field before the full county runs. TCAD id `0208011301` is not on the roll: no property is created for it and its permit is kept unmatched with `no_tcad_geoid` (FR-013). The property key is the TCAD identifier exactly as printed (P0-5).
- **FR-002** *(AC-2; story FR-002, NFR-001)*: System MUST reconcile the loaded property count to the certified roll account count N (493,246, or the run-time re-count from the same file): the loaded count MUST equal N minus proven dead/invalid accounts; every differing account is classified as dead, invalid or transform failure; the total difference MUST be under 2% of N; 0 accounts unexplained. All four account types (R, P, MH, MN) are loaded with their type. Confidential accounts (FR-005) are loaded with owner fields redacted and counted in the loaded count, never subtracted; their number is reported separately (Round 1 D-5, D-7).
- **FR-003** *(AC-3; story FR-003)*: System MUST classify each owner's mailing area from the versioned Travis ZIP list and the versioned regional (neighbouring-county) list: outside the Travis list → `owner_is_out_of_area = true` and `owner_area_class` = `regional` (on the regional list) or `out_of_area`; abroad or no ZIP → `out_of_area` only with evidence, else `unknown`. The SHA-256 of the list used MUST be stamped on every classification (AD-26). This is checked in the Query DB: the v1 public tables do not carry the mailing ZIP, so there `owner_area_class = unknown` and `owner_is_out_of_area` is null with `not_in_export`.
- **FR-004** *(AC-4; story FR-004)*: System MUST set `tenure_basis = unknown` for a property with no deed or sale date and MUST never count it as tenure > 10 years; a property with no year built keeps its roof-age basis `unknown` with that reason. Run 3 (ERR-71, ADR 0003): the dated transfer is the later of the latest `sales[].saleDt` and the latest allow-listed transfer `deeds[].deedDt`, and `tenure_basis` is `deed_date` when the deed is the later one.
- **FR-005** *(AC-5; story FR-005)*: System MUST honour Texas Tax Code §25.025 before validation. The 2026 certified JSON export carries no owner-level §25.025 marker (full key scan, 2026-10-21) and no legacy-layout data is on disk, so the conservative A-02 rule applies: every account with any `sales[].confidentialCode` or `sales[].confidentialSale` has its owner fields (names, mailing lines, sale-party data) redacted before validation and before anything is stored; the property itself is loaded and counted (FR-002). The redacted count and the limitation "source export carries no §25.025 marker; conservative suppression on sale-confidentiality codes" are written to the run's source limitations (A-11 copies them into the manifest), and no confidential owner name reaches the Query DB, the export path, any log or any evidence (P0-15). The export's key inventory is checked on every run, so a new confidentiality key fails the run instead of passing unseen.
- **FR-006** *(AC-6; story FR-006, NFR-002)*: When a TCAD download is blocked (403), the run MUST stop waiting for a human with the blocked receipt, MUST make no retry of that request and MUST NOT load partial or stale data as if complete. The run makes no new TCAD download: it uses the A-01 certified export, checks it against the A-01 receipt's SHA-256 before use (a mismatch stops the run) and re-counts N from the same file; a new download happens only after a stop, as one identified request.

**Part A-05: Coordinates**

- **FR-007** *(AC-7; story FR-007)*: System MUST attach the county GIS parcel centroid to each property by TCAD id, with `coordinate_source = gis_centroid` and the GIS layer URL, capture time and digest as provenance (checked on `0223120506` and the second pilot anchor). GIS is compared with the roll and never used as the population. GIS is fetched only from a GitHub-hosted US runner by a fetch-only workflow (no secrets, minimal fields, artifact only, never the Query DB; Round 1 D-2).
- **FR-008** *(AC-8; story FR-007, NFR-003)*: System MUST page the GIS layer at 2,000 features per request (fewer only if the layer's `maxRecordCount` is lower) and MUST reach coordinates on at least 99% of the 371,352 R accounts that are not condo-coded (A4, F4, O1) and MUST report the 70,609 condo-coded accounts separately (PO exception `docs/decisions/DEC-A-04-coverage-exception.md`; originally 99% of the 441,961 R accounts). The 51,285 non-land accounts (P, MH, MN) are loaded, counted separately with a reason and not in the denominator; publicly they are `out_of_scope` and not emitted. Condominium and shared-geoID units get their building's point by a recorded rule (DEC-A-01-parcel-gap-exception "Coverage effect"); only frozen-contract `missing` reasons and `coordinate_source` values are public (Round 1 D-1, D-5). The GIS feature count and its difference from N, the page count, duration and throughput MUST be recorded for `docs/source-limits.md`. Coverage is taken twice, from the Query DB and from `v_property` bound to a local table-export run that is never uploaded, and both values are reported.
- **FR-009** *(AC-9; story FR-008)*: For a property with no GIS coordinate whose TCAD id appears on an Austin permit that carries a latitude/longitude, System MUST attach that point with `coordinate_source = permit_point` and the permit's source URL as provenance in the Query DB. The frozen v1 `v_property` cannot label a permit point (it would read as `gis_centroid`, P0-11), so a permit point is never written to the public geometry: the public row reads `coordinate_source = none` with `no_coordinates`, and the difference between the Query DB and public coverage values MUST equal the permit-point count and be reported (Round 1 D-9).
- **FR-010** *(AC-10; story FR-009)*: A property with neither a GIS coordinate nor a permit point MUST keep `latitude` / `longitude` null, carry `coordinate_source = none` and the public reason `no_coordinates`, and be counted in the gap report under exactly one internal reason (`no_gis_feature`, `gis_null_geometry`, `no_permit_point`). No coordinate is ever geocoded from an address or invented. **Amended 2026-10-25 (PO decision, ADR 0004):** one narrow exception, an exact and unique match of the situs to the City of Austin public address-point layer may give a point (rule `address_point`, lowest priority, never over a GIS point); nothing else is ever turned into a point and no geocoding service is used.
- **FR-011** *(AC-11; story FR-010, NFR-004)*: On a GIS timeout or failure, the adapter MUST retry with backoff (1 s base, 60 s cap, 5 attempts), resume from the last completed page after a restart, and, when the attempts are spent, record `blocked` with the timestamp; partial coverage is never reported or published as complete.

**Part A-06: Permits from every jurisdiction**

- **FR-012** *(AC-12; story FR-011)*: System MUST backfill every row of the Austin dataset, paged by its row id, keeping each row's raw payload digest and source URL; the captured count MUST equal the source's own count at the run watermark (both taken at the same moment); permits located outside Travis County are counted separately, never dropped. After the backfill, runs are incremental from a watermark.
- **FR-013** *(AC-13; story FR-012, NFR-005)*: System MUST link permits to roll properties by TCAD id; the address-hash link (AD-16) applies when the permit's `tcad_id` is null **or is not a geoID on the roll** (a retired geoID): exactly one R account with the same exact address signature links with `link_method = address_hash`, `link_rule = address_sig_v1` and `stale_tcad_id = true`; none or several stay unmatched with `no_tcad_geoid`; a `tcad_id` that resolves is never overridden by the address (lead decision 2026-10-22). A shared geoID uses geoID + situs address, below. System MUST link at least 97% of the Austin reroof candidates; every unmatched permit is kept and counted with its reason (for example no `tcad_id`, or `no_tcad_geoid` for a `tcad_id` not on the roll such as `0208011301`). A `tcad_id` shared by several roll accounts is never silently linked: it links only when exactly one candidate's situs matches, else it stays unmatched with a reason.
- **FR-014** *(AC-14; story FR-013)*: System MUST classify roofing work and status only through the frozen A-02 profile (its SHA-256 stamped on each classification; no ad-hoc text matching; Expired never relabelled, AD-08) and MUST report the reroof candidates' counts by `status_class` against the 2026-10-19 baseline. Permit 1982-012866 BP MUST show raw status `Suspended` (a Query DB check: the raw status has no lexicon carrier), `status_class = open` and `open_days` = run `as_of` − 1982-06-23, where `as_of` is the run's `finishedAt`, never the current clock.
- **FR-015** *(AC-15; story FR-014)*: For every jurisdiction classified in A-01, the run MUST record either a captured count with the source total and timestamp (supported) or an entry in the run's source limitations with its evidence URL (records request or no public history); A-11 copies these into the manifest. At the A-01 classification this is Austin captured and the other 22 listed as records request, "not filed (PO decision 2026-10-20)".
- **FR-016** *(AC-16; story FR-015)*: `open_days` MUST be derived only from a real `issue_date`, as run `as_of` (`finishedAt`) − `issue_date`, for `open` and `stalled` permits; for any other class it is null with the public reason `not_open`; no `issue_date` → null with the internal reason `no_issue_date` (Query DB) and the public reason `needs_review`, never zero. The incremental run MUST detect a source-wide re-stamp of the change timestamp (as on 2026-10-19, 12:22–12:43 UTC), compare per-row content digests, write only rows whose content changed, and record "source bulk re-stamp; delta by content digest" as a limitation.
- **FR-017** *(AC-17; story FR-016, NFR-006)*: On a 429 or 5xx, the permit adapter MUST back off (1 s base, 60 s cap, 5 attempts), resume from the last committed page after a stop, and never skip a page; pages hold at most 50,000 rows; at most 1 request/s; no app token (Round 1 D-8).

**Edge cases and project rules**

- **FR-018** *(edge case, A-04)*: An account with several improvements MUST load as one property with the improvements as children; year built comes from the main improvement by a written rule recorded with the run.
- **FR-019** *(edge cases, A-04)*: Accounts sharing a situs address MUST all be kept under their own keys (merges belong to A-07). A supplemental export MUST NOT be mixed into this run (A-11 handles it as an incremental source).
- **FR-020** *(edge cases, A-05)*: When a centroid falls outside its polygon, the interior point MUST be used when the source offers one, and which point was used is recorded. A TCAD id with several GIS features MUST get one coordinate by a recorded rule, with the others counted. A permit point more than 0.5 mi from the same parcel's GIS centroid MUST NOT replace it; the permit is flagged for review.
- **FR-021** *(edge cases, A-06)*: Permits MUST be upserted by permit number + jurisdiction, with history kept in the capture receipts. A periodic key-set diff MUST write a `source_removed` tombstone for every row that disappears from the source; nothing is silently dropped.
- **FR-022** *(edge case, A-06)*: Austin-issued permits located in other cities (Lakeway, Bee Cave, Pflugerville, the ETJs) MUST be counted as Austin-issued and never as those cities' own permits.
- **FR-023** *(edge case, A-06)*: A description matching both include and exclude terms MUST be decided by the profile rule; anything the profile cannot decide goes to `needs_review`.
- **FR-024** *(P0-1, P0-2; story Out of scope)*: A-04 MUST publish nothing. The Query DB stays internal (never published, exported or reachable from outside the operator machine; its credentials never printed); the local table-export run used for the coverage test is never uploaded. Every count comes from the kit's own reporting.
- **FR-025** *(P0-10)*: One ingestion stack per run and one ingest run at a time, with one writer into the Query DB; the Austin backfill and the full-county TCAD run are never run concurrently.
- **FR-026** *(contract/v1; G4 note 5)*: Every public name MUST be the frozen `contract/v1` name. The internal reasons of FR-010, FR-013 and FR-016 MUST map to the closed-list public reason the contract assigns to that column (`no_coordinates` for `latitude` / `longitude`; the `open_days` and link reasons as `contract/v1/README.md` defines them) and never appear as public values; a field with no lexicon carrier (for example the raw status, ADR-0002) is kept and checked in the Query DB only.

### Non-functional requirements

- **NFR-001** *(story NFR-001; verified by FR-002)*: Completeness: loaded-vs-roll difference under 2% of N, 0 unexplained.
- **NFR-002** *(story NFR-002, ARD NFR-07; verified by FR-006)*: Source etiquette for TCAD and GIS: one identified User-Agent, bounded concurrency, backoff, stop on 403, no evasion (no CAPTCHA, bot-check or rate-limit bypass, no IP or user-agent rotation). Numbers (Round 1, 2026-10-21): GIS concurrency ≤ 2; Austin ≤ 1 request/s; backoff 1 s base, 60 s cap, 5 attempts, full jitter; stop on the first 403 with no retry; no new TCAD download without a stop (and then one identified request at concurrency 1).
- **NFR-003** *(story NFR-001 of A-05; verified by FR-008)*: Coordinate coverage ≥ 99% of the 371,352 R accounts that are not condo-coded (PO exception DEC-A-04-coverage-exception; originally the 441,961 R accounts), from the Query DB and from the local table export; non-land accounts counted separately (FR-008).
- **NFR-004** *(story NFR-002 of A-05; verified by FR-011)*: GIS concurrency ≤ 2; backoff on failure (1 s base, 60 s cap, 5 attempts).
- **NFR-005** *(story NFR-001 of A-06; verified by FR-013)*: The Austin roofing-permit match rate is reported as measured (the 97% target was replaced by the PO exception `docs/decisions/DEC-A-04-permit-match-rate.md`, 88.36% measured 2026-10-22); every unmatched permit is kept and counted with its reason. Original wording: ≥ 97% of Austin roofing permits matched to a roll property; every unmatched one counted (AD-16).
- **NFR-006** *(story NFR-002 of A-06; verified by FR-017)*: ≤ 50,000 rows per page, no app token (D-8), ≤ 1 request/s; backoff on 429/5xx (1 s base, 60 s cap, 5 attempts, full jitter).

### Key Entities

- **Property**: one TCAD account of any type (R, P, MH, MN), keyed by the TCAD identifier as printed; owner, mailing and situs address, year built, sale date, improvements (children), owner area class, tenure basis, coordinate and `coordinate_source`, provenance, missing reasons.
- **Owner**: the persons and companies on the property's latest dated sale; redacted when the account carries a sale-confidentiality code (conservative §25.025 rule, FR-005).
- **Coordinate**: `latitude` / `longitude` with `coordinate_source` (`gis_centroid`, `permit_point`, `none`) and its provenance; internal gap reason when absent.
- **Permit**: one source row, keyed by permit number + jurisdiction; raw status, `status_class`, dates, `open_days`, issuing and located jurisdiction, link to a property (TCAD id or address hash) or an unmatched reason, raw payload digest, source URL.
- **Jurisdiction**: one of the 23 classified in A-01, with its class (supported / records request / no public history), evidence URL and, when supported, captured count and source total.
- **Capture receipt**: per request or page: URL, time, status, digest, attempts; the basis of resume, history and `blocked` records.
- **Run report**: roll reconciliation, coverage and gap by reason, per-jurisdiction counts, match rate, status split, throughput, source limitations.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 25 of 25 pilot properties (anchor `0223120506` and the second real anchor included) show every mapped field or its missing reason, with provenance on 100% of values; `0208011301` yields no property and its permit is counted under `no_tcad_geoid`.
- **SC-002**: Loaded count = N − proven dead/invalid: total difference < 2% of N (fewer than 9,865 accounts at N = 493,246) and 0 unexplained accounts; confidential accounts included in the loaded count and reported separately.
- **SC-003**: Coordinate coverage ≥ 99% of the 371,352 R accounts that are not condo-coded (99.63% measured 2026-10-22; PO exception `docs/decisions/DEC-A-04-coverage-exception.md`; all 441,961 R accounts 88.26% public / 89.28% incl. permit points; **amended 2026-10-25 by ADR 0004: 98.20% public, 434,016 accounts, once the Run 3 `address_point` rank is assembled**) from the Query DB and from the local table export (their difference = the permit-point count); the 51,285 non-land accounts counted separately; 100% of properties without coordinates appear in the gap report with exactly one reason; 0 invented or geocoded coordinates.
- **SC-004**: Captured Austin rows = the source count at the run watermark (difference 0), with a digest and source URL on 100% of rows.
- **SC-005**: The link rate of the Austin reroof candidates is reported as measured (88.75% of the 22,084; 88.36% of the roofing permits; PO exception `docs/decisions/DEC-A-04-permit-match-rate.md` replaces the 97% target); 100% of unmatched ones counted with a reason.
- **SC-006**: The status-class split is reported next to the 2026-10-19 baseline; the anchor permit 1982-012866 BP shows `open` and the expected `open_days`.
- **SC-007**: 23 of 23 jurisdictions appear either with a captured count and source total (Austin) or in the source limitations with an evidence URL (the other 22).
- **SC-008**: Resume tests: 0 skipped and 0 duplicated pages after a forced stop (GIS and Austin); a 403 stops the run with 0 retries; a forced re-stamp writes only content-changed rows.
- **SC-009**: 0 confidential owner names in the Query DB, the export path, logs or evidence; the redacted count and the no-marker limitation are in the source limitations.

## Assumptions

- The frozen contract `contract/v1` (A-02) and the profile `travis-austin@1.0.0` are used unchanged; any rename needs `contract/v2`.
- The TCAD 2026 certified JSON export downloaded in A-01 (SHA-256 `6f7a7585…4c2346`, re-verified 2026-10-21) is the property source; sale dates are present in it (`deed_or_sale_dates_present: true`).
- The Austin Socrata adapter built in A-03 is extended, not replaced.
- The GIS host never connects from the operator machine (A-01 D-2/D-3); GIS paging runs on a GitHub-hosted US runner (Round 1 D-2), under the ARD § 8 rule that a geo-block may be retried from a US runner and a 403 never is.
- The 2026-10-21 Austin re-measure (2,381,226 / 63,021) has no committed receipt yet (G4 note C-10); the run's own watermark count supersedes it.
- The story size (2.5 days, above the 1.5-day ceiling) comes from the PO's story merge (feature-list amendment 0.2.1); accepted at G4 (2026-10-21, Round 1 D-3).
- Out of scope: address geocoding; the map view; contractor identity, BBB, merges and roof age (A-07); publication and the scheduled refresh (A-11); any UI (counts and fields appear later through A-13). **Amended 2026-10-25 (PO decision, ADR 0004):** one narrow exception, an exact and unique match of the situs to the City of Austin public address-point layer may give a point (rule `address_point`, lowest priority, never over a GIS point); nothing else is ever turned into a point and no geocoding service is used.
