---
id: QC-TC-A-16
type: test-cases
title: Prove zero idle cost, run the pipeline from the hosted app, and close the carried gaps
parent: [FEAT-A16, FEAT-A17]
story: stories/A-16-cost-and-admin.md
spec: specs/016-cost-and-admin/spec.md
owner: Heba Gaber         # QC Lead
status: Draft             # Draft → In Review → Approved
gate: G6
version: 0.1
created: 2026-10-26
runtime_url: "{RUNTIME_URL}"   # https://countylens.aldarraj.com or the Amplify preview of 016-cost-and-admin, never localhost
reviewed_code: "{sha}"
qc_signoff: false
---

# Test Cases: A-16 Prove zero idle cost, run the pipeline from the hosted app, and close the carried gaps

> Drafted with `developmentsupport-testcases` from the story's 14 Given/When/Then ACs, edge cases and Closure table, **not** from `tasks.md`. Every case runs against the hosted URL (`https://countylens.aldarraj.com` or the Amplify preview of branch `016-cost-and-admin`), except CDK assertion cases (run in CI `cdk synth`) and the bridge-offline case, which starts with "the bridge is stopped". Save as `testplans/A-16-test-cases.md`.

## 1. Feature overview

Part 1 shows on the hosted Coverage page what CountyLens costs while idle and how fast each source can be read. Part 2 lets the operator sign in with email and password, start, stop or retry an incremental run through an SQS queue pulled by a local bridge, and see Activity. Part 3 matches each page to its prototype board, makes Explore, the agent and MCP answer on the full county (441,961 properties) from a per-run index, and closes or records every carried gap from A-11, A-13 and A-14.

## 2. Requirement mapping

| Source | Reference | Covered by |
| --- | --- | --- |
| Acceptance criterion | AC-1 | A-16-TC-001, A-16-TC-002, A-16-TC-NF-01 |
| Acceptance criterion | AC-2 | A-16-TC-003, A-16-TC-004, A-16-TC-NF-01 |
| Acceptance criterion | AC-3 | A-16-TC-005, A-16-TC-006 |
| Acceptance criterion | AC-4 | A-16-TC-007 |
| Acceptance criterion | AC-5 | A-16-TC-008, A-16-TC-009 |
| Acceptance criterion | AC-6 | A-16-TC-010, A-16-TC-011, A-16-TC-012, A-16-TC-NF-04 |
| Acceptance criterion | AC-7 | A-16-TC-013, A-16-TC-014, A-16-TC-015, A-16-TC-NF-03 |
| Acceptance criterion | AC-8 | A-16-TC-016, A-16-TC-017, A-16-TC-NF-04 |
| Acceptance criterion | AC-9 | A-16-TC-018, A-16-TC-019 |
| Acceptance criterion | AC-10 | A-16-TC-020, A-16-TC-021, A-16-TC-NF-03 |
| Acceptance criterion | AC-11 | A-16-TC-022 |
| Acceptance criterion | AC-12 | A-16-TC-023, A-16-TC-024, A-16-TC-025, A-16-TC-026, A-16-TC-027, A-16-TC-028, A-16-TC-029, A-16-TC-030, A-16-TC-031, A-16-TC-032, A-16-TC-033 |
| Acceptance criterion | AC-13 | A-16-TC-034, A-16-TC-035, A-16-TC-036, A-16-TC-037, A-16-TC-038 |
| Acceptance criterion | AC-14 | A-16-TC-038, A-16-TC-039, A-16-TC-040 |
| Functional requirement | FR-001 | A-16-TC-001, A-16-TC-002 |
| Functional requirement | FR-002 | A-16-TC-003, A-16-TC-004 |
| Functional requirement | FR-003 | A-16-TC-005, A-16-TC-006 |
| Functional requirement | FR-004 | A-16-TC-007 |
| Functional requirement | FR-005 | A-16-TC-008, A-16-TC-009 |
| Functional requirement | FR-006 | A-16-TC-010, A-16-TC-011, A-16-TC-012, A-16-TC-022 |
| Functional requirement | FR-007 | A-16-TC-013, A-16-TC-014, A-16-TC-015 |
| Functional requirement | FR-008 | A-16-TC-016, A-16-TC-017 |
| Functional requirement | FR-009 | A-16-TC-018, A-16-TC-019, A-16-TC-022 |
| Functional requirement | FR-010 | A-16-TC-020, A-16-TC-021 |
| Functional requirement | FR-011 | A-16-TC-023, A-16-TC-024, A-16-TC-025, A-16-TC-026, A-16-TC-027, A-16-TC-028, A-16-TC-029, A-16-TC-030, A-16-TC-031, A-16-TC-032, A-16-TC-033 |
| Functional requirement | FR-012 | A-16-TC-034, A-16-TC-035, A-16-TC-036, A-16-TC-037, A-16-TC-038 |
| Functional requirement | FR-013 | A-16-TC-038, A-16-TC-039, A-16-TC-040 |
| NFR | NFR-001 | A-16-TC-001, A-16-TC-002, A-16-TC-003, A-16-TC-022, A-16-TC-NF-01 |
| NFR | NFR-002 | A-16-TC-023, A-16-TC-024, A-16-TC-025, A-16-TC-026, A-16-TC-027, A-16-TC-028, A-16-TC-029, A-16-TC-030, A-16-TC-031, A-16-TC-032, A-16-TC-033, A-16-TC-NF-02 |
| NFR | NFR-003 | A-16-TC-013, A-16-TC-020, A-16-TC-034, A-16-TC-NF-03 |
| NFR | NFR-004 | A-16-TC-010, A-16-TC-016, A-16-TC-017, A-16-TC-NF-04 |

## 3. Assumptions

- Credentials come from a local, git-ignored env file (`ADMIN_TEST_EMAIL`, `ADMIN_TEST_PASSWORD`, `NONADMIN_TEST_EMAIL`, `NONADMIN_TEST_PASSWORD`, plus `RUNTIME_URL`, `MCP_URL`, `MCP_TOKEN`). No credential or token value is written in this document, a test file, evidence or a log.
- AC-6 is email + password (Task B pattern, PO 2026-10-26); there is no email-code step. The board's "code sent" state is Justified in the parity matrix.
- `docs/evidence/A-16-prototype-parity.md` is the verdict source for AC-12 and is filled during the build; cases A-16-TC-023 to 033 fail until a family's cells are all Match, Fixed or Justified. Placeholder numbers on the boards are not compared.
- The Closure table has 27 IDs; expected Exceptions are A11-3, A11-5 and A14-2 unless the PO decides otherwise.
- The parked A-13/A-14 tests are un-parked by removing the `parkGap(` calls; a skipped test is never counted as passed.

## 4. Scope

- **In scope:** Coverage Cost and Limits, `cdk synth` assertions, admin sign-in, `admin.*` procedures, SQS/DLQ/bridge, Activity, parity of 11 page families, full-county Explore/agent/MCP, closure of carried gaps.
- **Out of scope (per story):** enabling the scheduler, company PagerDuty and metric registration, AI-user sign-in.

## 5. Test data

- Data snapshot: the latest published full-county run; manifest CID is recorded at run time in section 11 and `docs/evidence/A-16.md` (candidate: Run 3 manifest `bafkreifndsdibdllvgpzwmif6getzwvc6rupk5tgeak4eypccaw3t7vlfm`, 441,961 properties; Run 2 has 15,025 permits). Never hard-coded in a test.
- Real sources: TCAD `publicinformation` (HTTP 403 on 2026-10-17 and 2026-10-19), Travis GIS (2,000 features per page), Austin Socrata (2,380,725 rows, ≤ 50,000 per page), BBB (1 request per 3 s), Bedrock (10 requests per minute).
- Real places for Explore: Austin city 5 mi for radius + roof age and open permits; tenure ≥ 10 years; out-of-area owner (the mailing gap is stated, not filtered).
- Admin users: one in the `admin` group, one not. Command window: "Austin permits since Run {n} watermark".

## 6. Environment, risks and dependencies

- `RUNTIME_URL` is the hosted URL or the Amplify preview of `016-cost-and-admin`; `playwright.config.ts` refuses `localhost` and `127.0.0.1`.
- Bridge cases (TC-013, 014, 015, NF-03) need the bridge running on the operator machine; TC-018 needs it stopped.
- TC-018 waits 15 minutes; TC-019 needs the operator inbox.
- Free plan credits end 2027-04-16; if access is denied, check `aws freetier get-account-plan-state` first.
- Dependencies: A-03, A-11, A-13, A-14 merged; per-run Explore index built before TC-034 to 038.

## 7. Coverage matrix

| TC ID | Title | Priority | Tags | Type | Requirement(s) | Playwright test |
| --- | --- | --- | --- | --- | --- | --- |
| A-16-TC-001 | Cost section shows $0.00 fixed per month with billed-day window | P1 | @smoke @demo | UI | AC-1, FR-001, NFR-001 | `tests/e2e/A-16-cost.spec.ts › "A-16-TC-001 idle cost table"` |
| A-16-TC-002 | Credits shown apart from gross cost; per-use lines separated; Part 2 resources are per-use | P1 | @edge | UI | AC-1, FR-001, NFR-001 | `tests/e2e/A-16-cost.spec.ts › "A-16-TC-002 gross vs credits vs per-use"` |
| A-16-TC-003 | CDK synth assertions enforce the zero-idle rules | P1 | @smoke @cdk | CDK | AC-2, FR-002, NFR-001 | `infra/test/cost-rules.test.ts › "A-16-TC-003 zero-idle assertions" (run in CI `cdk synth`)` |
| A-16-TC-004 | Injected always-on resource makes the assertion fail | P2 | @negative @cdk | CDK | AC-2, FR-002 | `infra/test/cost-rules.test.ts › "A-16-TC-004 violation is caught"` |
| A-16-TC-005 | Every source has a complete limits row | P1 | @smoke | UI | AC-3, FR-003 | `tests/e2e/A-16-cost.spec.ts › "A-16-TC-005 limits table complete"` |
| A-16-TC-006 | TCAD row says "blocked" with dates, not a throughput | P1 | @negative @missing-data | UI | AC-3, FR-003 | `tests/e2e/A-16-cost.spec.ts › "A-16-TC-006 TCAD blocked row"` |
| A-16-TC-007 | Cost and Limits sections match the two docs, with "as of" and source | P1 | @smoke | UI | AC-4, FR-004 | `tests/e2e/A-16-cost.spec.ts › "A-16-TC-007 page equals docs"` |
| A-16-TC-008 | Cost Explorer lag: last available date shown, no zero filled in | P1 | @negative @missing-data | UI | AC-5, FR-005 | `tests/e2e/A-16-cost.spec.ts › "A-16-TC-008 cost lag as-of"` |
| A-16-TC-009 | Filebase usage not readable shows the reason | P1 | @negative @missing-data | UI | AC-5, FR-005 | `tests/e2e/A-16-cost.spec.ts › "A-16-TC-009 filebase usage unavailable"` |
| A-16-TC-010 | Admin signs in with email and password and lands on Runs | P1 | @smoke @auth | UI | AC-6, FR-006, NFR-004 | `tests/e2e/A-16-admin.spec.ts › "A-16-TC-010 admin sign-in"` |
| A-16-TC-011 | Signed-out visitors never see admin controls | P1 | @negative @auth | UI | AC-6, FR-006 | `tests/e2e/A-16-admin.spec.ts › "A-16-TC-011 signed-out has no controls"` |
| A-16-TC-012 | Sign-in refused: wrong password and Cognito unavailable | P1 | @negative @auth | UI | AC-6 edge, FR-006 | `tests/e2e/A-16-admin.spec.ts › "A-16-TC-012 sign-in refused message"` |
| A-16-TC-013 | Start reaches the bridge within 60 s and Runs shows Running | P1 | @smoke @demo @bridge | UI+Bridge | AC-7, FR-007, NFR-003 | `tests/e2e/A-16-admin.spec.ts › "A-16-TC-013 start reaches bridge"` |
| A-16-TC-014 | Second Start while a run is active is rejected | P1 | @negative @edge | UI | AC-7 edge, FR-007 | `tests/e2e/A-16-admin.spec.ts › "A-16-TC-014 double start rejected"` |
| A-16-TC-015 | Stop during publication leaves no half-published CIDs | P2 | @edge @bridge | UI+Bridge | AC-7 edge, FR-007 | `tests/e2e/A-16-admin.spec.ts › "A-16-TC-015 stop during publication"` |
| A-16-TC-016 | Non-admin signed-in user gets 403 and nothing is queued | P1 | @negative @security | API | AC-8, FR-008, NFR-004 | `tests/e2e/A-16-admin.spec.ts › "A-16-TC-016 non-admin 403"` |
| A-16-TC-017 | Expired token gets 401 and nothing is queued | P1 | @negative @security | API | AC-8, FR-008, NFR-004 | `tests/e2e/A-16-admin.spec.ts › "A-16-TC-017 expired 401"` |
| A-16-TC-018 | Bridge offline: command expires after 15 minutes | P1 | @negative @missing-data @bridge | UI+Bridge | AC-9, FR-009 | `tests/e2e/A-16-admin.spec.ts › "A-16-TC-018 bridge offline expiry"` |
| A-16-TC-019 | Three failed receives move the message to the DLQ and the alarm emails | P2 | @negative @bridge | Infra | AC-9, FR-009 | `tests/e2e/A-16-admin.spec.ts › "A-16-TC-019 dlq alarm"` |
| A-16-TC-020 | Activity summary loads from Logs Insights with query links | P1 | @smoke | UI | AC-10, FR-010, NFR-003 | `tests/e2e/A-16-admin.spec.ts › "A-16-TC-020 activity summary"` |
| A-16-TC-021 | Activity empty and error states | P2 | @negative @missing-data | UI | AC-10, FR-010 | `tests/e2e/A-16-admin.spec.ts › "A-16-TC-021 activity empty and error"` |
| A-16-TC-022 | CDK assertions for Part 2 resources | P1 | @smoke @cdk | CDK | AC-11, FR-006, FR-009, NFR-001 | `infra/test/admin-rules.test.ts › "A-16-TC-022 part 2 assertions" (run in CI `cdk synth`)` |
| A-16-TC-023 | Shell, Hub and Welcome: parity with board at 390, 768 and 1440 | P2 | @parity @responsive | UI | AC-12, FR-011, NFR-002 | `tests/e2e/A-16-parity.spec.ts › "A-16-TC-023 Shell, Hub and Welcome parity"` |
| A-16-TC-024 | Explore, drawer and filters: parity with board at 390, 768 and 1440 | P2 | @parity @responsive | UI | AC-12, FR-011, NFR-002 | `tests/e2e/A-16-parity.spec.ts › "A-16-TC-024 Explore, drawer and filters parity"` |
| A-16-TC-025 | ExploreQ AI and SQL states: parity with board at 390, 768 and 1440 | P2 | @parity @responsive | UI | AC-12, FR-011, NFR-002 | `tests/e2e/A-16-parity.spec.ts › "A-16-TC-025 ExploreQ AI and SQL states parity"` |
| A-16-TC-026 | Data catalog, manifest and verify: parity with board at 390, 768 and 1440 | P2 | @parity @responsive | UI | AC-12, FR-011, NFR-002 | `tests/e2e/A-16-parity.spec.ts › "A-16-TC-026 Data catalog, manifest and verify parity"` |
| A-16-TC-027 | Runs, Compare, Log and RunsAdmin: parity with board at 390, 768 and 1440 | P2 | @parity @responsive | UI | AC-12, FR-011, NFR-002 | `tests/e2e/A-16-parity.spec.ts › "A-16-TC-027 Runs, Compare, Log and RunsAdmin parity"` |
| A-16-TC-028 | Coverage: parity with board at 390, 768 and 1440 | P2 | @parity @responsive | UI | AC-12, FR-011, NFR-002 | `tests/e2e/A-16-parity.spec.ts › "A-16-TC-028 Coverage parity"` |
| A-16-TC-029 | Help MCP: parity with board at 390, 768 and 1440 | P2 | @parity @responsive | UI | AC-12, FR-011, NFR-002 | `tests/e2e/A-16-parity.spec.ts › "A-16-TC-029 Help MCP parity"` |
| A-16-TC-030 | Legal: parity with board at 390, 768 and 1440 | P2 | @parity @responsive | UI | AC-12, FR-011, NFR-002 | `tests/e2e/A-16-parity.spec.ts › "A-16-TC-030 Legal parity"` |
| A-16-TC-031 | Coming soon: parity with board at 390, 768 and 1440 | P2 | @parity @responsive | UI | AC-12, FR-011, NFR-002 | `tests/e2e/A-16-parity.spec.ts › "A-16-TC-031 Coming soon parity"` |
| A-16-TC-032 | AdminSignIn: parity with board at 390, 768 and 1440 | P2 | @parity @responsive | UI | AC-12, FR-011, NFR-002 | `tests/e2e/A-16-parity.spec.ts › "A-16-TC-032 AdminSignIn parity"` |
| A-16-TC-033 | Activity: parity with board at 390, 768 and 1440 | P2 | @parity @responsive | UI | AC-12, FR-011, NFR-002 | `tests/e2e/A-16-parity.spec.ts › "A-16-TC-033 Activity parity"` |
| A-16-TC-034 | Explore README searches on the full county, p95 < 3 s | P1 | @smoke @demo @perf | UI | AC-13, FR-012, NFR-003 | `tests/e2e/A-16-county.spec.ts › "A-16-TC-034 explore README searches p95"` |
| A-16-TC-035 | Two README agent prompts answer with citations and no timeout | P1 | @smoke @demo | UI | AC-13, FR-012 | `tests/e2e/A-16-county.spec.ts › "A-16-TC-035 agent README prompts"` |
| A-16-TC-036 | One MCP data tool call answers on the full county | P1 | @mcp | API | AC-13, FR-012 | `tests/e2e/A-16-county.spec.ts › "A-16-TC-036 mcp search_properties full county"` |
| A-16-TC-037 | Index is built only from that run's published CIDs | P1 | @negative @security | API | AC-13, FR-012 | `tests/e2e/A-16-county.spec.ts › "A-16-TC-037 index records published CIDs only"` |
| A-16-TC-038 | Parked A-13/A-14 tests run again and pass or are listed as exceptions | P1 | @closure | Suite | AC-13, AC-14, FR-012, FR-013 | `tests/e2e/A-16-closure.spec.ts › "A-16-TC-038 parked tests rerun"` |
| A-16-TC-039 | Closure table checked against evidence | P1 | @closure | Doc | AC-14, FR-013 | `tests/e2e/A-16-closure.spec.ts › "A-16-TC-039 closure table"` |
| A-16-TC-040 | Closed item with no evidence or parked test is rejected | P2 | @negative @closure | Doc | AC-14, FR-013 | `tests/e2e/A-16-closure.spec.ts › "A-16-TC-040 closure gaps fail"` |
| A-16-TC-NF-01 | Idle cost and budget alert are measurable | P1 | @perf @nfr | UI/CDK | NFR-001, AC-1, AC-2 | `tests/e2e/A-16-cost.spec.ts › "A-16-TC-NF-01 zero idle"` |
| A-16-TC-NF-02 | Responsive and Atlas check on Coverage and admin pages | P2 | @nfr @responsive | UI | NFR-002 | `tests/e2e/A-16-parity.spec.ts › "A-16-TC-NF-02 responsive atlas"` |
| A-16-TC-NF-03 | Command pickup and Activity timings | P1 | @perf @nfr | UI/API | NFR-003, AC-7, AC-10 | `tests/e2e/A-16-admin.spec.ts › "A-16-TC-NF-03 pickup and activity p95"` |
| A-16-TC-NF-04 | No token in logs; accessibility of admin pages | P1 | @security @nfr | UI/Log | NFR-004, AC-6, AC-8 | `tests/e2e/A-16-admin.spec.ts › "A-16-TC-NF-04 no token and axe"` |

## 8. Functional test cases

### A-16-TC-001: Cost section shows $0.00 fixed per month with billed-day window

- **Priority / tags:** P1 · `@smoke @demo`
- **Maps to:** AC-1, FR-001, NFR-001
- **Preconditions:** Hosted Coverage deployed; `docs/cost.md` committed.
- **Test data:** `docs/cost.md` and the billing screenshot in `docs/evidence/img/`; Cost Explorer read for the last ≥ 3 full billed days, grouped by service and record type. Snapshot: latest published run manifest CID recorded at run time.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/coverage` in a private window.
  2. **Click** the "Cost" section anchor. → Cost section scrolls into view.
  3. **Read** the headline figure. → It reads "$0.00 fixed per month" with a billing date ("as of {YYYY-MM-DD}") no older than the last billed day.
  4. **Read** the component table. → It has one row each for Amplify static, Lambda, API Gateway, S3 + CloudFront CID copy, DynamoDB on-demand, SSM, CloudWatch Logs, disabled scheduler, Cognito, SQS + DLQ, SNS; every row shows idle cost, "who pays per use" and a source.
  5. **Read** the window label. → It states the first and last billed day and the count of days (≥ 3).
  6. **Compare** each idle figure with `docs/cost.md`. → Identical values.
- **Expected result:** Headline "$0.00 fixed per month"; all 11 components listed with idle cost ($0.00 plus storage cents where stated), who pays per use, source, and a window of at least 3 full billed days; the screenshot file exists under `docs/evidence/img/`.

### A-16-TC-002: Credits shown apart from gross cost; per-use lines separated; Part 2 resources are per-use

- **Priority / tags:** P1 · `@edge`
- **Maps to:** AC-1, FR-001, NFR-001
- **Preconditions:** TC-001 passed.
- **Test data:** Cost Explorer record types: Usage and Credit; a billed day containing evaluator traffic.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/coverage` in a private window.
  2. **Click** the "Cost" anchor.
  3. **Read** the totals row. → It shows "Gross" and "Credits applied" as two separate figures, so $0 is not just credits.
  4. **Find** the Lambda row. → Cost of the sampled evaluator traffic is under "Per use", not in the "Idle" column.
  5. **Find** the Cognito, SQS + DLQ and SNS rows. → Each is listed with Idle "$0.00" and a per-use pricing note (or a first billed day if present).
  6. **Scan** the Idle column. → No row has a non-zero fixed amount.
- **Expected result:** Gross and credits are two figures; evaluator traffic sits under per-use; Cognito, SQS + DLQ and SNS show idle $0.00. A non-zero idle line is a defect (AC-1).

### A-16-TC-003: CDK synth assertions enforce the zero-idle rules

- **Priority / tags:** P1 · `@smoke @cdk`
- **Maps to:** AC-2, FR-002, NFR-001
- **Preconditions:** No hosted URL needed (CDK assertion case, run in CI).
- **Test data:** Synthesised templates of all stacks in `infra/`.
- **Steps:**
  1. **Run** `cdk synth` in CI for every stack. → Synth succeeds.
  2. **Assert** the scheduler rule state is `DISABLED`.
  3. **Assert** the templates contain zero resources of type Secrets Manager secret, RDS, KMS CMK, WAF WebACL, Route 53 hosted zone, and no provisioned concurrency.
  4. **Assert** every log group has retention 14 days, the query log group 30.
  5. **Assert** one AWS Budgets budget of $10 with an alert subscriber.
  6. **Assert** the region comes from config (no literal `eu-north-1`/`us-east-2` in stack code outside config).
- **Expected result:** All six assertions pass; any added Secrets Manager/RDS/CMK/WAF/hosted zone/provisioned concurrency, enabled scheduler or wrong retention fails the test.

### A-16-TC-004: Injected always-on resource makes the assertion fail

- **Priority / tags:** P2 · `@negative @cdk`
- **Maps to:** AC-2, FR-002
- **Preconditions:** TC-003 passes on the real app.
- **Test data:** A test-only stack adding `AWS::WAFv2::WebACL`, an enabled scheduler, and a 30-day log group (not the query log).
- **Steps:**
  1. **Synthesise** the test-only stack in the CDK test harness.
  2. **Run** the TC-003 assertions against it. → Three assertions fail, each naming its resource type or property ("WAF", "scheduler state ENABLED", "retention 30").
- **Expected result:** The harness reports exactly three failing assertions with those names; the real app is untouched.

### A-16-TC-005: Every source has a complete limits row

- **Priority / tags:** P1 · `@smoke`
- **Maps to:** AC-3, FR-003
- **Preconditions:** `docs/source-limits.md` committed.
- **Test data:** Source register: Travis GIS, Austin Socrata permits (2,380,725 rows, ≤ 50,000 per page), BBB (≤ 1 request per 3 s, Cloudflare challenge), Bedrock (10 requests per minute), TCAD publicinformation, Filebase.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/coverage` in a private window.
  2. **Click** the "Limits" anchor.
  3. **Read** the Austin Socrata row. → Shows throughput (rows or requests per minute), page size 50,000, the measured full-capture duration for the 2,380,725-row backfill, rate limit, anti-bot posture and the optimisation applied.
  4. **Read** the Travis GIS row. → Shows page size 2,000 features and the measured full paging duration.
  5. **Read** the BBB and Bedrock rows. → BBB shows "1 request per 3 s" and the Cloudflare challenge date; Bedrock shows "10 requests per minute".
  6. **Count** the rows. → Equals the number of sources in the register (100%).
- **Expected result:** Each source row has all six fields filled with measured values and dates; none is blank or a placeholder.

### A-16-TC-006: TCAD row says "blocked" with dates, not a throughput

- **Priority / tags:** P1 · `@negative @missing-data`
- **Maps to:** AC-3, FR-003
- **Preconditions:** TC-005 passed.
- **Test data:** TCAD `publicinformation` returned HTTP 403 on 2026-10-17 and 2026-10-19.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/coverage` in a private window.
  2. **Click** the "Limits" anchor.
  3. **Find** the TCAD row. → Status reads "blocked".
  4. **Read** the row detail. → It names HTTP 403 and both dates (2026-10-17, 2026-10-19).
  5. **Check** the throughput cell. → It shows no number ("not measured · blocked").
- **Expected result:** TCAD is shown as blocked with the two dates; no throughput or rate figure is invented.

### A-16-TC-007: Cost and Limits sections match the two docs, with "as of" and source

- **Priority / tags:** P1 · `@smoke`
- **Maps to:** AC-4, FR-004
- **Preconditions:** `docs/cost.md`, `docs/source-limits.md` committed.
- **Test data:** Both docs parsed by the test.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/coverage` in a private window.
  2. **Read** every numeric cell in Cost and in Limits. → Each is captured.
  3. **Compare** the cells with the tables in the two docs. → 100% equal.
  4. **Check** each section header. → Shows "as of {date}" and a source (Cost Explorer, Filebase, measurement log).
- **Expected result:** Zero differences between page and docs; both sections carry date and source.

### A-16-TC-008: Cost Explorer lag: last available date shown, no zero filled in

- **Priority / tags:** P1 · `@negative @missing-data`
- **Maps to:** AC-5, FR-005
- **Preconditions:** Test configuration whose cost data ends yesterday (the page's data file for the test has no row for today).
- **Test data:** Cost data dated yesterday (UTC).
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/coverage` in a private window.
  2. **Click** the "Cost" anchor.
  3. **Read** the section header. → It reads "as of {yesterday's date}".
  4. **Look** for a row for today. → There is none, and no "$0.00" is shown as today's value.
  5. **Check** the partial state against `CoverageStates.dc.html`. → "Partial (as of yesterday)" notice is present.
- **Expected result:** Header "as of {last available date}"; no fabricated figure for the missing day.

### A-16-TC-009: Filebase usage not readable shows the reason

- **Priority / tags:** P1 · `@negative @missing-data`
- **Maps to:** AC-5, FR-005
- **Preconditions:** Filebase usage field absent in the cost data (as when its API cannot be read).
- **Test data:** Filebase usage data not available.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/coverage` in a private window.
  2. **Click** the "Cost" anchor.
  3. **Find** the Filebase row. → It reads "Filebase usage: not available · {reason}" with a non-empty reason.
  4. **Check** the usage cell. → No "0" or "$0.00" is shown.
- **Expected result:** Exact pattern "Filebase usage: not available · {reason}"; no zero.

### A-16-TC-010: Admin signs in with email and password and lands on Runs

- **Priority / tags:** P1 · `@smoke @auth`
- **Maps to:** AC-6, FR-006, NFR-004
- **Preconditions:** Admin test user exists in the `admin` group; credentials in the local env file (never committed).
- **Test data:** `ADMIN_TEST_EMAIL`, `ADMIN_TEST_PASSWORD` from the local env file.
- **Steps:**
  1. **Open** `{RUNTIME_URL}/admin` in a private window. → Admin sign-in page shows an Email field, a Password field and a "Sign in" button.
  2. **Type** `${ADMIN_TEST_EMAIL}` and `${ADMIN_TEST_PASSWORD}` (read from the local env file) and **click** "Sign in". → Browser lands on Runs.
  3. **Read** the header. → "Signed in as admin" is shown.
  4. **Look** at the Runs page. → Start, Stop and Retry buttons are visible.
  5. **Check** the sign-in board states. → No "code sent" step appears (Justified in the parity matrix).
- **Expected result:** Runs page with Start / Stop / Retry and the text "Signed in as admin".

### A-16-TC-011: Signed-out visitors never see admin controls

- **Priority / tags:** P1 · `@negative @auth`
- **Maps to:** AC-6, FR-006
- **Preconditions:** None.
- **Test data:** No credentials.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/runs` in a private window.
  2. **Look** for Start, Stop, Retry buttons and "Signed in as admin". → None in the DOM (not merely hidden).
  3. Open `{RUNTIME_URL}/admin` in a private window. → Sign-in form shows. **Click** "Sign in" with both fields empty. → A field error shows and the page does not navigate.
  4. **Call** `admin.runs.start` without a token. → HTTP 401.
- **Expected result:** No admin control in the DOM; 401 for the unauthenticated call.

### A-16-TC-012: Sign-in refused: wrong password and Cognito unavailable

- **Priority / tags:** P1 · `@negative @auth`
- **Maps to:** AC-6 edge, FR-006
- **Preconditions:** For the unavailable case, the Cognito endpoint is stubbed to answer `TooManyRequestsException` / `LimitExceededException` in the browser test.
- **Test data:** `ADMIN_TEST_EMAIL` with the password "wrong-password-A16".
- **Steps:**
  1. Open `{RUNTIME_URL}/admin` in a private window.
  2. **Type** `${ADMIN_TEST_EMAIL}` and "wrong-password-A16", **click** "Sign in". → A refusal message appears, no navigation, and the message does not say which of email or password was wrong.
  3. **Stub** Cognito to answer a rate/limit error, **retry** the sign-in. → The screen shows "Sign-in is not available right now, try later".
  4. Open `{RUNTIME_URL}/tx/travis/explore` in a private window. → The public app loads normally.
- **Expected result:** Exact message "Sign-in is not available right now, try later" for the limit case; public pages unaffected.

### A-16-TC-013: Start reaches the bridge within 60 s and Runs shows Running

- **Priority / tags:** P1 · `@smoke @demo @bridge`
- **Maps to:** AC-7, FR-007, NFR-003
- **Preconditions:** Bridge running on the operator machine; no run active.
- **Test data:** Start for "Austin permits since Run {n} watermark" (n = latest published run, recorded at run time).
- **Steps:**
  1. **Open** `{RUNTIME_URL}/admin` in a private window. → Admin sign-in page shows an Email field, a Password field and a "Sign in" button.
  2. **Type** `${ADMIN_TEST_EMAIL}` and `${ADMIN_TEST_PASSWORD}` (read from the local env file) and **click** "Sign in". → Browser lands on Runs.
  3. **Click** Start for "Austin permits since Run {n} watermark". → One command ID is shown.
  4. **Record** the SQS message ID, then **poll** the bridge log. → The same command ID appears within 60 s.
  5. **Check** Restate. → A `CountyIngest` workflow ID exists for that command.
  6. **Read** the Runs page. → "Running · started {UTC time}" from `runs/live.json`.
- **Expected result:** Chain recorded in `docs/evidence/A-16.md`: SQS message ID → bridge log → Restate workflow ID; pickup ≤ 60 s; status text "Running · started {UTC time}".

### A-16-TC-014: Second Start while a run is active is rejected

- **Priority / tags:** P1 · `@negative @edge`
- **Maps to:** AC-7 edge, FR-007
- **Preconditions:** TC-013 run is still active.
- **Test data:** Same Start window.
- **Steps:**
  1. **Open** `{RUNTIME_URL}/admin` in a private window. → Admin sign-in page shows an Email field, a Password field and a "Sign in" button.
  2. **Type** `${ADMIN_TEST_EMAIL}` and `${ADMIN_TEST_PASSWORD}` (read from the local env file) and **click** "Sign in". → Browser lands on Runs.
  3. **Click** Start twice in a row. → The first is accepted.
  4. **Read** the second response. → "A run is already running" is shown.
  5. **Count** SQS messages for the window. → Exactly one command ID exists.
- **Expected result:** Message "A run is already running"; one command ID per run.

### A-16-TC-015: Stop during publication leaves no half-published CIDs

- **Priority / tags:** P2 · `@edge @bridge`
- **Maps to:** AC-7 edge, FR-007
- **Preconditions:** A run in its publish step (use a small window).
- **Test data:** Run started by TC-013.
- **Steps:**
  1. **Open** `{RUNTIME_URL}/admin` in a private window. → Admin sign-in page shows an Email field, a Password field and a "Sign in" button.
  2. **Type** `${ADMIN_TEST_EMAIL}` and `${ADMIN_TEST_PASSWORD}` (read from the local env file) and **click** "Sign in". → Browser lands on Runs.
  3. **Click** Stop while the run's step is "publish". → Stop is acknowledged.
  4. **Wait** for the bridge to finish the current atomic step. → The run ends as stopped.
  5. **Read** the run limitations. → It contains "stopped by admin".
  6. **Verify** the manifest. → Every CID it lists resolves; no CID is listed that is not pinned.
- **Expected result:** Run limitations include "stopped by admin"; zero half-published CIDs.

### A-16-TC-016: Non-admin signed-in user gets 403 and nothing is queued

- **Priority / tags:** P1 · `@negative @security`
- **Maps to:** AC-8, FR-008, NFR-004
- **Preconditions:** Non-admin Cognito user (not in `admin` group), credentials in the local env file.
- **Test data:** `NONADMIN_TEST_EMAIL`, `NONADMIN_TEST_PASSWORD`; SQS queue depth read before and after.
- **Steps:**
  1. Open `{RUNTIME_URL}/admin` in a private window.
  2. **Sign in** as the non-admin. → No Start / Stop / Retry shown.
  3. **Call** `admin.runs.start`, `admin.runs.stop`, `admin.runs.retry`, `admin.activity.summary` with that user's token. → Each answers HTTP 403.
  4. **Read** the queue depth. → Unchanged.
  5. **Search** the API log for the refusal. → A refusal line exists and contains no token.
- **Expected result:** 403 on every `admin.*` procedure; zero messages queued; log line without token.

### A-16-TC-017: Expired token gets 401 and nothing is queued

- **Priority / tags:** P1 · `@negative @security`
- **Maps to:** AC-8, FR-008, NFR-004
- **Preconditions:** An admin token past its expiry (captured earlier, or time-shifted fixture).
- **Test data:** Expired access token.
- **Steps:**
  1. **Open** `{RUNTIME_URL}/admin` in a private window. → Admin sign-in page shows an Email field, a Password field and a "Sign in" button.
  2. **Call** `admin.runs.start` with the expired token. → HTTP 401.
  3. **Read** the queue depth. → Unchanged.
  4. **Search** the API log. → Refusal logged, token string absent.
- **Expected result:** 401; zero messages queued; no token in logs.

### A-16-TC-018: Bridge offline: command expires after 15 minutes

- **Priority / tags:** P1 · `@negative @missing-data @bridge`
- **Maps to:** AC-9, FR-009
- **Preconditions:** The bridge is stopped.
- **Test data:** Start for the standard Austin permits window; clock 15 minutes.
- **Steps:**
  1. Confirm **the bridge is stopped** (no poll in its log).
  2. **Open** `{RUNTIME_URL}/admin` in a private window. → Admin sign-in page shows an Email field, a Password field and a "Sign in" button.
  3. **Type** `${ADMIN_TEST_EMAIL}` and `${ADMIN_TEST_PASSWORD}` (read from the local env file) and **click** "Sign in". → Browser lands on Runs.
  4. **Click** Start. → Command accepted and listed as pending.
  5. **Wait** 15 minutes. → UI shows "Bridge offline · command expired at {time}".
  6. **Start** the bridge. → It receives nothing and starts no workflow.
- **Expected result:** Exact text "Bridge offline · command expired at {time}"; no run starts later.

### A-16-TC-019: Three failed receives move the message to the DLQ and the alarm emails

- **Priority / tags:** P2 · `@negative @bridge`
- **Maps to:** AC-9, FR-009
- **Preconditions:** Test queue or message that is received but not deleted.
- **Test data:** One test command message; operator inbox access.
- **Steps:**
  1. **Receive** the message 3 times without deleting it. → It moves to the DLQ.
  2. **Read** the DLQ depth. → 1.
  3. **Wait** for the alarm. → The DLQ alarm goes to ALARM and one SNS email reaches the operator.
- **Expected result:** DLQ depth 1; alarm email received; email text saved in `docs/evidence/A-16.md`.

### A-16-TC-020: Activity summary loads from Logs Insights with query links

- **Priority / tags:** P1 · `@smoke`
- **Maps to:** AC-10, FR-010, NFR-003
- **Preconditions:** 30 days of query log.
- **Test data:** Admin session.
- **Steps:**
  1. **Open** `{RUNTIME_URL}/admin` in a private window. → Admin sign-in page shows an Email field, a Password field and a "Sign in" button.
  2. **Type** `${ADMIN_TEST_EMAIL}` and `${ADMIN_TEST_PASSWORD}` (read from the local env file) and **click** "Sign in". → Browser lands on Runs.
  3. **Open** `{RUNTIME_URL}/activity`. → Summary shows questions per day, p95 latency, failures by outcome.
  4. **Click** a number. → It opens or reveals the Logs Insights query that produced it.
  5. **Reload**. → Served from the 5-minute cache.
- **Expected result:** All three metrics render; every number has a query link.

### A-16-TC-021: Activity empty and error states

- **Priority / tags:** P2 · `@negative @missing-data`
- **Maps to:** AC-10, FR-010
- **Preconditions:** Stub the summary response empty, then failing.
- **Test data:** Admin session.
- **Steps:**
  1. **Open** `{RUNTIME_URL}/admin` in a private window. → Admin sign-in page shows an Email field, a Password field and a "Sign in" button.
  2. **Type** `${ADMIN_TEST_EMAIL}` and `${ADMIN_TEST_PASSWORD}` (read from the local env file) and **click** "Sign in". → Browser lands on Runs.
  3. **Open** the Activity page with an empty log. → The empty state from `ActivityStates.dc.html` shows.
  4. **Stub** the query to fail. → The error state shows with the reason, no zeros.
- **Expected result:** Empty and error states match the board; no invented numbers.

### A-16-TC-022: CDK assertions for Part 2 resources

- **Priority / tags:** P1 · `@smoke @cdk`
- **Maps to:** AC-11, FR-006, FR-009, NFR-001
- **Preconditions:** None (CDK assertion case).
- **Test data:** Synthesised templates.
- **Steps:**
  1. **Run** `cdk synth`.
  2. **Assert** the user pool has self sign-up off (admin-create only) and an `admin` group.
  3. **Assert** the queue has a DLQ with `maxReceiveCount` 3, 15-minute message retention, and one alarm to an SNS email topic.
  4. **Assert** no resource lets AWS reach the operator machine (no inbound VPN, tunnel or API target pointing to it).
  5. **Search** `apps/` and `infra/` for a Query DB connection string. → 0 matches.
  6. **Assert** no always-on cost resource added by Part 2.
- **Expected result:** All assertions pass; failures name the violating resource.

### A-16-TC-023: Shell, Hub and Welcome: parity with board at 390, 768 and 1440

- **Priority / tags:** P2 · `@parity @responsive`
- **Maps to:** AC-12, FR-011, NFR-002
- **Preconditions:** Parity matrix `docs/evidence/A-16-prototype-parity.md` filled for this family.
- **Test data:** Board files `design/prototype/Hub*.dc.html` (every state listed there); light theme; placeholder numbers on the boards are not compared. Routes: `/`, `/tx/travis`.
- **Steps:**
  1. Open `{RUNTIME_URL}/` in a private window.
  2. **Set** the viewport to 390 px wide. → Layout, section order, components, labels match the board's 390 state.
  3. **Set** 768 px, then 1440 px. → Same check against the 768 and 1440 boards.
  4. **Reach** each other state on the board (empty, error, loading, populated as listed). → Each matches.
  5. **Compare** with the parity matrix. → Every cell for this family is Match, Fixed or Justified, and every difference lists its reason (AD-xx decision, real data or accessibility rule).
- **Expected result:** Zero unexplained differences for this family; matrix cells and the live page agree.

### A-16-TC-024: Explore, drawer and filters: parity with board at 390, 768 and 1440

- **Priority / tags:** P2 · `@parity @responsive`
- **Maps to:** AC-12, FR-011, NFR-002
- **Preconditions:** Parity matrix `docs/evidence/A-16-prototype-parity.md` filled for this family.
- **Test data:** Board files `design/prototype/Explore*.dc.html` (every state listed there); light theme; placeholder numbers on the boards are not compared. Routes: `/tx/travis/explore`.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/explore` in a private window.
  2. **Set** the viewport to 390 px wide. → Layout, section order, components, labels match the board's 390 state.
  3. **Set** 768 px, then 1440 px. → Same check against the 768 and 1440 boards.
  4. **Reach** each other state on the board (empty, error, loading, populated as listed). → Each matches.
  5. **Compare** with the parity matrix. → Every cell for this family is Match, Fixed or Justified, and every difference lists its reason (AD-xx decision, real data or accessibility rule).
- **Expected result:** Zero unexplained differences for this family; matrix cells and the live page agree.

### A-16-TC-025: ExploreQ AI and SQL states: parity with board at 390, 768 and 1440

- **Priority / tags:** P2 · `@parity @responsive`
- **Maps to:** AC-12, FR-011, NFR-002
- **Preconditions:** Parity matrix `docs/evidence/A-16-prototype-parity.md` filled for this family.
- **Test data:** Board files `design/prototype/ExploreQ*.dc.html` (every state listed there); light theme; placeholder numbers on the boards are not compared. Routes: `/tx/travis/explore?tab=ai`, `?tab=sql`.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/explore?tab=ai` in a private window.
  2. **Set** the viewport to 390 px wide. → Layout, section order, components, labels match the board's 390 state.
  3. **Set** 768 px, then 1440 px. → Same check against the 768 and 1440 boards.
  4. **Reach** each other state on the board (empty, error, loading, populated as listed). → Each matches.
  5. **Compare** with the parity matrix. → Every cell for this family is Match, Fixed or Justified, and every difference lists its reason (AD-xx decision, real data or accessibility rule).
- **Expected result:** Zero unexplained differences for this family; matrix cells and the live page agree.

### A-16-TC-026: Data catalog, manifest and verify: parity with board at 390, 768 and 1440

- **Priority / tags:** P2 · `@parity @responsive`
- **Maps to:** AC-12, FR-011, NFR-002
- **Preconditions:** Parity matrix `docs/evidence/A-16-prototype-parity.md` filled for this family.
- **Test data:** Board files `design/prototype/Data*.dc.html` (every state listed there); light theme; placeholder numbers on the boards are not compared. Routes: `/tx/travis/data`.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/data` in a private window.
  2. **Set** the viewport to 390 px wide. → Layout, section order, components, labels match the board's 390 state.
  3. **Set** 768 px, then 1440 px. → Same check against the 768 and 1440 boards.
  4. **Reach** each other state on the board (empty, error, loading, populated as listed). → Each matches.
  5. **Compare** with the parity matrix. → Every cell for this family is Match, Fixed or Justified, and every difference lists its reason (AD-xx decision, real data or accessibility rule).
- **Expected result:** Zero unexplained differences for this family; matrix cells and the live page agree.

### A-16-TC-027: Runs, Compare, Log and RunsAdmin: parity with board at 390, 768 and 1440

- **Priority / tags:** P2 · `@parity @responsive`
- **Maps to:** AC-12, FR-011, NFR-002
- **Preconditions:** Parity matrix `docs/evidence/A-16-prototype-parity.md` filled for this family.
- **Test data:** Board files `design/prototype/Runs*.dc.html` (every state listed there); light theme; placeholder numbers on the boards are not compared. Routes: `/tx/travis/runs`.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/runs` in a private window. Admin pages: sign in first as in A-16-TC-010.
  2. **Set** the viewport to 390 px wide. → Layout, section order, components, labels match the board's 390 state.
  3. **Set** 768 px, then 1440 px. → Same check against the 768 and 1440 boards.
  4. **Reach** each other state on the board (empty, error, loading, populated as listed). → Each matches.
  5. **Compare** with the parity matrix. → Every cell for this family is Match, Fixed or Justified, and every difference lists its reason (AD-xx decision, real data or accessibility rule).
- **Expected result:** Zero unexplained differences for this family; matrix cells and the live page agree.

### A-16-TC-028: Coverage: parity with board at 390, 768 and 1440

- **Priority / tags:** P2 · `@parity @responsive`
- **Maps to:** AC-12, FR-011, NFR-002
- **Preconditions:** Parity matrix `docs/evidence/A-16-prototype-parity.md` filled for this family.
- **Test data:** Board files `design/prototype/Coverage*.dc.html` (every state listed there); light theme; placeholder numbers on the boards are not compared. Routes: `/tx/travis/coverage`.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/coverage` in a private window.
  2. **Set** the viewport to 390 px wide. → Layout, section order, components, labels match the board's 390 state.
  3. **Set** 768 px, then 1440 px. → Same check against the 768 and 1440 boards.
  4. **Reach** each other state on the board (empty, error, loading, populated as listed). → Each matches.
  5. **Compare** with the parity matrix. → Every cell for this family is Match, Fixed or Justified, and every difference lists its reason (AD-xx decision, real data or accessibility rule).
- **Expected result:** Zero unexplained differences for this family; matrix cells and the live page agree.

### A-16-TC-029: Help MCP: parity with board at 390, 768 and 1440

- **Priority / tags:** P2 · `@parity @responsive`
- **Maps to:** AC-12, FR-011, NFR-002
- **Preconditions:** Parity matrix `docs/evidence/A-16-prototype-parity.md` filled for this family.
- **Test data:** Board files `design/prototype/HelpMcp*.dc.html` (every state listed there); light theme; placeholder numbers on the boards are not compared. Routes: `/help/mcp`.
- **Steps:**
  1. Open `{RUNTIME_URL}/help/mcp` in a private window.
  2. **Set** the viewport to 390 px wide. → Layout, section order, components, labels match the board's 390 state.
  3. **Set** 768 px, then 1440 px. → Same check against the 768 and 1440 boards.
  4. **Reach** each other state on the board (empty, error, loading, populated as listed). → Each matches.
  5. **Compare** with the parity matrix. → Every cell for this family is Match, Fixed or Justified, and every difference lists its reason (AD-xx decision, real data or accessibility rule).
- **Expected result:** Zero unexplained differences for this family; matrix cells and the live page agree.

### A-16-TC-030: Legal: parity with board at 390, 768 and 1440

- **Priority / tags:** P2 · `@parity @responsive`
- **Maps to:** AC-12, FR-011, NFR-002
- **Preconditions:** Parity matrix `docs/evidence/A-16-prototype-parity.md` filled for this family.
- **Test data:** Board files `design/prototype/Legal*.dc.html` (every state listed there); light theme; placeholder numbers on the boards are not compared. Routes: `/legal/terms`, `/legal/privacy`, `/legal/data`.
- **Steps:**
  1. Open `{RUNTIME_URL}/legal/terms` in a private window.
  2. **Set** the viewport to 390 px wide. → Layout, section order, components, labels match the board's 390 state.
  3. **Set** 768 px, then 1440 px. → Same check against the 768 and 1440 boards.
  4. **Reach** each other state on the board (empty, error, loading, populated as listed). → Each matches.
  5. **Compare** with the parity matrix. → Every cell for this family is Match, Fixed or Justified, and every difference lists its reason (AD-xx decision, real data or accessibility rule).
- **Expected result:** Zero unexplained differences for this family; matrix cells and the live page agree.

### A-16-TC-031: Coming soon: parity with board at 390, 768 and 1440

- **Priority / tags:** P2 · `@parity @responsive`
- **Maps to:** AC-12, FR-011, NFR-002
- **Preconditions:** Parity matrix `docs/evidence/A-16-prototype-parity.md` filled for this family.
- **Test data:** Board files `design/prototype/Extensions*.dc.html` (every state listed there); light theme; placeholder numbers on the boards are not compared. Routes: `/coming-soon`.
- **Steps:**
  1. Open `{RUNTIME_URL}/coming-soon` in a private window.
  2. **Set** the viewport to 390 px wide. → Layout, section order, components, labels match the board's 390 state.
  3. **Set** 768 px, then 1440 px. → Same check against the 768 and 1440 boards.
  4. **Reach** each other state on the board (empty, error, loading, populated as listed). → Each matches.
  5. **Compare** with the parity matrix. → Every cell for this family is Match, Fixed or Justified, and every difference lists its reason (AD-xx decision, real data or accessibility rule).
- **Expected result:** Zero unexplained differences for this family; matrix cells and the live page agree.

### A-16-TC-032: AdminSignIn: parity with board at 390, 768 and 1440

- **Priority / tags:** P2 · `@parity @responsive`
- **Maps to:** AC-12, FR-011, NFR-002
- **Preconditions:** Parity matrix `docs/evidence/A-16-prototype-parity.md` filled for this family.
- **Test data:** Board files `design/prototype/AdminSignIn*.dc.html` (every state listed there); light theme; placeholder numbers on the boards are not compared. Routes: `/admin`.
- **Steps:**
  1. Open `{RUNTIME_URL}/admin` in a private window.
  2. **Set** the viewport to 390 px wide. → Layout, section order, components, labels match the board's 390 state.
  3. **Set** 768 px, then 1440 px. → Same check against the 768 and 1440 boards.
  4. **Reach** each other state on the board (empty, error, loading, populated as listed). → Each matches.
  5. **Compare** with the parity matrix. → Every cell for this family is Match, Fixed or Justified, and every difference lists its reason (AD-xx decision, real data or accessibility rule).
- **Expected result:** Zero unexplained differences for this family; matrix cells and the live page agree.

### A-16-TC-033: Activity: parity with board at 390, 768 and 1440

- **Priority / tags:** P2 · `@parity @responsive`
- **Maps to:** AC-12, FR-011, NFR-002
- **Preconditions:** Parity matrix `docs/evidence/A-16-prototype-parity.md` filled for this family.
- **Test data:** Board files `design/prototype/Activity*.dc.html` (every state listed there); light theme; placeholder numbers on the boards are not compared. Routes: `/activity`.
- **Steps:**
  1. Open `{RUNTIME_URL}/activity` in a private window. Admin pages: sign in first as in A-16-TC-010.
  2. **Set** the viewport to 390 px wide. → Layout, section order, components, labels match the board's 390 state.
  3. **Set** 768 px, then 1440 px. → Same check against the 768 and 1440 boards.
  4. **Reach** each other state on the board (empty, error, loading, populated as listed). → Each matches.
  5. **Compare** with the parity matrix. → Every cell for this family is Match, Fixed or Justified, and every difference lists its reason (AD-xx decision, real data or accessibility rule).
- **Expected result:** Zero unexplained differences for this family; matrix cells and the live page agree.

### A-16-TC-034: Explore README searches on the full county, p95 < 3 s

- **Priority / tags:** P1 · `@smoke @demo @perf`
- **Maps to:** AC-13, FR-012, NFR-003
- **Preconditions:** Per-run Explore index published for the latest full-county run (441,961 properties).
- **Test data:** Four README searches: (a) radius + roof age, Austin city 5 mi, roof ≥ 15 years; (b) open permits; (c) tenure ≥ 10 years; (d) out-of-area owner. 20 timed runs each. Snapshot manifest CID recorded at run time.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/explore` in a private window.
  2. **Run** search (a) with the filters. → Results with count and provenance (run ID, manifest CID).
  3. **Run** (b), (c), (d) the same way. → Each returns results or an honest empty/"field not published" statement; for (d) the owner mailing gap is stated, never filtered.
  4. **Time** each search 20 times. → p95 of each < 3 s.
  5. **Check** the network log. → No HTTP 500, no ~29 s call.
- **Expected result:** p95 < 3 s for all four; zero timeouts or 5xx; provenance on every result.

### A-16-TC-035: Two README agent prompts answer with citations and no timeout

- **Priority / tags:** P1 · `@smoke @demo`
- **Maps to:** AC-13, FR-012
- **Preconditions:** TC-034 index live.
- **Test data:** The two README agent prompts, word for word from `README.md` Demo Transcript.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/explore` in a private window.
  2. **Click** the "AI" tab.
  3. **Submit** README prompt 1. → Answer arrives before the 25 s client limit with `outcome` = `answered`, citations (`property_cid`, source) and stated assumptions.
  4. **Submit** README prompt 2. → Same checks.
  5. **Check** responses. → No HTTP 500, no `timed_out`.
- **Expected result:** Both prompts return outcome `answered` with citations; no timeout.

### A-16-TC-036: One MCP data tool call answers on the full county

- **Priority / tags:** P1 · `@mcp`
- **Maps to:** AC-13, FR-012
- **Preconditions:** `MCP_URL`, `MCP_TOKEN` in the environment.
- **Test data:** `search_properties` with the TC-034 (a) arguments.
- **Steps:**
  1. **Send** `POST {MCP_URL}` `tools/call` `search_properties` with the bearer token from env. → HTTP 200 inside the 15 s Lambda limit.
  2. **Compare** the `property_cid` set with Explore search (a). → Identical.
  3. **Read** one row. → Carries `run_id`, `manifest_cid`, `table_cid`, `source_url`, `captured_at`.
- **Expected result:** Result sets equal; full provenance; no timeout.

### A-16-TC-037: Index is built only from that run's published CIDs

- **Priority / tags:** P1 · `@negative @security`
- **Maps to:** AC-13, FR-012
- **Preconditions:** TC-034 index live.
- **Test data:** The index header and the run manifest.
- **Steps:**
  1. **Fetch** the index header for the latest run. → Lists the source CIDs and the run's `manifest_cid`.
  2. **Compare** with the run manifest's artifact CIDs. → Every index CID is in the manifest; none is missing or extra.
  3. **Check** the header for a raw-table permit count (A14-7). → Present.
- **Expected result:** Index CIDs are a subset of the manifest's published CIDs; recorded in the index.

### A-16-TC-038: Parked A-13/A-14 tests run again and pass or are listed as exceptions

- **Priority / tags:** P1 · `@closure`
- **Maps to:** AC-13, AC-14, FR-012, FR-013
- **Preconditions:** Every `parkGap(` call removed from `tests/e2e`.
- **Test data:** Parked IDs from `docs/evidence/A-13.md` and `tests/e2e/lib/a13-fixtures.ts`: exploreSearch gap: A-13-TC-008, 009, 025-027, 029-037, 041, 043, 062, 065, 073, 074, 086; sqlFirstQuery gap: A-13-TC-004, 023, 028, 038, 039, 040; runsLogLcp gap: A-13-TC-058, 081; A-14 tests parked for the full county (G1 to G6, AC-8 three-way comparison, MCP checks on Run 2).
- **Steps:**
  1. **Search** `tests/e2e` for `parkGap(`. → 0 matches.
  2. **Run** the parked IDs against `{RUNTIME_URL}`. → Each is executed (not skipped).
  3. **Read** the report. → Each ID passed, or failed with a defect, or is listed in `docs/evidence/A-16.md` § Exceptions with PO decision.
  4. **Check** the counts. → 0 skipped or fixme counted as passed.
- **Expected result:** Every parked ID has a real result; none is counted as passed while skipped.

### A-16-TC-039: Closure table checked against evidence

- **Priority / tags:** P1 · `@closure`
- **Maps to:** AC-14, FR-013
- **Preconditions:** `docs/evidence/A-16.md` § Closure exists.
- **Test data:** Closure table of 27 IDs in the story: A11-1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12; A13-1 to A13-8; A14-1 to A14-8.
- **Steps:**
  1. **Parse** the Closure table in `stories/A-16-cost-and-admin.md`. → 27 IDs listed once each.
  2. **Parse** `docs/evidence/A-16.md` § Closure. → Each ID appears once as Closed (with evidence link) or Exception.
  3. **Check** each Exception. → It has a reason and a PO decision in `docs/evidence/A-16.md` § Exceptions (A11-3, A11-5, A14-2 expected).
  4. **Check** each Closed row's evidence file. → Exists and names the ID.
- **Expected result:** 100% of IDs present once; zero IDs missing, duplicated, or Closed without evidence.

### A-16-TC-040: Closed item with no evidence or parked test is rejected

- **Priority / tags:** P2 · `@negative @closure`
- **Maps to:** AC-14, FR-013
- **Preconditions:** TC-039 helper available.
- **Test data:** Fixture closure file with one ID missing, one Closed without link, one Exception without a PO decision.
- **Steps:**
  1. **Run** the TC-039 checker on the fixture. → It fails with three messages naming the ID and the defect: "missing", "closed without evidence", "exception without PO decision".
- **Expected result:** Exactly three failures, each naming its ID.

### A-16-TC-NF-01: Idle cost and budget alert are measurable

- **Priority / tags:** P1 · `@perf @nfr`
- **Maps to:** NFR-001, AC-1, AC-2
- **Preconditions:** TC-001, TC-003 passed.
- **Test data:** Cost data for ≥ 3 billed days.
- **Steps:**
  1. Open `{RUNTIME_URL}/tx/travis/coverage` in a private window.
  2. **Sum** the Idle column. → Fixed total equals $0.00 (storage cents listed separately).
  3. **Read** the budget row. → $10 budget alert with subscriber.
- **Expected result:** Fixed idle = $0.00; one $10 budget.

### A-16-TC-NF-02: Responsive and Atlas check on Coverage and admin pages

- **Priority / tags:** P2 · `@nfr @responsive`
- **Maps to:** NFR-002
- **Preconditions:** Admin user available.
- **Test data:** Pages: Coverage, AdminSignIn, Runs (admin), Activity; widths 390, 768, 1440.
- **Steps:**
  1. **Open** each page (admin pages after sign-in) at each width. → No horizontal scroll; tap targets ≥ 24 px.
  2. **Audit** computed styles. → Only Atlas tokens; `smeargle` report has 0 violations.
- **Expected result:** 0 horizontal scroll, 0 token violations.

### A-16-TC-NF-03: Command pickup and Activity timings

- **Priority / tags:** P1 · `@perf @nfr`
- **Maps to:** NFR-003, AC-7, AC-10
- **Preconditions:** Bridge running.
- **Test data:** 20 Activity loads.
- **Steps:**
  1. **Measure** Start to bridge-log time over 5 runs of the admin Start (stubbed workflow). → Each ≤ 60 s.
  2. **Time** 20 Activity loads with the cache warm. → p95 < 3 s.
- **Expected result:** Pickup ≤ 60 s; Activity p95 < 3 s.

### A-16-TC-NF-04: No token in logs; accessibility of admin pages

- **Priority / tags:** P1 · `@security @nfr`
- **Maps to:** NFR-004, AC-6, AC-8
- **Preconditions:** TC-010, TC-016, TC-017 executed.
- **Test data:** API and bridge logs from those runs.
- **Steps:**
  1. **Grep** API and bridge logs for the three session tokens. → 0 matches.
  2. **Run** axe (WCAG 2.2 AA) on AdminSignIn, Runs (admin), Activity. → 0 serious or critical violations.
  3. **Check** the IAM policies. → Each Lambda has only the actions it uses.
- **Expected result:** 0 token matches; 0 serious axe violations.

## 9. Edge cases

- AWS credits offset: gross and credits shown apart (A-16-TC-002).
- Lambda traffic on the sampled day: per-use, not idle (A-16-TC-002).
- TCAD never reachable: "blocked" with dates (A-16-TC-006).
- Two Start presses: second rejected (A-16-TC-014).
- Stop during publication: no half-published CIDs (A-16-TC-015).
- Cognito refuses sign-in: "Sign-in is not available right now, try later" (A-16-TC-012).
- Cost window of last full billed days and Part 2 resources per-use (A-16-TC-001, 002).

## 10. Gap-linked cases (expected to fail until fixed)

| TC ID | Asserts | Gap | Defect |
| --- | --- | --- | --- |
| A-16-TC-034 | Explore search p95 < 3 s on the full county | A13-1 (HTTP 500 after ~29 s today) | — |
| A-16-TC-035, 036 | Agent and MCP answer on the full county | A14-1 | — |
| A-16-TC-038 | Parked A-13/A-14 tests run again | A13-8 | — |

## 11. Execution log (filled in Phase 5)

| TC ID | Run date | Build (sha) | Result | Evidence | Defect |
| --- | --- | --- | --- | --- | --- |
| A-16-TC-001 | {date} | `{sha}` | — | `docs/evidence/A-16.md` | — |

---

## Gate G6: Test Case Approval

| # | Criterion | Status |
| --- | --- | --- |
| G6-1 | Every AC and every FR maps to at least one TC (sections 2 and 7) | ☐ |
| G6-2 | Happy, negative, edge and missing-data paths covered | ☐ |
| G6-3 | NFRs have test cases with measurable pass criteria | ☐ |
| G6-4 | Every case is a complete sequence starting from the hosted URL (or CDK synth / stopped bridge, as marked) | ☐ |
| G6-5 | Negative cases state the exact message or rejection behavior | ☐ |
| G6-6 | Test data and environment documented, with real records | ☐ |
| G6-7 | Every TC traces to the story and a requirement | ☐ |
| G6-8 | AI pre-check (`developmentsupport-g6-precheck`): PASS | ☐ |

**Decision:** ☐ Approved ☐ Returned, reason: {…} · {date}
