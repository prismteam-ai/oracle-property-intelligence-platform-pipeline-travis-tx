---
id: UT-A-11
type: unit-test-report
story: A-11
branch: 011-publish-and-runs
commit: 5e4f080
ci_run: "https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/40087427236 (commit 5e4f080, current HEAD at this report): gitleaks, oracle-runtime, workspace all success. e2e-hosted timed out after 30 min waiting for the Amplify build of this commit (AM-08: infra deploys are PO-laptop-driven, not CI; this story has ui:false and no hosted-UI surface this pass, G4 C-04 exception) -- not one of this gate's merge-blocking jobs per ci.yml's own NFR-09 comment (workspace, oracle-runtime, gitleaks). Coverage numbers below are local runs on the operator machine on 2026-10-24 (V8 provider)."
created: 2026-10-24
---

# Unit and Integration Test Report: A-11 Publish the full county by CID and keep it current with incremental runs

All numbers were copied from local command output on 2026-10-24, on branch `011-publish-and-runs`, one command at a time, then confirmed against the real CI run above.

| Item | Value |
| --- | --- |
| Command (oracle-runtime) | `cd pipeline/oracle-runtime && npm test` |
| Command (local-stack) | `cd pipeline/local-stack && npm test` |
| Command (pipeline/publish) | `cd pipeline/publish && npx vitest run` |
| Command (query-core coverage) | `cd packages/query-core && pnpm exec vitest run --coverage --coverage.thresholds.lines=80 --coverage.thresholds.branches=80` |
| Command (contract coverage) | `cd packages/contract && pnpm exec vitest run --coverage --coverage.thresholds.lines=80 --coverage.thresholds.branches=80` |
| Command (infra) | `CDK_DEFAULT_REGION=eu-north-1 AWS_REGION=eu-north-1 CDK_DEFAULT_ACCOUNT=515618610572 OPERATOR_EMAIL=test@example.com npx vitest run` (infra) |
| Command (scripts, incl. verify-manifest) | `npx vitest run --project scripts` (root) |
| Command (gates) | `sh scripts/grep-gates.sh` |
| Command (full workspace graph) | `pnpm turbo run typecheck lint test synth` |
| Suites / tests | oracle-runtime 88 files / 1039 tests · local-stack 26 files / 203 tests · pipeline/publish 16 files / 261 tests · infra 8 files / 95 tests · scripts (root project) test/verify-manifest.test.ts 14 tests + test/workspace-layout.test.ts 6 tests |
| Passed / failed / skipped | oracle-runtime 1037 / 0 / 2 · local-stack 200 / 0 / 3 · pipeline/publish 261 / 0 / 0 · infra 94 / 0 / 1 · scripts 20 / 0 / 0 |
| grep-gates | `grep-gates: OK (5 gates, root ...)`, exit 0 |
| Coverage (NFR-09 gate, >=80% lines/branches) | `packages/contract`: 100% stmts / 100% branches / 100% lines · `packages/query-core`: 94.23% stmts / 90.27% branches / 96.15% lines — both clear the 80% target |
| synth | `cdk synth --quiet` succeeds for all 6 stacks (CountyLensData, CountyLensApi, CountyLensWeb, CountyLensOps, CountyLensCert, CountyLensScheduler) with `CDK_DEFAULT_REGION=eu-north-1` |
| Full workspace graph | `pnpm turbo run typecheck lint test synth`: 22/22 tasks successful |
| Duration | oracle-runtime ~7s · local-stack ~2s · pipeline/publish ~2s · infra ~12s (scheduler.test.ts's CDK assertions dominate at ~6s) · scripts ~27s (fixture()'s real sha256 hashing of two ~50MB mock artifacts, see Failures and flakes) |

The 2 skipped oracle-runtime tests, 3 skipped local-stack tests, and 1 skipped infra test are pre-existing, unrelated to A-11 (confirmed against earlier stories' reports).

## Root cause of the one real CI failure on this branch, and the fix

CI run `40035234426` (commit `5661b896`, 10 commits behind this report's HEAD) failed two jobs:

1. **`workspace` job, "Typecheck, lint, test, synth (Turborepo)" step.** `scripts/test/verify-manifest.test.ts`'s "retries 504 up to MAX_ATTEMPTS" test timed out at Vitest's default 5000ms. Every test in this file calls `fixture()`, which does real sha256 hashing of two ~50MB mock artifacts — CPU-heavy under full-turbo-graph contention. Only the first test ("retries 429...") had been given a 20000ms per-test override to cover that cost; every later test in the file kept the default. **Fix (commit `ef6aded`):** apply the timeout file-wide with `vi.setConfig({ testTimeout: 20000 })` instead of per-test, since the root cause applies to every test in the file, not just the first. Re-run: 14/14 pass.

2. **`oracle-runtime` job, "Format check" step.** Two files (`test/transforms/austin-property-improvement.test.ts`, `travis/backbone/commands/permits.ts`) were unformatted. **Fix (commit `9f68969`):** `prettier --write`, pure line-wrapping, no logic change (confirmed by diff and by re-running the affected suites).

Reproducing every CI step locally (not just pushing and hoping) surfaced two further, **latent** failures the one real CI run never reached because it failed earlier in each job:

3. The root workspace job's own "Prettier" step (`pnpm format:check`) was failing on 17 pre-existing unformatted files across `pipeline/publish`, `infra`, and `scripts`. **Fix (commit `8e70fd6`):** `prettier --write` on all 17; verified pure formatting by diff, and re-ran every affected test suite (`pipeline/publish` 261/261, `infra` 94/95+1 skip) after reformatting to confirm no behavior changed.

4. `scripts/grep-gates.sh`'s `query-db` gate was failing on `infra/test/no-connection-string.test.ts` (A-11 T025's own ban-detection test, which must spell out "postgres" in its regex/test names and strings — the same situation as the three files the gate's header comment already documents as exceptions) and on two prose comments in `infra/src/stacks/scheduler-stack.ts` naming the AD-26 operator-chosen Postgres (never the Query DB). **Fix (commit `5e4f080`):** added the test file to the gate's existing `QUERY_DB_ALLOW` per-file allowlist (and its header documentation), and marked the two scheduler-stack.ts lines `grep-gates:allow` with a reason — the gate's own documented per-line exception mechanism — rather than widening the gate's pattern itself.

All four fixes were verified locally before push (full `pnpm turbo run typecheck lint test synth`, both coverage gates, prettier, stylelint, bundle gate, and all oracle-runtime/local-stack steps green), then confirmed against a real CI run: `40087427236` on this commit shows `gitleaks`, `oracle-runtime`, and `workspace` (the three merge-blocking jobs named in ci.yml's own NFR-09 comment) all green.

## Tests written first (TDD)

A-11's own new test files, each confirmed to fail before the corresponding implementation existed, per the builders' reports and `specs/011-publish-and-runs/run-log.md`:

| Task | Test file | Failed first? | Now |
| --- | --- | --- | --- |
| T007 | `scripts/test/verify-manifest.test.ts` | Yes | PASS (14/14) |
| T020 | `pipeline/publish/test/incremental.test.ts` (delta/tombstone logic) | Yes | PASS |
| T025 | `infra/test/no-connection-string.test.ts` | Yes | PASS (3/3) |
| T030 | sequence-level unit test for FR-008 (added post-analyze, per `/speckit-analyze` finding F1) | Yes | PASS |
| G-SCHED | `infra/test/scheduler.test.ts` | Yes | PASS (7/7) |
| T031 (contractor-identity wiring) | `pipeline/oracle-runtime/test/travis/permits/write-group.test.ts` and `pipeline/local-stack/test/permits-write-group.test.ts` | Yes | PASS |

## Failures and flakes

| Test | Cause | Action |
| --- | --- | --- |
| `scripts/test/verify-manifest.test.ts` ("retries 504 up to MAX_ATTEMPTS") | Default 5000ms Vitest timeout too short for `fixture()`'s real sha256 hashing under full-turbo-graph CPU contention — the actual cause of CI run `40035234426`'s failure | Fixed: file-wide 20000ms timeout via `vi.setConfig`, replacing the inconsistent per-test override (commit `ef6aded`); 14/14 now pass, confirmed in CI (`40087427236`) |
| `oracle-runtime` Format check | 2 unformatted files | Fixed: `prettier --write`, no logic change (commit `9f68969`) |
| Root workspace Prettier step (latent, never reached by the one real CI run) | 17 pre-existing unformatted files | Fixed: `prettier --write`, no logic change (commit `8e70fd6`) |
| `scripts/grep-gates.sh` query-db gate (latent, never reached by the one real CI run) | A new ban-detection test spelling out "postgres", and two legitimate architecture-decision comments in `scheduler-stack.ts` | Fixed: per-file allowlist entry + `grep-gates:allow` with a reason on the two comment lines (commit `5e4f080`) |
| `@countylens/web#test` (apps/web) | Observed intermittently (1 of 3 local full-`pnpm turbo` runs) failing on `test/app-shell.test.tsx`'s "redirects / to /runs" case, cause consistent with a `screen.findByRole` default-timeout flake under the same full-graph CPU contention pattern as the verify-manifest issue above. Reproduces 0/2 times when run in isolation (`pnpm turbo run test --filter=@countylens/web`, 166/166 both times) or filtered with 2 other tasks (166/166). Not touched by any A-11 change (apps/web is outside this story's scope) | Not fixed this pass: confirmed pre-existing, environment-dependent, and not reproduced in the real GitHub Actions CI run (`40087427236`'s `workspace` job, which runs this same suite, passed). Flagged here for visibility, not filed as a defect, since it never failed in the real CI environment this gate cares about |

## Addendum 2026-10-25: Run 3 corrections

Branch `011c-run3-integrated`, run locally on the head of this commit (the feature branch is merged into it). CI run 40227156140 on `0b32bd9` passed every job (workspace, gitleaks, oracle-runtime, and the seven e2e-hosted jobs).

| Package | Result |
| --- | --- |
| pipeline/publish | 397 passed (new: fetch-retry 9, unit-lock 6, car-files deferral 2, car-files probe skip 1) |
| pipeline/oracle-runtime | 1,270 passed / 2 skipped (owner-name parser 63, deed tenure, address points, contractor name and BBB link) |
| packages/query-core | 336 passed / 8 skipped (roof date from built year, tenure from deeds, open days for finished permits) |
| packages/contract | 58 passed (contract v1.1, 58 columns) |
| packages/shared | 44 passed |
| pipeline/local-stack | 237 passed / 9 skipped |
| apps/web | 505 passed / 3 skipped |
| apps/api | 166 passed |
| scripts | 104 passed |

Typecheck (`tsc -b`), ESLint and both Prettier checks are clean. Coverage of the changed packages was not measured in this round; the new modules each have their own test file (listed above).


## Run 3.1 addendum (2026-10-26, branch `011e-run3-1-permit-contractors`)

Local runs on the final code (the CI run on the same commit is recorded in `docs/gates/G7-A-11-run3-1-precheck.md`):

| Package | Result | New or changed tests |
| --- | --- | --- |
| `pipeline/publish` | 408 passed | run-manifest: correction-run options, address-point carry, registry note replaces the old note, contractor coverage cross-check (all five states, sum); publish-run: `PUBLISH_FILEBASE_UNITS` (own units only, unknown ids refused), a tables folder waits for its CAR |
| `pipeline/local-stack` | contractor-coverage 6 passed | five-state totals, group reading, registry load and report writing with a fake SQL client, argument parsing |
| `pipeline/oracle-runtime` | permits 31 passed (travis suite 553 passed) | ERR-72: person-only contractor as `company.name`, a printed company wins |
| `packages/query-core` | 439 passed, 6 skipped | v1.2 address columns and reasons (with and without address fields), owner area reason for a mailing address without a ZIP, view plan |
| `packages/contract` | 58 passed | v1.2 column list; situs city/ZIP gaps |
| `apps/web` | 537 passed, 1 skipped (after a fresh build) | sample column count 61 (v1.2) |

Coverage of the changed code (vitest v8, lines): `pipeline/publish/src/run-manifest.ts` 97.6 %, `publish-run.ts` 92.3 %, `manifest.ts` 92.7 % (92.55 % of statements over the three); `pipeline/local-stack/scripts/contractor-coverage.ts` 76.8 %: every exported function is covered; the uncovered lines are the command-line entry (`.env`, database connection, console output), exercised by the real run, which reproduced the published counts exactly (2026-10-26).
