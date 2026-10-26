---
id: A-07
type: user-story
title: Resolve contractor identity from official business records
parent: FEAT-A07
vision: VIS-A
ard: ARD-A
eval_point: A1
priority: P2
moscow: Must
branch: 007-contractor-identity
spec: specs/007-contractor-identity/
depends_on: [A-04, A-06]
size_days: 0.5
agents:
  design: [oracle, mew]
  builder: oracle
  reviewers: [oracle, donphan]
  verify: "resolved / unresolved / ambiguous counts (five AD-05 states in Task A)"
skills: [query-db-loading-matching, use-neutral-lexicon, apply-engineering-guidelines]
ui: false
status: Merged
merged_into: A-07
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---
> **Merged into [A-07](../A-07-enrich-reconcile.md) on 2026-10-21.** This file is kept for reference only; do not run it as a story. Its ACs now live in A-07 as tagged "(was A-07 AC-n)".


# A-07 Resolve contractor identity from official business records

| Field | Value |
| --- | --- |
| Evaluation point | A1 (primary) · A2 |
| Demo line(s) | D-3 (contractor records), D-9 (contractor identity on open permits) |
| Agents | design `oracle`, `mew` · builder `oracle` · reviewers `oracle`, `donphan` · verify resolved / unresolved / ambiguous counts, extended to five states by AD-05 (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-04, A-06 |
| Size | 0.5 days |
| Branch | `007-contractor-identity`, merged into `feature/oracle-pipeline` |

## Context

The README asks "who is the listed contractor?" (D-11). A **roofing sales rep** wants to know which company did the work; the **evaluator** checks that identity comes from official records, not from names typed on a permit (P0-6). Texas has no state roofing licence, so the official registry is the TX Comptroller "Active Franchise Tax Permit Holders" dataset.

Facts (live 2026-10-19): Comptroller `9cir-efmm` has **3,487,662** rows statewide and **342,334** with Travis county code `227`; **708** Travis taxpayers have "ROOF" in the name. On the 22,084 Austin reroof candidates, **1,678** distinct contractor company names are printed and **15,060** permits have no company name at all.

## Description

As a **roofing sales rep (through the CRM)**, I want **each permit's contractor matched to an official Comptroller record, or honestly marked as not resolved**, so that **I know which company a permit really belongs to and how sure the match is**.

When done: the Comptroller registry is loaded into the Query DB before resolution (ARD § 8). Printed contractor names are search keys only. Every contractor on a permit gets one of five states (AD-05): `resolved` (official registry identifier match), `candidate`, `ambiguous`, `conflicting`, `unresolved`. A `property_improvement_has_contractor` link is written only for `resolved` (AD-06). The Comptroller taxpayer number goes in `request_identifier` + `source_http_request`, and a lexicon extension request is filed.

**Overrides applied (ARD § 15, AD-30):** report all five states, not three (AD-05, AD-24); `resolved` only on an official registry identifier; an exact, unique, active legal-name match is `candidate` (PO decision 2026-10-19). Check whether Austin publishes any official contractor ID that crosswalks to the Comptroller (oracle R4), and record the answer.

**Independent test:** the five-state counts over all Austin reroof permits add up to the permit total, and every `resolved` row cites the Comptroller record it matched.

## Acceptance Criteria

1. **AC-1** · **Given** a reroof permit whose printed company name matches exactly one active Travis Comptroller legal name, **When** resolution runs without an official identifier crosswalk, **Then** the state is `candidate`, the printed name is shown "as printed on permit", and no company record or `property_improvement_has_contractor` link is written. ☐ testable
2. **AC-2** · **Given** an official identifier crosswalk (if A-07 finds one Austin publishes), **When** a permit's contractor identifier equals a Comptroller taxpayer number, **Then** the state is `resolved`, the company link is written, and the match rule and both source URLs are recorded. ☐ testable
3. **AC-3** (scale) · **Given** all 22,084 Austin reroof candidates and the 342,334 Travis Comptroller records, **When** resolution completes, **Then** the five-state totals (`resolved`, `candidate`, `ambiguous`, `conflicting`, `unresolved`) sum to the permit total, are written to the manifest `coverage` section with `derivation = aggregate_match` (AD-28), and the match rule version is recorded. ☐ testable
4. **AC-4** (missing data) · **Given** a permit with no printed company name (15,060 of the 22,084 on 2026-10-19), **When** it is resolved, **Then** its state is `unresolved` with reason `contractor_not_printed`, and the UI-facing view shows "Contractor not printed on permit", never a guessed company. ☐ testable
5. **AC-5** (error) · **Given** the Comptroller dataset is unreachable or not yet loaded, **When** resolution runs, **Then** every contractor stays `unresolved` with reason `registry_unavailable` and the run records the limitation; it never falls back to name = identity. ☐ testable

## Edge cases (at least two)

- Two active Comptroller records share the printed name ("ABC ROOFING LLC" in Austin and Pflugerville) → `ambiguous`; both candidates kept in the ledger.
- The printed name matches a record whose `sos_status_code` is not active → `conflicting`, with the status shown.
- Abbreviations and punctuation ("Roofing Co." vs "ROOFING COMPANY") → normalisation rule versioned; still `candidate`, never `resolved` on name alone.
- BBB or Overture name matches → never used for identity (P0-6).

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST assign one of five states using official identifiers only for `resolved` | AC-1, AC-2 |
| FR-002 | System MUST write company links only for `resolved` | AC-1, AC-2 |
| FR-003 | System MUST publish five-state totals in the manifest coverage with derivation labels | AC-3 |
| FR-004 | System MUST mark unprinted or unavailable identity with a reason | AC-4, AC-5 |
| NFR-001 | Every count reproducible from the ledger; 0 `resolved` without an identifier match (review sample of 25) | AC-3 |

## Prototype reference

Not a UI story. The five-state badge is designed in `design/prototype/ContractorBadge.dc.html` (rendered by A-13).

## Demo Script

1. Presenter: "Show properties in that area with open roofing permits … including contractor and BBB rating where available." → Expected: contractor "as printed on permit" with its state badge; nothing labelled resolved without a registry match.

## Out of scope

- BBB enrichment (A-08). Publishing Comptroller business records as their own data group (A-09).

## Evidence to capture

- `docs/evidence/A-07.md`: five-state counts, crosswalk finding, match rule version, a 25-row review sample.
- `testplans/A-07-test-cases.md` results, `docs/reviews/CR-A-07.md`.

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
