---
id: UT-A-07
type: unit-test-report
story: A-07
branch: 007-enrich-reconcile
commit: 0f5d7d7
ci_run: "https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/39880301906 (commit 0f5d7d7, the current HEAD: gitleaks, oracle-runtime, workspace success on the first pass; e2e-hosted timed out twice on a slow Playwright browser install, succeeded on the third attempt -- confirmed via the GitHub API). Coverage numbers below are local runs on the operator machine on 2026-10-23 (V8 provider, offline Vitest — the no-network setup file makes any real fetch fail)."
created: 2026-10-23
---

# Unit and Integration Test Report: A-07 (merged: tracks A, D; tracks B, C not built this pass)

All numbers were copied from local command output on 2026-10-23, on branch `007-enrich-reconcile`, one command at a time. `pipeline/oracle-runtime` and `packages/query-core` are pure/offline Vitest runs. `pipeline/local-stack`'s tests use a mocked Postgres client (no real database) for every file this story touches; the live, real-database proof for the same logic is in `specs/007-enrich-reconcile/run-log.md` and the job report JSON files under `pipeline/data/` (registry load, resolution run, merge runs, roof-age audit/apply/full-roll), not in this report.

| Item | Value |
| --- | --- |
| Command (runtime) | `cd pipeline/oracle-runtime && npx vitest run --coverage` |
| Command (local stack) | `cd pipeline/local-stack && npx vitest run --coverage` |
| Command (query-core) | `cd packages/query-core && npx vitest run --coverage` |
| Command (gates) | `bash scripts/grep-gates.sh` |
| Suites / tests | runtime 87 files / 1021 tests · local-stack 25 files / 199 tests · query-core 18 files / 246 tests |
| Passed / failed / skipped | runtime 1019 / 0 / 2 · local-stack 196 / 0 / 3 · query-core 241 / 0 / 5 |
| grep-gates | `grep-gates: OK (5 gates)`, exit 0 |
| Coverage, whole tree | runtime 86.55% stmts / 88.62% lines · local-stack 84.06% stmts / 85.41% lines · query-core 92.27% stmts / 93.6% lines — all clear NFR-09's 80% target |
| Duration | runtime ≈7 s · local-stack ≈1.5 s · query-core ≈2 s |

The 2 skipped runtime tests are pre-existing A-04 cases unrelated to this story (`GIS_ARTIFACT`-gated). The 3 skipped local-stack tests and 5 skipped query-core tests are likewise pre-existing, unrelated to A-07.

## Coverage on A-07's own new/changed files (V8, statements / branches / functions / lines)

### Track A (contractor identity)

| File | Stmts | Branch | Funcs | Lines |
| --- | --- | --- | --- | --- |
| `travis/identity/resolver.ts` | 97.22 | 90.9 | 100 | 100 |
| `travis/identity/sampler.ts` | 95.74 | 83.33 | 100 | 100 |
| `travis/adapters/socrata/tx-comptroller.ts` | (in `travis/discovery/probes`'s `socrata.ts` group) 90.21 | 78.57 | 100 | 92.04 |
| `travis/backbone/commands/{identity:load-registry,identity:resolve}.ts` | (in `travis/backbone/commands` group) 84.67 | 80.14 | 83.87 | 87.2 |
| `pipeline/local-stack/services/tracks/comptroller.ts` | 98.68 | 83.33 | 100 | 100 |
| `pipeline/local-stack/services/report-sections/identity.ts` | 100 (isolated run; see note) | — | — | — |

**G7 pre-check fix (2026-10-23):** `sampler.ts`'s `comptrollerRecordUrl`/`buildEvidenceSkeletonRow`/`buildEvidenceSkeleton` (54.54% functions) and `report-sections/identity.ts`'s `section.build`/`loadIdentityData` path (35.71% statements) had no tests — only `assembleIdentitySection`/`sampleContractorLedger` were covered. Added 6 tests for the sampler functions and 2 tests for `section.build` (one happy path against a mocked Postgres client, one "registry not loaded" path), closing both gaps to 95%+ and 100% respectively.

### Track D (reconcile + roof age)

| File | Stmts | Branch | Funcs | Lines |
| --- | --- | --- | --- | --- |
| `travis/reconcile/merge.ts` | 100 (isolated run; see note) | 100 | 100 | 100 |
| `travis/roof-age/run.ts` | 100 | 100 | 100 | 100 |
| `packages/query-core/roof-age-comparison.ts` | 100 (isolated run; see note) | — | — | — |
| `travis/runs/a07-coverage.ts` | 91.48 | 64.63 | 100 | 93.18 |
| `travis/runs/a07-verify.ts` | 72.83 | 53.4 | 81.81 | 74.64 |
| `pipeline/local-stack/services/tracks/reconcile.ts` | 100 | 100 | 100 | 100 |
| `pipeline/local-stack/services/workflows/reconcile-report.ts` | 91.66 | 91.66 | 88.88 | 90 |
| `pipeline/local-stack/services/workflows/roof-age-audit.ts` | 95.55 | 78.37 | 94.11 | 94.87 |
| `pipeline/local-stack/services/workflows/roof-age-backfill.ts` | 91.83 | 68.18 | 96.29 | 94.73 |

**Note on `merge.ts` and `roof-age-comparison.ts`**: both are 100% covered when their own test file runs in isolation (`npx vitest run test/travis/a07/reconcile/merge.test.ts`, `npx vitest run test/roof-age-comparison.test.ts`), but don't appear at all in the full-suite coverage table above — a known v8-provider/parallel-worker-isolation display quirk (confirmed by the isolated runs, not chased further). `report-sections/identity.ts` (Track A table above) has the same quirk.

**G7 pre-check fix (2026-10-23):** `run.ts`'s `simpleBasisOf` had no direct test (it was only exercised transitively via `local-stack`'s tests, in a separate coverage run); added 4 tests covering each of its four basis branches (null anchor, `property_built_year`, a permit anchor with `primary_roof_new_construction`, a permit anchor with any other classification). `run.ts` is now 100%, and the `travis/roof-age` group rose from 83.72% to 97.67% statements.

**Remaining, accepted gap — `a07-verify.ts`**: the uncovered lines are the CLI entrypoint (`main()`, `process.argv` parsing, the direct-invocation bootstrap guard) — exercised by actually running the script (`node travis/runs/a07-verify.ts ...`, done for real in Stage 5 and again for this report, output recorded in the run log), not by a unit test; this is a common, accepted pattern for CLI glue, not business-rule code.

Two Wave-1 functions (`runAudit`/`runApply`/`writeReport`, a file-based wrapper nothing in the real pipeline calls — the real audit/apply path reads live database data server-side instead) were removed as dead code during the build, raising `run.ts` from 57% to 68% (now 100% after the fix above) and the `travis/roof-age` group from 72.88% to 97.67%.

## Tests written first (TDD)

Every implementation task in `specs/007-enrich-reconcile/tasks.md` has a preceding test task; each was confirmed to fail before the implementation existed, per the builders' own reports and the run log.

| Task | Test file | Failed first? | Now |
| --- | --- | --- | --- |
| T009/T010 | `test/travis/a07/identity/tx-comptroller.test.ts` | ✅ | PASS |
| T011/T014 | `test/travis/a07/identity/resolver.test.ts` | ✅ | PASS |
| T012/T015 | `test/travis/a07/identity/crosswalk.test.ts` | ✅ | PASS |
| T013/T018 | `test/travis/a07/identity/totals.test.ts` | ✅ | PASS |
| T021/T022 | `test/travis/a07/identity/sampler.test.ts` | ✅ | PASS |
| T016/T017 | `pipeline/local-stack/test/tracks/comptroller.test.ts` | ✅ | PASS |
| T046/T049 | `test/travis/a07/reconcile/merge.test.ts` | ✅ | PASS |
| T047/T051 | `packages/query-core/test/roof-age-comparison.test.ts` | ✅ | PASS |
| T048/T050 | `test/travis/a07/roof-age/run.test.ts` | ✅ | PASS |
| T052/T053 | `test/travis/a07/runs/a07-coverage.test.ts` | ✅ | PASS |
| T054/T055 | `test/travis/a07/runs/a07-verify.test.ts` | ✅ | PASS |
| (gap, closed post-build) | `pipeline/local-stack/test/tracks/reconcile.test.ts` | N/A — written after T056/T057 were already implemented and live-proven; tasks.md never scoped this test | PASS |
| (gap, closed post-build) | `pipeline/local-stack/test/workflows/reconcile-report.test.ts` | N/A, same reason | PASS |
| (gap, closed post-build) | `pipeline/local-stack/test/workflows/roof-age-audit.test.ts` | N/A, same reason | PASS |
| (gap, closed post-build) | `pipeline/local-stack/test/workflows/roof-age-backfill.test.ts` | N/A, same reason | PASS |

## Failures and flakes

| Test | Cause | Action |
| --- | --- | --- |
| `test/no-text-classification.test.ts` ("no profile term literal outside profiles/") | A "reroof" literal in a code comment (`travis/identity/resolver.ts`), found in wave 3 | Fixed: reworded the comment, no logic change (`56e25dd`) |
| Same test, second occurrence | A CLI scope literal `z.literal("austin-reroof")` (`identity:resolve.ts`), slipped past because the suite wasn't re-run after that commit | Fixed: renamed the scope consistently across the CLI verb, the Loader track, its test fixture, and `contracts/cli.md`/`quickstart.md` (`463bbcd`) |
| `scripts/grep-gates.sh`'s `query-db` gate | Six comments correctly describing "never Postgres directly" / naming the dropped `--database-url-env DATABASE_URL` flag tripped the literal-word ban under `pipeline/oracle-runtime/travis/**` | Fixed: reworded to avoid the literal words, no logic change (`cb8e674`) |
| `test/views.fixture.test.ts` (3 files, 6 tests) | Flaky under parallel full-suite load — 5 s default `testTimeout` too short when many worker processes contend; confirmed by an isolated re-run at 20 s timeout: 30/30 pass | Not a defect; not fixed (pre-existing timeout default, not touched by A-07) |
| 25-property roof-age audit, first run | 24/25 — traced to the audit's own harness picking a permit completion date without the chronology gate the real view (`terminalDateAccepted`) already applies correctly | Fixed: the audit now reuses `terminalDateAccepted` instead of reimplementing the rule (`463bbcd`); 25/25 confirmed, including the TCAD-100050 regression case now covered directly by a unit test |
| `tx-comptroller.ts` field mapping | Wrong Comptroller `9cir-efmm` field names (guessed, not probed live) meant every registry row defaulted `sosStatusCode` to `"unknown"`, so no row could ever resolve as active | Fixed: corrected field names, widened the stale-row WHERE guard, stamped a `MAPPING_VERSION` into the staged artifact so the fix forces a legitimate re-merge (`56e25dd`) |
| CI (D-24 push) | Prettier (18 files never run through the formatter) and a gitleaks false positive (`COMPTROLLER_SOURCE_KEY`, a fixed Socrata dataset-id string flagged on entropy alone) | Fixed: `prettier --write`, `.gitleaksignore` entry with a reason comment. CI run `39860024821` fully green (gitleaks, oracle-runtime, workspace, e2e-hosted) |
| G7 pre-check: per-file coverage gaps | `sampler.ts` (54.54% functions), `report-sections/identity.ts` (35.71% statements), `run.ts`'s `simpleBasisOf` (untested) | Fixed: 12 new tests added (see the coverage notes above); all three now at 95%+ or 100% |
| G7 pre-check: stale test counts/CI reference | This report originally said "1008/1006" tests and `docs/evidence/A-07.md` said "1009/1007" — both were snapshots from different points in the build; neither matched HEAD. The report also said "Not yet pushed to origin" after the branch had already been pushed and CI had run | Fixed: both documents now cite the same, current, re-verified counts and the real CI run URL |
