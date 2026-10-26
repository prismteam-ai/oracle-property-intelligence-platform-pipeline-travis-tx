---
id: A-09
type: user-story
title: Load business and places data for the county
parent: FEAT-A09
vision: VIS-A
ard: ARD-A
eval_point: A1
priority: P2
moscow: Must
branch: 009-business-places
spec: specs/009-business-places/
depends_on: [A-01, A-07]
size_days: 0.5
agents:
  design: [oracle]
  builder: oracle
  reviewers: [oracle]
  verify: "counts + licence recorded"
skills: [overture-places-ingest, apply-engineering-guidelines]
ui: false
status: Merged
merged_into: A-07
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---
> **Merged into [A-07](../A-07-enrich-reconcile.md) on 2026-10-21.** This file is kept for reference only; do not run it as a story. Its ACs now live in A-07 as tagged "(was A-09 AC-n)".


# A-09 Load business and places data for the county

| Field | Value |
| --- | --- |
| Evaluation point | A1 (primary) |
| Demo line(s) | D-3 (business records by source) |
| Agents | design `oracle` · builder `oracle` · reviewers `oracle` · verify counts + licence recorded (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-01, A-07 |
| Size | 0.5 days |
| Branch | `009-business-places`, merged into `feature/oracle-pipeline` |

## Context

The README asks to "load available business records" (AC-9), and the demo's "totals by source" line lists business records next to property and permit (D-3). The **evaluator** checks the count against the source's own total and checks that each open-data licence was respected.

Facts (live 2026-10-19): the TX Comptroller "Active Franchise Tax Permit Holders" dataset `9cir-efmm` has **342,334** rows with Travis county code `227` (Austin 301,031; Pflugerville 8,379; Lakeway 3,824). Overture places are optional (Could, feature list § 4) and have their own licence gate.

## Description

As a **Roofing CRM developer**, I want **Travis County business records and, where the licence allows, Overture places loaded with counts and licence recorded**, so that **the published dataset covers businesses as the README asks and every record's terms are known**.

When done: the Comptroller registry loaded for A-07 is also transformed into business entity records and published as its own data group; `overture-places-ingest` runs for the Travis County bounding area after its licence gate passes, as a separate publication group with counts by category.

**Independent test:** the business-record count equals the Comptroller Travis total at the capture watermark, and the manifest lists each group's licence.

## Acceptance Criteria

1. **AC-1** (scale) · **Given** the Comptroller dataset at the capture watermark (342,334 Travis rows on 2026-10-19), **When** the business group is transformed, **Then** the loaded count equals the source count at that watermark, each record keeps the taxpayer number, legal name, mailing address and SOS file number with source URL and capture time, and the count goes into the manifest `coverage` with `derivation = capture_receipt`. ☐ testable
2. **AC-2** · **Given** the Overture licence gate passes, **When** `overture-places-ingest` runs for Travis County, **Then** places are loaded as a separate publication group with counts by top-level category, the Overture release ID and licence (CDLA / ODbL per theme) recorded in the manifest limitations. ☐ testable
3. **AC-3** (missing data) · **Given** the Overture licence gate fails or the release cannot be fetched, **When** the story runs, **Then** no places are ingested, the reason is recorded in the manifest limitations, and the Coverage page shows "Places: not loaded · {reason}" instead of zero. ☐ testable
4. **AC-4** · **Given** a place or business whose name equals a permit's printed contractor name, **When** records are loaded, **Then** no contractor identity is created or changed from it (P0-6). ☐ testable

## Edge cases (at least two)

- Comptroller rows whose county code is `227` but whose address is outside Travis → keep (county code is the source's own attribution), note the count.
- Overture place outside the county polygon but inside the bounding box → excluded by polygon test; count recorded.
- Comptroller dataset row count changes during capture → re-read the count at the watermark; the receipt stores both.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST load Travis business records with provenance and a reconciled count | AC-1 |
| FR-002 | System MUST load Overture places only after its licence gate, as a separate group | AC-2 |
| FR-003 | System MUST record why places are absent if the gate fails | AC-3 |
| FR-004 | System MUST NOT derive contractor identity from business or place names | AC-4 |
| NFR-001 | Captured count = source count at watermark; licence recorded for 100% of groups | AC-1, AC-2 |

## Prototype reference

Not a UI story. Counts appear on `design/prototype/Coverage1440.dc.html` (through A-13).

## Demo Script

1. Presenter: "Show the total uploaded records by source." → Expected: a business row with its Comptroller total and capture time, and a places row with its count or reason.

## Out of scope

- Texas SOSDirect (paid source; out of scope OS-04).
- Using places for roof age or identity.

## Evidence to capture

- `docs/evidence/A-09.md`: counts vs source totals, licence record, category counts.
- `testplans/A-09-test-cases.md` results, `docs/reviews/CR-A-09.md`.

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
