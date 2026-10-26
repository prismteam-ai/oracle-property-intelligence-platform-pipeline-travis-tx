---
id: ERR-33
type: defect
kind: product defect
feature: FEAT-A13
story: A-13
test_case: A-13-TC-083
ac_reference: A-13-AC-10
severity: High
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-33: Data · Catalog – definition lists hold bare divs (axe definition-list, 23 nodes)

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **product defect**.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-10 · **Test case:** A-13-TC-083

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium, desktop 1440 |

## Steps to reproduce

Run `tests/e2e/A-13-scan.spec.ts` case `@scenario:A-13-TC-083` with RUNTIME_URL set to the preview.

## Expected result

Zero serious or critical axe violations on every route (WCAG 2.2 AA).

## Actual result

`Error: 0 serious or critical violations; focus visible on every control` with `/data/catalog: definition-list (serious, 23) article[aria-labelledby="table-county.address"] > dl | article[data-table="county.address_has_parcel"] > dl | article[aria-labelledby="table-county.company"] > dl`. All other routes were clean.

## Impact and severity

- **Impact:** TC-083 fails, so the accessibility line of the demo and the G7 evidence are red; screen readers lose the label/value pairing of each table card (Size, Rows, published_rows).
- **Severity:** High because it is a serious axe rule on a page the evaluator opens, and the accessibility case cannot pass until it is fixed.

## Root cause

`DataCatalog.tsx` TableCard rendered `<dl>` with `<div>` children holding free text and spans, and no `<dt>`/`<dd>`. A `<dl>` may only contain dt/dd groups (optionally wrapped in a div).

## Fix

`apps/web/src/routes/DataCatalog.tsx`: each fact is now `<div class="fact"><dt>label</dt><dd>value</dd></div>` (Size, Rows, published_rows · label); `DataCatalog.module.css` adds `.fact`. Every data hook is unchanged (data-size, data-rows, data-published-rows with data-coverage-key and data-value, data-count moved onto the dd).

## Regression test

`apps/web/test/catalog.test.tsx` "valid definition lists" (every dl child is dt/dd or a div holding only dt/dd with both; hooks kept). Red before the fix (`expected [ 'dt', 'dd' ] to include 'span'`), green after. Hosted TC-083 and TC-053 re-test.

## Resolution

| Field | Value |
| --- | --- |
| Root cause | dl children were free-text divs instead of dt/dd groups |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
