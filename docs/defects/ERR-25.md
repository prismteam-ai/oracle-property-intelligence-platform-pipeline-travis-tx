---
id: ERR-25
type: defect
feature: FEAT-A11
story: A-11
test_case: A-03-TC-020 and TC-012 (FR-009 count checks, hosted) and the pre-publish identity gate (v_roofing_permit = permits_emitted)
ac_reference: A-11
severity: High
status: Closed
found_by: QC test runner (Claude), for HebaGaber
found_date: 2026-10-24
fix_branch: 011-publish-and-runs
fix_commit: "`0cd4fe5`"
retest_date: "2026-10-25 (hosted CI run 40150597123, commit b1de02c: e2e-hosted isolated, site, permits and manifest all green)"
closed_date: pending
---

# ERR-25: 2,362 D-4b trade sub-permits published as roofing scope in Run 1

## Brief description

Run 1 published 2,362 D-4b trade sub-permits as if they were roofing permits.

## Related requirement

- **Story:** A-11 · **Test case:** A-03-TC-020 and TC-012 (FR-009 count checks, hosted) and the pre-publish identity gate (v_roofing_permit = permits_emitted)

## Environment

| Item | Value |
| --- | --- |
| URL | hosted URL (re-test pending) |
| Build | branch `011-publish-and-runs`, 2026-10-24 |

## Impact and severity

- **Severity:** High

## Resolution

| Field | Value |
| --- | --- |
| Root cause | Trade sub-permits were not excluded from the roofing scope. |
| Fix | Commit `0cd4fe5` skips trade sub-permits (PO decision "Publish roofing only"); Run 2 records them under coverage key `permits_trade_sub_permit` (2,362). |
| Re-test | Pending on the hosted URL |
| Status | Fixed, closure pending hosted re-test |
