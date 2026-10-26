---
id: ERR-45
type: defect
kind: product defect (regression from the ERR-44 fix)
feature: FEAT-A13
story: A-13
test_case: A-13-TC-056
ac_reference: "AC-11, FR-011 (static Legal pages: no data request)"
severity: Medium
status: "Closed (fixed, re-tested PASS on hosted build 2e14516: TC-056 Legal pages make no data request)"
found_by: hosted Playwright run (general phase) on build dfed5b0
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: 32a3d60
retest_date: 2026-10-22
---

# ERR-45: The /runs/index.json preload also fired on the static Legal pages

## Brief description

The ERR-44 fix (build `dfed5b0`) put `<link rel="preload" href="/runs/index.json">` in `index.html`, so every page, including `/legal/privacy` and `/legal/terms`, requested the run index. TC-056 (test case: "no data request (no Parquet or manifest fetch)") failed: `no Parquet or manifest fetch`, received `https://…/runs/index.json`. The other 58 general cases passed.

## Root cause

A static link tag cannot be conditional on the route. The speedup was meant only for the pages that read published data.

## Fix

`index.html`: the static link is replaced by a tiny inline script that adds the preload only on `/`, `/runs…`, `/data…`, `/tx…` and `/permits`; Legal, Help and Coming soon pages get none. The CID-copy preconnect stays (it makes no request). `apps/web/test/html-hints.test.ts` runs the script against a fake `location` for 15 paths (red before: 12 failures; green after).

## Impact

A tiny unnecessary request on three static pages; caught before the evidence was closed.
