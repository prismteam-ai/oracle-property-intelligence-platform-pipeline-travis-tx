---
id: A-10
type: user-story
title: Reconcile duplicates and derive roof age with lineage
parent: FEAT-A10
vision: VIS-A
ard: ARD-A
eval_point: A2
priority: P1
moscow: Must
branch: 010-reconcile-roof-age
spec: specs/010-reconcile-roof-age/
depends_on: [A-04, A-05, A-06, A-07]
size_days: 1
agents:
  design: [oracle]
  builder: oracle
  reviewers: [oracle, donphan, porygon]
  verify: "worked example with lineage"
skills: [query-db-loading-matching, use-oracle, unify-metrics, apply-engineering-guidelines]
ui: false
status: Merged
merged_into: A-07
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---
> **Merged into [A-07](../A-07-enrich-reconcile.md) on 2026-10-21.** This file is kept for reference only; do not run it as a story. Its ACs now live in A-07 as tagged "(was A-10 AC-n)".


# A-10 Reconcile duplicates and derive roof age with lineage

| Field | Value |
| --- | --- |
| Evaluation point | A2 (primary) · A5 |
| Demo line(s) | D-8 (roof older than 15 years, with roof-age basis), D-3 (duplicates merged statistic on Coverage) |
| Agents | design `oracle` · builder `oracle` · reviewers `oracle`, `donphan`, `porygon` · verify worked example with lineage (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-04, A-05, A-06, A-07 |
| Size | 1 day |
| Branch | `010-reconcile-roof-age`, merged into `feature/oracle-pipeline` |

## Context

"Roof older than 15 years" is the README's headline query (AC-11, D-8), and "reconcile duplicate entities" plus provenance is evaluation point A2. A **roofing sales rep** needs to know *why* a roof counts as old and how sure that is; the **evaluator** wants a duplicates-merged statistic and one worked example with full lineage.

Real anchors (Austin, live 2026-10-19): TCAD id `0208011301` carries reroof permit **1982-012866 BP**, `Suspended` (open) since 1982-06-23; TCAD id `0223120506` carries **2000-000025 BP**, `Re Review` since 2000-01-05. 17,251 reroof candidates are `Final` and can anchor roof age.

## Description

As a **roofing sales rep (through the CRM)**, I want **one canonical record per property, owner and contractor, and a roof age with its basis and confidence**, so that **I can trust why a property shows up as an aged-roof lead and see where every fact came from**.

When done: `query-db-loading-matching` reconciles with the TCAD id as key, a single writer, tombstones and path+hash watermarks. The kit roof-age estimator runs with the versioned Travis profile: audit dry-run (limit 25) → review → apply → re-run proving `rowsWritten: 0`. Roof age and basis come only from the estimator (P0-8); views compute `roof_age_years` from the published roof date and `as_of_date` (= run `finishedAt`).

**Independent test:** the 25-property audit agrees with the view derivation 25/25 (AD-25), the re-run writes 0 rows, and the worked example traces one property's roof age to its source records.

## Acceptance Criteria

1. **AC-1** · **Given** TCAD id `0208011301` with open replacement permit 1982-012866 BP (`Suspended`), **When** roof age is estimated, **Then** the open permit does **not** reset roof age (P0-8); the anchor is the latest *final* replacement permit or, failing that, the built year, with `roof_age_basis` and `roof_age_confidence` recorded, and the worked example in evidence shows every source record, URL, capture time and digest behind it. ☐ testable
2. **AC-2** · **Given** a property whose latest roofing permit is `Final`, **When** roof age is estimated, **Then** `roof_age_basis = permit`, `roof_age_confidence = high`, and `roof_age_years` = run `as_of` − the permit's final date; new construction gives `new_construction`/medium; built year only gives `built_year`/low (mew § 2.4). ☐ testable
3. **AC-3** (scale) · **Given** the full roll from A-04, **When** the estimator is applied, **Then** roof-age coverage is reported by basis and confidence over all N properties (counts and %), the 25-property audit matches the view derivation 25/25, and a second run writes `rowsWritten: 0`. ☐ testable
4. **AC-4** · **Given** owners and contractors from TCAD, permits and the Comptroller, **When** reconciliation merges duplicates, **Then** the manifest `coverage` carries `merge {entityType, inputRecords, canonical}` per entity type with `derivation = aggregate_match` (AD-28), and contractor clusters are merged only where identity is `resolved` (AD-05). ☐ testable
5. **AC-5** (missing data) · **Given** a property with no roofing permit and no year built, **When** roof age is estimated, **Then** `roof_age_basis = unknown`, `roof_age_confidence = none`, `roof_age_years` is null, the property is excluded from "roof > 15" results but counted in the coverage gap, and no date is invented. ☐ testable

## Edge cases (at least two)

- Two final reroof permits on the same property → the latest final date wins; the earlier one stays in lineage.
- A reroof permit `Expired` with no final (stalled) → not an anchor; it is a lead signal only.
- Year built in the future or before 1850 → flagged invalid, basis `unknown`, reason recorded.
- A merge would join two TCAD ids → never; the TCAD id is the key (P0-5).

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST derive roof age only from the kit estimator with the Travis profile | AC-1, AC-2 |
| FR-002 | System MUST never reset roof age on an open replacement permit | AC-1 |
| FR-003 | System MUST report roof-age coverage by basis and confidence and prove idempotency | AC-3 |
| FR-004 | System MUST publish merge counts as aggregates with derivation labels | AC-4 |
| FR-005 | System MUST mark unknown roof age with a reason | AC-5 |
| NFR-001 | Audit 25/25 agreement; re-run `rowsWritten: 0` | AC-3 |

## Prototype reference

Not a UI story. Basis and confidence columns appear on `design/prototype/ExploreQ-roof15.dc.html`; "Merged from" on `design/prototype/PropertyDetail.dc.html` (through A-13).

## Demo Script

1. Presenter: "Using the UI, show properties within a sample radius that have roofs older than 15 years." → Expected: each result shows its roof-age basis and confidence derived here.

## Out of scope

- Physical roof inspection (roof age is evidence-based; caveat shown).
- Publishing lineage files (lineage stays internal; only aggregates are published, AD-04).

## Evidence to capture

- `docs/evidence/A-10.md`: dedup statistics per entity type, roof-age coverage by basis and confidence, the 25-property audit, the `rowsWritten: 0` re-run, the worked example for `0208011301`.
- `testplans/A-10-test-cases.md` results, `docs/reviews/CR-A-10.md`.

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
