---
id: A-06
type: user-story
title: Harvest permits from every classified jurisdiction
parent: FEAT-A06
vision: VIS-A
ard: ARD-A
eval_point: A1
priority: P1
moscow: Must
branch: 006-permits
spec: specs/006-permits/
depends_on: [A-01, A-02, A-03]
size_days: 1
agents:
  design: [oracle]
  builder: oracle
  reviewers: [oracle, donphan]
  verify: "per-jurisdiction counts"
skills: [county-permit-adapter, county-ingest-run, durable-workflow-builder, apply-engineering-guidelines]
ui: false
status: Merged
merged_into: A-04
merged_on: 2026-10-21
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---

# A-06 Harvest permits from every classified jurisdiction

> Merged into **A-04** on 2026-10-21 ([../A-04-property-backbone.md](../A-04-property-backbone.md)). Kept for history; the ACs live there now.

| Field | Value |
| --- | --- |
| Evaluation point | A1 (primary) · A5 |
| Demo line(s) | D-3 (permit records by source), D-9 (open roofing permits by open duration) |
| Agents | design `oracle` · builder `oracle` · reviewers `oracle`, `donphan` · verify per-jurisdiction counts (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-01, A-02, A-03 |
| Size | 1 day |
| Branch | `006-permits`, merged into `feature/oracle-pipeline` |

## Context

Open and long-stalled roofing permits are the strongest lead signal the README names (AC-4, AC-5, AC-37). The **roofing sales rep** needs every permit with its status, dates and open duration; the **evaluator** checks per-jurisdiction counts against each source.

Facts (Austin `3syk-w9eu`, live 2026-10-19): **2,380,725** rows; **22,084** reroof description matches, of which 21,694 are `AUSTIN FULL PURPOSE`, 78 `AUSTIN LTD`, 50 `AUSTIN 2 MILE ETJ`, 3 `WEST LAKE HILLS FULL PURPOSE`, 6 `OTHER`, 250 no jurisdiction; **508** reroof rows have no `tcad_id` (97.7% have one). Oldest still-open reroof: **1982-012866 BP**, `Suspended`, issued 1982-06-23. **Every row's `:updated_at` was re-stamped between 12:22 and 12:43 UTC on 2026-10-19**, so `:updated_at > watermark` alone can return the whole dataset after a city republish.

## Description

As a **roofing sales rep (through the CRM)**, I want **every permit from every supported jurisdiction loaded with raw status, issue, expiry and final dates, open duration and a roofing classification**, so that **long-open and stalled reroofs can be ranked as leads**.

When done: the Austin Socrata adapter (new, TypeScript, through the kit's seams) does a full backfill paged by `:id`, keeps raw payloads and digests, and then runs incrementally from a watermark. Permits link to properties by `tcad_id`, with an address-hash fallback; unmatched permits are kept and counted. Roofing work is classified only by the frozen A-02 profile. Other jurisdictions use the matching kit vendor module, or carry the A-01 evidence that they have no public history.

**Independent test:** per-jurisdiction counts in the Query DB equal each source's own count at the run watermark, and the roofing status split matches the profile.

## Acceptance Criteria

1. **AC-1** (scale) · **Given** the Austin dataset at the run watermark (2,380,725 rows on 2026-10-19), **When** the full backfill completes, **Then** the captured row count equals the source count at that watermark, each row keeps its raw payload digest and source URL, and permits outside Travis County are counted separately, not dropped. ☐ testable
2. **AC-2** · **Given** the 22,084 Austin reroof candidates, **When** linked to properties, **Then** at least 97% link to a roll property by `tcad_id` or address hash (AD-16), and every unmatched permit (for example the 508 with no `tcad_id`) is kept and counted with its reason. ☐ testable
3. **AC-3** · **Given** the A-02 profile, **When** the reroof candidates are classified, **Then** the counts by `status_class` are reported against the 2026-10-19 baseline (open 129: Active 125, Suspended 2, Re Review 1, Pending Permit 1; stalled 2,213; closed 17,251; exclude 2,491), and permit 1982-012866 BP shows `status_raw = Suspended`, `status_class = open`, `open_days` = run `as_of` − 1982-06-23. ☐ testable
4. **AC-4** · **Given** each jurisdiction classified in A-01, **When** the run finishes, **Then** every supported one has a captured count with source total and timestamp, and every records-request or no-history one is listed in the manifest limitations with its evidence URL. ☐ testable
5. **AC-5** (missing data / error) · **Given** a permit with no `issue_date`, **When** `open_days` is derived, **Then** it is null with reason `no_issue_date`, not zero; **Given** Socrata re-stamps every `:updated_at` in one republish (as on 2026-10-19), **When** the incremental run reads the window, **Then** the adapter detects the source-wide re-stamp, compares row content digests, writes only rows whose content changed, and records "source bulk re-stamp; delta by content digest" as a limitation. ☐ testable
6. **AC-6** · **Given** a 429 or 5xx from Socrata, **When** paging, **Then** the adapter backs off (1 s base, 60 s cap, 5 attempts), resumes from the last committed page after a stop, and never skips a page. ☐ testable

## Edge cases (at least two)

- A permit appears in a later page with a new status → upsert by permit number + jurisdiction; history kept in the capture receipts.
- A row disappears from the source (deleted upstream) → detected by the periodic key-set diff; written as a `source_removed` tombstone, not silently dropped.
- Austin-issued permits located in Lakeway (6,825) or Pflugerville (1,117 full purpose) → kept as Austin-issued; never counted as those cities' own permits.
- A description matches both include and exclude terms ("REROOF AND SOLAR") → profile rule decides; uncertain ones go to `needs_review`.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST backfill every Austin row with raw payload and digest | AC-1 |
| FR-002 | System MUST link permits to properties and keep unmatched permits | AC-2 |
| FR-003 | System MUST classify roofing and status only through the versioned profile | AC-3 |
| FR-004 | System MUST record every jurisdiction's count or documented absence | AC-4 |
| FR-005 | System MUST derive open days from real dates only and detect bulk re-stamps | AC-5 |
| FR-006 | System MUST page with backoff and resume | AC-6 |
| NFR-001 | ≥ 97% of Austin roofing permits matched; every unmatched one counted (AD-16) | AC-2 |
| NFR-002 | ≤ 50,000 rows per page with app token; backoff on 429/5xx (NFR-07) | AC-6 |

## Prototype reference

Not a UI story. Permit chips ("Stalled 6.4 yrs · source says Expired") appear on `design/prototype/ExploreQ-permits5.dc.html` (through A-13).

## Demo Script

1. Presenter: "Show properties in that area with open roofing permits, prioritizing permits that have remained open for many years, including contractor and BBB rating where available." → Expected: the permits, statuses and open days loaded here, ranked by A-13.

## Out of scope

- Contractor identity (A-07), BBB (A-08), the scheduled refresh (A-12).

## Evidence to capture

- `docs/evidence/A-06.md`: per-jurisdiction counts vs source totals, match rate, unmatched by reason, status-class split, backfill throughput, re-stamp detection log.
- `testplans/A-06-test-cases.md` results, `docs/reviews/CR-A-06.md`.

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
