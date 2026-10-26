---
id: ERR-13
type: defect
feature: FEAT-A03
story: A-03
test_case: A-03-TC-NF-03
ac_reference: A-03-AC-2
severity: Low
status: Closed
found_by: smeargle
found_date: 2026-10-21
fix_branch: 003-walking-skeleton
fix_commit: 660f73ccfe1805673e0b0efae38c0bb002ea75b5
retest_date: 2026-10-21
closed_date: 2026-10-21
---

# ERR-13: App shell – at 600 px and wider, Tab reaches the page content before the navigation rail

## Brief description

Advisory. From 600 px the navigation rail sits visually left of the main region, but in the DOM `<nav>` comes after `<main>`. Keyboard users therefore tab through the whole page (every Copy CID button and link) before reaching the Runs / Permits destinations, which does not follow the visual order (WCAG 2.4.3 Focus Order).

## Related requirement

- **Story:** A-03 · **AC:** A-03-AC-2, A-03-AC-3 (shell of both pages) · **Requirement:** NFR-003, plan § "Atlas element map" → Shell · **Test case:** A-03-TC-NF-03

## Environment

| Item | Value |
| --- | --- |
| URL | https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/runs (same on /permits) |
| Build | `1380ad3` (Amplify branch preview `003-walking-skeleton`) |
| Data snapshot | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` |
| Browser / OS / device | Chromium (Playwright) · macOS · 768 and 1440 px |
| Role | anonymous (public page) |

## Preconditions and test data

- Viewport at least 600 px wide (navigation rail layout).

## Steps to reproduce

1. Open https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/runs in a private window at 1440 × 900.
2. Press Tab repeatedly from the top of the page.
3. Note the order in which focus visits the run card controls and the rail's Runs / Permits links.

## Expected result

Focus visits the navigation rail (Runs, Permits) before the main content, matching the visual left-to-right order; landmark order is banner, navigation, main. The visual layout is unchanged.

## Actual result

Focus visits every focusable element in `<main>` first; the rail's links come last.

## Impact and severity

- **Impact:** keyboard and screen-reader users meet the content before the navigation; smeargle marks it advisory.
- **Severity:** Low because every control is still reachable and nothing in the demo breaks.

## Suggested investigation area

`apps/web/src/components/AppShell.tsx` (element order); `AppShell.module.css` already places each element with `grid-area`.

## Evidence

- [x] smeargle report 2026-10-21 (screenshots `docs/evidence/img/A-03-smeargle-runs-{768,1440}.png`)
- [x] Red unit run before the fix: "renders the navigation before main in DOM order; the grid areas place them visually" failed ("navigation before main")
- [x] Hosted re-test: PASS in hosted run 2 (build `fbdb68b`)

## Resolution

| Field | Value |
| --- | --- |
| Root cause | `AppShell` rendered `header, main, nav`; the grid moves the rail to the left only visually. |
| Fix | `AppShell` renders `header, nav, main`. The CSS grid areas (`"bar" "main" "nav"` below 600 px, `"bar bar" "nav main"` from 600 px) are unchanged, so nothing moves on screen; on compact widths the bottom navigation stays at the bottom. Commit: _(filled after commit)_ on `003-walking-skeleton`. |
| Tests | `apps/web/test/app-shell.test.tsx` › "ERR-13: landmark order: banner, navigation, then main …" › "renders the navigation before main in DOM order; the grid areas place them visually" and "keeps the layout in grid-template-areas (DOM order does not move anything visually)". |
| Re-test | TC-NF-03 PASS in hosted run 2 (build `fbdb68b`, 2026-10-21); `smeargle` re-check: nav before main |
| Status | ☒ Closed (2026-10-21) ☐ Reopened · Re-tested: PASS in hosted run 2 (build `fbdb68b`, 2026-10-21) |
