---
id: ERR-3
type: defect
feature: FEAT-A01
story: A-01
test_case: A-01-TC-006
ac_reference: A-01-AC-2
severity: Medium
status: Closed
found_by: Claude (QC run 2026-10-20)
found_date: 2026-10-20
fix_branch: 001-discover-sources
fix_commit: 9c7579a
retest_date: 2026-10-20
---

# ERR-3: Austin counts – capture-bounded recount always returns 0 because the city reloads the dataset in full

## Brief description

TC-006 steps 3, 5 and 6 bound the recount by Socrata's `:created_at <= capture time`. For `3syk-w9eu` every row carries the same `:created_at` (the reload time, 2026-10-20T11:39:24.581Z on this run), so the bounded count is 0 and the step fails even though the recorded count is right.

## Related requirement

- **Story:** A-01 · **AC:** A-01-AC-2 · **Requirement:** FR-002 (AC-2) · **Test case:** A-01-TC-006

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

1. Run `curl -sG -A "$ORACLE_UA" https://data.austintexas.gov/resource/3syk-w9eu.json --data-urlencode '$select=count(*),min(:created_at),max(:created_at)'`.
2. Observe `min` = `max`.
3. Run the step-3 recount with `:created_at <= '2026-10-19T20:59:36.244'`: `count` 0.

## Expected result

The recount reproduces the recorded 2,380,725 within normal daily drift.

## Actual result

Bounded recount 0; today's plain count 2,380,939 (+214, 0.009%); rows without `tcad_id` 63,019 (recorded 63,019).

## Impact and severity

- **Impact:** TC-006 could never pass for a fully reloaded dataset; the recorded counts were right.
- **Severity:** Medium because no data was wrong, but an AC-2 check was unusable.

## Suggested investigation area

Test design: `:created_at` is the load time, not the record time, for this dataset.

## Evidence

- [x] Acceptance JSON report of the QC run (`docs/reports/A-01-test-report.md` lists the runs)
- [ ] Screenshot: n/a (terminal)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | Test design: `:created_at` is the load time, not the record time, for this dataset. |
| Fix | Steps 3, 5 and 6 recount now and allow the same 0.5% drift as TC-005 and TC-014 (`step6NullDrift`). The test plan's TC-006 needs the same wording (QC-owned). |
| Re-test | see `docs/reports/A-01-test-report.md` |
| Status | ☒ Closed ☐ Reopened |
