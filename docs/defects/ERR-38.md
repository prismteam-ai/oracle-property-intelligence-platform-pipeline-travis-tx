---
id: ERR-38
type: defect
kind: product defect (touch target)
feature: FEAT-A13
story: A-13
test_case: A-13-TC-082
ac_reference: A-13-AC-12
severity: Medium
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted smeargle run 2
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: d3ae47e
retest_date: 2026-10-22
---

# ERR-38: Runs pages – `.link` is 14 px high on /runs and /runs/compare (touch target)

## Brief description

Hosted smeargle run 2 on build `a285dbe`: `.link` in `apps/web/src/routes/Runs.module.css` measured 14 px high on `/runs` and `/runs/compare`, 6 of 81 cells checked. This is a **product defect**.

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `a285dbe` (preview build) |
| Browser / OS / device | Playwright Chromium, 390 and 1440 px |

## Steps to reproduce

Open `/runs` and `/runs/compare`; measure the in-table `.link` elements.

## Expected result

Every interactive target is at least the Atlas touch size (`--space-9`).

## Actual result

Inline links measured 14 px high.

## Root cause

`.link` was a plain inline element, so its box was one text line tall and `min-height` did not apply.

## Fix

`.link` is `display: inline-flex; align-items: center; min-height: var(--space-9)` in `apps/web/src/routes/Runs.module.css`.

## Regression test

`apps/web/test/touch-targets.test.ts` case N1. Shown red without the fix, green with it. Hosted smeargle re-run pending.

## Resolution

| Field | Value |
| --- | --- |
| Root cause | inline `.link` ignored min-height |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
