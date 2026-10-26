---
id: ERR-26
type: defect
feature: FEAT-A11
story: A-11
test_case: A-03-TC-032, TC-033, TC-034
ac_reference: A-11
severity: High
status: Closed
found_by: QC test runner (Claude), for HebaGaber
found_date: 2026-10-24
fix_branch: 011-publish-and-runs
fix_commit: "`502bfe6`"
retest_date: "2026-10-25 (hosted CI run 40150597123, commit b1de02c: e2e-hosted isolated, site, permits and manifest all green)"
closed_date: pending
---

# ERR-26: `rawCid()` cannot verify table parts above 256 KiB (fallback crash)

## Brief description

The client-side `rawCid()` check cannot verify table parts larger than 256 KiB, so the fallback path crashes (TC-032, TC-033, TC-034; currently `test.fixme`).

## Related requirement

- **Story:** A-11 · **Test case:** A-03-TC-032, TC-033, TC-034

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
| Root cause | `rawCid()` does not handle multi-chunk content above 256 KiB. |
| Fix | Commit `502bfe6`: verify parts by SHA-256 taken from the CID-verified manifest (PO decision "SHA-256 from manifest", constitution A3 amended). |
| Re-test | Pending on the hosted URL |
| Status | Fixed, closure pending hosted re-test of TC-032/033/034 |
