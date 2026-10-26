---
id: ERR-23
type: defect
kind: test defect
feature: FEAT-A13
story: A-13
test_case: A-13-TC-003
ac_reference: A-13-AC-2
severity: Low
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-23: Coverage hosted test – textContent fuses adjacent blocks, so /\bunresolved\b/ fails

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **test defect**.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-2 · **Requirement:** FR-002 · **Test case:** A-13-TC-003

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium (desktop; 390 for the touch-target cases) |

## Steps to reproduce

Run `tests/e2e/A-13-*.spec.ts` case `@scenario:A-13-TC-003` with RUNTIME_URL set to the preview.

## Expected result

The contractor kind lists its five states, incl. unresolved.

## Actual result

toContainText (textContent) received "...conflicting, unresolvedcontractor ambiguous0From the run's..." : the heading and the next row have no whitespace between them in textContent, so \b does not match. A reader sees them on separate lines.

## Root cause

Test defect: it asserted on textContent, not on rendered text. The page is correct (heading is a block element).

## Fix

A-13-explorer.spec.ts TC-003 reads `innerText` of the contractor kind and matches each state against it.

## Regression test

tests/e2e/A-13-explorer.spec.ts @scenario:A-13-TC-003 (hosted); no jsdom equivalent, jsdom computes no layout

## Resolution

| Field | Value |
| --- | --- |
| Root cause | Test defect: it asserted on textContent, not on rendered text. The page is correct (heading is a block element). |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
