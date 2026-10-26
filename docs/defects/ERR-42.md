---
id: ERR-42
type: defect
kind: product defect (layout, slow network)
feature: FEAT-A13
story: A-13
test_case: A-13-TC-072 (also seen as a one-off in TC-080 runs)
ac_reference: "Edge 4 (390 px: no horizontal scroll), FR-018, NFR-002 (CLS)"
severity: Medium
status: Closed (fixed, re-tested PASS on hosted build 34c8eaf, 2026-10-22)
found_by: hosted Playwright run (general phase, 4 workers; 2 of 3 full runs)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: 015fbf9
retest_date: 2026-10-22
---

# ERR-42: Bottom-nav icon shows its raw glyph name until the symbols font loads, widening the page to 406 px at 390

## Brief description

Hosted run of A-13 on the preview (builds `d3ae47e`, `7f04685`). TC-072 passed 6 of 6 times when run alone but failed in the 4-worker general phase twice with `filter sheet: no horizontal scroll`, expected ≤ 390, received 406.

## Reproduction

A fresh Chromium at 390 × 844 opens `/tx/travis/explore`, with the `explore.search` response delayed by 4 s (a slow network), and opens the Filters sheet. While the page is `data-state="loading"`: `scrollWidth` 406; the only element past the right edge is `span.material-symbols-rounded` "more_horiz", 111 px wide. After the results arrive the page settles at 390.

## Root cause

The app shell's `Glyph` rendered the icon name as the element's text (`more_horiz`, `travel_explore`, …), and the `Icon` component draws it from generated content. Neither had a fixed box, so until the Material Symbols font is applied the name shows in the fallback font: wide text in the bottom nav, a horizontal scroll and a layout shift (CLS) for real users on a slow connection. Fast runs never showed it because the font arrived first.

## Fix

`AppShell.module.css` `.glyph` (used by `Glyph`) and `Icon.module.css` `.icon`: `width: 1em; height: 1em; overflow: hidden; white-space: nowrap`, so the fallback text is clipped and the loaded glyph fills the same box.

## Regression test

`apps/web/test/touch-targets.test.ts` "N2: icon glyphs have a fixed 1em box" (red before the CSS change, green after). Hosted re-test pending on the next build: TC-072 and TC-080 in the 4-worker phase.

## Impact

Users on slow connections saw a brief horizontal scroll and a layout jump at 390 px on every page with the bottom navigation. No data was affected.
