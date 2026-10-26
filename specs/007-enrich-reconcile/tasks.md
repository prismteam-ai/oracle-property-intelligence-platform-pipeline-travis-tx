---
description: "Task list for A-07 enrich and reconcile (merged story: tracks A-D)"
---

# Tasks: Enrich and reconcile: contractor identity, BBB ratings, business and places data, duplicate merge and roof age

**Input**: Design documents from `specs/007-enrich-reconcile/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md — all present.

**Tests**: MANDATORY (constitution X, XXI, XXII). Test tasks come first in every phase and must fail before the implementation tasks run. Every phase ends with the Phase Z tasks.

**Builder**: every implementation task is delegated to `soofi-xyz-team-kit:oracle` (constitution XV) — **exactly four builder subagents, one per track (A/B/C/D, light lane L4)**, each owning only its own track's files and resumed across waves with SendMessage instead of restarted.

**Organization**: four task groups, one per track, matching the spec's four user stories **in the spec's own order** (Track A P1, Track B P2, Track C P3, Track D P1) rather than a strict priority stack — this is intentional, not a phase-ordering defect: spec.md itself organizes its four user stories by track letter, not by re-sorting P1/P1 together, because the four builder subagents (light lane L4, one per track) need each phase to map 1:1 to one builder's file ownership. Each task is tagged with its **wave** (§ 3a of the walkthrough) in parentheses. **Only one group writes to the Query DB per wave** — see the Wave/DB-writer table below.

## Wave / DB-writer map (walkthrough § 3a)

| Wave | DB writer | What else runs alongside |
| --- | --- | --- |
| 1 | Track D: property + owner merge run | All four groups' code + tests (no other DB writes) |
| 2 | Track A: registry load | A3 totals writer tests; C1 business coverage entry; C2 full clip → D-15 gate |
| 3 | Track A: full resolution run | 25-row sampler + evidence skeleton; C1 local validate→hash→export-tables |
| 4 | Track D: contractor clusters (then B1 status write, same wave, in sequence) | C2 places local CLI proof |
| 5 | Track D: estimator `--apply` (after D-21; full roll after D-21 pre-approval or D-22) | worked example; unit tests for both toolchains |

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies)
- **[Story]**: US1=Track A, US2=Track B, US3=Track C, US4=Track D
- File paths are exact; wave is noted as `(W#)`

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Create new directories: `pipeline/oracle-runtime/travis/{identity,bbb,places,reconcile}/`, `pipeline/oracle-runtime/test/travis/a07/{identity,bbb,places,reconcile,roof-age}/`, `pipeline/oracle-runtime/test/fixtures/a07/{comptroller,bbb-stub,overture,reconcile,roof-age}/` (W1)
- [x] T002 [P] Confirm Node ≥22.18, pnpm, DuckDB CLI versions match Stage 0's measured toolchain (no new dependency to add); record the confirmed versions as a line in `specs/007-enrich-reconcile/run-log.md` (W1)

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: blocks Track A (US1) and Track C (US3), both of which read the same Comptroller load. Tracks B (US2) and D (US4) do not depend on this phase.

- [x] T003 [P] Migration `pipeline/local-stack/migrations/0401_comptroller_registry.sql`: staging table for `9cir-efmm` rows, `ON CONFLICT` upsert keyed on taxpayer number, `updated_at` watermark column (W1)
- [x] T004 [P] Migration `pipeline/local-stack/migrations/0402_contractor_ledger.sql`: append-only ledger per data-model.md's "Contractor resolution ledger row" (`permitKey, rawContractorName, state, reasonCode, matchedRecordIds, matchRule, resolverVersion, registrySnapshotDigest, effectiveOn`) (W1)
- [ ] T005 [P] Migration `pipeline/local-stack/migrations/0403_bbb_status.sql`: one row per resolved company per data-model.md's BBB status record (`companyId, bbbStatus ENUM(rated,not_found,blocked,not_checked), reason, evidence JSONB`) (W1)
- [ ] T006 [P] Migration `pipeline/local-stack/migrations/0404_business_places.sql`: business + place record tables per data-model.md (W1)
- [x] T007 [P] Migration `pipeline/local-stack/migrations/0405_reconcile_merge.sql`: merge table keyed by `tcadId` (never a pair of TCAD ids) per data-model.md's reconciled record (W1)
- [x] T008 [P] Migration `pipeline/local-stack/migrations/0406_roof_age.sql`: one row per reconciled property per data-model.md's roof-age estimate (`roofAgeBasis ENUM(permit,new_construction,built_year,unknown)`, `roofAgeConfidence ENUM(high,medium,low,none)`, `roofAgeYears` nullable, null iff basis=unknown) (W1)
- [x] T009 [US1] Test (fails first): shared Comptroller adapter staging/upsert/watermark/digest behavior in `pipeline/oracle-runtime/test/travis/a07/identity/tx-comptroller.test.ts` (W1)
- [x] T010 [US1] Implement the single shared Comptroller adapter in `pipeline/oracle-runtime/travis/adapters/socrata/tx-comptroller.ts` — one writer, staged `ON CONFLICT` upsert, `:updated_at` watermark, sha256 snapshot digest of the sorted row set (depends T003, T009) (W1)

**Checkpoint**: T010 unblocks both US1 (Track A) and US3 (Track C) — no second fetch path is ever created for the Comptroller data.

---

## Phase 3: User Story 1 — Know the official contractor on a permit, honestly (Priority: P1) — Track A

**Goal**: Resolve every Austin reroof permit's printed contractor name into one of five AD-05 states against the loaded Comptroller registry, honestly recording 0 `resolved` since no identifier crosswalk exists (D-10).

**Independent Test** (spec.md): five-state counts over all 22,084 Austin reroof permits sum exactly to the permit total; every `resolved` row cites the Comptroller record it matched.

### Tests for User Story 1 (write first, must fail) ⚠️

- [x] T011 [P] [US1] Resolver test: all five states, including the decision-order short-circuit (no printed name → `contractor_not_printed`; registry unloaded → `registry_unavailable`; two active same-name records → `ambiguous`, both kept; non-active `sos_status_code` → `conflicting`; "Roofing Co." vs "ROOFING COMPANY" → `candidate`, never `resolved`) in `pipeline/oracle-runtime/test/travis/a07/identity/resolver.test.ts` (FR-001, FR-004, FR-005) (W1)
- [x] T012 [P] [US1] Crosswalk negative-finding test: the labelled fixture proves the `resolved` code path exists even with 0 live matches, per FR-002's fixture-fallback clause, in `pipeline/oracle-runtime/test/travis/a07/identity/crosswalk.test.ts` (FR-002) (W1)
- [x] T013 [P] [US1] Five-state totals/manifest-contribution test (sum == permit total, `derivation = aggregate_match`) in `pipeline/oracle-runtime/test/travis/a07/identity/totals.test.ts` (FR-003) (W1)

### Implementation for User Story 1

- [x] T014 [US1] Implement the resolver per `contracts/resolver.md`'s decision order in `pipeline/oracle-runtime/travis/identity/resolver.ts` (depends T011) (FR-001, FR-002, FR-004, FR-005) (W1)
- [x] T015 [US1] Record the crosswalk negative finding (dataset `3syk-w9eu`, full column list, PDF citation) for evidence in `pipeline/oracle-runtime/travis/identity/crosswalk.ts` (depends T012) (FR-002) (W1)
- [x] T016 [P] [US1] Test (fails first): the Loader track registers the Comptroller track and the report section emits the expected shape, on a mocked DB client, in `pipeline/local-stack/test/tracks/comptroller.test.ts` (W1)
- [x] T017 [US1] Implement the Loader track + report section: `pipeline/local-stack/services/tracks/comptroller.ts`, `pipeline/local-stack/services/report-sections/identity.ts` (depends T004, T010, T016) (W1)
- [x] T018 [US1] Implement five-state totals per `contracts/report.md` in `pipeline/oracle-runtime/travis/identity/totals.ts` (depends T013, T014) (FR-003) (W2)
- [x] T019 [US1] [RUN] Execute the registry load (`EN identity:load-registry --source tx-comptroller --scope travis`), egress check first; write the row count, watermark and snapshot digest to `pipeline/data/identity/travis/<jobId>/registry-load-report.json` and record the same in `specs/007-enrich-reconcile/run-log.md` (depends T010, T017) — **Wave 2 DB writer** (FR-003, FR-005) (W2)
- [x] T020 [US1] [RUN] Execute the full resolution run over all 22,084 Austin reroof candidates; write each state's count and the match rule version to `pipeline/data/identity/travis/<jobId>/resolution-report.json` (depends T014, T019) — **Wave 3 DB writer** (FR-001, FR-003) (W3)
- [x] T021 [P] [US1] Test (fails first): the 25-row sampler's seed-recording and every-non-empty-state-represented guarantee, on fixture ledger rows, in `pipeline/oracle-runtime/test/travis/a07/identity/sampler.test.ts` (W1)
- [x] T022 [US1] Build the 25-row contractor sampler (random seed recorded, every non-empty state represented) and the evidence skeleton in `pipeline/oracle-runtime/travis/identity/sampler.ts` — written while T020's run goes (depends T014, T021) (NFR-001) (W3)

**Checkpoint**: Track A fully functional and independently testable; `resolved = 0` with the AC-2 fixture (T012) proving the code path.

---

## Phase 4: User Story 2 — See a contractor's BBB standing, only where BBB allows it (Priority: P2) — Track B

**Goal**: Build and test the bounded BBB request wrapper against a local stub only (D-2); every `resolved` company (expected: none) ends with exactly one `bbb_status`.

**Independent Test** (spec.md): the bounded probe runs against the stub, makes at most 7 requests, and every `resolved` company has exactly one `bbb_status` with coverage % in the manifest.

### Tests for User Story 2 (write first, must fail) ⚠️

- [ ] T023 [P] [US2] Stub server test fixtures (default / 403-first / 403-halfway / robots-disallow / NR-profile modes) in `pipeline/oracle-runtime/test/travis/a07/bbb/stub-server.test.ts` (FR-006) (W1)
- [ ] T024 [P] [US2] Wrapper bound/pacing/stop-on-403 test: ≤7 requests, ≤1/3s, concurrency 1, 8th request refused, robots.txt fetch does not count toward the 7 (D-6); plus the negative case (FR-010) that a `candidate` or `unresolved` contractor is never passed to the wrapper at all, asserted by a spy/mock that fails the test if the wrapper receives one in `pipeline/oracle-runtime/test/travis/a07/bbb/wrapper.test.ts` (FR-006, FR-007, FR-010) (W1)
- [ ] T025 [P] [US2] `BBB_TARGET=stub` config-gate test + CI grep-fail assertion that `bbb.org` never appears reachable in this run's config in `pipeline/oracle-runtime/test/travis/a07/bbb/config.test.ts` (FR-006) (W1)

### Implementation for User Story 2

- [ ] T026 [P] [US2] Status test for FR-009's interaction: a company captured `blocked` at request time but with no confirmed lexicon carrier MUST still show `bbb_status = not_checked`/`no_lexicon_carrier` in the published view, while the manifest's internal counts keep the capture-time `blocked` status under its own `derivation` label — both facts asserted in the same test, in `pipeline/oracle-runtime/test/travis/a07/bbb/status.test.ts` (FR-009) (W1)
- [ ] T027 [US2] Implement the bounded wrapper per `contracts/cli.md`'s `bbb:probe` in `pipeline/oracle-runtime/travis/bbb/wrapper.ts` (depends T024) (FR-006, FR-007) (W1)
- [ ] T028 [US2] Implement the `BBB_TARGET` config gate in `pipeline/oracle-runtime/travis/bbb/config.ts` (depends T025) (FR-006) (W1)
- [ ] T029 [P] [US2] Test (fails first): the Travis enrichment profile's bounds, category and market-URL shape in `pipeline/oracle-runtime/test/travis/a07/bbb/profile.test.ts` (W1)
- [ ] T030 [US2] Implement the Travis enrichment profile (`roofing-contractors`, market URL) in `pipeline/oracle-runtime/travis/profiles/roofing-contractors.ts` (depends T029) (FR-006) (W1)
- [ ] T031 [US2] Implement `bbb_status` assignment, joined only on `resolved` company id, citing the A-01 403 receipts when D-2=(a); applies FR-009's internal-vs-published split per T026 in `pipeline/oracle-runtime/travis/bbb/status.ts` (depends T027, T026) (FR-008, FR-009, FR-010) (W1)
- [ ] T032 [P] [US2] Test (fails first): the per-status BBB coverage % computation (`rated ÷ resolved`; `"not computable"` when `resolved = 0`, never `0%`/`NaN`) in `pipeline/oracle-runtime/test/travis/a07/bbb/coverage.test.ts` (W1)
- [ ] T033 [US2] Implement the per-status BBB counts and coverage % (`rated ÷ resolved`; `"not computable"` when `resolved = 0`, never `0%`/`NaN`) per `contracts/report.md` in `pipeline/oracle-runtime/travis/bbb/coverage.ts` (depends T031, T032) (FR-008) (W1)
- [ ] T034 [US2] [RUN] Apply BBB statuses to the `resolved` list from T020 (expected: 0 rows, so 0 statuses — not a defect); write the per-status counts to `pipeline/data/bbb/travis/<jobId>/status-report.json` (depends T020, T031) — runs right after Track D's contractor-cluster write, same Wave 4 (FR-008) (W4)

**Checkpoint**: Track B independently testable against the stub; zero requests reach bbb.org.

---

## Phase 5: User Story 3 — Load Travis business records, and places if licensed (Priority: P3, conditional) — Track C

**Goal**: Transform the already-loaded Comptroller registry into a business group with an exact count; load Overture places only if the licence gate passes. **This phase builds only if tracks A (Phase 3) and D (Phase 6) both merge before 2026-10-23 12:00 EEST** — otherwise stop after T035–T040 (tests + wrappers) and record the documented gap instead of running T041–T044.

**Independent Test** (spec.md): the business group's loaded count equals the source count at the watermark; the manifest lists each loaded group's licence.

### Tests for User Story 3 (write first, must fail) ⚠️

- [ ] T035 [P] [US3] Business transform count/receipt test on fixtures (loaded count == source count at watermark, both counts stored if the source moved) in `pipeline/oracle-runtime/test/travis/a07/places/business.test.ts` (FR-011) (W1)
- [ ] T036 [P] [US3] Overture wrapper + STAC-pin test (release `2026-09-23.0` per D-8; `expected_count = NULL` never `0`) in `pipeline/oracle-runtime/test/travis/a07/places/overture.test.ts` (FR-012, FR-013) (W1)
- [ ] T037 [P] [US3] Polygon-clip test: bbox `ST_Intersects` prefilter then exact `ST_Within`; a place inside the bbox but outside the polygon is excluded and counted in `pipeline/oracle-runtime/test/travis/a07/places/clip.test.ts` (FR-012) (W1)
- [ ] T038 [P] [US3] "Business or Overture place named like a printed contractor changes no identity state" test (FR-014, both the business and the place case) in `pipeline/oracle-runtime/test/travis/a07/places/identity-stability.test.ts` (FR-014) (W1)

### Implementation for User Story 3

- [ ] T039 [US3] Implement the business transform (reusing T010's load, never a second fetch) in `pipeline/oracle-runtime/travis/places/business.ts` (depends T010, T035) (FR-011) (W1)
- [ ] T040 [US3] Implement the Overture wrapper (STAC release pin, counts-only probe) in `pipeline/oracle-runtime/travis/places/overture.ts` (depends T036) (FR-012) (W1)
- [ ] T041 [US3] Implement the polygon clip in `pipeline/oracle-runtime/travis/places/clip.ts` (depends T037) (FR-012) (W1)
- [ ] T042 [US3] [RUN] Business coverage-entry writer in `pipeline/local-stack/services/report-sections/business-places.ts` + manifest test (depends T039) — **Wave 2** (FR-011) (W2)
- [ ] T043 [US3] [RUN] Overture counts-only probe, then full clip gated on D-15's licence-gate result; write the bounding-box count, clipped count and gate result to `pipeline/data/places/travis/<jobId>/overture-probe-report.json`; on fail, record "Places: not loaded · {reason}" there instead of 0 (depends T040, T041) — **Wave 1–2** (FR-012, FR-013) (W1-2)
- [ ] T044 [US3] [RUN, only if A+D merged in time] Local validate → `hash --output-car` → validate CAR → `export-tables` for the business group into `pipeline/data/`; record CAR root CID and row count in `tables-export.json` — never uploaded (depends T039, T042) — **Wave 3** (FR-011) (W3)
- [ ] T045 [US3] [RUN, only if A+D merged in time and D-15 passed] Places local CLI proof, same validate→export pattern; record the CAR root CID and row count in `pipeline/data/places/travis/<jobId>/tables-export.json` (depends T043) — **Wave 4** (FR-012) (W4)

**Checkpoint**: Track C independently testable on fixtures regardless of the merge-deadline gate; the live runs (T044–T045) are conditional.

---

## Phase 6: User Story 4 — One record per property, owner and contractor, with an honest roof age (Priority: P1) — Track D

**Goal**: Merge duplicate property/owner/contractor records keyed only on the TCAD id; estimate roof age via the unmodified kit estimator; prove the view derivation agrees 25/25.

**Independent Test** (spec.md): `merge{entityType, inputRecords, canonical}` reported per entity type; the 25-property roof-age audit agrees with the view derivation 25/25; the immediate re-run writes `rowsWritten: 0`.

### Tests for User Story 4 (write first, must fail) ⚠️

- [x] T046 [P] [US4] Merge-rule test: TCAD id is the only key; a merge spanning two TCAD ids is refused and counted; a lint-level assertion that no merge function accepts two TCAD ids in `pipeline/oracle-runtime/test/travis/a07/reconcile/merge.test.ts` (FR-018) (W1)
- [x] T047 [P] [US4] View-derivation comparison harness test (25/25 against estimator output, on fixtures) in `packages/query-core/test/roof-age-comparison.test.ts` (FR-017) (W1)
- [x] T048 [P] [US4] Estimator profile-mapping tests, no writes (open permit 1982-012866 BP does not reset age; two finals → latest wins; `Expired` with no final is not an anchor; year built future/pre-1850 → `unknown` + reason; no permit + no year built → `unknown`/`none`, excluded from "roof > 15") in `pipeline/oracle-runtime/test/travis/a07/roof-age/run.test.ts` (FR-015, FR-016, FR-019) (W1)

### Implementation for User Story 4

- [x] T049 [US4] Implement the merge rules per entity type in `pipeline/oracle-runtime/travis/reconcile/merge.ts` (depends T007, T046) (FR-018) (W1)
- [x] T050 [US4] Implement the roof-age estimator invocation wrapper (audit/apply/re-run, unmodified kit estimator) per `contracts/estimator.md` in `pipeline/oracle-runtime/travis/roof-age/run.ts` (depends T048) (FR-016, FR-017) (W1)
- [x] T051 [US4] Implement the view-derivation comparison harness (diffs `packages/query-core`'s view-side `roof_date`/basis/confidence against the estimator's output for the 25 audited properties) in `packages/query-core/roof-age-comparison.ts` (depends T047) (FR-017) (W1)
- [x] T052 [P] [US4] Test (fails first): `runs/a07-coverage.ts` assembles the correct manifest-coverage contribution shape (per `contracts/report.md`) from each track's report JSON files, on fixture reports, in `pipeline/oracle-runtime/test/travis/a07/runs/a07-coverage.test.ts` (W1)
- [x] T053 [US4] Implement `runs/a07-coverage.ts`: assembles all four tracks' counts (five-state totals, BBB per-status/coverage%, business/places counts, merge counts, roof-age coverage) into the manifest-coverage contribution shape, reading each track's report JSON, never the Query DB directly (AD-04) (depends T052) (W5)
- [x] T054 [P] [US4] Test (fails first): `runs/a07-verify.ts` correctly passes on a known-good fixture set of the four tracks' reports and fails (non-zero exit) on each of the four broken-report fixtures (one per independent-test condition) in `pipeline/oracle-runtime/test/travis/a07/runs/a07-verify.test.ts` (W1)
- [x] T055 [US4] Implement `runs/a07-verify.ts` — the story's `agents.verify` check: reads the T020/T034/T042/T060 report JSON files and T053's manifest-coverage contribution, asserts the four conditions in spec.md's "What done means", exits non-zero on any failure (depends T053, T054) (W5)
- [x] T056 [US4] [RUN] Property + owner merge run; write `inputRecords`/`canonical` per entity type and refused cross-TCAD merges to `pipeline/data/reconcile/travis/<jobId>/merge-property-owner-report.json` (depends T049) — **Wave 1 DB writer** (FR-018) (W1)
- [x] T057 [US4] [RUN] Contractor clusters merge, `resolved`-only; write the result to `pipeline/data/reconcile/travis/<jobId>/merge-contractor-report.json` (depends T020, T049) — **Wave 4 DB writer** (FR-018) (W4)
- [x] T058 [US4] [RUN] 25-property roof-age audit dry-run, `--as-of-date 2026-10-22` per D-9; report to `pipeline/data/roof-age/travis/<jobId>/audit.json` per `contracts/estimator.md` (depends T050, T051) — **Wave 5**, feeds 🛑 D-21 (FR-017) (W5)
- [x] T059 [US4] [RUN, after D-21 approval] Apply the 25 (`--apply`), then re-run the same 25 → must show `rowsWritten: 0`; report to `pipeline/data/roof-age/travis/<jobId>/apply-25.json` and `.../rerun-25.json` — **Wave 5 DB writer** (FR-017) (W5)
- [x] T060 [US4] [RUN] Widen to the full roll: audit → apply → re-run, `rowsWritten: 0` over the full scope; report roof-age coverage by basis/confidence to `pipeline/data/roof-age/travis/<jobId>/full-roll-report.json` (depends T059) — **Wave 5**, pre-approved at D-21(a) or gated on 🛑 D-22 (FR-017) (W5)
- [x] T061 [US4] Worked example for `0223120506` (substituting the absent anchor `0208011301`): every source record with URL, capture time, digest, then the anchor/basis/confidence/profile digest, written alongside T060's full-roll apply, into `pipeline/data/roof-age/travis/<jobId>/worked-example.json` (depends T060) (FR-015) (W5)

**Checkpoint**: Track D independently testable; 0 contractor merges is a correct outcome (Track A found 0 `resolved`), not a defect.

---

## Phase N: Polish & Cross-Cutting Concerns

- [x] TN01 [P] Run `npx vitest run --coverage` in `pipeline/oracle-runtime` and the root-workspace suites for `packages/query-core`; confirm ≥ 80% on business-rule code (NFR-09), writing the coverage summary into `docs/reports/A-07-unit-test-report.md`
- [x] TN02 Run `quickstart.md` end to end on the local stack and confirm every expected output matches; record any mismatch in `specs/007-enrich-reconcile/run-log.md`
- [x] TN03 Cross-check `specs/007-enrich-reconcile/lexicon-extension-drafts.md` is unfiled and unchanged (D-11)

---

## Phase Z: Prove on the hosted runtime (mandatory, always last)

**Purpose**: Constitution I, XVI, XXII. The story is not done until these pass.

- [x] TZ01 Run the reviewer agents (`oracle`, `donphan`, `porygon`) plus `/code-review medium`, read-only, one round (L5); record scores in `docs/reviews/CR-A-07.md` (each ≥ 75 or fixed/deferred). **As actually run**, cost mode C6 overrode this to 2 reviewers + `/code-review low`: `oracle` did not run; `donphan` declined (scoped to published-Atlas-data queries only, not this unpublished pipeline work) and was substituted with a `general-purpose` subagent (90/100); `porygon` ran as itself (92/100); `/code-review low` ran, not `medium` (4 findings, all fixed or deferred) — see `docs/reviews/CR-A-07.md`'s "Review round composition" section
- [x] TZ02 N/A (no file produced): pipeline-only story (`ui: false`), deploys nothing
- [x] TZ03 N/A (no file produced): pipeline-only story (`ui: false`), deploys nothing
- [x] TZ04 N/A (no file produced): pipeline-only story (`ui: false`), deploys nothing
- [x] TZ05 Run the story's `agents.verify` check — the four-part independent test from spec.md "What done means" — via `node pipeline/oracle-runtime/travis/runs/a07-verify.ts` (built by T055, reading T053's manifest-coverage contribution and the T020/T034/T042/T060 report JSON files; asserts all four conditions, exits non-zero on any failure): (1) five-state sum == permit total with every `resolved` row cited; (2) manifest BBB coverage by status with receipts; (3) business count == Comptroller Travis total at watermark, licence per group listed; (4) 25-property roof-age audit 25/25, re-run `rowsWritten: 0`, worked example for `0223120506` traced
- [x] TZ06 Write `docs/reports/A-07-unit-test-report.md`, `docs/evidence/A-07.md` (one section per track), the `docs/traceability.md` row, and one `docs/kit-usage.md` line

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; **blocks US1 and US3** (both need the shared Comptroller adapter, T010). US2 and US4 do not depend on Phase 2 and may start in Wave 1 alongside it.
- **User Stories (Phase 3–6)**: Wave 1 work (tests + non-DB-writing implementation) runs for all four tracks in parallel. From Wave 2 on, **only one track's run writes to the Query DB per wave** (see the Wave/DB-writer map above) — the other tracks' Wave-2+ work is either read-only or waits its turn.
- **Polish (Phase N)**: depends on all four stories' implementation tasks (not necessarily the conditional Track C live runs).

### Critical path (≈2h 15m, matches walkthrough S5.1)

T010 (shared adapter) → T019 (registry load) → T020 (resolution run) → 🛑 D-14 (25-row review) → rule fixes if any → T018/🛑 D-16 (totals) → T057 (contractor clusters) → T058 (roof-age 25 audit) → 🛑 D-21 → T059 (apply 25, re-run 0) → (🛑 D-22 only if needed) → T060 (full-roll apply, re-run 0). Tracks B (Phase 4), C (Phase 5), Track D's property/owner merge (T056) and the view-derivation harness (T047 test, T051 implementation) all run beside this path, not on it.

### What stays sequential (never parallel)

- T010 before T019 and before T039 (one load, two readers, never a second fetch).
- T019 before T020 (load before resolution) and before T039/T042 (load before the business transform).
- T020 before T034 (Track B needs Track A's `resolved` list) and before T057 (contractor clusters need the ledger).
- T049 before T056/T057 (merge rules before any merge run).
- T050 before T058; T058 → 🛑D-21 → T059 → T060, each strictly after the one before.
- T043's licence-gate result before T045 (places CLI proof never runs if the gate failed).

---

## Parallel example: Wave 1

```bash
# All four tracks' tests + non-DB-writing implementation run together in Wave 1:
Task: "T011 Resolver test (five states) — Track A"
Task: "T023 BBB stub server test — Track B"
Task: "T035 Business transform test — Track C"
Task: "T046 Merge-rule test — Track D"
# Each builder subagent (one per track) is started once in Wave 1 and resumed (SendMessage)
# for its later-wave tasks instead of restarted.
```

---

## Implementation strategy

**MVP = Track A (Phase 3) + Track D (Phase 6)**, both P1 and both load-bearing (A2 and the README's "roofs older than 15 years" query depend on D; A1 is the primary evaluation point and depends on A). This matches the PO's cost-mode scope decision (2026-10-22): track A and D build this run; track B is a documented gap; track C builds only if A and D merge in time.

1. Phase 1 + 2 (Setup + Foundational).
2. Phase 3 (Track A) and Phase 6 (Track D) in parallel — the MVP.
3. Phase 4 (Track B) alongside, built and tested against the stub regardless of A's `resolved` count.
4. Phase 5 (Track C) only if A and D merge before 2026-10-23 12:00 EEST; otherwise its tests/wrappers (T035–T041) still prove the code exists, and T042–T045 are skipped with the gap recorded.
5. Phase N, then Phase Z (always last, per the template).
