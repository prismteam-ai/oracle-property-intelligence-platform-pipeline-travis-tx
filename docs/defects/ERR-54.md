---
id: ERR-25
type: defect
kind: product defect
feature: FEAT-A13
story: A-13
test_case: A-13-TC-009
ac_reference: A-13-AC-5
severity: High
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-25: Explore – D-9 (roof 15, open 5 yrs) zero results do not say 'no open roofing permits'

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **product defect**.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-5 · **Requirement:** FR-005 · **Test case:** A-13-TC-009

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium (desktop; 390 for the touch-target cases) |

## Steps to reproduce

Run `tests/e2e/A-13-*.spec.ts` case `@scenario:A-13-TC-009` with RUNTIME_URL set to the preview.

## Expected result

With the permit filter active and zero rows, the exact line "no open roofing permits in this radius on the current run".

## Actual result

Element not found: the page showed the generic `No properties within … mi` line because the roof filter was also set.

## Root cause

An earlier review fix showed the permit sentence only when the permit filter was the ONLY filter; that contradicts AC-5 for the demo query.

## Fix

ExploreFilters.tsx Results: whenever a permit filter is active and no rows came back, show EXPLORE_TEXTS.noOpenPermits, then the generic zero-results hint and the Close matches list. Without a permit filter only the generic text shows.

## Regression test

apps/web/test/explore-review-a.test.tsx (zero results text: permit filter alone, permit + roof + openYrs, no permit filter)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | An earlier review fix showed the permit sentence only when the permit filter was the ONLY filter; that contradicts AC-5 for the demo query. |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
