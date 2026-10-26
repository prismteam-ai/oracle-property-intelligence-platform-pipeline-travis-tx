---
id: ERR-2
type: defect
feature: FEAT-A01
story: A-01
test_case: A-01-TC-005, A-01-TC-007, A-01-TC-010, A-01-TC-013, A-01-TC-NF-02, A-01-TC-NF-03
ac_reference: A-01-AC-1 to AC-5
severity: High
status: Closed
found_by: Claude (QC run 2026-10-20)
found_date: 2026-10-20
fix_branch: 001-discover-sources
fix_commit: 9c7579a
retest_date: 2026-10-20
---

# ERR-2: Acceptance helper – `catq`/`repq` fail on every compound expression ("sources is not defined")

## Brief description

The § 6 shell helpers `catq` and `repq` build `new Function('c','return c.'+EXPR)`, which puts `c.` only before the first name. Any expression with a second top-level name (`… && sources.find(…)`, `Math.abs(parcel.gap_pct - …)`) throws `ReferenceError: sources is not defined`, so six cases fail before checking anything. The acceptance suite had not been run end to end before this QC run.

## Related requirement

- **Story:** A-01 · **AC:** A-01-AC-1 to AC-5 · **Requirement:** FR-007a, FR-002, FR-003b, FR-004a; test plan § 6 · **Test case:** A-01-TC-005, A-01-TC-007, A-01-TC-010, A-01-TC-013, A-01-TC-NF-02, A-01-TC-NF-03

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

1. `cd` to the repo root and paste the § 6 shell setup.
2. Run `catq 'sources.find(s=>s.key==="austin_permits").throughput.pages_read >= 3 && sources.find(s=>s.key==="austin_permits").throughput.page_size <= 50000'`.
3. Observe the error.

## Expected result

`true` printed (the catalog has `pages_read: 3`, `page_size: 50000`).

## Actual result

`ReferenceError: sources is not defined` at `<anonymous_script>:3`; exit 1.

## Impact and severity

- **Impact:** six cases (TC-005, TC-007, TC-010, TC-013, TC-NF-02, TC-NF-03) could not run at all.
- **Severity:** High because six P1/P2 cases failed before checking anything.

## Suggested investigation area

The helper evaluates the expression with only the first name scoped.

## Evidence

- [x] Acceptance JSON report of the QC run (`docs/reports/A-01-test-report.md` lists the runs)
- [ ] Screenshot: n/a (terminal)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | The helper evaluates the expression with only the first name scoped. |
| Fix | `a01.steps.ts` § 6 setup: `new Function('c','with(c){return '+EXPR+'}')` (same for `repq`), so every top-level name resolves against the catalog. The test plan's § 6 needs the same change (QC-owned). |
| Re-test | see `docs/reports/A-01-test-report.md` |
| Status | ☒ Closed ☐ Reopened |
