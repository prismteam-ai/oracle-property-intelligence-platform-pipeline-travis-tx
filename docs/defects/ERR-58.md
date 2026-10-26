---
id: ERR-58
type: defect
kind: product defect (accessibility)
feature: FEAT-A13
story: A-13
test_case: A-13-TC-083
ac_reference: AC-14 (accessibility, WCAG 2.2 AA)
severity: Medium
status: Closed (fixed; re-tested PASS, CI run 40185511164, code dc46a6d)
found_by: "hosted run 40181120042 (axe: `/runs/log: scrollable-region-focusable (serious, 1) main`)"
found_date: 2026-10-25
fix_branch: 013-explorer-and-pages
fix_commit: ad2a9ef
retest_date: 2026-10-25
---

# ERR-58: the scrolling `<main>` could not be reached by keyboard on /runs/log

## Root cause

`<main>` is the scroll container (`overflow-y: auto`). On `/runs/log` its content has no link or button, so a keyboard user had no focusable element to scroll with. Run 2 made the log long enough to scroll; the 14-property slice did not.

## Fix

`apps/web/src/components/AppShell.tsx`: `tabIndex={0}` on `<main>`; the global `:focus-visible` ring (Atlas token) applies. A first attempt with a negative outline offset was rejected by the repository's no-negative-values test and dropped.
