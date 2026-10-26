---
id: ERR-36
type: defect
kind: test defect (harness), waiting on a network call that never happens
feature: FEAT-A13
story: A-13
test_case: A-13-TC-041
ac_reference: A-13-AC-10
severity: Medium
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (perf phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-36: Filters search timing – TC-041 exceeds its 300 s timeout in `waitForResponse`

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **test defect (harness)**: the page and API are fast (`explore.search`, radius 5, roof 15: 3.4 s cold, 0.41 to 0.51 s warm, measured by hand).

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-10 · **Test case:** A-13-TC-041 (NFR-001, p95 < 3 s)

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium, desktop 1440 |

## Steps to reproduce

Run `tests/e2e/A-13-perf.spec.ts` case `@scenario:A-13-TC-041` with RUNTIME_URL set to the preview.

## Expected result

20 timed runs per search, each from radius input change to the updated header, p95 < 3,000 ms, all timings recorded.

## Actual result

`Test timeout of 300000ms exceeded.` / `Error: page.waitForResponse: Test timeout of 300000ms exceeded.` at `timedRadius` (A-13-perf.spec.ts:94), called from the timed loop.

## Impact and severity

- **Impact:** the Filters search NFR has no timing evidence; one run that makes no API call hides the other 39 and costs 5 minutes of a hosted run.
- **Severity:** Medium: no product defect, but the case yields no result.

## Root cause

The series opened at radius 5, ran an untimed warm-up at 3, then toggled 5, 3, 5, 3 ... Each run waited for an `explore.search` response with no timeout. The page (react-query) caches an answered search by its request, so going back to a radius already searched (the first timed run at 5, which the URL load had already answered) is answered locally: no API call, `waitForResponse` waits forever. Even where it did not hang, repeats measured cache hits, not searches.

## Fix

`tests/e2e/A-13-perf.spec.ts` TC-041 and new `tests/e2e/lib/a13-perf-runs.ts`: every timed run sets a radius not searched before (20 distinct radii, 3 to 8 mi in 0.25 steps, never the loaded 5), waits for the header to name exactly that radius (own text, regex `N within {r} mi of`), with a 10 s cap per run; the response wait is optional and bounded. A failure reads `TC-041 {series}: run {i} of 20 at radius {r} mi: no updated header within 10000 ms (...)`. The test timeout is set from the worst case (`seriesBudgetMs`, 460 s) with a comment. All 20 timings, radii, p50/p95 and `provisional` are written to `docs/evidence/A-13-TC-041-timings.json` even when a run fails. The p95 < 3,000 ms assertions are unchanged.

## Regression test

`tests/e2e/lib/a13-perf-runs.test.ts` (distinct radii, none cached, header pattern exact, failure names run and radius, budget). Hosted TC-041 re-test.

## Resolution

| Field | Value |
| --- | --- |
| Root cause | unbounded wait for a network response that a client-cache hit never makes |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
