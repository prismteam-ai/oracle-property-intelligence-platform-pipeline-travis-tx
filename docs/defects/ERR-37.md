---
id: ERR-37
type: defect
kind: test defect (harness), unstable generic selector for the INP control
feature: FEAT-A13
story: A-13
test_case: A-13-TC-081
ac_reference: A-13-AC-12
severity: Medium
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (vitals phase)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: a285dbe
retest_date: 2026-10-22
---

# ERR-37: Web vitals – TC-081 INP click times out on /runs/log (no control in main)

## Brief description

First hosted run of A-13 against the preview (build `641bc25`). This is a **test defect (harness)**. The trace shows Hub and Data · Catalog completed; the click failed on `/runs/log`.

## Related requirement

- **Story:** A-13 · **AC:** A-13-AC-12 · **Test case:** A-13-TC-081 (INP < 200 ms)

## Environment

| Item | Value |
| --- | --- |
| URL | https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com/runs/log |
| Build | `641bc25` (preview build) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Playwright Chromium, 390 px mobile profile |

## Steps to reproduce

Run `tests/e2e/A-13-vitals.spec.ts` case `@scenario:A-13-TC-081` with RUNTIME_URL set to the preview.

## Expected result

LCP, CLS and INP are measured on each of the eight pages.

## Actual result

`TimeoutError: locator.click: Timeout 30000ms exceeded.` waiting for `[data-main-control], main :is(button:not([disabled]), a[href^="/"], [role="tab"]):not([aria-disabled="true"])` `.first()`; the log shows no "resolved to" line, so nothing ever matched.

## Impact and severity

- **Impact:** LCP/CLS/INP evidence for the eight pages is missing, and the first page without a control stopped the other pages.
- **Severity:** Medium: no evidence, no product defect.

## Root cause

`mainControl` was a generic "first button, same-site link or tab inside `main`". Runs · Log (`apps/web/src/routes/RunsLog.tsx`) and Legal · Data have no link, button or tab inside `main` at all (the shell nav lives outside `main`), so the locator matched nothing for the full 30 s. On other pages the first match could be a link that navigates away.

## Fix

`tests/e2e/lib/a13-vitals.ts`: an explicit table `INP_CONTROLS` (route to role/name): Hub link "Open", Catalog first `summary`, Runs, Coverage and Manifest first "Copy CID" button, Explore tab "Filters". The control is waited for visible (15 s, error names the route and entry), scrolled into view, clicked with a 5 s timeout, and INP is read after two animation frames (the click's presentation frame) plus 500 ms. **Page note:** Runs · Log and Legal · Data have no main control; their INP is recorded "n/a" with the reason in `docs/evidence/A-13-pages.md` (no interaction exists, so INP is undefined) and the INP < 200 ms limit is unchanged for the six pages that have one. No page change is required.

## Regression test

`tests/e2e/lib/a13-vitals.test.ts` (every TC-081 page has an entry, no-control pages carry a reason, unknown route rejected). Hosted TC-081 re-test.

## Resolution

| Field | Value |
| --- | --- |
| Root cause | generic selector with no match on pages that have no control in main |
| Fix | uncommitted on `013-explorer-and-pages` (parent commits) |
| Re-test | pending: hosted re-run on the next preview build |
| Status | Fixed, re-test pending (hosted) |
