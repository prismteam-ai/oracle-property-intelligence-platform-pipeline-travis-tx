---
id: ERR-6
type: defect
feature: FEAT-A01
story: A-01
test_case: A-01-TC-003, A-01-TC-020, A-01-TC-027, A-01-TC-NF-02
ac_reference: A-01-AC-1, A-01-AC-6
severity: Low
status: Closed
found_by: Claude (QC run 2026-10-20)
found_date: 2026-10-20
fix_branch: 001-discover-sources
fix_commit: 9c7579a
retest_date: 2026-10-20
---

# ERR-6: Acceptance steps – four expectations out of date after approved changes

## Brief description

Four steps encode behaviour that later approved changes replaced: TC-003 expects exactly 2 destination identities (OR-m4 added a third, the configured connection); TC-020 looks for a `geo-check.yml` workflow and "N/A: no geo signal" (the US check ran as `a01-us-gis-probe.yml` under the FR-006b amendment, DEC-A-01-source-access D-2, and GIS's signal moved to `operator_blocked_evidence`); TC-027 expects `resolve` to refuse with exit 1 (it now refuses with exit 2 and sends nothing, CR-3/CR2-1); TC-NF-02 allows only `pipeline/data/raw/tcad` (the 16-byte US-runner count artifact sits in `raw/gis/us-runner-39387019700`).

## Related requirement

- **Story:** A-01 · **AC:** A-01-AC-1, A-01-AC-6 · **Requirement:** FR-001c, FR-006b, FR-006f, NFR (bounded measurement) · **Test case:** A-01-TC-003, A-01-TC-020, A-01-TC-027, A-01-TC-NF-02

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

Run the acceptance suite; observe `expected 3 to deeply equal 2` (TC-003), `expected +0 to be 1` (TC-020), the exit-code mismatch (TC-027), `expected [ 'gis' ] to deeply equal []` (TC-NF-02).

## Expected result

Each step checks the approved behaviour.

## Actual result

As above.

## Impact and severity

- **Impact:** four cases failed although the product behaves as approved.
- **Severity:** Low because the tests lagged behind approved changes; no product defect.

## Suggested investigation area

`a01.steps.ts` tc003, tc020, tc027, tcNf02.

## Evidence

- [x] Acceptance JSON report of the QC run (`docs/reports/A-01-test-report.md` lists the runs)
- [ ] Screenshot: n/a (terminal)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | `a01.steps.ts` tc003, tc020, tc027, tcNf02. |
| Fix | Updated each step (comments cite ERR-6 and the decision); the test plan needs matching wording (QC-owned). |
| Re-test | see `docs/reports/A-01-test-report.md` |
| Status | ☒ Closed ☐ Reopened |
