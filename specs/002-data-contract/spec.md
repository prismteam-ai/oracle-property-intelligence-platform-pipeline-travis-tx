# Feature Specification: Freeze the property-intelligence data contract

**Feature Branch**: `002-data-contract`

**Created**: 2026-10-20

**Status**: Draft

**Input**: User description: "Specify the story in stories/A-02-data-contract.md. Every acceptance criterion becomes at least one FR with the same numbers. Fill the spec header (story, evaluation point, demo lines, owner agents) from the story front matter. Facts: ../assessment-guide/reference/A-oracle.md § 5. No technology choices."

**Story**: `stories/A-02-data-contract.md` | **Evaluation point**: A5 (primary) · A6 | **Demo line(s)**: D-4 (query layer), D-9 and D-11 (contractor, status and BBB fields exist or say why not), D-12 (MCP-ready "without changing the data model")

**Owner agents** (from the story front matter; used by the plan, not by this spec): design `mew`, `oracle` · builder `oracle` · reviewers `oracle`, `donphan` · verify Vitest on views; `contract/v1/sample.parquet` readable

> Every story acceptance criterion becomes at least one FR below. No technology choices in this file; they belong in plan.md.

**Numbering.** FR-001 to FR-008 match AC-1 to AC-8 one to one. FR-009 onward carry the rest of the story's requirements. The story's own REQ IDs are given in brackets, e.g. *(story FR-003)*.

## Clarifications

### Session 2026-10-20

- Q: Where do the pilot rows' `run_id` and `manifest_cid` come from, given nothing is published until A-03? → A: A local pilot manifest (PO, D-2: "Local pilot manifest (Recommended)"). It follows `RunManifestV1`, is built only from the CLI outputs, has run ID `travis-pilot-20261020`, and gets a locally computed CIDv1. It is never uploaded. The README says these are real content addresses of unpublished pilot files, and A-03 replaces them with published ones.
- Q: How is a ZIP code area or a Census place judged to be "in Travis County"? → A: By the Census county relationship files for ZCTAs and for places. Any area with land in Travis is included; one that also has land in another county gets `partial_in_travis`. *Answered from the story's straddling-place edge case and FR-004 (public Census data only).*
- Q: What are the tenure and out-of-area rules? → A: Long tenure means `as_of − last_sale_date > 10 years`; with no deed date, `tenure_basis = unknown`. An owner is out of area when the mailing ZIP is not on the Travis ZIP list; `owner_area_class` also separates the configurable regional (neighbouring-county) list. *Answered from `reference/A-oracle.md` § 5.*
- Q: Which permits get `open_days`? → A: `open_days = as_of − issue_date` for `open` and `stalled` permits that have no `final_date` (ERR-70, 2026-10-25: a permit with a plausible `final_date` is finished, and an Expired status after completion is an administrative lapse, so it gets no interval). For any other class, and for a finished permit, it is empty, with the reason `not_open`; a `final_date` before `issue_date` or after `as_of` is a data-quality gap: empty with the reason `needs_review`. `as_of` is the run's finish time, never "now". *Answered from § 5 and ARD § 5.*

## User Scenarios & Testing *(mandatory)*

The main user is the **Roofing CRM developer** (Task B). They need exact column names and meanings, and real rows to build against, before the full county is published. The other consumers are the explorer UI (A-13), the agent (A-14) and the MCP server (A-15), which must all read the same data model.

### User Story 1 - Know which fields can be published at all (Priority: P1)

Before any name is frozen, every needed field gets a verdict: either the exact lexicon class and property that carries it, shown in a real pilot export, or "no carrier" with the fallback and a drafted extension request.

**Why this priority**: Only published-tool output is public (constitution A2). A field with no lexicon carrier cannot be published, so demo lines D-9 and D-11 depend on this answer. Every other part of the contract builds on it.

**Independent Test**: Open `docs/decisions/0002-lexicon-carriers.md` and check that each of the nine fields listed in FR-001 has a verdict. Each "carrier" verdict cites a pilot row, and each "no carrier" verdict names its fallback and a drafted request.

**Acceptance Scenarios**:

1. **Given** the PO has loaded the lexicon references and a local pilot run has produced a real table-export summary, **When** each needed field is checked, **Then** the carrier record holds exactly one verdict per field, each with its evidence.
2. **Given** a field whose carrier exists in the lexicon but does not appear in the pilot export, **When** it is checked, **Then** its verdict is "no carrier (not emitted by the export)".

---

### User Story 2 - Build against four frozen views (Priority: P1)

The CRM developer, UI, agent and MCP query four views (property, roofing permit, contractor, run) whose column names come from the lexicon and are frozen against the pilot export.

**Why this priority**: This is the contract itself (evaluation point A5, demo D-4, D-12).

**Independent Test**: Run the view tests over the pilot tables. All four views compile and expose exactly the frozen column list.

**Acceptance Scenarios**:

1. **Given** the carrier verdicts and the pilot export, **When** the views are bound to it, **Then** all four compile and expose exactly the names in FR-002.
2. **Given** a field with no carrier, or a property with no deed date, **When** a view row is read, **Then** the row shows a reason, never a blank.

---

### User Story 3 - Trust the roofing and status classification (Priority: P1)

Reroof permits and their open, stalled or closed state are decided by a versioned Travis/Austin profile, never by query text, and the profile is accurate on a reviewed sample.

**Why this priority**: The lead signals (open and stalled reroofs) are only as good as the classifier. Searching "ROOF" alone pulls in about 10k rooftop-solar permits.

**Independent Test**: Draw a random sample of 25 permits that mention ROOF (seed recorded). The PO marks each verdict right or wrong. Run the full-dataset count and compare it with the live match count.

**Acceptance Scenarios**:

1. **Given** the profile, **When** the PO reviews 25 sampled permits, **Then** at least 24 are right, at most 1 is `needs_review`, and no solar, PV or RTU permit is accepted.
2. **Given** an Expired reroof, **When** it is classified, **Then** it is `stalled` and is never relabelled Completed or Cancelled. Its published status is empty (no lexicon carrier for "Expired", PO decision D-4a), and the source word stays readable at the row's `source_url`.

---

### User Story 4 - Look up any Travis place by name or ZIP (Priority: P2)

One shared place list returns the Census internal point of every Travis County place and ZIP code area, with its source. Anything outside the county returns `out_of_scope`.

**Why this priority**: The UI area search, the agent's place lookup and the MCP `area` argument all need it, but none of them is built in this story.

**Independent Test**: Look up Pflugerville, Manor, Lakeway, ZIP 78753 and ZIP 99999, and check the points, the source stamps and the `out_of_scope` answer.

**Acceptance Scenarios**:

1. **Given** the gazetteer, **When** "Pflugerville" is looked up, **Then** it returns GEOID 4857176 at 30.447765, −97.602116, with the source file URL, file date and SHA-256.
2. **Given** "ZIP 99999", **When** it is looked up, **Then** the answer is `out_of_scope` and no point.

---

### User Story 5 - Start building the CRM from 20 real rows (Priority: P2)

Task B gets 20 real rows cut from the pilot export, with full provenance and a README that documents every column and every gap.

**Why this priority**: It unblocks Task B on day 2. It depends on stories 1 to 3.

**Independent Test**: `duckdb -c "SELECT count(*) FROM 'contract/v1/sample.parquet'"` prints 20, and every provenance column is non-null.

**Acceptance Scenarios**:

1. **Given** the sample file, **When** Task B reads it, **Then** it holds 20 rows, at least one stalled reroof and at least one property with a roof age, and every provenance field is filled.

---

### Edge Cases

- The live lexicon tools are down when the check runs: the check waits, or uses the schema bundled with the installed publishing tool plus a real pilot export. It never freezes a name from memory.
- A carrier exists but the export does not emit it as a column: treated as "no carrier" for the views until the export includes it.
- A status word appears that is not in the map (new Austin vocabulary): it becomes `needs_review`, never a guess, and the profile version goes up when the word is mapped.
- A Census place straddles the county line (Round Rock, Cedar Park, Leander): it is kept with a `partial_in_travis` flag, and results stay limited to Travis County.
- An Auxiliary Power permit whose description contains "ROOF" is never roofing.
- `validate` reports errors in the pilot: the transform is fixed until validation is clean. Validation is never skipped.
- Austin or Census answers 403 or times out: the step stops and is recorded as blocked, with no retry under another identity.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** *(AC-1; story FR-001)*: System MUST record, in `docs/decisions/0002-lexicon-carriers.md`, a carrier verdict for each needed field before any name is frozen into a view. The nine fields are: printed contractor name, `status_raw`, `expiry_date`, BBB rating, BBB profile URL, per-permit contractor state (`candidate` / `ambiguous` / `conflicting`), `roof_age_basis`, `roof_age_confidence` and owner sale date. A "carrier" verdict names the exact lexicon class.property **and** a pilot row where it appears in the export. A "no carrier" verdict names the fallback and holds a drafted lexicon extension request (filing it is a PO decision; not filed by default). The fallbacks are: AD-24 for contractor state (`resolved` / `unresolved` per row plus five-state totals in the manifest), and AD-25 for the rest (field not published, reason shown).
- **FR-002** *(AC-2; story FR-002)*: System MUST define four views, `v_property`, `v_roofing_permit`, `v_contractor` and `v_run`, over the published-table export of the pilot run only. They must compile and expose exactly the AD-07 names for every field that has a carrier, including `roof_age_years`, `roof_age_basis` ∈ {`permit`, `new_construction`, `built_year`, `unknown`}, `tenure_years` + `tenure_basis`, `owner_is_out_of_area` + `owner_area_class`, `coordinate_source`, `issue_date`, `final_date`, `open_days`, `contractor_company_cid` and `bbb_status` ∈ {`rated`, `not_found`, `blocked`, `not_checked`}. The frozen column list is recorded; any later rename, retype or change of meaning needs a `contract/v2`. Derived columns follow the clarified rules: `open_days = as_of − issue_date` for `open` and `stalled` permits with no `final_date` only (otherwise empty with reason `not_open`; an implausible `final_date` gives `needs_review`, ERR-70); `v_roofing_permit.request_identifier` is the permit record's stable key; long tenure means `tenure_years > 10`, and with no deed date `tenure_basis = unknown`; `owner_is_out_of_area` is true when the mailing ZIP is not on the Travis ZIP list, and `owner_area_class` also separates the regional list. `as_of` is always the run's finish time.
- **FR-003** *(AC-3; story FR-003, NFR-001)*: System MUST classify roofing permits only through the versioned profile `travis-austin@{semver}`. The include terms are REROOF, RE-ROOF and ROOF REPLACE. The excludes are solar/PV, Auxiliary Power, RTU, roof deck and "roof-mounted". On a random sample of 25 permits (seed recorded) drawn from the Austin permits whose description or work class mentions ROOF, the PO marks at least 24 right, at most 1 (≤ 5%) is `needs_review`, and 0 solar/PV/RTU permits are accepted as roofing.
- **FR-004** *(AC-4; story FR-003)*: System MUST map the raw permit status through the profile's status map (AD-08). Active, Pending, Pending Permit, On Hold, Suspended, Inactive Pending Revision and Re Review map to `open`. Expired and Expired - License map to `stalled`. Final and Closed map to `closed`. VOID, Withdrawn, any Cancelled\* word, Aborted, Denied but Closed, Revoked and Rejected map to `exclude`. Any other word maps to `needs_review`. Where `status_raw` has a carrier, the source word is kept unchanged; an Expired permit is never relabelled Completed or Cancelled.
- **FR-005** *(AC-5; story FR-003)*: System MUST, when the profile is applied to the full Austin permit dataset (2,380,725 rows on 2026-10-19), produce a reroof candidate count equal to the live include-term match count minus the excluded rows, both measured in the same run. "Excluded rows" are the exclude-term matches, the trade sub-permits (non-BP, PO decision D-4b) and the `needs_review` rows, each counted separately and recorded in the profile with their date (baseline: 22,084 description matches on 2026-10-19). No Auxiliary Power row may be a candidate, and the profile's SHA-256 is stamped on every classification (AD-26).
- **FR-006** *(AC-6; story FR-004)*: System MUST provide one versioned place gazetteer, `travis-places@{semver}`, built from the public US Census 2024 Gazetteer place and ZCTA files and filtered to Travis County. Every lookup of a Travis place or ZIP (for example "Pflugerville", "Manor", "Lakeway", "78753") returns the Census internal point with the source file URL, file date and SHA-256. For example, Pflugerville city is GEOID 4857176 at 30.447765, −97.602116. A ZIP or place outside Travis County (for example "99999") returns `out_of_scope` and never a guessed point. An area counts as in Travis County when the Census county relationship file for ZCTAs or for places shows land in Travis; one that also has land in another county carries `partial_in_travis`. The gazetteer is versioned code in git, not a published artifact.
- **FR-007** *(AC-7; story FR-005)*: System MUST show a reason instead of a blank in a view row for every field whose verdict is "no carrier" and for every missing value. Examples: `bbb_status = not_checked` with reason `no_lexicon_carrier`; contractor "not published · no lexicon carrier"; `tenure_basis = unknown` when there is no deed date, never "long tenure".
- **FR-008** *(AC-8; story FR-006)*: System MUST commit `contract/v1/sample.parquet` and `contract/v1/README.md`. The file holds 20 real rows cut from the pilot export; each row is one roofing permit from `v_roofing_permit` with its property's `v_property` columns. Every row has non-null provenance (`source_url`, `captured_at`, `table`, `table_cid`, `run_id`, `manifest_cid`). The rows include at least one stalled reroof and at least one property with a roof age. The README documents every column and every "no carrier" gap. The rows are kept in git only: never published as their own artifact, and never shown on the hosted site.
- **FR-009** *(story FR-003)*: System MUST keep classification text out of the views. No `LIKE '%ROOF%'` or similar pattern may appear in the view definitions. An automated test enforces this in A-02, and the CI grep gate takes over from A-03.
- **FR-010** *(story Description)*: System MUST provide shared schemas for `RunManifestV1`, `RunsIndexV1`, `Provenance` and the four view row types, used by every consumer (UI, agent, MCP, Task B).
- **FR-011** *(AC-1, AC-2 precondition)*: System MUST produce the pilot export locally by running the publishing tool's steps validate → hash with CAR output → validate the CAR → export tables, once per data group (`county`, `property_improvement`), with no upload. Each step's command, root CID and export-summary SHA-256 are recorded. The pilot also gets a local pilot manifest that follows `RunManifestV1`. It is built only from the CLI outputs and capture receipts, has run ID `travis-pilot-20261020` and a locally computed CIDv1, and is never uploaded. The sample rows' `run_id` and `manifest_cid` come from it, and the README says these are unpublished pilot addresses that A-03 replaces.

### Non-functional requirements

- **NFR-001** *(story NFR-001)*: Classifier accuracy ≥ 24/25 per profile version, ≤ 5% `needs_review`, 0 solar/PV/RTU accepted (verified by FR-003).
- **NFR-002** *(story NFR-002, feature-list NFR-09)*: ≥ 80% unit-test coverage on the query layer and the contract packages.

### Key Entities

- **Carrier verdict**: one per needed field, either a lexicon class.property with a pilot row reference, or "no carrier" with a fallback and a drafted extension request.
- **Property view row** (`v_property`): one per TCAD property. It holds the identifier as printed, the address, location and its source, year built, roof age with basis and confidence, tenure with basis, owner mailing area class, and provenance.
- **Roofing permit view row** (`v_roofing_permit`): one per reroof permit. It holds the permit number, jurisdiction, raw and classified status, issue, final and expiry dates, open days, work class, description, contractor resolution (`resolved` / `unresolved`), contractor company CID (only when resolved), BBB status, and provenance.
- **Contractor view row** (`v_contractor`): one per company. It holds the identity source, BBB status, permit count and roofing permit count.
- **Run view row** (`v_run`): one per pipeline run. It holds the run ID, start and end times, sources, counts, deltas, limitations, the manifest CID and the previous manifest CID.
- **Provenance**: `source_url`, `captured_at`, `table`, `table_cid`, `run_id`, `manifest_cid`, plus an optional missing-field reason.
- **Roofing and status profile** (`travis-austin@semver`): include and exclude terms, the status map, the recorded expectation counts with dates, and a SHA-256.
- **Place gazetteer entry** (`travis-places@semver`): name or ZIP, GEOID, kind (place or ZCTA), internal point, `partial_in_travis` flag, source URL, file date and SHA-256.
- **Pilot export**: the local, unpublished output of the four publishing steps per data group (CAR root CID, table-export summary, table files).
- **Pilot manifest**: a local `RunManifestV1` for run `travis-pilot-20261020`, built from the pilot export only, with a locally computed CIDv1. Never uploaded.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 9 of 9 needed fields have a verdict with evidence in the carrier record.
- **SC-002**: The view tests pass over the pilot tables, and each of the four views exposes exactly its frozen column list.
- **SC-003**: The PO marks at least 24 of 25 sampled classifications right, at most 1 is `needs_review`, and 0 solar/PV/RTU permits are accepted.
- **SC-004**: The full-dataset reroof candidate count equals the live match count minus excludes, with 0 Auxiliary Power candidates.
- **SC-005**: 4 of 4 named Travis lookups return the expected Census point with source stamps, and 1 of 1 out-of-county lookup returns `out_of_scope`.
- **SC-006**: The sample file holds exactly 20 rows with 0 null provenance values, at least 1 stalled reroof and at least 1 property with a roof age.
- **SC-007**: 0 blank values for missing or uncarried fields in view rows (every one has a reason).
- **SC-008**: Unit-test coverage is ≥ 80% on the query layer and the contract.

## Assumptions

- The public data comes only from the mandated publishing tool (`elephant-cli`, constitution A2); the views shape its exported tables at query time. Its version is pinned to the GitHub `main` build at commit 44bb182, because the packaged release lacks the table-export command.
- The pilot slice (which permits and parcels) is chosen at walkthrough stop D-3. It stays local, is never uploaded, and is gitignored, with only digests recorded.
- Roof age in the views is derived from public fields using mew's rules (AD-25): replacement permit → `permit`/high, new construction → `new_construction`/medium, built year → `built_year`/low, else `unknown`/none. The kit estimator stays the authority for published roof dates; `as_of` is the run's finish time, never "now".
- There is no hosted runtime until A-03. Tests run from the repository root on this branch (G4 C-04 exception). The views are shown live later by A-13 (SQL panel) and A-15 (MCP `get_schema`).
- Lexicon extension requests are drafted, not filed (PO decision D-1, 2026-10-20; revisited at D-8).
- The "regional" county list and the Travis ZIP list behind `owner_area_class` are versioned code in git, digested like the profile (AD-26).
- Out of scope: publishing the sample or gazetteer, showing sample rows on the hosted site, and full-county data (A-04 to A-10).
