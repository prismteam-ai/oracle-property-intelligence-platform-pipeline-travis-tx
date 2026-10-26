---
gate: G4
artifact: stories/A-13-explorer-and-pages.md
artifact_version: "Ready rev 3 (run-1 wording fixes + PO round R1 decisions D-1, D-2, D-3 of 2026-10-21, uncommitted)"
run_date: 2026-10-21
tool: Claude
verdict: PASS
---

# G4 pre-check (run 2): A-13 Build the Explorer UI with its hub, legal, catalog and Coming soon pages

Inputs read: the story; `docs/feature-list.md` (FEAT-A13 Must, FEAT-A18 Should); `../assessment-guide/AGENT-MAP.md` § 4 (row A-13, parts A-13 and A-18); `docs/traceability.md` demo map D-1 to D-12; `docs/progress.md` (A-01, A-02, A-03 Done; A-11 Draft); `stories/A-11-publish-and-runs.md` (Draft, `depends_on: [A-07]`); `runs/index.json` (1 run: `travis-202609-permits-20261021t103516z`); `packages/query-core/views.sql` (`roof_age_confidence`); `stories/merged/A-04-tcad-backbone.md` (AC-39, AC-40); `docs/evidence/A-01-coverage.md` (Pflugerville `blocked`); all 23 linked `design/prototype/*.dc.html` screens (exist); `.specify/memory/constitution.md` (XI, XIII). This report finds gaps; it does not approve.

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Front matter | PASS | id, parent `[FEAT-A13, FEAT-A18]`, `eval_point: A5`, `priority: P1`, `moscow: Must`, branch, `depends_on`, status filled. Agents match AGENT-MAP § 4 row A-13 (design `metagross`, builder `metagross`, reviewers `metagross`, `audino`, verify text identical); skills are the row's three plus `apply-engineering-guidelines` (required by CLAUDE.md for every builder). |
| C-02 | User story form | PASS | "As the evaluator (and the CRM developer), I want … so that …" and an Independent test. |
| C-03 | GWT | PASS (fixed in run 1) | Was FAIL: AC-7's second clause "**Given** a gateway answers 429 during Verify, **Then** …" had no When. Fixed to "**Given** a gateway answers 429, **When** Verify runs, **Then** …". All 14 ACs are now Given / When / Then. |
| C-04 | Observable and real | PASS (fixed in run 1) | Every AC is observable on the hosted UI (C-04 applies to all 14; `ui: true`). Was FAIL: Context said "Pflugerville's own permits come only if A-01 classifies its portal as supported", but A-01 classified it `blocked` (2026-10-19). Reworded to the A-01 facts (Austin-issued permits there: 1,117 in city, 592 in ETJ). |
| C-05 | Scale + honesty | PASS | Scale: AC-6 (20 timed runs, p95 < 3 s, first load ≤ 8 s), AC-12 (≥ 3 runs, LCP < 2.5 s). Missing data / error: AC-7, AC-13. |
| C-06 | Testable | PASS (fixed in run 1) | Was FAIL on five points, all wording: (1) AC-1 "deltas" (vs what?) → "per-source deltas versus the previous run"; (2) AC-4 "confidence" → the column `roof_age_confidence` (views.sql); (3) AC-5 fixed the Pflugerville outcome while its own demo-area note says the area is picked from the data, so two testers could judge different areas → the expected list is now the one recorded for the chosen area in `docs/evidence/A-13-open-permits.md`, and the Pflugerville numbers stay as a dated reference "2026-10-19, re-measured at run time" (the PO confirms this reading at D-2); (4) AC-8 "the definitions on screen" and the unexplained "(AC-39, AC-40)" → "a one-line definition of each of the two filters" and "backlog AC-39 tenure, AC-40 out-of-area owners, from A-04"; (5) the Description said a "Soon" marker, AC-13 says a "Coming soon" label → both say "Coming soon". |
| C-07 | Edge cases | PASS | Six edge cases (zero results, CID copy down, SQL typo, 390 width, `tables-export.json` unreachable, CRM goes live). |
| C-08 | Requirements traced | PASS | FR-001 to FR-010 and NFR-001 to NFR-003 each trace to an AC; NFRs have thresholds (p95 < 3 s, ≤ 8 s, ≤ 300 KB gzipped, LCP < 2.5 s, CLS < 0.1, WCAG 2.2 AA, 100% provenance). |
| C-09 | Prototype | PASS | 23 screens linked for both parts, all present in `design/prototype/`; nine states listed with their state boards. |
| C-10 | Ready | PASS (run 2) | Run 2: `depends_on: [A-02, A-03, A-11]` (PO D-1, 2026-10-21); the Depends-on row and the Decision line state that the hosted proofs of AC-1, AC-2, AC-3 full county, AC-6, AC-10, AC-12 and G7 wait for A-11. Run 1 finding: (a) **Implicit dependency (G4-8):** AC-1 (Runs 1–3, Compare), AC-2 and AC-3 (full-county coverage and artifacts), AC-6 (full-county scale), AC-10 (`tables-export.json`) and AC-12 (≥ 3 runs) need A-11, but `depends_on: [A-02, A-03]` omits it. A-11 is Draft (`docs/progress.md`) and waits on A-07 → A-04. Today `runs/index.json` holds one real run (the A-03 slice, 35 permits, no `tables-export.json`): that is the real data the build and unit tests use; nothing is stubbed with invented values. Fix: `depends_on: [A-02, A-03, A-11]` and state that the hosted tests of those six ACs and G7 wait for A-11 (PO decision D-1/D-2). (b) No `[NEEDS CLARIFICATION]` left: PASS (the only match is the G4-9 checklist label). |
| C-11 | Slicing | PASS (run 2, PO exception) | Run 2: the Size row records the 2.5 days as an accepted exception from the PO story merge (PO D-2, 2026-10-21), with Part 2 as the cut line. Run 1 finding: One primary evaluation point (A5) and vertical: PASS. Size `size_days: 2.5` exceeds the 0.5–1.5-day slice. The size comes from the PO's story merge of 2026-10-21 (AGENT-MAP § 4 note: A-18 → A-13, loop runs once). Fix: record that merge as an accepted size exception in the story (PO decision at D-2), with Part 2 as the cut line (D-12). |

## Fix list (by impact on the assessment score)

1. **C-10 (PO, D-1):** add A-11 to `depends_on`, and say that the hosted proofs of AC-1, AC-2, AC-3, AC-6, AC-10, AC-12 and G7 wait for A-11's published Runs 1–3. Without this, `progress.sh` and later gates read a false "ready" and A5/A3/A4 evidence would be claimed on a 35-permit slice.
2. **C-11 (PO, D-2):** record the 2.5-day size as the accepted exception from the 2026-10-21 merge, with Part 2 as the cut line.
3. Applied in run 1 (no change of meaning, PO confirms at D-2): C-03 AC-7 When; C-04 Pflugerville context; C-06 AC-1 deltas, AC-4 column name, AC-5 demo-area expectation, AC-8 definitions and references, "Coming soon" label.

## Run 2 (2026-10-21, after PO round R1)

- D-1 "Add A-11 (Recommended)" → `depends_on: [A-02, A-03, A-11]`. C-10 PASS.
- D-2 "Ready, build now (Recommended)" → size exception recorded; the AC-5 rewording stays. C-11 PASS.
- Gateways "Yes, Pinata + Filebase (Recommended)" → AC-1, AC-3, FR-003, the Description and the Scope note now name Pinata (`gateway.pinata.cloud`) and Filebase (`ipfs.filebase.io`), matching ARD AM-01 and ADR-0001 D-4 (ipfs.io and dweb.link retired on 2026-09-21).
- D-3 "Yes, after Part 1 (Recommended)" → Part 2 stays in scope, built in wave 3.

**Verdict: PASS** (11 / 11). Recorded for Stage 3 (not G4 failures; inputs for the design round D-5): `tables-export.json` is written only to local `reports/` and lists no columns (AC-10); the manifests carry no run events (AC-12); manifest `coverage` has no BBB, business, places or coordinate keys and no denominators (AC-2); eight of nine A-02 carrier fields are "no carrier" and `v_property.bbb_status` is always `not_checked` (AC-5, AC-7); address fields are `not_in_export`, so `owner_area_class` is `unknown` until A-04 (AC-8). Each is produced by A-04, A-07 or A-11, or needs an additive pipeline change, never a sample.
