---
id: A-08
type: user-story
title: Enrich contractors with BBB ratings within source boundaries
parent: FEAT-A08
vision: VIS-A
ard: ARD-A
eval_point: A1
priority: P2
moscow: Must
branch: 008-bbb-ratings
spec: specs/008-bbb-ratings/
depends_on: [A-07]
size_days: 0.5
agents:
  design: [oracle]
  builder: oracle
  reviewers: [oracle, donphan]
  verify: "coverage %, 403 evidence"
skills: [bbb-harvest, apply-engineering-guidelines]
ui: false
status: Merged
merged_into: A-07
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---
> **Merged into [A-07](../A-07-enrich-reconcile.md) on 2026-10-21.** This file is kept for reference only; do not run it as a story. Its ACs now live in A-07 as tagged "(was A-08 AC-n)".


# A-08 Enrich contractors with BBB ratings within source boundaries

| Field | Value |
| --- | --- |
| Evaluation point | A1 (primary) |
| Demo line(s) | D-3 (contractor with BBB rating where available), D-9 (BBB on open permits) |
| Agents | design `oracle` · builder `oracle` · reviewers `oracle`, `donphan` · verify coverage %, 403 evidence (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-07 |
| Size | 0.5 days |
| Branch | `008-bbb-ratings`, merged into `feature/oracle-pipeline` |

## Context

The README asks for BBB ratings "where publicly available" (AC-8, AC-38). A **roofing sales rep** uses a rating to judge a contractor; the **evaluator** checks that the pipeline respected BBB's terms and stopped on a 403 (access boundaries; P0-7). BBB answered with a Cloudflare bot challenge on 2026-10-17, so zero coverage is a real possibility; that is a documented gap, not a failure (ASM-5).

## Description

As a **roofing sales rep (through the CRM)**, I want **a BBB rating on each resolved contractor where BBB allows it, and a clear status where it does not**, so that **I can weigh a contractor's reputation without the pipeline breaking BBB's rules**.

When done: if the BBB API key is granted, it is used. Otherwise `bbb-harvest` runs a bounded probe (`--max-pages 2 --max-profiles 5`, ≤ 1 request per 3 s, concurrency 1), then the bounded full run only if the probe saw no 403. On the first 403 or challenge, the run stops and keeps the evidence. BBB is enrichment only, never identity.

**Overrides applied (ARD § 15, AD-30, AD-25):** a BBB rating is published only through a lexicon carrier confirmed in A-02 (for example `fact_sheet` via `company_has_fact_sheet`) and only for `resolved` companies. Otherwise the field is not published and the view shows `bbb_status` with its reason.

**Independent test:** the manifest `coverage` section shows BBB counts by `bbb_status` with the coverage percentage, and the capture receipts contain either ratings or the 403 evidence.

## Acceptance Criteria

1. **AC-1** · **Given** no BBB API key, **When** the bounded probe runs (`--max-pages 2 --max-profiles 5`), **Then** it makes at most 7 requests at ≤ 1 per 3 s with concurrency 1, and records each response code and time. ☐ testable
2. **AC-2** (error) · **Given** the probe or the full run receives a 403 or a Cloudflare challenge (as seen on 2026-10-17), **When** it happens, **Then** the run stops at that request, records `bbb_status = blocked` for all unchecked contractors with the evidence (URL, code, time, response digest), and makes no retry with a changed IP or user agent. ☐ testable
3. **AC-3** (scale) · **Given** every `resolved` company from A-07, **When** enrichment finishes, **Then** each one has exactly one `bbb_status` ∈ {`rated`, `not_found`, `blocked`, `not_checked`}, and the coverage % (rated ÷ resolved) and per-status counts are in the manifest `coverage` with `derivation` labels. ☐ testable
4. **AC-4** (missing data) · **Given** no lexicon carrier was confirmed in A-02, **When** the views are read, **Then** no BBB rating is published, every contractor shows `bbb_status = not_checked` with reason `no_lexicon_carrier`, and a lexicon extension request is on file. ☐ testable
5. **AC-5** · **Given** a contractor that is `candidate` or `unresolved`, **When** enrichment runs, **Then** BBB is not looked up for it and no BBB profile ever decides its identity (P0-6). ☐ testable

## Edge cases (at least two)

- BBB profile exists but shows "NR" (no rating) → `rated` is false; status `not_found` with the profile URL kept as evidence.
- Probe succeeds but the full run hits a 403 halfway → keep the ratings already captured, mark the rest `blocked`, stop.
- robots.txt disallows the path → do not fetch; status `blocked` with reason `robots_disallow`.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST bound BBB requests (≤ 1 per 3 s, concurrency 1, probe limits) | AC-1 |
| FR-002 | System MUST stop on the first 403 or challenge and record evidence | AC-2 |
| FR-003 | System MUST give every resolved company a `bbb_status` and publish coverage counts | AC-3 |
| FR-004 | System MUST publish ratings only through a confirmed lexicon carrier | AC-4 |
| FR-005 | System MUST never use BBB for identity | AC-5 |
| NFR-001 | 0 CAPTCHA or challenge bypasses; stop on first 403 (NFR-07) | AC-2 |

## Prototype reference

Not a UI story. "BBB: Blocked · 403" appears on `design/prototype/ExploreQ-permits5.dc.html` and `design/prototype/Property1440.dc.html` (through A-13).

## Demo Script

1. Presenter: "… including contractor and BBB rating where available." → Expected: a rating where one was captured and published, otherwise the BBB status and its reason.

## Out of scope

- Applying for the BBB API (a Day-0 action, not code).
- Ratings for unresolved contractors.

## Evidence to capture

- `docs/evidence/A-08.md`: probe log, 403 evidence or ratings captured, coverage % by status.
- `testplans/A-08-test-cases.md` results, `docs/reviews/CR-A-08.md`.

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
