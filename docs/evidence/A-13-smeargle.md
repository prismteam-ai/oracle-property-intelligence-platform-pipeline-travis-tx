# A-13 Smeargle responsive check, run 3 (hosted preview, build 015fbf9)

URL: https://013-explorer-and-pages.d2lx0utip89u18.amplifyapp.com. `/build.json` returned sha `015fbf99bed1d784c908714c56418c83ce2d5e4f`, branch `013-explorer-and-pages`. One scripted Chromium (not `playwright test`), sequential pages, 390/768/1440 px, 27 pages = 81 cells. Screenshots: docs/evidence/img/A-13-smeargle-{page}-{width}.png, plus -explore-drawer-{w}, -explore-filters-sheet-390, -more-sheet-{w}, and -n2-{font-delay|search-delay|both}-390. Explore pages were opened with the 25 mi downtown Austin search (`at=30.2672,-97.7431&r=25&roof=0&view=list`) so result rows and the drawer exist.

Pages: hub, runs, runs-compare, runs-log, coverage, explore, explore-sql, harris-explore (/tx/harris/explore), data-manifest, data-verify (latest manifest CID), data-catalog, help-mcp, legal-data, legal-privacy, legal-terms, permits, and the 11 /soon/{item} pages.

## Result: 80 of 81 cells PASS, 1 FAIL
FAIL: help-mcp at 390 (new defect N3 below). All other 80 cells pass every check.

## History
| Defect | Run 1 (641bc25) | Run 2 (a285dbe) | Run 3 (015fbf9) |
|---|---|---|---|
| D1 header wordmark link 116x25 | FAIL 81 cells | fixed | still fixed |
| D2 footer / More sheet links | FAIL | fixed | still fixed |
| D3 Copy CID button on /data/manifest | FAIL | fixed | still fixed |
| D4 checkboxes 20x20, Arial | FAIL | fixed | still fixed |
| D5 Property drawer source links | FAIL | fixed | still fixed (0 small controls in the drawer at 390/768/1440) |
| N1 Runs / Compare in-page links 14 px | n/a | FAIL (6 cells) | FIXED (runs links are 48 px high at 390: 273x48, 216x48, 174x48, 310x48, 324x48) |
| N2 bottom-nav glyph name as text while the font loads | n/a | n/a | FIXED (see below) |
| N3 /help/mcp horizontal scroll inside `main` at 390 | n/a | n/a (not measured) | NEW, FAIL |

## Checks (all 81 cells unless stated)
- Horizontal scroll: document, body and `main` scrollWidth must be <= viewport, and a requestAnimationFrame sampler recorded the maximum overflow from navigation commit until settled (page still loading). PASS in 80 of 81. The 390 filter sheet (checked immediately after the click and after settle), the 390/768/1440 More sheet and the Property drawer all PASS (scrollWidth 390). FAIL: help-mcp at 390 (N3).
- Targets >= 48 px (width and height) for every visible link, button, input, select, textarea, tab, option: 0 small controls on any page, in the filter sheet, the More sheet or the drawer (N1, D1 to D5 included).
- Fonts: every button, input, select and textarea computes Roboto. The header wordmark `a._titleLink` uses the brand token `--md-ref-typeface-brand` ("Google Sans", "Google Sans Text", Roboto, Arial), which is an Atlas token stack, so PASS. Author colours and sizes were not mapped back to tokens one by one (see Not checked).
- Contrast: up to 40 text colour pairs per cell (alpha-composited over the real ancestor background), 4.5 (3 for large text): 0 failures.
- Navigation before main in the DOM: PASS on every page.
- Coming soon skeletons: 0 running animations on all 11 /soon pages; also no sample, placeholder, lorem, "not wired", ProtoBar, TODO or dummy text on any page.
- Provenance and missing-reason: provenance text (Source, Index, Manifest, collected, run, table, CID) present on every data page; missing-reason pills visible (143 on Explore, 385 on Permits); Harris Explore shows the Travis-only message; /soon pages are static copy with no data.
- Keyboard: up to 70 Tab presses per cell; Tab order follows DOM order (0 order breaks on all pages; the 4 reported in the More sheet are the focus-trap wrap-around after the last link), no positive tabindex, every focused control had a visible outline or shadow (0 without), also in the filter sheet, the More sheet and the drawer.

## N2 test (390 px, Explore with the 25 mi search)
- Font request delayed 6 s (all fonts.gstatic.com requests): Material Symbols stayed "loading" until about 7 s; `main` and document scrollWidth stayed 390 at every sample (1, 2.5, 4.5, 7.5, 9 and 12 s), max overflow 0.
- `explore.search` delayed 4 s: scrollWidth 390 for the whole 12 s, max overflow 0.
- Both delays together: scrollWidth 390, max overflow 0.
N2 is fixed.

## Update after run 3: final state on `2e14516`
N3 (ERR-43) was fixed in `34c8eaf` (`.snippetBox { min-width: 0 }`) and re-measured on the hosted build: `main` is 390 / 688 / 1360 px wide at 390 / 768 / 1440 px (the width the viewport leaves beside the side navigation); no sideways scroll inside it. The run 3 table above is unchanged: 80 of 81 cells passed on `015fbf9`; with N3 re-measured the page grid is complete. Changes after `015fbf9` touch only the Coverage cards (T046), the `index.html` hints (ERR-44, ERR-45), the fonts (ERR-46, self-hosted) and a Catalog test, so the other cells were not re-run. On `2e14516` the icons were checked visually: 3 fonts loaded from the app's own host, 0 requests to Google, icons render, 0 icon names shown as text (check image `fonts-check.png` in the operator's session folder, not in the repo).

## Defect N3 (new, found in run 3)
`/help/mcp` at 390 px: `main` (overflow-x: auto, the scroll container) has scrollWidth 693 against clientWidth 390, so the page scrolls sideways inside `main` (document scrollWidth stays 390, which hides it from a body-only check). Sampling during load saw 303 px of overflow. Cause: `div._card_*` is `display:grid` and its unnamed child wrapping `pre[data-snippet].snippet` takes the `pre`'s unwrapped content width as its min-content, so the grid track grows to 677 px and the headings, paragraphs and tool list all lay out 16..693. `.snippet` already has `overflow-x:auto; max-width:100%`, but the grid item around it is not a scroll container.
Suggested fix (HelpMcp.module.css or Runs.module.css): give the card's grid a `grid-template-columns: minmax(0, 1fr)` (or `min-width: 0` on the card's direct children and on the wrapper div around each `pre`). Applies only at 390; 768 and 1440 pass.

## Not checked
Dark theme (light only). Atlas token use was checked for fonts and contrast only, not by mapping every author colour, spacing and radius back to a token. Contrast is a sample (40 pairs per cell). The Tab walk is capped at 70 presses, so Explore, Manifest, Catalog and Permits (many rows) were not tabbed to the end. Fonts verified by computed font-family and font load state, not by glyph rendering. Real devices (BrowserStack) not used. No timing was assessed.
