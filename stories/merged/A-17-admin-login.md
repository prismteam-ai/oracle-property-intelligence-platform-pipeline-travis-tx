---
id: A-17
type: user-story
title: Let the operator sign in and start, stop or retry a pipeline run from the hosted app
parent: FEAT-A17
vision: VIS-A
ard: ARD-A
eval_point: A3
priority: P3
moscow: Should
branch: 017-admin-login
spec: specs/017-admin-login/
depends_on: [A-03, A-12, A-13]
size_days: 1.5
agents:
  design: [metagross, machamp]
  builder: [metagross, machamp]   # AGENT-MAP: metagross (sign-in, UI, API), machamp (queue, DLQ, bridge)
  reviewers: [metagross, machamp, audino]
  verify: "Playwright admin sign-in + Start run reaches the bridge; non-admin gets 403"
skills: [build-frontend-backends, build-batch-workflows, frontend-bug-fix, responsive-design-tests, apply-engineering-guidelines]
ui: true
status: Merged
merged_into: A-16
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---

> **Merged on 2026-10-21 into [A-16 Prove zero idle cost and let the operator run the pipeline from the hosted app](../A-16-cost-and-admin.md).** Kept for history only: do not plan, build or gate this file. Its ACs are now AC-1 to AC-5 (A-16) or AC-6 to AC-11 (A-17) there, each tagged with its old ID.

# A-17 Let the operator sign in and start, stop or retry a pipeline run from the hosted app

| Field | Value |
| --- | --- |
| Evaluation point | A3 (primary) · A4 |
| Demo line(s) | none required (the demo needs no admin access); supports D-2 by showing how a run is started |
| Agents | design `metagross`, `machamp` · builder `metagross` (sign-in, UI, API), `machamp` (queue, DLQ, bridge) · reviewers `metagross`, `machamp`, `audino` · verify Playwright admin sign-in + Start run reaches the bridge; non-admin gets 403 (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-03, A-12, A-13 |
| Size | 1.5 days |
| Branch | `017-admin-login`, merged into `feature/oracle-pipeline` |

## Context

Architecture decision AD-12 (Accepted 2026-10-19) puts admin pieces in the product and builds them **last**: Cognito email-code sign-in, an SQS command queue, and a local bridge next to the pipeline. The **Oracle operator** gets a way to trigger the incremental refresh (A-12) on demand from the hosted app without exposing the laptop or the Query DB. The bridge **pulls** commands outbound, so nothing in AWS can reach the operator machine (ARD § 2.2). The public demo never needs this; every demo step works signed out.

## Description

As the **Oracle operator**, I want **to sign in with an email code and start, stop or retry an incremental run from the Runs page, and see recent activity**, so that **I can refresh Travis County data on demand while the Query DB stays private on my machine**.

When done:
- A Cognito user pool with the built-in email code, self sign-up off, and an `admin` group.
- An `adminProcedure` that verifies the JWT with `aws-jwt-verify`.
- `admin.runs.start / stop / retry` send a command to an SQS queue (15-minute expiry, cancel by command ID) with a DLQ and one alarm that emails the operator through SNS.
- A local bridge in `pipeline/` polls the queue outbound and starts the Restate `CountyIngest` workflow. It writes `runs/live.json`, a small admin S3 status object.
- The Activity page shows `admin.activity.summary / list` from the query log through Logs Insights, cached 5 minutes.
- Admin controls appear only after sign-in.

**Independent test:** sign in as the admin on the hosted URL, press Start for an Austin-permits window, see the command reach the bridge and the run state change in `runs/live.json`; sign in as a non-admin and get 403.

## Acceptance Criteria

1. **AC-1** · **Given** the operator's email is in the `admin` group, **When** they open Admin, enter the email and the 6-digit code from the Cognito email, **Then** they land on Runs with Start / Stop / Retry visible and "Signed in as admin" shown; signed-out visitors never see these controls. ☐ testable
2. **AC-2** · **Given** a signed-in admin and the bridge running, **When** they press Start for "Austin permits since Run {n} watermark", **Then** one SQS message with a command ID is sent, the bridge picks it up within 60 s, the Restate `CountyIngest` workflow starts, and the Runs page shows "Running · started {UTC time}" from `runs/live.json`. ☐ testable
3. **AC-3** (error) · **Given** a signed-in user who is not in the `admin` group, or an expired token, **When** they call any `admin.*` procedure, **Then** the API answers 403 or 401, sends nothing to SQS, and logs the refusal without the token. ☐ testable
4. **AC-4** (missing data / error) · **Given** the bridge is offline, **When** a Start command waits 15 minutes, **Then** it expires, the UI shows "Bridge offline · command expired at {time}", nothing runs later by surprise, and after 3 failed receives the message goes to the DLQ, whose alarm emails the operator. ☐ testable
5. **AC-5** (scale) · **Given** 30 days of query log, **When** the admin opens Activity, **Then** the summary (questions per day, p95 latency, failures by outcome) loads in p95 < 3 s through the 5-minute cache, and every number links to its Logs Insights query. ☐ testable
6. **AC-6** · **Given** the CDK app, **When** `cdk synth` runs, **Then** assertions confirm self sign-up off, the queue's DLQ and alarm, no inbound path from AWS to the operator machine, no Query DB connection string in `apps/` or `infra/`, and $0 idle cost (Cognito free tier, SQS per request). ☐ testable

## Edge cases (at least two)

- Two Start presses in a row → the second is rejected while a run is active ("A run is already running"); one command ID per run.
- Stop during publication → the bridge finishes the current atomic step, never leaves half-published CIDs, and records "stopped by admin" in the run limitations.
- The Cognito email quota (default SES sender) is reached → the sign-in screen shows "Code could not be sent, try later"; the public app is unaffected.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | System MUST sign in admins with a Cognito email code and show admin controls only to them | AC-1 |
| FR-002 | System MUST deliver run commands through SQS to an outbound-polling bridge | AC-2 |
| FR-003 | System MUST reject non-admin and expired tokens on every admin procedure | AC-3 |
| FR-004 | System MUST expire unpicked commands and alarm on DLQ messages | AC-4 |
| FR-005 | System MUST show Activity from the query log with links to its queries | AC-5 |
| NFR-001 | $0 idle cost; Activity p95 < 3 s cached; command pickup ≤ 60 s while the bridge runs | AC-2, AC-5, AC-6 |
| NFR-002 | Least-privilege IAM; no token in logs; WCAG 2.2 AA; responsive at 390/768/1440 | AC-1, AC-3 |

## Prototype reference (mandatory if the story has UI)

| Element | Value |
| --- | --- |
| Claude Design screen | `design/prototype/AdminSignIn1440.dc.html` (+ 768, 390), `design/prototype/RunsAdmin1440.dc.html`, `design/prototype/Activity1440.dc.html` (+ 768, 390), `design/prototype/ActivityStates.dc.html` |
| States covered | signed out · code sent · signed in · running · bridge offline · expired · empty activity · error |
| Design system | `assessment-guide/design-system/` (Atlas, Material 3, mobile-first) |

## Demo Script

Not on the README transcript. Optional closing aside: "As the Oracle operator I can also start the next incremental run from here; the command is pulled by my machine, so the database never leaves it." → Expected: Start, then "Running" on Runs.

## Out of scope

- AI-user sign-in (Coming soon in A-18).
- Enabling the EventBridge schedule (stays disabled, AD-15).

## Evidence to capture

- `docs/evidence/A-17.md`: sign-in screenshots, the SQS message ID → bridge log → Restate workflow ID chain, 403 check, DLQ alarm test email, CDK assertion output, trace ID.
- `smeargle` report; `testplans/A-17-test-cases.md` results; `docs/reviews/CR-A-17.md`.

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
