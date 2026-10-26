---
id: ERR-39
type: defect
kind: product defect (controlled input flicker)
feature: FEAT-A13
story: A-13
test_case: A-13-TC-009
ac_reference: A-13-AC-4
severity: High
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (explorer phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: d3ae47e
retest_date: 2026-10-22
---

# ERR-39: Explore filters – "Open or stalled" and "Out-of-area owner" checkboxes flicker back (TC-009)

## Brief description

TC-009 failed in 3 of 6 clean runs on the preview with "Clicking the checkbox did not change its state". This is a **product defect**; real users also see a flicker.

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com/tx/travis/explore |
| Build | `a285dbe` (preview build) |
| Browser / OS / device | Playwright Chromium |

## Steps to reproduce

Open Explore, click "Open or stalled" (or "Out-of-area owner", or change Sort). Read the control right after the click.

## Expected result

The control shows the person's choice immediately and keeps it.

## Actual result

The control reads its old value until the URL commits, so Playwright's `setChecked` sees no change in about half of the runs.

## Root cause

In `apps/web/src/components/FilterSheet.tsx` the checkboxes and Sort `<select>` are controlled from URL state (`checked={openOrStalled}`, `value={value("sort")}`) and `onChange` calls `onPatch`, which goes through react-router `setSearchParams` (asynchronous navigation). React restores a controlled input to its old value right after the handler returns until the URL commits. The number fields already keep drafts; the place combobox is local state.

## Fix

Optimistic local `pending` state per control, rendered as `pending.x ?? urlValue`, set synchronously in `onChange`, cleared when the URL-derived value changes (effect) or on blur if the patch never landed.

## Regression test

`apps/web/test/filter-sheet-controlled.test.tsx` (5 cases: both checkboxes and Sort stay set with an `onPatch` that never updates props, the control follows a later URL change, blur drops an unlanded choice). Red (5 failed) before the fix, green after. Hosted TC-009 re-test pending.

## Resolution

| Field | Value |
| --- | --- |
| Root cause | controlled input reverted while navigation was pending |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
