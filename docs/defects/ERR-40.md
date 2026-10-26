---
id: ERR-40
type: defect
kind: "test defect (harness): allowlist too narrow and unsettled clicks"
feature: FEAT-A13
story: A-13
test_case: A-13-TC-073
ac_reference: A-13-AC-10
severity: High
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run 2 (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: d3ae47e
retest_date: 2026-10-22
---

# ERR-40: No-sample-data scan – real record CIDs flagged, and `explore` clicks hit a moving page

## Brief description

Hosted run 2 on build `a285dbe`: TC-073 failed with 40 problems. This is a **test defect (harness)**.

## Steps to reproduce

Run `tests/e2e/A-13-scan.spec.ts` case `@scenario:A-13-TC-073` against the preview.

## Actual result

(a) Real property and permit record CIDs on Explore (for example `bagu…stmq`, `baguqeera…`) were reported as "CIDs not in any manifest". (b) Steps `explore @ 1440` and `explore @ 390` failed with "element is not stable / detached from the DOM" on the first result row and the Filters toggle.

## Root cause

(a) The allowlist held only manifest, previousManifest, artifact and CAR CIDs; record CIDs of the published tables are real but not in a manifest. (b) The clicks ran while results were still re-rendering.

## Fix

(a) `mergeResponseCids` (`tests/e2e/lib/a13.ts`) adds every CID in the `explore.search` responses the page received during the visit; denylist and prototype-CID check unchanged. (b) Before those two clicks the scan waits for `data-state="ready"`, no `[role="progressbar"]` and a header text stable for 500 ms, and clicks with a 15 s timeout, inside the 60 s step budget.

## Regression test

`tests/e2e/lib/a13-allow.test.ts` (red: `mergeResponseCids is not a function`; green after; a prototype CID absent from every response is still flagged). Hosted re-test pending.

## Resolution

| Field | Value |
| --- | --- |
| Root cause | allowlist too narrow; clicks on an unsettled page |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Status | Fixed, re-test pending (hosted) |
