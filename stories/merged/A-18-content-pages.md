---
id: A-18
type: user-story
title: Show the hub, legal and catalog pages and mark planned features as Coming soon
parent: FEAT-A18
vision: VIS-A
ard: ARD-A
eval_point: A5
priority: P3
moscow: Should
branch: 018-content-pages
spec: specs/018-content-pages/
depends_on: [A-03, A-13]
size_days: 1
agents:
  design: [metagross]
  builder: metagross
  reviewers: [metagross, audino]
  verify: "Playwright: every page and Coming soon item renders; no sample data on the hosted site"
skills: [build-frontend-backends, frontend-bug-fix, responsive-design-tests, apply-engineering-guidelines]
ui: true
status: Merged
merged_into: A-13
gate: G4
qc_testability_signoff: false
created: 2026-10-19
---

# A-18 Show the hub, legal and catalog pages and mark planned features as Coming soon

> **Merged into A-13 on 2026-10-21.** This story is now part of [A-13 Build the Explorer UI with its hub, legal, catalog and Coming soon pages](../A-13-explorer-and-pages.md), branch `013-explorer-and-pages`. Its ACs and requirements are kept there with "was" tags. This file is kept for reference only: don't run the story loop on it.

| Field | Value |
| --- | --- |
| Evaluation point | A5 (primary) · A4 |
| Demo line(s) | D-1 (opening: the app the presenter lands on); none of the other lines depend on it |
| Agents | design `metagross` · builder `metagross` · reviewers `metagross`, `audino` · verify Playwright: every page and Coming soon item renders; no sample data on the hosted site (source: [AGENT-MAP.md](../../assessment-guide/AGENT-MAP.md) § 4) |
| Depends on | A-03, A-13 |
| Size | 1 day |
| Branch | `018-content-pages`, merged into `feature/oracle-pipeline` |

## Context

The approved design (`docs/02-design.md` § 3) has more pages than the demo needs: a Hub landing page, Legal pages, a Data Catalog, a Runs log, and features the PO wants visible as a roadmap. The **evaluator** should see a complete, finished-looking product, with the extra ideas presented as **"Must vs Coming soon"** rather than as broken links (02-design § 3, "Presenting the breadth"). The **CRM developer** uses the catalog and legal pages to know what each published table is and under which terms it can be reused.

**Data rule (P0-12, constitution XI, CLAUDE.md):** nothing on the hosted site may show sample, prototype or invented data. Pages built here show **real** published data (catalog, run log) or **static text**. Coming soon items show a description of the planned feature and why it is not live, never example values.

## Description

As the **evaluator** (and the CRM developer), I want **a Hub to start from, legal and data-licence pages, a data catalog and run log built from the published files, and every planned feature clearly marked Coming soon**, so that **the product feels complete and honest about what exists today and what comes next**.

Pages and items:
- **Built with real data or static text:**
  - **Hub** (`/`): the CountyLens card (Open, What can I ask?), the Roofing CRM card "Coming soon · Not deployed yet" until Task B is live, run status chip from `runs/index.json`, Watch demo and PR links (wired at release).
  - **Legal** (`/legal/data`, `/legal/privacy`, `/legal/terms`): static text naming every source, its licence or terms, and the access rules (stop on 403, no CAPTCHA bypass).
  - **Data · Catalog** (`/data/catalog`): one row per published table from `tables-export.json` of the latest manifest, with columns, row count, CID and size.
  - **Runs · Log** (`/runs/log`): real run events from the manifests (start, publish, verify, finish, limitations).
- **Could** (build only after every demo line D-1 to D-12 passes; otherwise Coming soon): run timeline scrubber over `runs/index.json`; gateway race (both Verify lanes timed side by side).
- **Coming soon, shown as a skeleton only** (the Atlas skeleton placeholder shapes of the planned layout, a "Soon" marker and a one-line description; no text, numbers, rows or CIDs inside the skeleton; PO decision 2026-10-19): Builder mode (#21), other counties and states (#20, only Travis is live), Street View (#17), AI-user sign-in (#66), saved searches, Similar properties (#63), SQL checks, pipeline diagram and Gantt, area matrix.

**Independent test:** Playwright opens every route and Coming soon item on the hosted URL; each renders; a scan of the rendered text finds none of the prototype's placeholder values (for example "SAMPLE, JORDAN A", "128 within 5 mi", fixed `bafybei…` strings not in a real manifest).

## Acceptance Criteria

1. **AC-1** · **Given** the hosted app, **When** a visitor opens `/`, **Then** the Hub shows the CountyLens card linking to Explore, the Roofing CRM card as "Coming soon · Not deployed yet" with a disabled button, and a status chip "Run {n} · {finishedAt}" read from `runs/index.json`. ☐ testable
2. **AC-2** · **Given** the latest manifest (for example Run 3), **When** the visitor opens Data · Catalog, **Then** every published table appears with its columns from `tables-export.json`, its row count from the manifest `coverage` (`published_rows`), its CID and size, and each CID links to Verify. ☐ testable
3. **AC-3** · **Given** the Legal pages, **When** opened, **Then** each source used (TCAD, Travis County GIS, City of Austin `3syk-w9eu`, TX Comptroller `9cir-efmm`, BBB, Overture, US Census Gazetteer) is listed with its terms or licence link, and the access rules (public sources only, stop on 403, no CAPTCHA bypass, Query DB never exposed) are stated. ☐ testable
4. **AC-4** (scale) · **Given** a run history of at least 3 runs, **When** Runs · Log opens, **Then** every event from every manifest appears in time order with its run ID, and the page renders in under 2.5 s LCP on mobile 4G. ☐ testable
5. **AC-5** (missing data) · **Given** a Coming soon item (for example Builder mode or "Harris County"), **When** a visitor opens or selects it, **Then** it shows the planned layout as a static skeleton (grey placeholder blocks, not animated, so it never looks like loading), a "Coming soon" label and one sentence on what it will do and why it is not live, with no example numbers, rows or CIDs; selecting another county shows "CountyLens has data for Travis County, TX only". ☐ testable
6. **AC-6** · **Given** the full hosted site, **When** the no-sample-data scan runs, **Then** it finds 0 prototype placeholder values and 0 "not wired" toasts, and the ProtoBar is absent (02-design § 3, P0-12). ☐ testable

## Edge cases (at least two)

- `tables-export.json` is unreachable → Catalog shows "Catalog unavailable · {reason}" and a link to the manifest; never a cached sample.
- Task B goes live during review → the CRM card switches to its live URL through config, without a code change.
- Phone width (390) → Coming soon items sit in the More sheet, with 48 px targets.

## Requirements

| REQ | Requirement | Traces to |
| --- | --- | --- |
| FR-001 | Hub MUST link the live app and show the CRM as Coming soon until it is deployed | AC-1 |
| FR-002 | Catalog and Runs log MUST be built only from published files | AC-2, AC-4 |
| FR-003 | Legal pages MUST name every source's terms and the access rules | AC-3 |
| FR-004 | Coming soon items MUST describe the feature without example data | AC-5 |
| FR-005 | The hosted site MUST contain no prototype or sample values | AC-6 |
| NFR-001 | LCP < 2.5 s, CLS < 0.1 on mobile 4G; WCAG 2.2 AA; Atlas only; responsive at 390/768/1440 | AC-4 |

## Prototype reference (mandatory if the story has UI)

| Element | Value |
| --- | --- |
| Claude Design screen | `design/prototype/Hub1440.dc.html` (+ 768, 390), `LegalData1440.dc.html`, `LegalPrivacy1440.dc.html`, `LegalTerms1440.dc.html` (+ variants), `DataCatalog1440.dc.html` (+ 768), `RunsLog1440.dc.html` (+ 768), `Shell390ComingSoon.dc.html`, `ExploreQ-builder.dc.html`, `UserSignIn1440.dc.html` (Coming soon, not linked), `Extensions.dc.html`, `EmptyHints.dc.html` |
| States covered | populated · unavailable · coming soon |
| Design system | `assessment-guide/design-system/` (Atlas, Material 3, mobile-first) |

## Demo Script

1. Presenter (opening line): "I will demonstrate that the Oracle pipeline has loaded the available dataset for Travis County, Texas…" → Expected: the Hub with the live run chip, then Open CountyLens.

## Out of scope

- Any sample or demo values on Coming soon items (P0-12); the PO chose skeleton-only previews on 2026-10-19.
- Welcome tour and owner/contractor name search (cut, #33, #47).

## Evidence to capture

- `docs/evidence/A-18.md`: route list with screenshots, the no-sample-data scan output, Lighthouse scores.
- `smeargle` report; `testplans/A-18-test-cases.md` results; `docs/reviews/CR-A-18.md`.

---

## Gate G4: Story ready for planning

| # | Criterion | Status |
| --- | --- | --- |
| G4-1 | Front matter complete (parent FEAT, eval point, branch, priority, **agents and skills from AGENT-MAP.md**) | ☐ |
| G4-2 | "As a / I want / So that" stated, with an independent test | ☐ |
| G4-3 | Every AC is Given / When / Then, and its testable box is ticked | ☐ |
| G4-4 | One scale AC and one missing-data or error AC | ☐ |
| G4-5 | At least two edge cases | ☐ |
| G4-6 | Every requirement traces to an AC; NFRs have thresholds | ☐ |
| G4-7 | Prototype screen linked (UI stories) | ☐ |
| G4-8 | Dependencies done, or stubbed with **real** sample data | ☐ |
| G4-9 | No `[NEEDS CLARIFICATION]` left | ☐ |
| G4-10 | AI pre-check (`developmentsupport-g4-precheck`): PASS | ☐ |

**Decision:** ☐ Ready ☐ Returned, reason: {…} · {date}
