---
id: ERR-57
type: defect
kind: product defect (regression from A-11 reuse)
feature: FEAT-A13
story: A-13
test_case: A-13-TC-004, A-13-TC-039
ac_reference: AC-6, FR-006
severity: High
status: Closed (fixed; re-tested on the hosted preview with `SELECT count(*) FROM v_property` = 441,961; the CI cases for the SQL panel are parked under A-16 gap 2)
found_by: hosted run 40172676788 (TC-039 suggested "use county.property" for a typo of v_property) and a probe of the hosted SQL panel (`SHOW TABLES` listed only `v_roofing_permit`)
found_date: 2026-10-25
fix_branch: 013-explorer-and-pages
fix_commit: f1fe540
retest_date: 2026-10-25
---

# ERR-57: the SQL panel had only the Permits view

## Root cause

A-11 made `bindRun` bind only the views the Permits page reads (`PERMITS_VIEWS`, ERR-19) to keep that page fast. The Explore SQL panel reused `bindRun`, so on a published run it saw only `v_roofing_permit`; `v_property` did not exist.

## Fix

`apps/web/src/engine/duckdb-wasm.ts` adds `bindAllViews` (every contract view, parts range-read from the CID copy when the run is too large to prefetch); `ExploreSql.engine.ts` uses it. The Permits page is unchanged.

## Impact and what remains

D-4 works on the hosted preview: `SELECT count(*) FROM v_property` returned 441,961 in a browser. The first query takes about 97 s (A-16 gap 2); on the CI runner it hangs or fails with a Filebase `NetworkError`, so TC-004, 023, 028, 038, 039 and 040 are parked.
