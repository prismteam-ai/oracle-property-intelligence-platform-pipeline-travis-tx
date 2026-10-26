---
id: A-02
type: user-story
title: Freeze the property-intelligence data contract
parent: FEAT-A02
vision: VIS-A
ard: ARD-A
eval_point: A5
priority: P1
moscow: Must
branch: 002-data-contract
spec: specs/002-data-contract/
depends_on: [A-01]
size_days: 1
agents:
  design: [mew, oracle]
  builder: oracle
  reviewers: [oracle, donphan]
  verify: "Vitest on views; `contract/v1/sample.parquet` readable"
skills: [use-oracle, use-neutral-lexicon, apply-engineering-guidelines]
ui: false
status: Done
gate: G7
qc_testability_signoff: true
created: 2026-10-19
---

# A-02 Freeze the property-intelligence data contract

| Field | Value |
| --- | --- |
| Evaluation point | A5 (primary) · A6 |
| Demo line(s) | D-4 (DuckDB query layer), D-9 and D-11 (contractor, status and BBB fields exist or say why not), D-12 (MCP "without changing the data model") |
| Agents | design `mew`, `oracle` · builder `oracle` · reviewers `oracle`, `donphan` · verify Vitest on views; `contract/v1/sample.parquet` readable (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-01 |
| Size | 1 day |
| Branch | `002-data-contract`, merged into `feature/oracle-pipeline` |

## Context

The UI, the agent, the MCP server and the Roofing CRM (Task B) must all read the same data model, or "MCP-ready without changing the data model" (D-12) cannot be true. The **CRM developer** needs exact column names and meanings plus real rows to build against on day 2, before the full county lands. Names come from the lexicon (`mew` owns them, AD-07); classification rules live in versioned profiles, never in the views (ARD § 5).

**The first risk to settle (mew R1/R2, both high, open since 2026-10-19).** Only `elephant-cli` output is public (A2), so a field is publishable only if the lexicon has a class or property for it (AD-25). Mew could not confirm carriers for the **printed contractor name**, **`status_raw`**, **`expiry_date`**, **BBB** or the per-permit contractor state, and the live lexicon tools were still failing on 2026-10-19. If these carriers are missing, demo lines D-9 and D-11 cannot show "who is the listed contractor" or "source says Expired" from published data. This story settles it first, before any name is frozen.

Real classification facts (Austin `3syk-w9eu`, live query 2026-10-19): **22,084** rows have `REROOF`, `RE-ROOF` or `ROOF REPLACE` in the description, while `work_class = 'Roof'` matches only 52; searching `ROOF` alone pulls in about 10k `Auxiliary Power` (rooftop solar) permits. Status split of the 22,084: Final 17,251 · VOID 2,400 · Expired 2,213 · Active 125 · Withdrawn 87 · Cancelled 4 · Suspended 2 · Re Review 1 · Pending Permit 1.

## Description

As a **Roofing CRM developer**, I want **four frozen DuckDB views with exact lexicon names, a versioned roofing and status profile, a shared place gazetteer, and 20 real sample rows**, so that **I can build the CRM against a contract that will not change under me**.

When done:
- **Lexicon carrier record** `docs/decisions/0002-lexicon-carriers.md`: for each needed field, the lexicon class and property that carries it (from the live schema and a real `tables-export.json`), or "no carrier" with a drafted extension request and the UI fallback (filing it is a PO decision; not filed by default).
- `packages/query-core/views.sql` defines `v_property`, `v_roofing_permit`, `v_contractor` and `v_run` over the `elephant-cli export-tables` output, with mew's AD-07 names frozen against that `tables-export.json`.
- `packages/contract` holds the Zod schemas (`RunManifestV1`, `RunsIndexV1`, `Provenance`, view rows).
- The Travis/Austin profile (`profiles/travis-austin@semver`) holds the reroof include/exclude list and the status map.
- **Place gazetteer** `packages/query-core/gazetteer/travis-places@semver`: every Census place and ZIP (ZCTA) in Travis County with its internal point, built from the public US Census 2024 Gazetteer files, with source URL, file date and SHA-256 stamped on every lookup (AD-26 pattern: versioned code in git, not an IPFS artifact). The UI area search (A-13), the agent's `geocodePlace` (A-14) and the MCP `area` argument (A-15) all use it.
- `contract/v1/README.md` and `contract/v1/sample.parquet` (20 real rows) committed for Task B.

**Overrides applied (ARD § 15, AD-30):** the PO runs `/soofi-xyz-team-kit:use-neutral-lexicon` during this story because mew cannot start it (mew R4); the 20 sample rows are **cut from the elephant-cli tables of the pilot run**, committed in git only, never published as a separate IPFS artifact and never shown on the hosted site (A2, P0-12).

**Independent test:** `docs/decisions/0002-lexicon-carriers.md` has a verdict for every field; `pnpm vitest packages/query-core` passes over the pilot tables; `duckdb -c "SELECT count(*) FROM 'contract/v1/sample.parquet'"` returns 20.

## Acceptance Criteria

1. **AC-1** (lexicon carrier check) · **Given** the PO has run `use-neutral-lexicon` and a pilot run has produced a real `tables-export.json`, **When** mew and oracle check each needed field — printed contractor name, `status_raw`, `expiry_date`, BBB rating and profile URL, per-permit contractor state (`candidate` / `ambiguous` / `conflicting`), `roof_age_basis`, `roof_age_confidence`, owner sale date — **Then** `0002-lexicon-carriers.md` records for each one either the exact class.property that carries it **and** a pilot row where it appears in the export, or "no carrier" with a lexicon extension request drafted in `0002-lexicon-carriers.md` (filing it is a PO decision; not filed by default) and the fallback named (AD-24: `resolved`/`unresolved` plus five-state totals; AD-25: field not published and the UI shows the reason). No field is frozen into a view before it has a verdict. ☑ testable
2. **AC-2** · **Given** the carrier verdicts and the real `tables-export.json`, **When** `views.sql` is bound to it, **Then** all four views compile in DuckDB and expose exactly the AD-07 names for every field that has a carrier, including `roof_age_years`, `roof_age_basis` ∈ {`permit`, `new_construction`, `built_year`, `unknown`}, `tenure_years` + `tenure_basis`, `owner_is_out_of_area` + `owner_area_class`, `coordinate_source`, `issue_date`, `final_date`, `open_days`, `contractor_company_cid` and `bbb_status` ∈ {`rated`, `not_found`, `blocked`, `not_checked`}. ☑ testable
3. **AC-3** · **Given** the profile `travis-austin@{version}` with include terms REROOF, RE-ROOF, ROOF REPLACE and excludes for solar/PV, Auxiliary Power, RTU, roof deck and "roof-mounted", **When** a random sample of 25 permits (seed recorded), drawn from the Austin permits whose description or work class mentions ROOF so that the excludes are exercised, is shown with the profile's verdict and the PO marks each one right or wrong, **Then** at least 24 of 25 are right, at most 1 of 25 (≤ 5%) is `needs_review`, and 0 solar/PV/RTU permits are accepted as roofing. ☑ testable
4. **AC-4** · **Given** the status map (AD-08), **When** the 22,084 reroof candidates are classified, **Then** Active, Pending, Pending Permit, On Hold, Suspended, Inactive Pending Revision and Re Review are `open`; Expired and Expired - License are `stalled`; Final and Closed are `closed`; VOID, Withdrawn, Cancelled\*, Aborted, Denied but Closed, Revoked and Rejected are `exclude`; and where `status_raw` has a carrier it keeps the source word (an Expired permit is never relabelled Completed or Cancelled). ☑ testable
5. **AC-5** (scale) · **Given** the profile applied to the full Austin dataset (2,380,725 rows on 2026-10-19), **When** the roofing classification runs, **Then** the reroof candidate count equals the live include-term match count minus the excluded rows, both measured in the same run and recorded in the profile with their date (baseline: 22,084 description matches on 2026-10-19), the ~10k Auxiliary Power rows are all excluded, and the profile's SHA-256 is stamped on every classification (AD-26). ☑ testable
6. **AC-6** · **Given** the place gazetteer, **When** "Pflugerville", "Manor", "Lakeway" or ZIP "78753" is looked up, **Then** it returns the Census internal point (for example Pflugerville city, GEOID 4857176, 30.447765, −97.602116) with the source file URL, file date and SHA-256; **Given** "ZIP 99999" or a place outside Travis County, **Then** it returns `out_of_scope`, never a guessed point. ☑ testable
7. **AC-7** (missing data) · **Given** a field whose AC-1 verdict is "no carrier", or a property with no deed date, **When** the view row is read, **Then** the row shows the reason instead of a blank (for example `bbb_status = not_checked` with reason `no_lexicon_carrier`, contractor "not published · no lexicon carrier", `tenure_basis = unknown`, never "long tenure"). ☑ testable
8. **AC-8** · **Given** the 20 sample rows, **When** Task B reads `contract/v1/sample.parquet` (each row is one roofing permit from `v_roofing_permit` with its property's `v_property` columns), **Then** every row has non-null provenance (`source_url`, `captured_at`, `table`, `table_cid`, `run_id`, `manifest_cid`), the rows include at least one stalled reroof and one property with roof age, and the README documents every column and every "no carrier" gap. ☑ testable

## Edge cases (at least two)

- The live lexicon tools are still down when the check runs → the check waits or uses the schema bundled with the installed `elephant-cli` and a real pilot export; it never freezes names from memory.
- A carrier exists but `export-tables` does not emit it as a column → treated as "no carrier" for the views until the export includes it.
- A status word not in the map appears (new Austin vocabulary) → `needs_review`, never guessed; the profile version is bumped when it is mapped.
- A Census place straddles the county line (Round Rock, Cedar Park, Leander) → kept with a `partial_in_travis` flag; results are still limited to Travis County.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST record a carrier verdict for every needed field before freezing names | AC-1 |
| FR-002 | System MUST define the four views over elephant-cli tables only, with AD-07 names | AC-2 |
| FR-003 | System MUST keep roofing and status classification in a versioned profile, not in SQL (no `LIKE '%ROOF%'` in views; enforced by a Vitest test in A-02 and by the CI grep gate from A-03) | AC-3, AC-4, AC-5 |
| FR-004 | System MUST provide one versioned place gazetteer from public Census data, used by UI, agent and MCP | AC-6 |
| FR-005 | System MUST show a missing reason for every field without a value or carrier | AC-7 |
| FR-006 | System MUST commit 20 real rows cut from pilot elephant-cli tables, git only | AC-8 |
| NFR-001 | Classifier accuracy ≥ 24/25 per profile version, ≤ 5% `needs_review`, 0 solar/PV/RTU accepted | AC-3 |
| NFR-002 | ≥ 80% unit-test coverage on `query-core` and `contract` (NFR-09) | AC-2, AC-6 |

## Prototype reference

Not a UI story. The column names appear on the SQL board (`design/prototype/ExploreQ-sql.dc.html`), the area search on `design/prototype/SearchBox.dc.html`, and the MCP schemas on `design/prototype/HelpMcp1440.dc.html`.

## Demo Script

1. Presenter: "Now I am opening the DuckDB-backed query layer." → Expected: the SQL panel (A-13) queries these views by their frozen names.
2. Presenter: "Finally, I will show that the system is MCP-ready." → Expected: the MCP tools (A-15) return the same view columns.

## Out of scope

- Publishing the sample rows or the gazetteer to IPFS, or showing sample rows on the hosted site (ARD § 15).
- Full-county data (A-04 to A-10).

## Evidence to capture

- `docs/evidence/A-02.md`: the carrier verdict table, extension requests drafted (and filed, if the PO decides so), `tables-export.json` digest, the frozen column list, the 25-permit classifier review, gazetteer source and digest.
- `testplans/A-02-test-cases.md` results, `docs/reviews/CR-A-02.md`.

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
| G4-7 | Prototype screen linked (UI stories) | ☑ |
| G4-8 | Dependencies done, or stubbed with **real** sample data | ☑ |
| G4-9 | No `[NEEDS CLARIFICATION]` left | ☑ |
| G4-10 | AI pre-check (`developmentsupport-g4-precheck`): PASS | ☑ |

**Decision:** ☑ Ready ☐ Returned · HebaGaber · 2026-10-20 (AI pre-check run 2 PASS; C-04 and C-10/G4-8 exceptions accepted by the PO; see [G4 report](../docs/gates/G4-A-02-precheck.md))
