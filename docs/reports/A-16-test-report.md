---
id: QC-RPT-A-16
type: test-execution-report
feature: FEAT-A16
story: A-16
test_cases: testplans/A-16-test-cases.md
runtime_url: https://016-cost-and-admin.d2lx0utip89u18.amplifyapp.com
build: "871664d (preview) plus the A-16 county and closure specs; API last deployed 2026-10-26 07:00 EEST"
data_snapshot: bafkreifndsdibdllvgpzwmif6getzwvc6rupk5tgeak4eypccaw3t7vlfm
owner: HebaGaber # QC Lead
status: "Draft: 33 of 44 cases pass as automated tests, 11 parity cases pass by hosted review, 5 skipped (bridge on hold or operator-driven), 0 failed; awaiting PO sign-off at G7"
gate: G7
created: 2026-10-26
signed_off_date:
---

# QC Test Report: A-16 Prove zero idle cost, run the pipeline from the hosted app, and close the carried gaps

## Read this first

- Every result was measured on the **hosted** preview or API, never on localhost. Data cases run on the latest full-county run, Run 3 (`travis-full-run3-20261025`, manifest above).
- **Skipped:** the run-command cases that need the bridge on the operator machine (TC-013, TC-014, TC-018) are skipped because the PO put the live bridge test on hold until Run 3.1 is done. TC-015 and TC-019 are operator-driven and also skipped. Their infrastructure half is proven by CDK tests.
- The parity cases TC-023 to TC-033 have no Playwright file. They were checked by hosted side-by-side review against the boards at 390, 768 and 1440 px (`docs/evidence/A-16-prototype-parity.md`). Remaining differences are features the product does not have; they are a recorded PO exception.
- The project CI (`.github/workflows/ci.yml`) runs the A-13 hosted shards and the workspace checks, not the a16 projects. The a16 projects were run by hand against the preview.

## Summary

| Item                                               | Value                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment                                        | Preview `https://016-cost-and-admin.d2lx0utip89u18.amplifyapp.com` · API `https://ciap8om4e2.execute-api.eu-north-1.amazonaws.com` · MCP `https://s7h96zfam0.execute-api.eu-north-1.amazonaws.com/mcp` · 2026-10-26                                                                |
| Test cases in the plan                             | 44 (40 functional + 4 NFR)                                                                                                                                                                                                                                                         |
| Automated and passed                               | 33 (Playwright `a16-cost`, `a16-admin`, `a16-county`, `a16-closure`; CDK `infra/test/idle-cost.test.ts`, `admin-queue.test.ts`)                                                                                                                                                    |
| Passed by hosted review                            | 11 (TC-023 to TC-033, parity)                                                                                                                                                                                                                                                      |
| Skipped                                            | 5 (TC-013, 014, 015, 018, 019), reasons below                                                                                                                                                                                                                                      |
| Failed                                             | 0                                                                                                                                                                                                                                                                                  |
| After the Run 3.1 merge (v1.2 indexes, Api deploy) | `a16-county` + `a16-closure` 7 of 7 on the latest run, Run 3.1; one transient 503 in 80 timed calls on the first run right after the deploy (ERR-79)                                                                                                                               |
| Final hosted Playwright run                        | Build `871664d`, 2026-10-26 08:20 EEST, projects `a16-cost`, `a16-admin`, `a16-county`, `a16-closure` together: **27 passed, 0 failed, 5 skipped** (3.1 min); TC-NF-04 also 3 of 3 on repeat                                                                                       |
| Project CI                                         | Run on `2e052ba` green on all jobs (gitleaks, workspace, oracle-runtime, 7 hosted shards): https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/40270305210. Earlier run on `2d17339`: hosted shards 123 passed, 0 failed, 4 skipped |
| Unit tests                                         | web 610 passed, 1 skipped (51 files); infra CDK A-16 files 26 of 26; e2e lib 104 (13 files)                                                                                                                                                                                        |
| Open Critical defects                              | 0 (ERR-75 to ERR-78 closed)                                                                                                                                                                                                                                                        |
| Code review log                                    | `docs/reviews/CR-A-16.md` (metagross 81, machamp 78, audino 82, `/code-review medium`)                                                                                                                                                                                             |

## Results

### Part 1 · Cost and limits (`tests/e2e/A-16-cost.spec.ts`, project `a16-cost`; CDK)

| TC ID       | AC   | Result | What the pass shows                                                                                                      | Evidence                                     |
| ----------- | ---- | ------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| A-16-TC-001 | AC-1 | PASS   | Coverage › Cost shows $0.00 fixed per month with the billed-day window                                                   | `img/A-16-TC-001-idle-cost-table.png`        |
| A-16-TC-002 | AC-1 | PASS   | Gross usage, credits and per-use lines are shown apart; Part 2 resources are per-use                                     | `img/A-16-TC-002-gross-credits.png`          |
| A-16-TC-003 | AC-2 | PASS   | CDK synth assertions: scheduler disabled, no provisioned or reserved concurrency, 14-day logs, budget, no literal region | `infra/test/idle-cost.test.ts` (22 of 22)    |
| A-16-TC-004 | AC-2 | PASS   | The same assertions run over every stack, so an always-on resource fails them                                            | `infra/test/idle-cost.test.ts`               |
| A-16-TC-005 | AC-3 | PASS   | Every source has a complete limits row                                                                                   | `img/A-16-TC-005-limits-table.png`           |
| A-16-TC-006 | AC-3 | PASS   | The blocked TCAD source shows dates, not a throughput                                                                    | `img/A-16-TC-006-blocked-dates.png`          |
| A-16-TC-007 | AC-4 | PASS   | Page values equal `docs/cost.md` and `docs/source-limits.md`, with "as of" and source                                    | `img/A-16-TC-007-page-equals-docs.png`       |
| A-16-TC-008 | AC-5 | PASS   | Cost Explorer lag: last billed day shown, no zero filled in                                                              | `img/A-16-TC-008-cost-lag.png`               |
| A-16-TC-009 | AC-5 | PASS   | Filebase usage not readable: the reason is shown                                                                         | `img/A-16-TC-009-filebase-not-available.png` |

### Part 2 · Admin sign-in and run commands (`tests/e2e/A-16-admin.spec.ts`, project `a16-admin`; CDK)

| TC ID       | AC    | Result  | What the pass shows                                                                                                                                             | Evidence                                                                        |
| ----------- | ----- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A-16-TC-010 | AC-6  | PASS    | Admin signs in with email and password and lands on Runs with controls                                                                                          | `img/A-16-TC-010-signed-in-runs.png`                                            |
| A-16-TC-011 | AC-6  | PASS    | Signed out: no admin controls; admin calls answer 401                                                                                                           | `img/A-16-TC-011-signed-out-sign-in.png`                                        |
| A-16-TC-012 | AC-6  | PASS    | Wrong password and Cognito unavailable show a fixed message                                                                                                     | `img/A-16-TC-012-wrong-password.png`, `img/A-16-TC-012-cognito-unavailable.png` |
| A-16-TC-013 | AC-7  | SKIPPED | Needs the bridge running (on hold by the PO until Run 3.1 is done)                                                                                              | —                                                                               |
| A-16-TC-014 | AC-7  | SKIPPED | Same reason as TC-013                                                                                                                                           | —                                                                               |
| A-16-TC-015 | AC-7  | SKIPPED | Operator-driven: needs a run in its publish step                                                                                                                | —                                                                               |
| A-16-TC-016 | AC-8  | PASS    | Signed-in non-admin gets 403 and nothing is queued                                                                                                              | `img/A-16-TC-016-non-admin-runs.png`                                            |
| A-16-TC-017 | AC-8  | PASS    | Expired token gets 401 and nothing is queued                                                                                                                    | test log                                                                        |
| A-16-TC-018 | AC-9  | SKIPPED | Needs the bridge stopped after a queued Start (on hold with TC-013)                                                                                             | —                                                                               |
| A-16-TC-019 | AC-9  | SKIPPED | Operator-driven DLQ email; the DLQ after 3 receives and its alarm are proven by CDK tests                                                                       | `infra/test/admin-queue.test.ts`                                                |
| A-16-TC-020 | AC-10 | PASS    | Activity summary with Logs Insights links; a reload is served from the 5-minute cache (each Lambda instance keeps its own cache, so the test checks the window) | `img/A-16-TC-020-activity.png`                                                  |
| A-16-TC-021 | AC-10 | PASS    | Activity error state                                                                                                                                            | `img/A-16-TC-021-activity-error.png`                                            |
| A-16-TC-022 | AC-11 | PASS    | CDK: one user pool, self sign-up off, SRP client without secret, `admin` group, queue + DLQ + alarm, send-only IAM, no inbound path to the operator machine     | `infra/test/idle-cost.test.ts`, `infra/test/admin-queue.test.ts`                |

### Part 3 · Prototype parity (AC-12), hosted review

| TC ID                      | Board family                                                                                            | Result                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-16-TC-023 to A-16-TC-033 | Shell/Hub, Explore, ExploreQ, Data, Runs, Coverage, Help MCP, Legal, Coming soon, AdminSignIn, Activity | PASS by review (not Playwright) | `docs/evidence/A-16-prototype-parity.md`: final review on preview `03c0ebc`, 21 match, 6 justified, 25 differ on 52 cells (was 10/6/36); no horizontal scroll at 390/768/1440. The 25 differences are board features the product does not have (AI three-pane with editable chips, Save, Area/Sort dropdowns, Manifest pager, Verify chips, Gantt, heatmap, reconciliation): PO exception "parity beyond the style-only scope". The ExploreQ SQL state is gone with the SQL tab (PO, `fa09e69`) |

### Part 3 · Full-county index (AC-13) and closure (AC-14) (`A-16-county.spec.ts`, `A-16-closure.spec.ts`)

| TC ID       | AC    | Result | What the pass shows                                                                                                                                                                                                                                                   |
| ----------- | ----- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-16-TC-034 | AC-13 | PASS   | README searches on Run 3, 20 timed calls each after a warm-up: p95 radius + roof 976 ms, open permits 1,245 ms, tenure 976 ms, out-of-area owner 545 ms (answers "owner area not published", no rows); no 5xx. `img/A-16-TC-034-full-county-radius-roof.png`          |
| A-16-TC-035 | AC-13 | PASS   | Real Bedrock calls: D-10 answered in 10.5 s with 50 cited rows (Run 3 provenance); D-11 answered in 6.2 s with 0 rows (`empty_in_scope`, an honest "nothing in scope"). `img/A-16-TC-035-d10-answered.png`, `img/A-16-TC-035-d11-answered.png`                        |
| A-16-TC-036 | AC-13 | PASS   | MCP `search_properties` on Run 3: 200 in 1.37 s, 50 rows of 75,432 with provenance; same `property_cid` set and total as `explore.search`                                                                                                                             |
| A-16-TC-037 | AC-13 | PASS   | Every `table_cid` in returned rows is a table artifact of the Run 3 manifest. Limit: the index header is in private S3, so "no CID missing from the index" is checked at build time by the index tool's `--verify` (`docs/evidence/A-16.md` Part 3), not by this test |
| A-16-TC-038 | AC-14 | PASS   | The only parks left (A-13 TC-053, A-13 TC-081, A-03 TC-034) are recorded exceptions in the Closure table. It checks the sources; the unparked cases' results come from the hosted CI shards                                                                           |
| A-16-TC-039 | AC-14 | PASS   | Both Closure tables list the same 33 IDs; every Closed row names evidence that exists in the repo; every Exception has a reason (first run found 11 rows without a pointer, fixed in the evidence doc)                                                                |
| A-16-TC-040 | AC-14 | PASS   | A synthetic table with a missing ID, a Closed row without evidence and an Exception without a reason gives exactly those three issues (`tests/e2e/lib/closure.test.ts`)                                                                                               |

## Non-functional results

| TC ID         | Result | Actual                                                                                                                                                                                       |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-16-TC-NF-01 | PASS   | $0.00 fixed per month on the page; budget and alarms in CDK                                                                                                                                  |
| A-16-TC-NF-02 | PASS   | Coverage at 390, 768, 1440 px: no horizontal page scroll; tables stack below 840 px with the header kept only for screen readers. `img/A-16-TC-NF-02-coverage-{390,768,1440}.png`            |
| A-16-TC-NF-03 | PASS   | Activity timing within the budget (pickup timing needs the bridge, on hold)                                                                                                                  |
| A-16-TC-NF-04 | PASS   | The access token is in neither page text nor console; axe has no serious or critical issue on sign-in, Runs and Activity, after the Runs loading placeholder got `role="status"` (`871664d`) |

## Defects

| ERR                                                                      | Severity | Status                                       | Fix                                                        |
| ------------------------------------------------------------------------ | -------- | -------------------------------------------- | ---------------------------------------------------------- |
| ERR-75 tRPC stack trace in error bodies                                  | High     | Closed, re-tested (401 without stack)        | Api redeploy 02:05                                         |
| ERR-76 Run 3 listed without an index                                     | High     | Closed, Run 3 index uploaded                 | `docs/defects/ERR-76-run3-listed-without-index.md`         |
| ERR-77 admin routes crashed (`global` undefined)                         | High     | Closed                                       | vite `define: { global: "globalThis" }`                    |
| ERR-79 Run 3.1 latest without an index; contract v1.2 stales every index | High     | Closed, re-tested (v1.2 indexes, Api deploy) | `docs/defects/ERR-79-run3-1-latest-without-index.md`       |
| ERR-78 agent said contractor names are unpublished                       | Medium   | Closed, re-asked on Run 3                    | `docs/defects/ERR-78-agent-says-contractor-unpublished.md` |
| (no ERR) axe `aria-prohibited-attr` on the Runs loading placeholder      | Low      | Fixed                                        | `871664d`                                                  |

## Exceptions and open items

- Bridge live test (TC-013, 014, 018) on hold until Run 3.1 is done (PO).
- Second IPFS pin, MCP burst 503 (no WAF, $0 idle), golden six-case grader on the full county (unsigned fetch 403), SQL panel removed, Catalog/Manifest vitals (A-13 TC-081), parity differences that would be new features: see the Closure table in `docs/evidence/A-16.md`.
- ✋ PO: Cost Explorer screenshot `docs/evidence/img/A-16-billing.png`.

## Sign-off

**Decision:** ☐ Validated (counts toward G7) ☐ Returned, reason: {…} · {date}
