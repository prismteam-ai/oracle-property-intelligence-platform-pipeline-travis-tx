---
id: ERR-56
type: defect
kind: product defect (layout assumption)
feature: FEAT-A13
story: A-13
test_case: A-13-TC-053, A-13-TC-054
ac_reference: AC-10, FR-010
severity: High
status: Closed (fixed; re-tested PASS on the hosted preview, CI run 40185511164, code dc46a6d)
found_by: "unit run after the merge with A-11 (`groups the manifest's table parts by table`: expected 0 to be 225) and hosted run 40172676788 (TC-053 \"the manifest lists tables\", received 0)"
found_date: 2026-10-25
fix_branch: 013-explorer-and-pages
fix_commit: 1912a7a
retest_date: 2026-10-25
---

# ERR-56: Data · Catalog showed no tables for a batched run

## Root cause

`catalogTables` only understood the pilot layout `tables/<group>/<table>/<part>`. Run 2 (A-11) publishes 225 table parts under export batches (`pipeline/data/runs/…/county-batched/tables/b01/<table>/<part>`), so every part was skipped and the Catalog listed 0 tables.

## Fix

`apps/web/src/data/parquet-meta.ts`: a part's table is its parent folder and its group is the one query-core's `resolveBatchGroups` resolves for its batch, so a table split over batches is one row and the pilot layout still works. Tests use the committed Runs 1 and 2.

## Impact

Data · Catalog (AC-10) was empty on the full county. Now 26 tables; footers load in about 50 s from a laptop.
