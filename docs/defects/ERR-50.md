---
id: ERR-21
type: defect
kind: product defect
feature: FEAT-A13
story: A-13
test_case: A-13-TC-002
ac_reference: A-13-AC-1
severity: High
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-21: Runs – source lines do not show the manifest watermark

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **product defect**.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-1 · **Requirement:** FR-001 · **Test case:** A-13-TC-002

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium (desktop; 390 for the touch-target cases) |

## Steps to reproduce

Run `tests/e2e/A-13-*.spec.ts` case `@scenario:A-13-TC-002` with RUNTIME_URL set to the preview.

## Expected result

Expected the source line to contain "2026-10-20T12:35:38.032Z" (the manifest `sources[].watermark`).

## Actual result

Line shows "42 records · collected 2026-10-21T10:35:59.798Z UTC · https://data.austintexas.gov/resource/3syk-w9eu.json"; no watermark.

## Root cause

Runs.tsx SourceItem rendered records, captured_at and the link only. TC-002 step 3 and FR-001 ask for the watermark too.

## Fix

Runs.tsx SourceItem shows `watermark {value}` (as published) after the collected time; nothing is shown for a null watermark (nothing invented).

## Regression test

apps/web/test/runs.test.tsx (Runs page: sources: watermark shown, null watermark not invented)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | Runs.tsx SourceItem rendered records, captured_at and the link only. TC-002 step 3 and FR-001 ask for the watermark too. |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
