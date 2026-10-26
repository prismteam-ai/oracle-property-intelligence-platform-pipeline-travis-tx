---
id: ERR-27
type: defect
kind: product defect
feature: FEAT-A13
story: A-13
test_case: A-13-TC-014
ac_reference: A-13-AC-1
severity: Medium
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-27: Compare with one run – no link to the run's manifest, and the single card is counted as a compared run

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **product defect**.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-1 · **Requirement:** FR-001b · **Test case:** A-13-TC-014

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium (desktop; 390 for the touch-target cases) |

## Steps to reproduce

Run `tests/e2e/A-13-*.spec.ts` case `@scenario:A-13-TC-014` with RUNTIME_URL set to the preview.

## Expected result

Single run: exact text, a link to that run (manifest), no comparison column.

## Actual result

No anchor with the manifest CID in its href (the run id linked to /runs, the CID was text); the single card also carried data-compare-run, the hook of a compared run.

## Root cause

RunsCompare.tsx single-run card linked only /runs and reused the compared-run hook.

## Fix

Card now has data-compare-single (no data-compare-run) and an `Open manifest` link to /data/verify/{manifestCid}.

## Regression test

apps/web/test/compare.test.tsx (Compare with one published run)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | RunsCompare.tsx single-run card linked only /runs and reused the compared-run hook. |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
