---
id: ERR-47
type: defect
kind: product defect (layout regression)
feature: FEAT-A03
story: A-03 (regressed by A-13)
test_case: "A-03-TC-NF-03 (tests/e2e/responsive.spec.ts, 'permits @ 390: first provenance line inside the first viewport')"
ac_reference: AC-2, AC-3, NFR-003
severity: Medium
status: "Closed (fixed, re-tested PASS in CI run 39835352646: A-03-TC-NF-03)"
found_by: CI run 39798211562 (hosted job), preview build 0e9be08 / 3efd120; regression of the first fix found by CI run 39808557005 (head c5c21f3)
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: 9fbf5ff
retest_date: 2026-10-22
---

# ERR-47: Permits at 390 x 844: first provenance line ends at y 860 (limit 844)

## Brief description

`/permits` at 390 x 844: the first `[data-cid]` box is top 812, height 48, bottom 860, 16 px below the fold. The A-03 rule (hard acceptance rule, the test is not weakened) needs the bottom at 844 or less. The provenance text (`span._text`) is 144 px tall (732 to 876) at the bottom of a 740 px card.

## Root cause

A product regression from the A-13 touch-target fixes (smeargle D3, D5). Two atomic 48 px boxes inside one sentence of 16 px text made their lines 48 px high:

- D5 `Provenance.module.css .link`: `display: inline-flex; min-height: var(--space-9)`. The source link (a 2-line URL, 32 px before) became a 48 px box on its own line: +16 px.
- D3 `CidDisplay.module.css .copy`: 48 x 48 with `flex: none`. The CID line is 48 px, not 16 px (the 48 px button existed since A-03 but sat on a line that had room; with the link line growing, the line count and total pushed the CID to y 812).

Lines measured on the preview: 16 (Source:) + 48 (link) + 16 (collected) + 48 (CID) + 16 (run) = 144. Fonts (ERR-46), the icon box (ERR-42) and the Permits `h2` (ERR-31) did not change the card above the provenance line (card top 152 as before).

## Fix history

### Attempt 1 (c5c21f3, reverted): negative margin

`.text [data-cid] { margin-block: calc(var(--space-4) * -1) }` took the CID line back to 16 px (first `[data-cid]` bottom 860 to 813 on macOS) but A-03-TC-NF-03 still measured 940.8 on the Linux runner, and the CID box now reported `margin-top/margin-bottom: -16px` on every page that shows a CID. A-03-TC-NF-03 and A-13-TC-080 (token audit) counted 352 violations of "only Atlas tokens" (permits, coverage, explore, dataManifest, dataVerify at 390/768/1440). A negative margin is not a token value, so the hack is removed and a test (N4) forbids a negative margin in any stylesheet.

### Attempt 2 (kept from attempt 1): link padding

`Provenance.module.css .link`: `display: inline; padding-block: var(--space-4)`. A 48 px target made of padding on an inline box; the line keeps its text height.

### Fix attempt 3 (two-column rows, 768 on macOS): not enough

The first card fix (label and value side by side) measured 768 on macOS, but CI run 39808557005 showed the Linux runner renders this page about 128 px taller than macOS (c5c21f3: 940.8 on the runner against 813 on macOS), so 768 would be about 896 there. The cause of the extra runner height was not isolated (candidates: different text wrapping of the long source URL, run id and pill texts with the runner's font rendering); the fix therefore targets a macOS bottom of 700 or less.

### Fix: compact the card, not the target

`apps/web/src/routes/Permits.module.css` only, token values only:

- `.cardRows` is a grid `minmax(0,3fr) minmax(0,2fr) minmax(0,2fr)` with `column-gap: var(--space-3)` and `row-gap: var(--space-1)`: Improvement status, Status class and Issue date share one row (label over value). The last two rows (Contractor, Missing data) span the full width (`grid-column: 1 / -1`).
- `.page` gap and `.card` gap one token step tighter (`--space-2`), card padding `var(--space-3) var(--space-4)`.
- No target is smaller than 48 px; the copy button, the link padding and all A-03 DOM hooks are unchanged. Reading order is unchanged.

Measured on macOS Chromium (plain script, 390 x 844, live preview with the CSS injected, a functional measurement): first `[data-cid]` bottom 828 (hack reverted, A-03 baseline here) to 768 (two-column rows) to 696 (this fix; limit 700 so that the runner stays at about 824 to 830, under 844).

## Regression test

`apps/web/test/touch-targets.test.ts` "N4" (three-column field grid, full-width last two rows, tighter token gaps and padding, no negative margin in any stylesheet; red before, green after) and the updated "D5" (the link is an inline box with `padding-block`, not an inline-flex `min-height` box). Hosted re-check: A-03-TC-NF-03 on the next build, plus smeargle D3/D5 (copy button and source link at least 48 px).

## Impact

Layout only; no data affected. The first permit's provenance (source, CID) was below the first viewport at 390 px.

## Re-test

CI run 39835352646 (commit `2c13e09`, code `2cc58ac`, 2026-10-22), job `e2e-hosted`, A-03 cases, one worker: 38 passed, including A-03-TC-NF-03 (permits first provenance line inside the first 390 x 844 viewport on the GitHub runner) and A-03-TC-061. The A-13 token audit (TC-080) is part of the 59 passed general cases of the same run, so the removed negative margin no longer shows. Closed.
