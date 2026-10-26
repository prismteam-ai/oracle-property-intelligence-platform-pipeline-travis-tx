---
gate: G4
artifact: stories/A-04-property-backbone.md
artifact_version: "Draft rev 1 (861efa1 + run-1 wording fixes, uncommitted)"
run_date: 2026-10-21
tool: Claude
verdict: FAIL
---

# G4 pre-check (run 1): A-04 Load the county backbone: TCAD properties and owners, coordinates, and permits from every jurisdiction

Inputs read: the story; `docs/feature-list.md` (FEAT-A04, FEAT-A05, FEAT-A06, amendment 0.2.1 story merge); `../assessment-guide/AGENT-MAP.md` § 4 (row A-04); `docs/progress.md` (A-01, A-02, A-03 Done); the frozen contract `contract/v1/README.md` and `contract/v1/columns.json`; `docs/sources.md`; `docs/decisions/DEC-A-01-parcel-gap-exception.md`; `pipeline/oracle-runtime/travis/pilot/capture-tcad-subset.ts`; `docs/evidence/A-03.md`; the design screens `Coverage1440`, `Property1440`, `ExploreQ-roof15`, `ExploreQ-permits5` (they exist). This report finds gaps; it does not approve.

## Gate exception (recorded once)

**C-04 (hosted/live demo evidence) is an accepted exception for this pipeline-only story.** A-04 loads the local stack and the internal Query DB; it publishes nothing. Its proof is in the PR: the `monitoring-county-ingestion` report, the roll reconciliation, the coverage SQL and gap report, the per-jurisdiction counts, the capture receipts and the test output. It shows live once A-11 publishes and A-13 reads it. C-04 still checks that every AC uses real Travis County data.

## Checks

| Check | Criterion | Result | Finding |
| --- | --- | --- | --- |
| C-01 | Front matter | PASS | All fields filled; agents and skills match AGENT-MAP row A-04 (plus the required `apply-engineering-guidelines`). |
| C-02 | User story form | PASS | As a / I want / So that, plus an independent test (monitoring report, roll reconciliation, coverage SQL, per-jurisdiction counts). |
| C-03 | GWT | PASS | AC-1…AC-17 are Given/When/Then (AC-4 and AC-16 have two clauses each). Testable boxes are unticked: user step. |
| C-04 | Observable and real | PASS (exception) | See "Gate exception" above. Every AC uses real figures: N = 493,246 (export SHA-256 `6f7a7585…4c2346`), GIS 373,683, Austin 2,380,725 / 2,381,226 rows, 22,084 reroofs, anchors `0208011301`, `0223120506`, permit 1982-012866 BP. |
| C-05 | Scale + honesty | PASS | Scale: AC-2, AC-8, AC-12. Missing data: AC-4, AC-10, AC-16. Error: AC-6, AC-11, AC-17. |
| C-06 | Testable | FAIL | (a) AC-8 asks for "at least 99% of the N properties" with coordinates, N = 493,246. The approved exception `DEC-A-01-parcel-gap-exception.md` (and `docs/sources.md` "Coverage effect") says A-05 reports coverage **against real-estate accounts**, because 51,285 non-land accounts and about 56,139 condominium units get no polygon of their own. Two testers would use different denominators, and 99% of all N is very likely out of reach. NFR-003 and the independent test (`avg(...) FROM v_property ≥ 0.99`) inherit this. (b) AC-2 subtracts confidential records from the loaded count ("N minus … minus confidential records"), but AC-5 redacts their owner fields, which means they are loaded. It is unclear whether confidential accounts are in the loaded count. Fix: a PO decision on both (it changes meaning, so not applied here). |
| C-07 | Edge cases | PASS | Eleven edge cases across the three parts. |
| C-08 | Requirements traced | FAIL | Every FR/NFR traces to an AC. NFR-002 ("bounded concurrency, backoff, no evasion") has no numeric threshold, and AC-6 tests only the 403 stop. Fix: state the TCAD threshold (for example one bulk download at concurrency 1, backoff 1 s base / 60 s cap / 5 attempts, stop on 403), as NFR-004 and NFR-006 already do. This adds a threshold, so it was not applied. |
| C-09 | Prototype | PASS | Not a UI story (`ui: false`); the screens it feeds through A-13 are named and exist. |
| C-10 | Ready | PASS (notes) | A-01, A-02, A-03 are Done; N is now measured; no `[NEEDS CLARIFICATION]`. Notes: GIS paging must run from a US runner (`docs/sources.md`, the operator egress never connects); the 2026-10-21T18:54:53Z Austin re-measure (2,381,226 / 63,021) has no receipt in the repo yet. |
| C-11 | Slicing | FAIL | One primary eval point (A1), vertical, but `size_days: 2.5` is above the 1.5-day ceiling. This comes from the PO's story merge (feature-list amendment 0.2.1, 2026-10-21). The user decides whether to accept it as an exception or split it. |

## Fixes applied (run 1, wording only)

- Context Part A-04: "not yet measured" replaced by measured N = 493,246 accounts (TCAD 2026 certified roll, streaming count, captured 2026-10-19T21:33:41Z; export SHA-256 `6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346`, re-verified 2026-10-21).
- Context Part A-04: the anchors `0208011301` / `0223120506` and the `tcad_id` link are explained. Austin's `tcad_id` carries the TCAD geoID (`propertyIdentification[].geoID`), which resolves to the key `pID` (`capture-tcad-subset.ts`, `docs/evidence/A-03.md`).
- AC-7: `gis_parcel_centroid` → the frozen value `gis_centroid` (`contract/v1/columns.json`; `permit_point` in AC-9 was already frozen).
- Context Part A-05: A-01 GIS facts added (373,683 features, US runner, 2026-10-20T07:31:05Z; 24.24% gap; PO exception `DEC-A-01-parcel-gap-exception.md`).
- Independent test: the coverage SQL runs over `v_property` bound to a local `elephant-cli export-tables` run (never uploaded), plus the same count from the Query DB. The SQL column is `latitude` (the frozen v_property column), not `lat`, so the query can run.
- Context Part A-05 and AC-12: the Austin re-measure dated 2026-10-21T18:54:53Z is added (2,381,226 rows, 63,021 with no `tcad_id`), and the dated figures are kept.
- AC-5, AC-15: "manifest limitations" → "the run's source limitations, which A-11 copies into the manifest".

## Fix list (ordered by impact on the score)

1. **PO decision on the AC-8 / NFR-003 denominator** (C-06): either all N (493,246) or real-estate accounts as `DEC-A-01-parcel-gap-exception.md` says, and how condominium units get coordinates. Without it, AC-8 is likely to fail at G7.
2. **PO decision on confidential accounts in AC-2 vs AC-5** (C-06): are they loaded with redacted owners or excluded from the loaded count?
3. **Add a numeric threshold to NFR-002** (C-08) for the TCAD download.
4. **Size 2.5 days** (C-11): accept it as a merge exception or split it at Stage 3.
5. For `/speckit-specify`: AC-7 and AC-10 still say `lat`/`lon`, while the contract columns are `latitude`/`longitude`. AC-10's gap reasons (`no_gis_feature`, `gis_null_geometry`, `no_permit_point`) are gap-report reasons; the `v_property` row carries `coordinate_source = none` and the closed reason `no_coordinates`. Keep both levels distinct. AC-14's `status_raw` has no lexicon carrier (ADR-0002), so it is a Query DB check only.
6. Commit the receipt for the 2026-10-21T18:54:53Z Austin re-measure.

**Decision:** Approved: Ready, 2026-10-21 22:30 (Round 1 D-3, user answer "Ready (Recommended)"). C-04 pipeline-only exception; C-11 size 2.5 d accepted as a consequence of the PO story merge (amendment 0.2.1); C-06 resolved by D-1 (99% of R accounts; non-land counted separately; condo building-point rule) and D-7 (no §25.025 marker in the JSON: conservative sale-code suppression, accounts loaded and counted, limitation recorded); C-08 resolved by NFR-002 numbers (GIS concurrency ≤ 2, Austin ≤ 1 req/s, backoff 1 s base / 60 s cap / 5 attempts / full jitter, stop on first 403, no new TCAD download without a stop). Gate-log row in docs/traceability.md is added in F4 (§ P step 5).
