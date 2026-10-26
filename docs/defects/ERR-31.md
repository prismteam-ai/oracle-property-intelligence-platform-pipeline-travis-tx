---
id: ERR-31
type: defect
kind: product defect
feature: FEAT-A13
story: A-13
test_case: A-13-TC-086
ac_reference: A-13-AC-13
severity: Medium
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-31: Permits (/permits) – no level-2 heading while loading or on error

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **product defect**.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-13 · **Requirement:** FR-018 · **Test case:** A-13-TC-086

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium (desktop; 390 for the touch-target cases) |

## Steps to reproduce

Run `tests/e2e/A-13-*.spec.ts` case `@scenario:A-13-TC-086` with RUNTIME_URL set to the preview.

## Expected result

Every route shows its page heading (h2) in every state.

## Actual result

`/permits: heading` not visible: the h2 only appeared in the empty state (EmptyState).

## Root cause

Permits.page.tsx rendered no title of its own.

## Fix

Permits.page.tsx renders `<h2>Permits</h2>` in loading, error, empty and ready.

## Regression test

apps/web/test/permits-state.test.ts (TC-086: the level-2 heading is there in every state)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | Permits.page.tsx rendered no title of its own. |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
