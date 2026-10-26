---
id: ERR-35
type: defect
kind: test defect (assertion counted across page loads)
feature: FEAT-A13
story: A-13
test_case: A-13-TC-023 (TC-024 was skipped behind it in the serial group)
ac_reference: Edge 2 (CID copy down), FR-016
severity: Low
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (verify phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-35: Fallback test counts requests to the dead CID-copy host across three page loads

## Brief description

First hosted run of A-13 against the preview (build `641bc25`), Verify phase, one worker. TC-023 aborts every request to the CID copy and walks Runs, the SQL panel and a Verify page. It failed with `copy requests for /bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i`: expected ≤ 1, received 3. TC-024 was skipped behind it (serial group).

## Root cause

The page works as designed: each page load reads the manifest once, tries the CID copy, falls back to Filebase and shows "fallback · ipfs.filebase.io" (the Runs, SQL and Verify steps all passed). Three page loads therefore make three attempts at the same path. The test's rule, "no request reached the aborted host again after the first failure per file" (test case TC-023 expected result), only makes sense within one page load; the test added the counts of all three navigations.

## Fix

`tests/e2e/A-13-verify.spec.ts`: the counters are checked and reset after each page (`assertOncePerFile`); the per-page bound stays ≤ 1, so a page that retried the dead host for the same file would still fail.

## Regression test

TC-023 itself (and TC-024 runs again behind it). Re-test pending on the next preview build.

## Impact

Test-only. No change to the page or the approved read path (ADR-0001: copy first, Filebase labelled fallback).
