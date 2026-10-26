---
id: ERR-5
type: defect
feature: FEAT-A01
story: A-01
test_case: A-01-TC-022
ac_reference: A-01-AC-7
severity: High
status: Closed
found_by: Claude (QC run 2026-10-20)
found_date: 2026-10-20
fix_branch: 001-discover-sources
fix_commit: 9c7579a
retest_date: 2026-10-20
---

# ERR-5: Sources summary – two numbers in "Approved exceptions" have no source URL or capture time

## Brief description

The "Approved exceptions" table added in the review fixes (OR-M3) prints the bound GIS count 373,683 and roll count 493,246 without a source URL and UTC capture time, against FR-007a (every number in `docs/sources.md` is traceable).

## Related requirement

- **Story:** A-01 · **AC:** A-01-AC-7 · **Requirement:** FR-007a (AC-7) · **Test case:** A-01-TC-022

## Environment

| Item | Value |
| --- | --- |
| URL | N/A: Project story, no hosted runtime until A-03 |
| Build | `a96d669` + QC fixes (branch `001-discover-sources`) |
| Data snapshot | catalog `pipeline/docs/travis-sources.yaml`; no manifest CID in A-01 |
| Browser / OS / device | terminal, macOS (darwin-arm64), Node 22.23.3, Vitest 5.0.5 |
| Role | operator |

## Preconditions and test data

- Branch `001-discover-sources`, repo root, § 6 shell setup of `testplans/A-01-test-cases.md`; committed catalog and evidence.

## Steps to reproduce

1. Run `grep -E '\| *[0-9][0-9,]* *\|' docs/sources.md | grep -vcE 'https?://.*[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z'`.

## Expected result

`0`.

## Actual result

`2` (lines 211–212: GIS features 373,683; roll accounts 493,246).

## Impact and severity

- **Impact:** two numbers in the committed, evaluator-facing `docs/sources.md` could not be traced to a source and time.
- **Severity:** High because it breaks AC-7's provenance rule in a deliverable.

## Suggested investigation area

`exceptionsSection` in `travis/discovery/render-sources-md.ts`.

## Evidence

- [x] Acceptance JSON report of the QC run (`docs/reports/A-01-test-report.md` lists the runs)
- [ ] Screenshot: n/a (terminal)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | `exceptionsSection` in `travis/discovery/render-sources-md.ts`. |
| Fix | The table gains Source and Captured (UTC) columns, taken from the measurement each number is bound to; test in `test/review-a01.test.ts` (fails on the old renderer, passes on the new one); `docs/sources.md` re-rendered. |
| Re-test | see `docs/reports/A-01-test-report.md` |
| Status | ☒ Closed ☐ Reopened |
