---
id: ERR-8
type: defect
feature: FEAT-A01
story: A-01
test_case: unit test `source-client.resume.test.ts` › "the 2-hour total limit spans all resumes" (A-01-TC-026, FR-003 download limits)
ac_reference: A-01-AC-3, A-01-AC-6
severity: Medium
status: Closed
found_by: Claude (G7 pre-check, CI run 39489669571)
found_date: 2026-10-20
fix_branch: 001-discover-sources
fix_commit: 024d9c0, 56e1426
retest_date: 2026-10-20
---

# ERR-8: Unit tests – download total-limit test is timing-sensitive and failed on the CI runner

## Brief description

`pipeline-ci` run [39489669571](https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/39489669571) on `de1b54e` failed 1 of 502 tests: `test/source-client.resume.test.ts:328` `expect(settled).toBe(true)`. The test advances fake timers 40 times by 50 ms and lets real `.part` file I/O run between steps. On the slower CI disk, 40 rounds were not enough for the download to settle. The same test passed in CI run 39488773733 on `2200636` and locally, and the commit under test (T066) did not touch the download code.

## Related requirement

- **Story:** A-01 · **AC:** A-01-AC-3, A-01-AC-6 · **Requirement:** FR-003 (download stops after 2 hours in total, across resumes) · **Test case:** A-01-TC-026 (unit)

## Environment

| Item | Value |
| --- | --- |
| URL | N/A: Project story, no hosted runtime until A-03 |
| Build | `de1b54e` (CI, `ubuntu-latest`, Node 22) |
| Data snapshot | none (synthetic fake server in the test) |
| Browser / OS / device | GitHub Actions runner `ubuntu-latest` |
| Role | CI |

## Preconditions and test data

- Fake server: the first stream breaks after 600 ms, the resumed stream trickles; `totalMs: 1_000`.

## Steps to reproduce

1. Run the `pipeline-ci` workflow on `de1b54e`, or run the test on a slow disk.
2. Observe `expected false to be true` at line 328.

## Expected result

The download settles as `blocked` (timeout) after one resume, with `timeout_ms` between 1,000 and 1,200 ms of fake time, on any machine.

## Actual result

On the CI runner the loop ran out of steps before the download settled.

## Impact and severity

- **Impact:** a red CI run on the story branch; no product behaviour was wrong.
- **Severity:** Medium because a flaky test blocks the G7 "all green in CI" check.

## Suggested investigation area

The fake-timer loop in `test/source-client.resume.test.ts`.

## Evidence

- [x] CI log of run 39489669571 (Unit tests step)
- [ ] Screenshot: n/a

## Resolution

| Field | Value |
| --- | --- |
| Root cause | Two parts. (1) A fixed step budget (40) for a test loop that also waits on real file I/O. (2) In the client, `timeout_ms` was measured when the receipt was written, after the cleanup that follows the abort, not when the limit fired; on the slower CI disk the fake clock moved on during cleanup, so the second CI run recorded 2,750 ms for a 1,000 ms limit (`expected 2750 to be less than 1200`, run 39489908500). In production this added the cleanup time to the reported value. |
| Fix | Test: budget raised to 400 steps with three `setImmediate` turns per step (commit `024d9c0`). Client (`travis/lib/source-client.ts`): the elapsed time is taken when the limit fires (`firedAt`), so `timeout_ms` reports when the download was stopped and is never below the limit. |
| Re-test | `pipeline-ci` run 39490116172 on `56e1426`: success on attempt 1 and on rerun attempt 2 (502/502) |
| Status | ☒ Closed ☐ Reopened (after the CI re-test) |
