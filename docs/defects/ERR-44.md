---
id: ERR-44
type: defect
kind: product defect (performance)
feature: FEAT-A13
story: A-13
test_case: TC-081
ac_reference: NFR LCP budget 2,500 ms (Lighthouse-mobile profile, 390 px)
severity: Medium
status: "Closed (fixed, re-tested PASS on hosted build 2e14516: TC-081 data pages median LCP 2.28 to 2.41 s; the fix pushed in dfed5b0, its regression ERR-45 fixed in 32a3d60)"
found_by: hosted vitals on build 5fdac1a (150 ms RTT, 1.6 Mbps, 4x CPU, median of 5)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: dfed5b0 (+ 32a3d60 for the ERR-45 regression)
retest_date: 2026-10-22
---

# ERR-44: median LCP 2508 ms on /tx/travis/coverage, 2.38-2.48 s on the other data pages

## Brief description

`/tx/travis/coverage` median LCP 2508 ms against the 2,500 ms budget (runs 2508, 2668, 2416, 2412, 2560). `/data/catalog` 2476, `/data/manifest` 2444, `/runs` 2396, `/runs/log` 2380. The budget was met only by luck.

## Root cause

Every data page ran a strict waterfall: HTML, then JS (entry about 114 KB gz plus route chunk), then same-origin `/runs/index.json`, then the manifest by CID from the CloudFront CID-copy host. That host is cross-origin, so its DNS, TCP and TLS handshake (about 2-3 RTT, 300-450 ms under the profile) only started after the index returned.

## Fix

`apps/web/index.html`: `<link rel="preload" as="fetch" href="/runs/index.json" crossorigin="anonymous">` starts the index request with the HTML, and `<link rel="preconnect" href="https://%VITE_CID_COPY_HOST%" crossorigin>` warms the CID-copy connection. `loadRunsIndex` already fetches that exact URL with default init (same-origin, default credentials, no cache or header override), so the preloaded response is reused; no change to `runs-index.ts`. `apps/web/vite.config.ts` has a `transformIndexHtml` plugin that removes the preconnect tag when `VITE_CID_COPY_HOST` is unset or not a bare hostname, so no literal placeholder ships. No Pinata/Filebase preconnect (Verify is on demand). No infra header change is needed.

## Regression test

`apps/web/test/html-hints.test.ts` (red before, green after): both tags in `index.html`, the exact-URL request shape of `loadRunsIndex`, and `dist/index.html` (when built) keeps the preload and has no unresolved placeholder. Hosted re-test: TC-081 on the next build.

## Impact

Lower LCP on all data pages; no data or behaviour change.
