---
id: ERR-29
type: defect
kind: test defect
feature: FEAT-A13
story: A-13
test_case: A-13-TC-071
ac_reference: A-13-AC-13
severity: Low
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-29: Hosted test – picks County option by a label that does not exist

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **test defect**.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-13 · **Requirement:** FR-013 · **Test case:** A-13-TC-071

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium (desktop; 390 for the touch-target cases) |

## Steps to reproduce

Run `tests/e2e/A-13-*.spec.ts` case `@scenario:A-13-TC-071` with RUNTIME_URL set to the preview.

## Expected result

Selecting "Harris County" in the picker shows the Travis-only message.

## Actual result

Test timeout 120000 ms; no error message. The <select> option label is `Harris County, TX`; Playwright selectOption({label}) matches exactly and waits.

## Root cause

Test defect: wrong option label. The page behaves per contracts.

## Fix

selectOption({ label: "Harris County, TX" }).

## Regression test

tests/e2e/A-13-pages.spec.ts @scenario:A-13-TC-071 (hosted)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | Test defect: wrong option label. The page behaves per contracts. |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
