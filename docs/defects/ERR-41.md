---
id: ERR-41
type: defect
kind: product defect (performance)
feature: FEAT-A13
story: A-13
test_case: A-13-TC-081
ac_reference: A-13-AC-10
severity: Medium
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted vitals run (mobile 4G profile, median of 5)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: 7f04685
retest_date: 2026-10-22
---

# ERR-41: Data · Catalog – median LCP 4836 ms against the 2500 ms budget

## Brief description

Hosted vitals (build `d3ae47e`): `/data/catalog` median LCP 4,836 ms; every other page passes (NFR-002, budget 2,500 ms). This is a **product defect**.

## Related requirement

- **Story:** A-13 · **NFR:** NFR-002 · **Test case:** A-13-TC-081

## Environment

| Item | Value |
| --- | --- |
| Build | `d3ae47e` (preview build) |
| Profile | Lighthouse-style mobile 4G, median of 5 |

## Steps to reproduce

Run `tests/e2e/A-13-vitals.spec.ts` (TC-081) against the preview and read the `/data/catalog` row.

## Expected result

Median LCP at or below 2,500 ms, CLS below 0.1.

## Actual result

Symptom: median LCP 4836 ms.

## Impact and severity

- **Impact:** the Catalog is slow to show anything on a throttled network, and TC-081 fails.
- **Severity:** Medium: content is correct, only the first large paint is late.

## Root cause

The page showed only a progress bar until every table's Parquet footer had been read (`results === null` meant loading, and all tables were set at once at the end), so the first large paint, the table list, waited for about four sequential Range reads over the throttled network. hyparquet is a static import of the lazy route (a few KB gz of parallel chunk load; not the main cause). The list itself is already known from the manifest (`catalogTables`).

## Fix

`apps/web/src/routes/DataCatalog.tsx`: the list renders as soon as the latest manifest is loaded (`data-state` is `loading` only until then). Each table has its own state (pending, ok or fail with its reason) and fills in when its footer arrives. Pending rows show names, CIDs, sizes and `published_rows`, plus "reading the Parquet footer…" instead of columns and the row count (no invented values). `Catalog unavailable` still shows when the index or manifest fails, or every footer fails. Footer reads stay bounded (concurrency 2). The columns area has one reserved-height class (`columnsSlot`, token min-height) in pending, failed and filled states to avoid layout shift. A dynamic hyparquet import was tried and dropped: `scripts/bundle-size.ts` follows only static imports, so its Catalog-only placement gate rejects it. The runs index then manifest order is inherent (the manifest CID comes from the index).

## Regression test

`apps/web/test/catalog.test.tsx`, "Catalog: progressive render (ERR-41, NFR-002)": list painted with footers that never resolve, one footer resolving leaves the others pending, a failed footer says why, columns-slot class and min-height guard. Red before the fix, green after. Hosted TC-081 re-test.

## Resolution

| Field | Value |
| --- | --- |
| Root cause | list gated on every footer read |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted TC-081 on the next preview build |
| Status | Fixed, re-test pending (hosted) |
