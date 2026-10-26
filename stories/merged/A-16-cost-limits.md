---
id: A-16
type: user-story
title: Prove zero idle cost and document source speed limits
parent: FEAT-A16
vision: VIS-A
ard: ARD-A
eval_point: A4
priority: P2
moscow: Must
branch: 016-cost-limits
spec: specs/016-cost-limits/
depends_on: [A-01, A-03]
size_days: 0.5
agents:
  design: [metagross, machamp]
  builder: metagross
  reviewers: [metagross, machamp]
  verify: "`docs/cost.md` + billing screenshot"
skills: [build-frontend-backends, build-batch-workflows, responsive-design-tests, apply-engineering-guidelines]
ui: true
status: Merged
merged_into: A-16
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---

> **Merged on 2026-10-21 into [A-16 Prove zero idle cost and let the operator run the pipeline from the hosted app](../A-16-cost-and-admin.md).** Kept for history only: do not plan, build or gate this file. Its ACs are now AC-1 to AC-5 (A-16) or AC-6 to AC-11 (A-17) there, each tagged with its old ID.

# A-16 Prove zero idle cost and document source speed limits

| Field | Value |
| --- | --- |
| Evaluation point | A4 (primary) · A1 |
| Demo line(s) | D-1 (opening claim), D-4 ("without requiring Oracle-hosted database infrastructure") |
| Agents | design `metagross`, `machamp` · builder `metagross` · reviewers `metagross`, `machamp` · verify `docs/cost.md` + billing screenshot (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-01, A-03 (final numbers after A-11 and A-12) |
| Size | 0.5 days |
| Branch | `016-cost-limits`, merged into `feature/oracle-pipeline` |

## Context

The README asks to "demonstrate that Oracle can operate without carrying the infrastructure cost" (AC-20, AC-44) and to identify and document slow or constrained sources (AC-17 to AC-19). The **evaluator** wants a real billing number, not a claim; the **Oracle operator** needs the measured limits to plan refreshes.

Measured constraints so far: TCAD `publicinformation` HTTP 403 (2026-10-17, 2026-10-19); Travis GIS timed out (same days) and pages at 2,000 features per request; Austin Socrata 2,380,725 rows, ≤ 50,000 rows per page, and a full `:updated_at` re-stamp on 2026-10-19; BBB Cloudflare challenge (2026-10-17), ≤ 1 request per 3 s; Bedrock 10 requests per minute (2026-10-17).

## Description

As the **evaluator**, I want **to see on the hosted Coverage page what CountyLens costs while idle, who pays for each part, and how fast each source can be read**, so that **I can confirm Oracle carries no standing infrastructure cost and that source limits are known and respected**.

When done: `docs/cost.md` (component, idle cost, cost per use, who pays) with real numbers from Cost Explorer and Filebase, plus a Budgets/Cost Explorer screenshot; `docs/source-limits.md` (throughput, rate limits, anti-bot posture, slow sites, BBB limits) from the A-01 to A-12 measurements; both shown on the Coverage page's Cost and Limits sections. CDK assertions enforce the cost rules.

**Independent test:** open Coverage · Cost on the hosted URL; it shows "$0.00 fixed per month" with the billing date, and `cdk synth` assertions pass.

## Acceptance Criteria

1. **AC-1** · **Given** the deployed stacks with no traffic, **When** Cost Explorer is read for the last full day, **Then** `docs/cost.md` shows each component's idle cost (Amplify static, Lambda, API Gateway, S3 + CloudFront CID copy, DynamoDB on-demand, SSM, CloudWatch Logs, disabled scheduler) with $0.00 fixed per month plus storage cents, who pays per use, and the screenshot is in `docs/evidence/img/`. ☐ testable
2. **AC-2** · **Given** the CDK app, **When** `cdk synth` runs, **Then** assertions confirm: scheduler `DISABLED`; no Secrets Manager, RDS, KMS CMK, provisioned concurrency, WAF or Route 53 hosted zone; log retention 14 days (query log 30); a $10 budget alert; region from config. ☐ testable
3. **AC-3** (scale) · **Given** the measurements from A-01 to A-12, **When** `docs/source-limits.md` is written, **Then** every source has throughput (rows or requests per minute), page size, the full-capture duration measured at full scale (for example the 2,380,725-row Austin backfill and the full GIS paging), rate limits, anti-bot posture and the optimisation applied. ☐ testable
4. **AC-4** · **Given** the hosted Coverage page, **When** the evaluator opens Cost and Limits, **Then** both sections render the same numbers as the two docs, each with its "as of" date and source. ☐ testable
5. **AC-5** (missing data) · **Given** Cost Explorer has not yet produced data for the current day (about 24 h lag) or Filebase usage is not readable through its API, **When** the page renders, **Then** it shows the last available date with "as of {date}" or "Filebase usage: not available · {reason}", never a zero filled in. ☐ testable

## Edge cases (at least two)

- AWS free-plan credits show a credit offset → show both gross cost and credits applied, so "$0" is not just credits.
- A Lambda invocation during the sampled day (evaluator traffic) → shown as per-use cost, not idle cost.
- A source that never became reachable (TCAD 403) → its limit row says "blocked" with dates, not a throughput.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST document idle and per-use cost per component from billing data | AC-1 |
| FR-002 | CDK MUST assert the zero-idle-cost rules | AC-2 |
| FR-003 | System MUST document measured limits for every source | AC-3 |
| FR-004 | Coverage page MUST show both documents' numbers with dates | AC-4 |
| FR-005 | Page MUST show reasons for unavailable cost data | AC-5 |
| NFR-001 | $0.00 fixed per month while idle; $10 budget alert (NFR-02) | AC-1, AC-2 |
| NFR-002 | Responsive at 390/768/1440, Atlas only (NFR-08) | AC-4 |

## Prototype reference (mandatory if the story has UI)

| Element | Value |
| --- | --- |
| Claude Design screen | `design/prototype/Coverage1440.dc.html` (Cost section), `Coverage768.dc.html`, `Coverage390.dc.html`, `CoverageStates.dc.html` |
| States covered | populated · partial (as of yesterday) · unavailable with reason |
| Design system | `assessment-guide/design-system/` (Atlas, Material 3, mobile-first) |

## Demo Script

1. Presenter: "Now I am opening the DuckDB-backed query layer." → Expected: alongside the SQL panel, Coverage · Cost shows that no Oracle-hosted database or standing infrastructure is billed.

## Out of scope

- Enabling the scheduler or any paid plan as a default.
- Company PagerDuty and Lexicon metric registration (deviations D-04, D-05).

## Evidence to capture

- `docs/cost.md`, `docs/source-limits.md`, billing screenshot, `cdk synth` assertion output.
- `smeargle` report; `testplans/A-16-test-cases.md` results; `docs/reviews/CR-A-16.md`.

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
