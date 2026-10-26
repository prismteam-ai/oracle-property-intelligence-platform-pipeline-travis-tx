# Feature Specification: Enrich and reconcile: contractor identity, BBB ratings, business and places data, duplicate merge and roof age

**Feature Branch**: `007-enrich-reconcile`

**Created**: 2026-10-22

**Status**: Draft

**Input**: User description: specify the merged story in `stories/A-07-enrich-reconcile.md` (parts A-07, A-08, A-09, A-10; tracks A identity, B BBB, C business and places, D reconcile and roof age), one user story per track, every AC becoming at least one FR with the same number, the D-2 BBB request policy included, no technology choices.

**Story**: `stories/A-07-enrich-reconcile.md` | **Evaluation point**: A1 (primary) · A2 · A5 | **Demo line(s)**: D-3, D-8, D-9

**Owner agents** (from the story front matter; used by the plan, not by this spec): design `oracle`, `mew` · builder `oracle` · reviewers `oracle`, `donphan`, `porygon` · verify five-state contractor counts (AD-05); BBB coverage % and 403 evidence; business and places counts + licence recorded; roof-age worked example with lineage

> Every story acceptance criterion becomes at least one FR below (AC-1 → FR-001 … AC-19 → FR-019, keeping the "(was A-0x AC-n)" tags). No technology choices in this file; they belong in plan.md.

**Cost-mode scope note (2026-10-22, PO decision, deadline 2026-10-23):** this spec covers the full merged story (all four tracks), but the build in Stage 5 is scoped to **track A and track D only** for this run. Track B is a documented gap (bbb.org answers with a Cloudflare challenge; see User Story 2 and FR-005–FR-009, which stay fully specified so the gap is evidenced, not skipped). Track C builds only if tracks A and D merge before 2026-10-23 12:00 EEST; otherwise it is also a documented gap. This does not change what any AC means — it changes which tracks this particular run builds and which stay as evidenced gaps for a later run.

## Clarifications

### Session 2026-10-22

- Q: What does a view show when a `resolved` company is both `blocked` by BBB (a 403/challenge was captured) and has no lexicon carrier confirmed for a BBB field? → A: `not_checked` with reason `no_lexicon_carrier` — nothing BBB-derived is publishable without a carrier regardless of what was captured at request time; the manifest's internal counts still record the capture-time `blocked` status with its `derivation` label, so the distinction isn't lost, just not shown through an unconfirmed carrier. (Source: walkthrough §5 "Blocked + no carrier (proposed)", applied directly per the "answer from the story/ARD/§5 facts first" rule — not escalated to round R2.) Applied to FR-009.
- Q: Which as-of date binds the roof-age estimator run and the 25-property audit comparison in the same test? → Deferred to Stage 3 design (D-9); the story and §5 only establish that one fixed date must be used for both sides of the audit, not which date. Not resolved here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Know the official contractor on a permit, honestly (Priority: P1) — Track A, was A-07

A roofing sales rep, through the CRM, needs to know which company actually did the work on a permit — from an official record, never from a name typed on a form.

**Why this priority**: Primary evaluation point A1. Contractor identity is the foundation the BBB rating (User Story 2) and the contractor-cluster merge (User Story 4) both depend on.

**Independent Test**: Run resolution over all Austin reroof permits against the loaded Comptroller registry; the five-state counts sum to the permit total and every `resolved` row cites the Comptroller record it matched.

**Acceptance Scenarios**:

1. **Given** a reroof permit whose printed company name matches exactly one Travis Comptroller legal name whose `sos_status_code` is active, **When** resolution runs without an official identifier crosswalk, **Then** the state is `candidate`, the printed name is shown "as printed on permit", and no company record or link is written.
2. **Given** an official identifier crosswalk (if Stage 3's research finds one Austin publishes), **When** a permit's contractor identifier equals a Comptroller taxpayer number, **Then** the state is `resolved`, the company link is written, and the match rule and both source URLs are recorded. If no crosswalk is found, this scenario is proven only by a labelled unit fixture, with the negative finding (what was checked, and where) recorded in evidence.
3. **Given** all 22,084 Austin reroof candidates and the 342,334 Travis Comptroller records, **When** resolution completes, **Then** the five-state totals (`resolved`, `candidate`, `ambiguous`, `conflicting`, `unresolved`) sum to the permit total, are written to the manifest `coverage` section with `derivation = aggregate_match`, and the match rule version is recorded.
4. **Given** a permit with no printed company name (15,060 of the 22,084 on 2026-10-19), **When** it is resolved, **Then** its state is `unresolved` with reason `contractor_not_printed`, and the public-facing view shows "Contractor not printed on permit", never a guessed company.
5. **Given** the Comptroller dataset is unreachable or not yet loaded, **When** resolution runs, **Then** every contractor stays `unresolved` with reason `registry_unavailable`, the run records the limitation, and it never falls back to name = identity.

---

### User Story 2 - See a contractor's BBB standing, only where BBB allows it (Priority: P2) — Track B, was A-08

A roofing sales rep wants a reputation signal alongside an officially identified contractor; the evaluator wants proof that BBB's access terms were respected, not bypassed.

**Why this priority**: Enrichment layered on User Story 1's identity; valuable but never load-bearing for identity, and may honestly resolve to zero coverage.

**Independent Test**: Run the bounded BBB probe/wrapper (against a stub, per the D-2 policy below) over the `resolved` company list; every company ends with exactly one `bbb_status`, and the coverage % and per-status counts are in the manifest.

**D-2 BBB request policy (PO decision, 2026-10-22):** no new request goes to bbb.org in this story. BBB has already answered twice with an HTTP 403 / Cloudflare challenge (2026-10-19T21:08:55.628Z; 2026-10-20T07:23:23Z, both receipted in `docs/evidence/blocked/`), and with 0 `resolved` companies expected there is nobody to enrich. The bounded request wrapper is still built and tested — but only against a local stub server — and every `resolved` company (if any exist) is marked `blocked`, citing the two existing receipts. A live BBB API key, if later granted, is a separate decision, not this story.

**Acceptance Scenarios**:

1. **Given** no BBB API key, **When** the bounded probe runs (`--max-pages 2 --max-profiles 5`), **Then** it makes at most 7 requests at ≤ 1 per 3 s with concurrency 1, and records each response code and time.
2. **Given** the probe or the full run receives a 403 or a Cloudflare challenge (as measured 2026-10-19T21:08:55.628Z and 2026-10-20T07:23:23Z), **When** it happens, **Then** the run stops at that request, records `bbb_status = blocked` for all unchecked contractors with the evidence (URL, code, time, response digest), and makes no retry with a changed IP or user agent.
3. **Given** every `resolved` company from User Story 1, **When** enrichment finishes, **Then** each one has exactly one `bbb_status` ∈ {`rated`, `not_found`, `blocked`, `not_checked`}, and the coverage % (rated ÷ resolved) and per-status counts are in the manifest `coverage` with `derivation` labels.
4. **Given** no lexicon carrier was confirmed in A-02, **When** the views are read, **Then** no BBB rating is published, every contractor shows `bbb_status = not_checked` with reason `no_lexicon_carrier`, and a lexicon extension request is on file.
5. **Given** a contractor that is `candidate` or `unresolved`, **When** enrichment runs, **Then** BBB is not looked up for it and no BBB profile ever decides its identity.

---

### User Story 3 - Load Travis business records, and places if licensed (Priority: P3) — Track C, was A-09

An evaluator and a roofing sales rep both want to see the Comptroller's Travis business records loaded with an exact, reproducible count, and — only where the licence allows it — nearby places for context.

**Why this priority**: A Must (business records) bundled with a Could (places); valuable context, not on User Story 1's or 4's critical path. This run builds it only if tracks A and D merge before the 2026-10-23 12:00 EEST deadline; otherwise it is a documented gap.

**Independent Test**: Transform the already-loaded Comptroller registry into a business group; the loaded count equals the source count at the watermark, and the manifest lists the group's licence (and the places group's, if loaded).

**Acceptance Scenarios**:

1. **Given** the Comptroller dataset at the capture watermark (342,334 Travis rows on 2026-10-19), **When** the business group is transformed, **Then** the loaded count equals the source count at that watermark, each record keeps the taxpayer number, legal name, mailing address and SOS file number with source URL and capture time, and the count goes into the manifest `coverage` with `derivation = capture_receipt`.
2. **Given** the Overture licence gate passes, **When** places ingestion runs for Travis County, **Then** places are loaded as a separate publication group with counts by top-level category, and the Overture release ID and licence are recorded in the manifest limitations.
3. **Given** the Overture licence gate fails or the release cannot be fetched, **When** the story runs, **Then** no places are ingested, the reason is recorded in the manifest limitations, and the Coverage page shows "Places: not loaded · {reason}" instead of zero.
4. **Given** a place or business whose name equals a permit's printed contractor name, **When** records are loaded, **Then** no contractor identity is created or changed from it.

---

### User Story 4 - One record per property, owner and contractor, with an honest roof age (Priority: P1) — Track D, was A-10

An evaluator and a roofing sales rep both need one canonical record per property/owner/contractor (not duplicates), and a roof age they can trust — with a stated basis, a stated confidence, and one worked example showing every source record behind it.

**Why this priority**: Evaluation point A2 (reconciliation + provenance), and the README's headline "roofs older than 15 years" query depends entirely on this track's output.

**Independent Test**: Run the merge over TCAD/owner/contractor/permit records; report `merge {entityType, inputRecords, canonical}` per entity type. Run the roof-age estimator's 25-property audit; it agrees with the view derivation 25/25, and the immediate re-run writes `rowsWritten: 0`.

**Acceptance Scenarios**:

1. **Given** TCAD id `0223120506` (pID 221829) with open replacement permit `2000-000025 BP` (`Re Review`), **When** roof age is estimated, **Then** the open permit does **not** reset roof age; the anchor is the latest *final* replacement permit or, failing that, the built year, with `roof_age_basis` and `roof_age_confidence` recorded, and the worked example in evidence shows every source record, URL, capture time and digest behind it. (Corrected at G4 2026-10-22: the original draft's anchor, TCAD geoID `0208011301`, has no 2026 TCAD account at all — see Edge Cases — so it cannot carry a roof age.)
2. **Given** a property whose latest roofing permit is `Final`, **When** roof age is estimated, **Then** `roof_age_basis = permit`, `roof_age_confidence = high`, and `roof_age_years` = run `as_of` − the permit's final date; new construction gives `new_construction`/medium; built year only gives `built_year`/low.
3. **Given** the full roll from A-04, **When** the estimator is applied, **Then** roof-age coverage is reported by basis and confidence over all N properties (counts and %), the 25-property audit matches the view derivation 25/25, and a second run writes `rowsWritten: 0`.
4. **Given** owners and contractors from TCAD, permits and the Comptroller, **When** reconciliation merges duplicates, **Then** the manifest `coverage` carries `merge {entityType, inputRecords, canonical}` per entity type with `derivation = aggregate_match`, and contractor clusters are merged only where identity is `resolved`.
5. **Given** a property with no roofing permit and no year built, **When** roof age is estimated, **Then** `roof_age_basis = unknown`, `roof_age_confidence = none`, `roof_age_years` is null, the property is excluded from "roof > 15" results but counted in the coverage gap, and no date is invented.

---

### Edge Cases

- Two active Comptroller records share the printed name ("ABC ROOFING LLC" in Austin and Pflugerville) → `ambiguous`; both candidates kept in the ledger. (Track A)
- The printed name matches a record whose `sos_status_code` is not active → `conflicting`, with the status shown. (Track A)
- Abbreviations and punctuation ("Roofing Co." vs "ROOFING COMPANY") → normalisation rule versioned; still `candidate`, never `resolved` on name alone. (Track A)
- BBB or Overture name matches → never used for identity. (Track A)
- BBB profile exists but shows "NR" (no rating) → `rated` is false; status `not_found` with the profile URL kept as evidence. (Track B)
- Probe succeeds but the full run hits a 403 halfway → keep the ratings already captured, mark the rest `blocked`, stop. (Track B)
- robots.txt disallows the path → do not fetch; status `blocked` with reason `robots_disallow`. (Track B)
- Comptroller rows whose county code is `227` but whose address is outside Travis → keep (county code is the source's own attribution), note the count. (Track C)
- Overture place outside the county polygon but inside the bounding box → excluded by the polygon test; count recorded. (Track C)
- Comptroller dataset row count changes during capture → re-read the count at the watermark; the receipt stores both. (Track C)
- Two final reroof permits on the same property → the latest final date wins; the earlier one stays in lineage. (Track D)
- A reroof permit `Expired` with no final (stalled) → not an anchor; it is a lead signal only. (Track D)
- Year built in the future or before 1850 → flagged invalid, basis `unknown`, reason recorded. (Track D)
- A merge would join two TCAD ids → never; the TCAD id is the key. (Track D)
- A permit's TCAD geoID has no matching 2026 TCAD account (for example `0208011301`, `no_tcad_geoid`) → no property to assign a roof age to; excluded from roof-age coverage with reason `no_tcad_geoid`, never silently dropped. (Track D, added at G4 2026-10-22)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (was A-07 AC-1): System MUST classify a permit's printed-name-only match against an active Travis Comptroller legal name as `candidate`, write no company record or link, and show the name "as printed on permit".
- **FR-002** (was A-07 AC-2): System MUST write a company link and record the match rule and both source URLs only when an official identifier crosswalk resolves the contractor; absent a crosswalk, this is proven by a labelled fixture with the negative finding recorded.
- **FR-003** (was A-07 AC-3): System MUST compute and publish five-state totals over all Austin reroof candidates against the Travis Comptroller population, summing to the permit total, in the manifest `coverage` with `derivation = aggregate_match`, with the match rule version recorded.
- **FR-004** (was A-07 AC-4): System MUST mark a permit with no printed company name `unresolved` with reason `contractor_not_printed`, and show "Contractor not printed on permit" rather than a guess.
- **FR-005** (was A-07 AC-5): System MUST mark every contractor `unresolved` with reason `registry_unavailable` when the Comptroller dataset is unreachable or unloaded, recording the limitation and never falling back to name = identity.
- **FR-006** (was A-08 AC-1): System MUST bound the BBB probe to at most 7 requests, ≤ 1 per 3 s, concurrency 1, recording each response code and time, with no new request sent to bbb.org under the D-2 policy (test against a local stub).
- **FR-007** (was A-08 AC-2): System MUST stop at the first 403 or Cloudflare challenge, mark unchecked contractors `blocked` with full evidence, and never retry with a changed identity or network.
- **FR-008** (was A-08 AC-3): System MUST assign every `resolved` company exactly one `bbb_status`, and publish the per-status counts and coverage % (rated ÷ resolved; "not computable" when resolved = 0) in the manifest.
- **FR-009** (was A-08 AC-4): System MUST publish no BBB rating, and show `bbb_status = not_checked` with reason `no_lexicon_carrier`, when no lexicon carrier is confirmed — including when the company was also captured `blocked` at request time, since nothing BBB-derived is publishable without a carrier either way (the capture-time `blocked` status still reaches the manifest's internal counts with its own `derivation` label); a lexicon extension request MUST be recorded.
- **FR-010** (was A-08 AC-5): System MUST never look up BBB for a `candidate` or `unresolved` contractor, and never let a BBB profile decide identity.
- **FR-011** (was A-09 AC-1): System MUST load the Travis business group with a count equal to the source count at the capture watermark, provenance per record, and the count in the manifest with `derivation = capture_receipt`.
- **FR-012** (was A-09 AC-2): System MUST load Overture places as a separate group, counted by top-level category, with the release ID and licence recorded, only after the licence gate passes.
- **FR-013** (was A-09 AC-3): System MUST record the reason and show "Places: not loaded · {reason}" (never 0) when the licence gate fails or the release can't be fetched.
- **FR-014** (was A-09 AC-4): System MUST NOT derive or change contractor identity from a matching business or place name.
- **FR-015** (was A-10 AC-1): System MUST never reset roof age on an open replacement permit; the anchor is the latest *final* replacement permit or the built year, with basis, confidence and a fully sourced worked example recorded.
- **FR-016** (was A-10 AC-2): System MUST derive `roof_age_basis`/`roof_age_confidence` as `permit`/high (final replacement permit), `new_construction`/medium, or `built_year`/low, with `roof_age_years` computed from the run's `as_of` date.
- **FR-017** (was A-10 AC-3): System MUST report full-roll roof-age coverage by basis and confidence, pass a 25-property audit 25/25 against the view derivation, and prove idempotency with a `rowsWritten: 0` re-run.
- **FR-018** (was A-10 AC-4): System MUST publish merge counts as `merge {entityType, inputRecords, canonical}` with `derivation = aggregate_match`, merging contractor clusters only where identity is `resolved`.
- **FR-019** (was A-10 AC-5): System MUST assign `unknown`/`none` with a null age when there is no roofing permit and no year built, excluding the property from "roof > 15" results while still counting it in the coverage gap, and MUST NOT invent a date.

### Non-Functional Requirements

- **NFR-001** (was A-07 NFR-001): Every contractor count is reproducible from the ledger; 0 `resolved` rows without an identifier match, verified by a 25-row sample review. Traces to FR-003.
- **NFR-002** (was A-08 NFR-001): 0 CAPTCHA or challenge bypasses; the run stops on the first 403. Traces to FR-007.
- **NFR-003** (was A-09 NFR-001): Loaded count equals the source count at the watermark; licence recorded for 100% of published groups. Traces to FR-011, FR-012.
- **NFR-004** (was A-10 NFR-001): Roof-age 25-property audit agrees 25/25; the immediate re-run writes `rowsWritten: 0`. Traces to FR-017.

### Key Entities

- **Contractor resolution ledger (Track A)**: one row per Austin reroof permit, carrying the five-state verdict, the normalisation rule version, the snapshot digest of the Comptroller record (if any), and the printed name as captured.
- **Company record (Track A)**: written only for `resolved` contractors; carries the Comptroller taxpayer number, legal name and `sos_status_code`, linked to the property improvement via `property_improvement_has_contractor`.
- **BBB status record (Track B)**: one per `resolved` company, carrying `bbb_status`, a reason, and the evidence (receipt or new capture) it rests on.
- **Business record (Track C)**: one per Travis taxpayer in the Comptroller dataset, carrying taxpayer number, legal name, mailing address, SOS file number, source URL and capture time.
- **Place record (Track C, conditional)**: one per Overture place inside the Travis polygon, carrying name, category, address, phone, website, and the pinned Overture release.
- **Reconciled property/owner/contractor records (Track D)**: canonical, deduplicated entities keyed by TCAD id, each merge recording `inputRecords` and `canonical` counts per entity type.
- **Roof-age estimate (Track D)**: one per reconciled property, carrying `roof_age_basis`, `roof_age_confidence`, `roof_age_years` (nullable), and the as-of date it was computed against.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The five contractor identity states, counted over every Austin reroof permit, sum exactly to the permit total, with zero unexplained remainder.
- **SC-002**: Every `resolved` contractor traces to exactly one cited official record; a 25-row random sample finds zero `resolved` verdicts without a matching identifier.
- **SC-003**: The BBB enrichment step issues zero uncounted requests beyond its documented bound, and stops within one request of any access block, with full evidence kept.
- **SC-004**: The loaded business-record count matches the public source's count at the capture time, with zero unexplained discrepancy.
- **SC-005**: A second, immediate run of the roof-age backfill over the same scope writes zero additional rows (full idempotency).
- **SC-006**: A 25-property roof-age audit sample agrees with the published view's basis, confidence and age on all 25.
- **SC-007**: Every merge of duplicate property, owner or contractor records is reported as a count (inputs vs. canonical result), with zero merges that cross two distinct TCAD identifiers.
- **SC-008**: Every property lacking enough source data for a roof-age estimate is shown with a stated reason, never a blank or invented value.

## Assumptions

- Texas has no statewide contractor licence; the TX Comptroller's "Active Franchise Tax Permit Holders" dataset is the official identity registry for Track A, per the story and ARD.
- The Comptroller identity lookup is scoped to Travis County records (342,334 rows) for this run, as the story's ACs state, even though the source's own documentation calls the statewide set (3,487,662 rows) "the identity lookup set" — a PO decision recorded at G4 (D-1); revisit only with Stage-3 evidence of material out-of-Travis matches.
- No BBB API key is available or will be applied for during this story (PO decision, DEC-A-01 D-4); Track B proves its bounded request path against a local stub only (D-2 policy).
- Track C (business and places) is built this run only if tracks A and D both merge before 2026-10-23 12:00 EEST; otherwise it is recorded as a documented gap, same as Track B.
- A property with no 2026 TCAD account (for example the geoID named in the original A-10 draft, `0208011301`) cannot receive a roof age; it is excluded from roof-age coverage with a stated reason rather than treated as a data error.
- The Comptroller registry is loaded into the internal Query DB exactly once, before any resolution or business-record transform runs, and is never reloaded a second way within this story.
- Dependencies A-01, A-02, A-03 and A-04 are complete and merged before this story's Stage 5 build begins; their outputs (sources, lexicon carriers/profile/views, manifest builder, and the TCAD/permit backbone) are read, never re-derived.
