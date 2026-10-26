---
id: ERR-24
type: defect
kind: test defect
feature: FEAT-A13
story: A-13
test_case: A-13-TC-008
ac_reference: A-13-AC-4
severity: Low
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-24: Explore hosted test – expected zero-results text built with NaN

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **test defect**.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-4 · **Requirement:** FR-004 · **Test case:** A-13-TC-008

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium (desktop; 390 for the touch-target cases) |

## Steps to reproduce

Run `tests/e2e/A-13-*.spec.ts` case `@scenario:A-13-TC-008` with RUNTIME_URL set to the preview.

## Expected result

n = 0: the page shows the contracts/ui-routes.md zero-results line.

## Actual result

Locator getByText(/^No properties within NaN mi · NaN close matches just outside$/): templatePattern passed "(.+?)" holes into Number(), giving NaN.

## Root cause

Test defect: it computed the expected text from regex placeholders. The page text matches contracts/ui-routes.md (`No properties within {r} mi · {k} close matches just outside`).

## Fix

TC-008 builds EXPLORE_TEXTS.zeroResults(5, result.close_matches.length) from the radius it set and the API response.

## Regression test

tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-008 (hosted); page text covered by apps/web/test/explore-review-a.test.tsx

## Resolution

| Field | Value |
| --- | --- |
| Root cause | Test defect: it computed the expected text from regex placeholders. The page text matches contracts/ui-routes.md (`No properties within {r} mi · {k} close matches just outside`). |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
