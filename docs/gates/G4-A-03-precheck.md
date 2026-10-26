---
gate: G4
artifact: stories/A-03-walking-skeleton.md
artifact_version: "Draft rev 2 (c5c7b19 + run-1 wording fixes + PO decisions D-1 of 2026-10-21, uncommitted)"
run_date: 2026-10-21
tool: Claude
verdict: PASS
---

# G4 pre-check (run 2): A-03 Publish one month of Austin roofing permits by CID and show them in the hosted UI

Inputs read: the story; `docs/feature-list.md` (FEAT-A03, DEP-02, DEP-03, NFR-01/02/03/06/08); `../assessment-guide/AGENT-MAP.md` § 4 (row A-03); `docs/progress.md` (A-01, A-02 Done); the frozen contract `contract/v1/README.md`, `contract/v1/columns.json`, `contract/v1/pilot-manifest.json`; `docs/decisions/0002-lexicon-carriers.md` (ADR-0002, AD-24, AD-25); `profiles/travis-austin@1.0.0` (D-4b); `pipeline/oracle-runtime/travis/pilot/run-pilot.ts`, `capture-tcad-subset.ts`; design screens `Runs1440`, `ExploreQ-sqlperm`, `ShellStates` (exist). This report finds gaps; it does not approve.

## Run 2 note

Run 1 (2026-10-21) was FAIL on C-04, C-06 and C-08: AC-3 asked for `status_raw` and the printed contractor, which have no lexicon carrier (ADR-0002, `contract/v1/README.md` lines 157, 159); AC-5 asked to list a permit with no `tcad_id`, which is never emitted; NFR-002/003/004 were not traced to measuring ACs. Run 1 applied wording fixes only. The PO then decided D-1 (2026-10-21): AC-3 "Use contract columns"; AC-5 "Labels + Runs count"; NFR traces "Add to AC-2/3 and AC-7"; TCAD scope "Yes, show both sources". The story now carries those decisions in its G4 notes. Run 2 re-checks the result.

## Checks

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Front matter | PASS | All fields filled; agents and skills match AGENT-MAP row A-03 (plus the required `apply-engineering-guidelines`). |
| C-02 | User story form | PASS | As a / I want / So that and an independent test on the hosted `/runs` URL plus `verify-manifest`. |
| C-03 | GWT | PASS | AC-1…AC-7 are Given/When/Then (AC-5 has three clauses). Testable boxes are unticked: user step. |
| C-04 | Observable and real | PASS | AC-3 now uses frozen `v_roofing_permit` columns (`improvement_status`, `status_class`, `contractor_resolution`, `missing`; `contract/v1/README.md` lines 186–212). AC-5 uses the real manifest count `permits_no_tcad_geoid` (1 on 2026-10-20). AC-2 lists both manifest sources, as the pilot manifest does. |
| C-05 | Scale + honesty | PASS | Scale: AC-4. Missing data: AC-5 (per-row `missing` labels; Runs count). Error: AC-5 Filebase fallback. |
| C-06 | Testable | PASS (note) | Every row today carries `no_lexicon_carrier` and `contractor_unresolved` (no contractor edge before A-07), so the label rule is exercised on real rows. Note for `/speckit-specify`: fix the reason → human-label table (21 closed reasons, README line 131) so testers check the same wording. |
| C-07 | Edge cases | PASS | Four edge cases; edge 1 carries the 38 re-measure. |
| C-08 | Requirements traced | PASS | FR-001…FR-005 and NFR-001…NFR-004 trace to ACs with thresholds: NFR-002 → AC-7 (budget; idle $0 proven in A-16); NFR-003 → AC-2, AC-3 (390/768/1440, Atlas, `smeargle`); NFR-004 → AC-7 (warm API p95 < 1 s, cold start < 3 s). FR-002 and FR-004 reworded to match. |
| C-09 | Prototype | PASS | `Runs1440`, `ExploreQ-sqlperm`, `ShellStates` exist; states loading · populated · fallback · error. |
| C-10 | Ready | PASS (notes) | A-01, A-02 Done; TCAD 2026 certified export (A-01) noted as already available; no `[NEEDS CLARIFICATION]`. Other prerequisites to confirm at Stage 3: `elephant-cli` main (44bb182), Filebase, Amplify, Namecheap CNAME/certificate, SNS email; the contract sample CIDs are replaced in A-03. |
| C-11 | Slicing | PASS (risk) | One primary eval point (A4), 1.5 days, vertical. Risk: scope sits at the 1.5-day ceiling (scaffold, 5 stacks, publish, spike, two pages, observability, TCAD subset). AC-4's raw 2.38 M-row Parquet stays a private spike asset, never a public CID. |

## Fixes applied

Run 1 (wording only): Description says A-03 extends the A-01 runtime and folds `pipeline-ci.yml` into the Turborepo CI; Real slice re-measure added (42 → 38, 1 no `tcad_id`, 0 no contractor name), dated 42 kept; edge case 1 notes 38; NFR-002 trace → AC-7.

Run 2 (PO decisions D-1): AC-2 lists every manifest source, Austin first then TCAD, publishes `county` + `property_improvement` groups, passes at 390/768/1440 with Atlas tokens; AC-3 uses contract columns with labelled `missing` reasons and the breakpoint check; AC-5 per-row labels plus Runs count `permits_no_tcad_geoid`, fallback clause unchanged; AC-7 records warm API p95 and cold start; FR-002, FR-004 reworded; TCAD export noted under Depends on; PO decisions quoted in the story's G4 notes.

## Fix list (remaining, none blocking)

1. In `/speckit-specify`, add the reason → human-label table so AC-3/AC-5 labels are judged the same way.
2. Watch the 1.5-day ceiling; split the read-path spike out if Stage 3 slips.

The user records the G4 decision: tick the checklist in the story, record the decision and date, and add a row to the gate log in `docs/traceability.md`.
