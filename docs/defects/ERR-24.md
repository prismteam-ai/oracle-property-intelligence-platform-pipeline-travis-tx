---
id: ERR-24
type: defect
feature: FEAT-A11
story: A-11
test_case: A-03-TC-020–TC-031, TC-012, TC-013, TC-NF-01–03 (hosted, `tests/e2e/permits.spec.ts`, `runs.spec.ts`, `perf.spec.ts`) and the pre-publish identity gate
ac_reference: A-11
severity: Critical
status: Closed
found_by: QC test runner (Claude), for HebaGaber
found_date: 2026-10-24
fix_branch: 011-publish-and-runs
fix_commit: "`75a0eaf`, `1fc994a`"
retest_date: "2026-10-25 (hosted CI run 40150597123, commit b1de02c: e2e-hosted isolated, site, permits and manifest all green)"
closed_date: pending
---

# ERR-24: Run 1 permits never joined county properties (0 of 17,387)

## Brief description

In Run 1 none of the 17,387 published permits joined a county property: the shared `property.json` differed between the county and permits outputs (legal description, year built, improvements, geometry).

## Related requirement

- **Story:** A-11 · **Test case:** A-03-TC-020–TC-031, TC-012, TC-013, TC-NF-01–03 (hosted, `tests/e2e/permits.spec.ts`, `runs.spec.ts`, `perf.spec.ts`) and the pre-publish identity gate

## Environment

| Item | Value |
| --- | --- |
| URL | hosted URL (re-test pending) |
| Build | branch `011-publish-and-runs`, 2026-10-24 |

## Impact and severity

- **Severity:** Critical

## Resolution

| Field | Value |
| --- | --- |
| Root cause | `slimPayload` / permits path wrote a different `property.json` than the county path. |
| Fix | Commits `75a0eaf`, `1fc994a`. Data repair: backfill, then Run 2 (15,025 roofing permits; 0 of 10,792 unmatched in the gate). |
| Re-test | Pending on the hosted URL |
| Status | Fixed, closure pending hosted re-test |
