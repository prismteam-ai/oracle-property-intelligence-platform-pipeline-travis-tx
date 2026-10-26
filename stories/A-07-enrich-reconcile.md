---
id: A-07
type: user-story
title: "Enrich and reconcile: contractor identity, BBB ratings, business and places data, duplicate merge and roof age"
parts: [A-07, A-08, A-09, A-10]
parent: [FEAT-A07, FEAT-A08, FEAT-A09, FEAT-A10]
vision: VIS-A
ard: ARD-A
eval_point: A1
priority: P1
moscow: Must
branch: 007-enrich-reconcile
spec: specs/007-enrich-reconcile/
depends_on: [A-01, A-02, A-03, A-04]
size_days: 2.5
agents:
  design: [oracle, mew]
  builder: oracle
  reviewers: [oracle, donphan, porygon]
  verify: "five-state contractor counts (AD-05); BBB coverage % and 403 evidence; business and places counts + licence recorded; roof-age worked example with lineage"
skills: [query-db-loading-matching, use-neutral-lexicon, bbb-harvest, overture-places-ingest, use-oracle, unify-metrics, apply-engineering-guidelines]
ui: false
status: Done
gate: G7
qc_testability_signoff: true
created: 2026-10-19
merged: 2026-10-21
---

# A-07 Enrich and reconcile: contractor identity, BBB ratings, business and places data, duplicate merge and roof age

**Merged story (2026-10-21).** This story replaces four smaller ones to save repeated gate and Spec Kit work. Every acceptance criterion from the four parts is kept. Each AC keeps a tag with its original ID. The original files are in [stories/merged/](merged/): [A-07](merged/A-07-contractor-identity.md), [A-08](merged/A-08-bbb-ratings.md), [A-09](merged/A-09-business-places.md), [A-10](merged/A-10-reconcile-roof-age.md).

| Field | Value |
| --- | --- |
| Evaluation point | A1 (primary) · A2 · A5 |
| Parts | A-07 contractor identity (track A) · A-08 BBB ratings (track B) · A-09 business and places (track C) · A-10 reconcile and roof age (track D) |
| Demo line(s) | D-3 (contractor, business and places records by source; duplicates-merged statistic), D-8 (roof older than 15 years, with roof-age basis), D-9 (contractor identity and BBB on open permits) |
| Agents | design `oracle`, `mew` · builder `oracle` · reviewers `oracle`, `donphan`, `porygon` · verify five-state counts, BBB coverage % and 403 evidence, business and places counts + licence, roof-age worked example with lineage (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-01, A-04 (direct: the merged backbone, TCAD roll, coordinates, permits, sources); A-02, A-03 (implicit, added at G4 2026-10-22: lexicon carriers/profile/views for AC-9/AC-16/AC-17, manifest coverage builder for AC-3/AC-8/AC-11/AC-17/AC-18) |
| Size | 2.5 days (sum of parts: 0.5 + 0.5 + 0.5 + 1) |
| Branch | `007-enrich-reconcile`, merged into `feature/oracle-pipeline` |

## Context

This story turns the loaded backbone into trustworthy leads. It covers four README needs.

**Who is the contractor? (track A, was A-07).** The README asks "who is the listed contractor?" (D-11). A **roofing sales rep** wants to know which company did the work. The **evaluator** checks that identity comes from official records, not from names typed on a permit (P0-6). Texas has no state roofing licence, so the official registry is the TX Comptroller "Active Franchise Tax Permit Holders" dataset. Facts (live 2026-10-19): Comptroller `9cir-efmm` has **3,487,662** rows statewide and **342,334** with Travis county code `227`. **708** Travis taxpayers have "ROOF" in the name. On the 22,084 Austin reroof candidates, **1,678** distinct contractor company names are printed, and **15,060** permits have no company name at all.

**BBB ratings (track B, was A-08).** The README asks for BBB ratings "where publicly available" (AC-8, AC-38). The **evaluator** checks that the pipeline respected BBB's terms and stopped on a 403 (access boundaries; P0-7). BBB answered with an HTTP 403 and Cloudflare bot challenge at 2026-10-19T21:08:55.628Z, repeated at 2026-10-20T07:23:23Z, so zero coverage is a real possibility. That is a documented gap, not a failure (ASM-5).

**Business and places records (track C, was A-09).** The README asks to "load available business records" (AC-9). The demo's "totals by source" line lists business records next to property and permit (D-3). Facts (live 2026-10-19): the Comptroller dataset has **342,334** Travis rows (Austin 301,031; Pflugerville 8,379; Lakeway 3,824). Overture places are optional (Could, feature list § 4) and have their own licence gate.

**Duplicates and roof age (track D, was A-10).** "Roof older than 15 years" is the README's headline query (AC-11, D-8). "Reconcile duplicate entities" plus provenance is evaluation point A2. The sales rep needs to know *why* a roof counts as old and how sure that is. The evaluator wants a duplicates-merged statistic and one worked example with full lineage. Real anchor (Austin, live 2026-10-22): TCAD id `0223120506` (pID 221829) carries open replacement permit **2000-000025 BP**, `Re Review` since 2000-01-05, and has a coordinate (`gis_centroid`). 17,251 reroof candidates are `Final` and can anchor roof age. (A-04's full-roll evidence found that the TCAD geoID `0208011301` named in the original A-10 draft has **no 2026 TCAD account at all** — `no_tcad_geoid`, no property, no coordinate — so it cannot carry a roof age; it is kept below only as the "no TCAD record" edge case, and AC-15 and the Stage 5 worked example now anchor on `0223120506` instead.)

**Order inside the story.** Track A and track C share the Comptroller load, so the registry is loaded once, first. Track B needs track A's `resolved` companies. The roof-age half of track D needs only A-04. Its contractor merge needs track A.

## Description

As a **roofing sales rep (through the CRM)**, I want **each permit's contractor matched to an official record (or honestly marked unresolved) and rated by BBB where BBB allows it, Travis business and places records loaded with their licences, and one canonical record per property, owner and contractor with a roof age, its basis and its confidence**, so that **I know which company a permit really belongs to, can weigh its reputation, and can trust why a property shows up as an aged-roof lead and where every fact came from**.

When done:

- **Track A (contractor identity).** The Comptroller registry is loaded into the Query DB before resolution (ARD § 8). Printed contractor names are search keys only. Every contractor on a permit gets one of five states (AD-05): `resolved` (official registry identifier match), `candidate`, `ambiguous`, `conflicting` or `unresolved`. A `property_improvement_has_contractor` link is written only for `resolved` (AD-06). The Comptroller taxpayer number goes in `request_identifier` + `source_http_request`, and a lexicon extension request is filed. **Overrides applied (ARD § 15, AD-30):** report all five states, not three (AD-05, AD-24). `resolved` only on an official registry identifier. An exact, unique, active legal-name match is `candidate` (PO decision 2026-10-19). Check whether Austin publishes any official contractor ID that crosswalks to the Comptroller (oracle R4), and record the answer.
- **Track B (BBB).** **D-2 policy (PO decision, 2026-10-22): send no new request to bbb.org in this story.** BBB has already answered with an HTTP 403 / Cloudflare challenge twice (2026-10-19T21:08:55.628Z, 2026-10-20T07:23:23Z, both in `docs/evidence/blocked/`), its robots.txt disallows the category-pagination path we'd need, and with 0 `resolved` companies expected there is nobody to enrich. The bounded probe and request wrapper (`--max-pages 2 --max-profiles 5`, ≤ 1 request per 3 s, concurrency 1) are still built and tested, but only against a local stub server; every `resolved` company (if any) is marked `blocked` citing the two existing A-01 receipts. If a BBB API key is later granted, that path can be used instead — not this story. **On any new 403 or challenge, the run stops and keeps the evidence.** BBB is enrichment only, never identity. **Overrides applied (ARD § 15, AD-30, AD-25):** a BBB rating is published only through a lexicon carrier confirmed in A-02 (for example `fact_sheet` via `company_has_fact_sheet`) and only for `resolved` companies. Otherwise the field is not published, and the view shows `bbb_status` with its reason.
- **Track C (business and places).** The Comptroller registry loaded for track A is also transformed into business entity records and published as its own data group. `overture-places-ingest` runs for the Travis County bounding area after its licence gate passes, as a separate publication group with counts by category.
- **Track D (reconcile and roof age).** `query-db-loading-matching` reconciles with the TCAD id as key, a single writer, tombstones and path+hash watermarks. The kit roof-age estimator runs with the versioned Travis profile: audit dry-run (limit 25) → review → apply → re-run proving `rowsWritten: 0`. Roof age and basis come only from the estimator (P0-8). Views compute `roof_age_years` from the published roof date and `as_of_date` (= run `finishedAt`).

**Independent test:**

1. The five-state counts over all Austin reroof permits add up to the permit total, and every `resolved` row cites the Comptroller record it matched.
2. The manifest `coverage` section shows BBB counts by `bbb_status` with the coverage percentage. The capture receipts contain either ratings or the 403 evidence.
3. The business-record count equals the Comptroller Travis total at the capture watermark, and the manifest lists each group's licence.
4. The 25-property audit agrees with the view derivation 25/25 (AD-25), the re-run writes 0 rows, and the worked example traces one property's roof age to its source records.

## Acceptance Criteria

### Track A · Contractor identity (was A-07)

1. **AC-1** (was A-07 AC-1) · **Given** a reroof permit whose printed company name matches exactly one Travis Comptroller legal name whose `sos_status_code` is active, **When** resolution runs without an official identifier crosswalk, **Then** the state is `candidate`, the printed name is shown "as printed on permit", and no company record or `property_improvement_has_contractor` link is written. ("Active" = the Comptroller `sos_status_code` for that record indicates an active franchise-tax status; see the Edge cases section's "conflicting" row for the non-active case.) ☐ testable
2. **AC-2** (was A-07 AC-2) · **Given** an official identifier crosswalk (if this story finds one Austin publishes), **When** a permit's contractor identifier equals a Comptroller taxpayer number, **Then** the state is `resolved`, the company link is written, and the match rule and both source URLs are recorded. If Stage 3's crosswalk research (oracle R4) finds no such Austin field, this AC is proven only by a labelled unit fixture, and the finding (what was checked, with URLs, and the verdict) is recorded in evidence. ☐ testable
3. **AC-3** (scale; was A-07 AC-3) · **Given** all 22,084 Austin reroof candidates and the 342,334 Travis Comptroller records, **When** resolution completes, **Then** the five-state totals (`resolved`, `candidate`, `ambiguous`, `conflicting`, `unresolved`) sum to the permit total, are written to the manifest `coverage` section with `derivation = aggregate_match` (AD-28), and the match rule version is recorded. ☐ testable
4. **AC-4** (missing data; was A-07 AC-4) · **Given** a permit with no printed company name (15,060 of the 22,084 on 2026-10-19), **When** it is resolved, **Then** its state is `unresolved` with reason `contractor_not_printed`, and the UI-facing view shows "Contractor not printed on permit", never a guessed company. ☐ testable
5. **AC-5** (error; was A-07 AC-5) · **Given** the Comptroller dataset is unreachable or not yet loaded, **When** resolution runs, **Then** every contractor stays `unresolved` with reason `registry_unavailable` and the run records the limitation; it never falls back to name = identity. ☐ testable

### Track B · BBB ratings (was A-08)

6. **AC-6** (was A-08 AC-1) · **Given** no BBB API key, **When** the bounded probe runs (`--max-pages 2 --max-profiles 5`), **Then** it makes at most 7 requests at ≤ 1 per 3 s with concurrency 1, and records each response code and time. ☐ testable
7. **AC-7** (error; was A-08 AC-2) · **Given** the probe or the full run receives a 403 or a Cloudflare challenge (as seen on 2026-10-19T21:08:55.628Z, repeated 2026-10-20T07:23:23Z), **When** it happens, **Then** the run stops at that request, records `bbb_status = blocked` for all unchecked contractors with the evidence (URL, code, time, response digest), and makes no retry with a changed IP or user agent. ☐ testable
8. **AC-8** (scale; was A-08 AC-3) · **Given** every `resolved` company from track A, **When** enrichment finishes, **Then** each one has exactly one `bbb_status` ∈ {`rated`, `not_found`, `blocked`, `not_checked`}, and the coverage % (rated ÷ resolved) and per-status counts are in the manifest `coverage` with `derivation` labels. ☐ testable
9. **AC-9** (missing data; was A-08 AC-4) · **Given** no lexicon carrier was confirmed in A-02, **When** the views are read, **Then** no BBB rating is published, every contractor shows `bbb_status = not_checked` with reason `no_lexicon_carrier`, and a lexicon extension request is on file. ☐ testable
10. **AC-10** (was A-08 AC-5) · **Given** a contractor that is `candidate` or `unresolved`, **When** enrichment runs, **Then** BBB is not looked up for it and no BBB profile ever decides its identity (P0-6). ☐ testable

### Track C · Business and places (was A-09)

11. **AC-11** (scale; was A-09 AC-1) · **Given** the Comptroller dataset at the capture watermark (342,334 Travis rows on 2026-10-19), **When** the business group is transformed, **Then** the loaded count equals the source count at that watermark, each record keeps the taxpayer number, legal name, mailing address and SOS file number with source URL and capture time, and the count goes into the manifest `coverage` with `derivation = capture_receipt`. ☐ testable
12. **AC-12** (was A-09 AC-2) · **Given** the Overture licence gate passes, **When** `overture-places-ingest` runs for Travis County, **Then** places are loaded as a separate publication group with counts by top-level category, and the Overture release ID and licence (CDLA / ODbL per theme) are recorded in the manifest limitations. ☐ testable
13. **AC-13** (missing data; was A-09 AC-3) · **Given** the Overture licence gate fails or the release cannot be fetched, **When** the story runs, **Then** no places are ingested, the reason is recorded in the manifest limitations, and the Coverage page shows "Places: not loaded · {reason}" instead of zero. ☐ testable
14. **AC-14** (was A-09 AC-4) · **Given** a place or business whose name equals a permit's printed contractor name, **When** records are loaded, **Then** no contractor identity is created or changed from it (P0-6). ☐ testable

### Track D · Reconcile duplicates and roof age (was A-10)

15. **AC-15** (was A-10 AC-1) · **Given** TCAD id `0223120506` (pID 221829) with open replacement permit 2000-000025 BP (`Re Review`), **When** roof age is estimated, **Then** the open permit does **not** reset roof age (P0-8); the anchor is the latest *final* replacement permit or, failing that, the built year, with `roof_age_basis` and `roof_age_confidence` recorded, and the worked example in evidence shows every source record, URL, capture time and digest behind it. (Corrected at G4 2026-10-22: the original draft's anchor, TCAD geoID `0208011301`, has no 2026 TCAD account — `no_tcad_geoid`, per A-04's evidence — so it cannot carry a roof age. It is kept only as the "no TCAD record" edge case below.) ☐ testable
16. **AC-16** (was A-10 AC-2) · **Given** a property whose latest roofing permit is `Final`, **When** roof age is estimated, **Then** `roof_age_basis = permit`, `roof_age_confidence = high`, and `roof_age_years` = run `as_of` − the permit's final date; new construction gives `new_construction`/medium; built year only gives `built_year`/low (mew § 2.4). ☐ testable
17. **AC-17** (scale; was A-10 AC-3) · **Given** the full roll from A-04, **When** the estimator is applied, **Then** roof-age coverage is reported by basis and confidence over all N properties (counts and %), the 25-property audit matches the view derivation 25/25, and a second run writes `rowsWritten: 0`. ☐ testable
18. **AC-18** (was A-10 AC-4) · **Given** owners and contractors from TCAD, permits and the Comptroller, **When** reconciliation merges duplicates, **Then** the manifest `coverage` carries `merge {entityType, inputRecords, canonical}` per entity type with `derivation = aggregate_match` (AD-28), and contractor clusters are merged only where identity is `resolved` (AD-05). ☐ testable
19. **AC-19** (missing data; was A-10 AC-5) · **Given** a property with no roofing permit and no year built, **When** roof age is estimated, **Then** `roof_age_basis = unknown`, `roof_age_confidence = none`, `roof_age_years` is null, the property is excluded from "roof > 15" results but counted in the coverage gap, and no date is invented. ☐ testable

## Edge cases (at least two)

- Two active Comptroller records share the printed name ("ABC ROOFING LLC" in Austin and Pflugerville) → `ambiguous`; both candidates kept in the ledger. (A-07)
- The printed name matches a record whose `sos_status_code` is not active → `conflicting`, with the status shown. (A-07)
- Abbreviations and punctuation ("Roofing Co." vs "ROOFING COMPANY") → normalisation rule versioned; still `candidate`, never `resolved` on name alone. (A-07)
- BBB or Overture name matches → never used for identity (P0-6). (A-07)
- BBB profile exists but shows "NR" (no rating) → `rated` is false; status `not_found` with the profile URL kept as evidence. (A-08)
- Probe succeeds but the full run hits a 403 halfway → keep the ratings already captured, mark the rest `blocked`, stop. (A-08)
- robots.txt disallows the path → do not fetch; status `blocked` with reason `robots_disallow`. (A-08)
- Comptroller rows whose county code is `227` but whose address is outside Travis → keep (county code is the source's own attribution), note the count. (A-09)
- Overture place outside the county polygon but inside the bounding box → excluded by polygon test; count recorded. (A-09)
- Comptroller dataset row count changes during capture → re-read the count at the watermark; the receipt stores both. (A-09)
- Two final reroof permits on the same property → the latest final date wins; the earlier one stays in lineage. (A-10)
- A reroof permit `Expired` with no final (stalled) → not an anchor; it is a lead signal only. (A-10)
- Year built in the future or before 1850 → flagged invalid, basis `unknown`, reason recorded. (A-10)
- A merge would join two TCAD ids → never; the TCAD id is the key (P0-5). (A-10)
- A permit's TCAD geoID has no matching 2026 TCAD account (for example `0208011301`, linked only via `no_tcad_geoid`) → no property to assign a roof age to; excluded from roof-age coverage with reason `no_tcad_geoid`, never silently dropped. (A-10, added at G4 2026-10-22)

## Requirements

| REQ | Requirement | Traces to | Was |
| --- | --- | --- | --- |
| FR-001 | System MUST assign one of five states using official identifiers only for `resolved` | AC-1, AC-2 | A-07 FR-001 |
| FR-002 | System MUST write company links only for `resolved` | AC-1, AC-2 | A-07 FR-002 |
| FR-003 | System MUST publish five-state totals in the manifest coverage with derivation labels | AC-3 | A-07 FR-003 |
| FR-004 | System MUST mark unprinted or unavailable identity with a reason | AC-4, AC-5 | A-07 FR-004 |
| FR-005 | System MUST bound BBB requests (≤ 1 per 3 s, concurrency 1, probe limits) | AC-6 | A-08 FR-001 |
| FR-006 | System MUST stop on the first 403 or challenge and record evidence | AC-7 | A-08 FR-002 |
| FR-007 | System MUST give every resolved company a `bbb_status` and publish coverage counts | AC-8 | A-08 FR-003 |
| FR-008 | System MUST publish ratings only through a confirmed lexicon carrier | AC-9 | A-08 FR-004 |
| FR-009 | System MUST never use BBB for identity | AC-10 | A-08 FR-005 |
| FR-010 | System MUST load Travis business records with provenance and a reconciled count | AC-11 | A-09 FR-001 |
| FR-011 | System MUST load Overture places only after its licence gate, as a separate group | AC-12 | A-09 FR-002 |
| FR-012 | System MUST record why places are absent if the gate fails | AC-13 | A-09 FR-003 |
| FR-013 | System MUST NOT derive contractor identity from business or place names | AC-14 | A-09 FR-004 |
| FR-014 | System MUST derive roof age only from the kit estimator with the Travis profile | AC-15, AC-16 | A-10 FR-001 |
| FR-015 | System MUST never reset roof age on an open replacement permit | AC-15 | A-10 FR-002 |
| FR-016 | System MUST report roof-age coverage by basis and confidence and prove idempotency | AC-17 | A-10 FR-003 |
| FR-017 | System MUST publish merge counts as aggregates with derivation labels | AC-18 | A-10 FR-004 |
| FR-018 | System MUST mark unknown roof age with a reason | AC-19 | A-10 FR-005 |
| NFR-001 | Every contractor count reproducible from the ledger; 0 `resolved` without an identifier match (review sample of 25) | AC-3 | A-07 NFR-001 |
| NFR-002 | 0 CAPTCHA or challenge bypasses; stop on first 403 (NFR-07) | AC-7 | A-08 NFR-001 |
| NFR-003 | Captured count = source count at watermark; licence recorded for 100% of groups | AC-11, AC-12 | A-09 NFR-001 |
| NFR-004 | Roof-age audit 25/25 agreement; re-run `rowsWritten: 0` | AC-17 | A-10 NFR-001 |

## Prototype reference

Not a UI story. Its outputs are rendered by A-13:

- five-state contractor badge: `design/prototype/ContractorBadge.dc.html`
- "BBB: Blocked · 403": `design/prototype/ExploreQ-permits5.dc.html` and `design/prototype/Property1440.dc.html`
- business and places counts: `design/prototype/Coverage1440.dc.html`
- roof-age basis and confidence columns: `design/prototype/ExploreQ-roof15.dc.html`; "Merged from": `design/prototype/PropertyDetail.dc.html`

## Demo Script

1. Presenter: "Show the total uploaded records by source." → Expected: a business row with its Comptroller total and capture time, a places row with its count or reason, and the duplicates-merged statistic.
2. Presenter: "Show properties in that area with open roofing permits … including contractor and BBB rating where available." → Expected: the contractor "as printed on permit" with its state badge (nothing labelled resolved without a registry match), and a BBB rating where one was captured and published, otherwise the BBB status and its reason.
3. Presenter: "Using the UI, show properties within a sample radius that have roofs older than 15 years." → Expected: each result shows the roof-age basis and confidence derived here.

## Out of scope

- Applying for the BBB API (a Day-0 action, not code). Ratings for unresolved contractors.
- Texas SOSDirect (paid source; out of scope OS-04). Using places for roof age or identity.
- Physical roof inspection (roof age is evidence-based; caveat shown). Publishing lineage files (lineage stays internal; only aggregates are published, AD-04).
- Full-county publication by CID (A-11).

## Evidence to capture

- `docs/evidence/A-07.md`, one section per track:
  - A: five-state counts, crosswalk finding, match rule version, a 25-row review sample.
  - B: probe log, 403 evidence or ratings captured, coverage % by status.
  - C: counts vs source totals, licence record, category counts.
  - D: dedup statistics per entity type, roof-age coverage by basis and confidence, the 25-property audit, the `rowsWritten: 0` re-run, the worked example for `0223120506`.
- `testplans/A-07-test-cases.md` results, `docs/reviews/CR-A-07.md`.

---

## Gate G4: Story ready for planning

| # | Criterion | Status |
| --- | --- | --- |
| G4-1 | Front matter complete (parent FEAT, eval point, branch, priority, **agents and skills from AGENT-MAP.md**) | ☑ |
| G4-2 | "As a / I want / So that" stated, with an independent test | ☑ |
| G4-3 | Every AC is Given / When / Then, and its testable box is ticked | ☑ |
| G4-4 | One scale AC and one missing-data or error AC | ☑ |
| G4-5 | At least two edge cases | ☑ |
| G4-6 | Every requirement traces to an AC; NFRs have thresholds | ☑ |
| G4-7 | Prototype screen linked (UI stories) | ☑ N/A — `ui: false`, pipeline-only story |
| G4-8 | Dependencies done, or stubbed with **real** sample data | ☑ A-01, A-02, A-03, A-04 all merged + Done (added A-02, A-03 at G4, D-0) |
| G4-9 | No `[NEEDS CLARIFICATION]` left | ☑ |
| G4-10 | AI pre-check (`developmentsupport-g4-precheck`): PASS | ☑ PASS after fixes, see `docs/gates/G4-A-07-precheck.md` |

**Decision:** ☑ Ready ☐ Returned, reason: {…} · 2026-10-22 (D-0 add A-02/A-03; D-1 Ready, Travis scope kept as written; D-2 BBB policy (a) no new request; D-3 no kit PR; D-4 no IPFS upload in A-07)
