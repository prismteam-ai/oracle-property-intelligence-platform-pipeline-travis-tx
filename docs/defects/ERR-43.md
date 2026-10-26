---
id: ERR-43
type: defect
kind: product defect (layout)
feature: FEAT-A13
story: A-13
test_case: "smeargle run 3 (not caught by a Playwright case: the page body stays 390)"
ac_reference: "Edge 4 (390 px: no horizontal scroll), FR-018, FR-023"
severity: Medium
status: "Closed (fixed, re-checked on hosted build 34c8eaf: /help/mcp main 390 = 390 at 390 px)"
found_by: smeargle hosted responsive check, build 015fbf9, /help/mcp at 390 px
found_date: 2026-10-22
fix_branch: 013-explorer-and-pages
fix_commit: 34c8eaf
retest_date: 2026-10-22
---

# ERR-43: Help · MCP content area scrolls sideways at 390 px (main scrollWidth 693)

## Brief description

Final `smeargle` pass on the preview (build `015fbf9`): `/help/mcp` at 390 px fails; 80 of 81 page × width cells pass. `main` (a scroll container, `overflow-x: auto`) has `scrollWidth` 693 against `clientWidth` 390. The document and body stay at 390, so a body-only check (and the Playwright no-horizontal-scroll cases) do not see it.

## Root cause

Each setup snippet sits in a plain `<div>` inside a CSS grid card. A grid item's automatic minimum width is its content's min-content, here the unwrapped `<pre>` (677 px), so the track grew past the viewport even though `.snippet` has `overflow-x: auto; max-width: 100%`.

## Fix

`HelpMcp.module.css` `.snippetBox { min-width: 0 }` on the wrapper (used by `HelpMcp.tsx`), so the code block scrolls inside itself.

## Regression test

`apps/web/test/touch-targets.test.ts` "N3" (red before, green after). Hosted re-check: `/help/mcp` at 390 on the next build, and TC-042/TC-080.

## Impact

At phone width the whole Help · MCP page could be dragged sideways; no data was affected.
