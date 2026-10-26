---
id: ERR-46
type: defect
kind: product defect (performance)
feature: FEAT-A13
story: A-13
test_case: TC-081 (vitals), TC-040 (first Explore load), TC-073 (screenshot)
ac_reference: NFR LCP budget 2,500 ms (Lighthouse mobile profile)
severity: High
status: "Closed (fixed, re-tested on hosted build 2e14516: TC-081 PASS, TC-073 PASS, TC-040 engine waterfall holds no request to Google; TC-040 itself still fails on a slow link, see the test report)"
found_by: hosted vitals and request waterfall, build 32a3d60
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: 2e14516
retest_date: 2026-10-22
---

# ERR-46: third-party Google Fonts requests dominate load time and vary run to run

## Brief description

TC-081 on the preview (build `32a3d60`): `/data/catalog` median LCP 2656 ms and `/tx/travis/coverage` 2572 ms against the 2,500 ms budget; every data page sits at 2.4-2.6 s. TC-040: first Explore load 9-18 s on repeated runs (4.1-4.6 s earlier the same day). The TC-073 screenshot timed out "waiting for fonts to load".

## Root cause

`apps/web/index.html` loaded a render-blocking stylesheet from `fonts.googleapis.com` (1.1 s), which then pulled Roboto woff2 (0.65 s) and woff (1.2 s), Material Symbols Rounded woff2 (3.0 s, the full icon font) and Roboto Mono (0.3 s) from `fonts.gstatic.com`. `tokens.css` repeated the same `@import`. Page ready was 5.8 s unthrottled, and the latency depended on the network of the moment.

## Fix

Fonts are self-hosted from `apps/web/public/fonts/` (stable URLs): Roboto (latin, variable 400-700), Roboto Mono (latin, variable 400-500) and a Material Symbols Rounded subset of the 16 icon names the app uses (`icons.json`). `src/styles/fonts.css` declares the `@font-face` rules (text `swap`, icons `block`), imported first in `main.tsx`. The Google preconnects, stylesheet and `tokens.css` `@import` are removed. `index.html` preloads Roboto and the icon subset. Licences: `public/fonts/LICENSE-fonts.txt` (Apache 2.0). `.stylelintrc.json` ignores `fonts.css` (a literal `font-family` is the point of `@font-face`).

## Regression test

`apps/web/test/self-hosted-fonts.test.ts` (red before, green after); `html-hints.test.ts` now exempts font preloads from the "no static data preload" rule. Hosted re-check: TC-081, TC-040, TC-073 on the next build.

## Follow-up (infra, not done here)

Add an Amplify custom header for `/fonts/<*>`: `Cache-Control: public, max-age=31536000, immutable` in `infra/src/web-stack.ts` `renderCustomHeaders`.
