---
id: ERR-26
type: defect
kind: test defect
feature: FEAT-A13
story: A-13
test_case: A-13-TC-012
ac_reference: A-13-AC-1
severity: Low
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-26: Hosted test – 'no article' too broad for the run-index error state

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **test defect**.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-1 · **Requirement:** FR-021 · **Test case:** A-13-TC-012

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium (desktop; 390 for the touch-target cases) |

## Steps to reproduce

Run `tests/e2e/A-13-*.spec.ts` case `@scenario:A-13-TC-012` with RUNTIME_URL set to the preview.

## Expected result

Error state shows only the error banner: no run card, count, CID or chip.

## Actual result

locator('article') expected 0, got 2: on the Hub the two Hub cards (CountyLens, Roofing CRM) are articles and are meant to stay.

## Root cause

Test defect: it asserted on every <article> instead of the run card and the run chip. The page is correct.

## Fix

TC-012 asserts #run-title (the Runs card heading) and the `Run n · …` chip are absent.

## Regression test

tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-012 (hosted)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | Test defect: it asserted on every <article> instead of the run card and the run chip. The page is correct. |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
