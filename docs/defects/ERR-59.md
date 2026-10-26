---
id: ERR-59
type: defect
kind: product defect (waiting too long for an error)
feature: FEAT-A13
story: A-13
test_case: A-13-TC-083 (flaky), A-13-TC-073, A-13-TC-074
ac_reference: AC-5, FR-005
severity: Medium
status: Closed (fixed; re-tested, CI run 40185511164, code dc46a6d)
found_by: "hosted run 40185074747 (TC-083: Explore stayed `data-state=\"loading\"` past 60 s)"
found_date: 2026-10-25
fix_branch: 013-explorer-and-pages
fix_commit: dc46a6d
retest_date: 2026-10-25
---

# ERR-59: a timed-out Explore search kept the page loading for about 59 s

## Root cause

The shared query client sets `retry: 1`. A search the server cannot finish already waits up to 29 s, and the retry doubled it, so the error appeared after about 59 s, right on the test's 60 s limit (passed once, failed once).

## Fix

`apps/web/src/routes/ExploreFilters.tsx`: `retry: false` for `explore.search`. The error shows after one attempt and the page keeps its own Retry button. Other pages keep the shared default.
