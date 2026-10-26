---
id: A-04
type: user-story
title: Ingest the TCAD property and owner backbone for the full county
parent: FEAT-A04
vision: VIS-A
ard: ARD-A
eval_point: A1
priority: P1
moscow: Must
branch: 004-tcad-backbone
spec: specs/004-tcad-backbone/
depends_on: [A-01, A-03]
size_days: 1
agents:
  design: [oracle]
  builder: oracle
  reviewers: [oracle, donphan]
  verify: "`monitoring-county-ingestion`; roll count matches"
skills: [county-seed-data, county-appraisal-onboarding, build-county-transform, county-ingest-run, apply-engineering-guidelines]
ui: false
status: Merged
merged_into: A-04
merged_on: 2026-10-21
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---

# A-04 Ingest the TCAD property and owner backbone for the full county

> Merged into **A-04** on 2026-10-21 ([../A-04-property-backbone.md](../A-04-property-backbone.md)). Kept for history; the ACs live there now.

| Field | Value |
| --- | --- |
| Evaluation point | A1 (primary) · A2 |
| Demo line(s) | D-3 (property and ownership records by source), D-8 (properties behind the radius search) |
| Agents | design `oracle` · builder `oracle` · reviewers `oracle`, `donphan` · verify `monitoring-county-ingestion`; roll count matches (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-01, A-03 |
| Size | 1 day |
| Branch | `004-tcad-backbone`, merged into `feature/oracle-pipeline` |

## Context

Every lead starts from a property. The **roofing sales rep** (through the CRM) needs every Travis County parcel with its owner, mailing address, situs address and year built, and the **evaluator** checks that the published property count matches the appraisal district's own certified roll. Owner tenure (AC-39) and out-of-area owners (AC-40) also depend on this backbone.

The denominator is the TCAD 2026 certified roll account count that A-01 records in `pipeline/docs/travis-sources.yaml` (not yet measured: TCAD returned 403 on 2026-10-17 and 2026-10-19). Real anchor parcels from the Austin permit data: TCAD id `0208011301` (permit 1982-012866 BP) and `0223120506` (permit 2000-000025 BP).

## Description

As a **Roofing CRM developer**, I want **every property on the TCAD certified roll loaded with owner, mailing address, situs address, year built, improvements and, if present, the last sale or deed date**, so that **every lead search covers the whole county and owner-based filters work**.

When done: `county-seed-data`, `county-appraisal-onboarding` and `build-county-transform` run on the TCAD certified special export (JSON, or the fixed-width layout if A-01 chose it), first as a 25-parcel pilot and then for the full county, through `county-ingest-run` on the local stack. The property key is the TCAD identifier exactly as printed (P0-5). Confidentiality flags (Texas Tax Code §25.025) are applied before `validate`.

**Independent test:** `monitoring-county-ingestion` reports the run complete, and the Query DB property count equals the certified roll count, or each difference is classified.

## Acceptance Criteria

1. **AC-1** · **Given** a 25-parcel pilot including TCAD ids `0208011301` and `0223120506`, **When** the transform runs, **Then** each pilot property has owner name, mailing address, situs address, year built (or a missing reason), the source URL, capture time and payload digest, and the transform coverage report shows every mapped field. ☐ testable
2. **AC-2** (scale) · **Given** the full TCAD certified roll (account count N recorded by A-01), **When** the full-county ingest completes, **Then** the loaded count equals N minus proven dead/invalid minus confidential records, the total difference is under 2% of N, and every differing account is classified (dead, invalid, confidential, transform failure) with 0 unexplained. ☐ testable
3. **AC-3** · **Given** owners whose mailing ZIP is outside the versioned Travis ZIP list, **When** the property is transformed, **Then** `owner_is_out_of_area = true` and `owner_area_class` is `regional` (a neighbouring county on the versioned regional list) or `out_of_area`, and the list's SHA-256 is stamped on the classification (AD-26). ☐ testable
4. **AC-4** (missing data) · **Given** a property with no deed or sale date in the export, **When** its tenure is derived, **Then** `tenure_basis = unknown` and the property is never counted as tenure > 10 years; **Given** a property with no year built, **Then** its roof-age basis stays `unknown` with that reason. ☐ testable
5. **AC-5** · **Given** records flagged confidential under §25.025, **When** the run prepares data for `validate`, **Then** owner fields are redacted before validation, the redacted count goes into the manifest limitations, and no confidential owner name reaches the Query DB export path. ☐ testable
6. **AC-6** (error) · **Given** TCAD downloads are still blocked (403) at ingest time, **When** the run starts, **Then** it stops in `WAITING_HUMAN` with the blocked receipt and does not load partial or stale data as if complete. ☐ testable

## Edge cases (at least two)

- One TCAD account with several improvements → one property, improvements kept as children; year built taken from the main improvement, rule recorded.
- Two accounts with the same situs address → both kept (key is the TCAD id); A-10 decides merges.
- A supplemental export lands during the run → not mixed in; A-12 handles it as an incremental source.
- Mailing address abroad or missing ZIP → `owner_area_class = out_of_area` only with evidence, otherwise `unknown`.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST transform owner, mailing, situs, year built, improvements and sale date with provenance | AC-1 |
| FR-002 | System MUST reconcile the loaded count to the certified roll with every difference classified | AC-2 |
| FR-003 | System MUST classify out-of-area owners from versioned lists | AC-3 |
| FR-004 | System MUST mark unknown tenure and unknown roof-age basis with reasons | AC-4 |
| FR-005 | System MUST apply §25.025 confidentiality before `validate` | AC-5 |
| FR-006 | System MUST stop on a blocked source | AC-6 |
| NFR-001 | Completeness: difference < 2% of the roll, 0 unexplained | AC-2 |
| NFR-002 | Source etiquette: bounded concurrency, backoff, no evasion (NFR-07) | AC-6 |

## Prototype reference

Not a UI story. Its counts appear on `design/prototype/Coverage1440.dc.html` and its fields on `design/prototype/Property1440.dc.html` (through A-13).

## Demo Script

1. Presenter: "Show the total uploaded records by source." → Expected: property and ownership counts next to the TCAD certified roll count.

## Out of scope

- Coordinates (A-05), merges (A-10), publication (A-11).

## Evidence to capture

- `docs/evidence/A-04.md`: pilot output for the 25 parcels, roll count vs loaded count with the classified difference, confidential count, `monitoring-county-ingestion` report.
- `testplans/A-04-test-cases.md` results, `docs/reviews/CR-A-04.md`.

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
