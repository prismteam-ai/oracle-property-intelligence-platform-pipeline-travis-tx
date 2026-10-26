---
id: ERR-34
type: defect
kind: test defect (harness), with unbounded waits
feature: FEAT-A13
story: A-13
test_case: A-13-TC-073
ac_reference: A-13-AC-10
severity: High
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-34: No-sample-data scan – TC-073 exceeds its 30 minute timeout without naming the stuck step

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **test defect (harness), with unbounded waits**.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-10 · **Test case:** A-13-TC-073

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium, desktop 1440 |

## Steps to reproduce

Run `tests/e2e/A-13-scan.spec.ts` case `@scenario:A-13-TC-073` with RUNTIME_URL set to the preview.

## Expected result

The scan visits every route at 1440 and 390 and ends with 0 hits, in roughly the time the click scan (TC-074, about 256 s) needs.

## Actual result

`Test timeout of 1800000ms exceeded.` then `browserContext.close: Protocol error (Target.disposeBrowserContext): Failed to find context`. Evidence images exist only for hub, runs, runscompare, runslog and coverage; the run stalled on the next route (explore) and the output named no step.

## Impact and severity

- **Impact:** TC-073 (no sample data anywhere) has no result, so the "nothing invented" claim in the demo is unproven; one stuck control hid the result of every other route.
- **Severity:** High because the case gives no evidence at all and a stall costs 30 minutes of a hosted run.

## Root cause

The case ran all routes in one flow with no per-step budget. Its clicks (`tab.click()`, `row.click()`, `isEnabled()`, filter and More sheet) used Playwright's default of no action timeout, so one control that never became actionable (for example a tab list that changes after a click) waited until the 30 minute test timeout. `openSettled` also added a best-effort `networkidle` wait on every page. Every page the scan visited does reach a settled `data-state` (loading, ready or error), so no page defect was found by reading; the exact control on explore was not identifiable from the output.

## Fix

`tests/e2e/A-13-scan.spec.ts` TC-073: each route at each width is its own `test.step` inside `runBudgeted` (new `tests/e2e/lib/step-budget.ts`) with a 60 s budget, 40 s for `data-state` to leave loading (no `networkidle`), a 5 s default action timeout, and a note before each sub-step. A stuck step is recorded as `{route} @ {width}: STEP FAILED: ... no result within 60000 ms; last step: ...` and the other routes still run. The assertions (denylist, prototype CIDs, CID allowlist, ProtoBar selectors, 0 hits) are unchanged.

## Regression test

`tests/e2e/lib/step-budget.test.ts` (overrun message with route and last step, passthrough, no leaked timer). Red before the helper existed (module missing), green after. Hosted TC-073 re-test.

## Resolution

| Field | Value |
| --- | --- |
| Root cause | unbounded Playwright actions in one long flow, no per-route budget, no step names |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
