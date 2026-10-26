# UI visual comparison: built Runs/Permits vs Claude Design prototype (2026-10-23)

## Method

The earlier review (`docs/reviews/ui-review-2026-10-23.md`) compared Atlas CSS token values
and source code only — it did not render the prototype, which uses `<dc-import>`/`<x-dc>`
custom elements (`design/prototype/support.js`) that assemble content at runtime. Reading
`design/prototype/Runs390.dc.html` etc. as static HTML shows almost nothing.

This pass actually rendered both sides with Playwright (Chromium) at 1440 / 768 / 390 px:

- Prototype: served locally (`python3 -m http.server 8743` from `design/prototype/`),
  screenshotted `Runs1440/768/390.dc.html` and `Explore1440/768/390.dc.html`.
- Live: `https://countylens.aldarraj.com/runs` and `/permits`, resized to the same three widths.
- Confirmed no page-level horizontal overflow on the live Permits page at any width
  (`document.documentElement.scrollWidth === clientWidth` at 390/768/1440 — checked via a
  throwaway script, not saved).

Screenshots saved to (ephemeral scratchpad, not in the repo):
`/private/tmp/claude-501/-Users-hebagaber-Github-oracle-property-intelligence-platform-pipeline-travis-tx-p/b205cf06-1df3-48d3-9cda-3adb71a88632/scratchpad/shots/`
(`proto-runs-{1440,768,390}.png`, `proto-explore-{1440,768,390}.png`,
`live-runs-{1440,768,390}.png`, `live-permits-{1440,768,390}.png`).

## Sitemap check for "Permits"

`design/prototype/canvas.json` has no dedicated Permits screen. Permit-level fields
(roof age, permit status, stalled/expired) live inside the **Explore** workspace
(`Explore1440/768/390.dc.html`, plus query-result variants like `ExploreQ-permits5.dc.html`),
which is a property-centric search/filter/map tool, not a permits table.

## Findings

**Runs page — real, substantial gap (expected at this build stage, not a defect to "fix"):**
The prototype's Runs1440 is a full pipeline-ops screen: a run picker, sync-status panel,
an 8-source → check/join → derive → publish → verify DAG with per-node status, a Gantt
timeline, a live "Latest events" feed, and a "what this run changed" diff (added/changed/removed
counts per source, manifest CID vs previous). The built `/runs` page shows one run's static
summary card: id, start/finish, sources with record counts and source URLs, coverage counts,
data-group table CIDs. Nav also differs: prototype uses a horizontal top nav row (same pattern
at 1440 and 768); the build uses a left icon-rail at 1440/768 and a bottom tab bar at 390. This
is a walking-skeleton vs. full-prototype feature gap, not a token/style bug, and matches what
the task brief calls "expected and fine" — no code change made for it.

**Permits page — no 1:1 prototype equivalent exists.** The closest analog is Explore, which is
map/filter/radius-search over properties with roofing/permit signals folded in, not a flat
permits table. The built Permits page (sortable table ≥600px, collapsing to stacked cards
<600px, every row carrying a `Source:` link, collected-at timestamp, manifest CID, and a
"Missing data" / "No place for this field" chip list per row) is a reasonable, honest design
for a data-provenance table, but it cannot be meaningfully graded against a prototype screen
that doesn't exist. Flagging this explicitly rather than skipping it.

**Investigated and ruled out as a bug:** at 768px the Permits table in a `fullPage` screenshot
appears to cut off the right-most columns (Missing data, Provenance). Checked the actual CSS
(`apps/web/src/routes/Permits.module.css`) — `.tableWrap { overflow-x: auto; }` is an
intentional per-component horizontal scroll (Atlas § 7 "Data table from 600 px"), and a
`scrollWidth`/`clientWidth` check confirmed no page-level overflow at 390/768/1440. This is a
screenshot artifact (`fullPage` capture doesn't scroll nested containers), not a real clipping
defect. No fix applied.

## What was fixed

Nothing. No genuine, fixable visual defect was found — the real differences found are expected
feature-richness gaps between a walking-skeleton build and a full prototype, and one apparent
"overflow" turned out to be a correct, intentional scroll container once checked in a real
browser rather than a screenshot.
