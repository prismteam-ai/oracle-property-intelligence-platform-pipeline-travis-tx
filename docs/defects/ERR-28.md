---
id: ERR-28
type: defect
kind: test defect
feature: FEAT-A13
story: A-13
test_case: A-13-TC-016
ac_reference: A-13-AC-2
severity: Low
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-28: Coverage hosted test – demands a table chip on a kind that has no published table

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **test defect**.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-2 · **Requirement:** FR-002 · **Test case:** A-13-TC-016

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium (desktop; 390 for the touch-target cases) |

## Steps to reproduce

Run `tests/e2e/A-13-*.spec.ts` case `@scenario:A-13-TC-016` with RUNTIME_URL set to the preview.

## Expected result

Each record kind shows its published table, or a reason (AC-2, FR-007).

## Actual result

Key #21 (contractor_*): "the kind's table chip" not found. Contractor states are the run's internal match; the page shows "no published table for this kind in this run".

## Root cause

Test defect: stricter than AC-2, which allows a stated reason. The page is correct.

## Fix

expectKindTable accepts a chip whose CID is in M, or (kind without table) the reason text.

## Regression test

tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-016 (hosted)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | Test defect: stricter than AC-2, which allows a stated reason. The page is correct. |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
