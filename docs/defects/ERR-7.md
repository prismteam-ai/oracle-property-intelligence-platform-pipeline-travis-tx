---
id: ERR-7
type: defect
feature: FEAT-A01
story: A-01
test_case: A-01-TC-019 (also A-01-TC-008, A-01-TC-NF-01)
ac_reference: A-01-AC-6
severity: Medium
status: Closed
found_by: Claude (QC run 2026-10-20)
found_date: 2026-10-20
fix_branch: 001-discover-sources
fix_commit: 9c7579a
retest_date: 2026-10-20
---

# ERR-7: Unit tests – no test titled with the plan's IDs, so `-t "A-01-TC-019"` runs nothing

## Brief description

The plan maps TC-008, TC-019 and TC-NF-01 to unit tests titled with their IDs. No such titles existed, so `npm test -- -t "A-01-TC-019"` skipped all 496 tests and, with `--passWithNoTests`, exited 0 without a single pass.

## Related requirement

- **Story:** A-01 · **AC:** A-01-AC-6 · **Requirement:** FR-006a, NFR-001 · **Test case:** A-01-TC-019 (also A-01-TC-008, A-01-TC-NF-01)

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

1. Run `npm --prefix pipeline/oracle-runtime test -- -t "A-01-TC-019"`.
2. Observe `Tests 496 skipped (496)`.

## Expected result

The named tests run and pass.

## Actual result

0 tests run; the acceptance step `expected … to match /passed/` fails.

## Impact and severity

- **Impact:** TC-019's unit check ran 0 tests; plan-to-test traceability was broken for three cases.
- **Severity:** Medium because the behaviour was tested but could not be found by its ID.

## Suggested investigation area

`test/source-client.test.ts` describe titles.

## Evidence

- [x] Acceptance JSON report of the QC run (`docs/reports/A-01-test-report.md` lists the runs)
- [ ] Screenshot: n/a (terminal)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | `test/source-client.test.ts` describe titles. |
| Fix | The three describe blocks are titled `A-01-TC-019 no evasion: …` (4 tests), `A-01-TC-008 429 backoff: …` (5) and `A-01-TC-NF-01 etiquette: …` (6); each `-t` now runs and passes them. |
| Re-test | see `docs/reports/A-01-test-report.md` |
| Status | ☒ Closed ☐ Reopened |
