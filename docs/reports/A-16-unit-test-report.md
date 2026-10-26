---
id: UT-A-16
type: unit-test-report
story: A-16
branch: 016-cost-and-admin
commit: 25326bf
ci_run: "https://github.com/HebaGaber/oracle-property-intelligence-platform-pipeline-travis-tx/actions/runs/40272763316 (push of 25326bf, 2026-10-26 05:09 UTC): workspace job (typecheck, lint, test, synth, coverage gates, format, stylelint, grep gates, bundle gate) success; gitleaks success; oracle-runtime success. Previous run 40271440296 (871664d): all 10 jobs success."
created: 2026-10-26
---

# Unit and Integration Test Report: A-16

All numbers below were copied from local command output on 2026-10-26 between 05:12 and 05:25 UTC on branch `016-cost-and-admin` at commit `25326bf` (clean tree except the untracked `docs/gates/G7-A-16-precheck.md`). Coverage reports were written to a scratch directory outside the repo. These are **local unit, fixture-engine and CDK assertion tests only**. They do not prove the hosted runtime: Playwright against the hosted URL is reported in `docs/reports/A-16-test-report.md` and `docs/evidence/A-16.md`.

Environment for every command (no secrets; the email is a placeholder for a local synth only):

```sh
export AWS_PROFILE=assess AWS_REGION=eu-north-1 CDK_DEFAULT_REGION=eu-north-1
export CDK_DEFAULT_ACCOUNT=515618610572 OPERATOR_EMAIL=operator@example.invalid
```

## Summary

| Item                                                            | Value                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command (whole workspace, coverage)                             | `pnpm test:coverage` (root vitest, `@vitest/coverage-v8`, `vitest.config.ts` projects), 72 s                                                                                                                                                                                                                                                  |
| Command (coverage of files outside the root `coverage.include`) | same run plus `--coverage.include` for `infra/src/**`, `pipeline/publish/scripts/**`, `scripts/**/*.{ts,mjs}`                                                                                                                                                                                                                                 |
| Command (packages outside the root projects)                    | `vitest run --coverage` in `pipeline/local-stack` and `tests/e2e`; `vitest run test/travis/permits/write-group.test.ts --coverage` in `pipeline/oracle-runtime`                                                                                                                                                                               |
| Root totals                                                     | 174 test files passed, 1 skipped (175) · 2404 tests passed, 9 skipped (2413) · **0 failed**                                                                                                                                                                                                                                                   |
| Root coverage (all included files)                              | statements 87.65 % · branches 79.68 % · functions 85.83 % · lines 89.51 %                                                                                                                                                                                                                                                                     |
| `pipeline/local-stack`                                          | 30 files passed, 1 skipped · 244 passed, 9 skipped · 0 failed · lines 71.44 % (package-wide; A-16's `run-lock.ts` 85.45 %)                                                                                                                                                                                                                    |
| `tests/e2e` (harness library)                                   | 13 files · 104 passed · 0 failed · lines 68.04 % (harness code, not product code)                                                                                                                                                                                                                                                             |
| `pipeline/oracle-runtime`                                       | `write-group.test.ts` 17/17 passed. Full local run: 1248 passed, 23 failed in 3 A-04 files (`gis-adapter`, `gis-artifact`, `vendored-a04`), all with `Cannot find module '@dsnp/parquetjs'`: that package's own dependencies are not installed on this laptop. The CI `oracle-runtime` job installs them and passed on 25326bf. Not A-16 code |
| CI                                                              | Run 40272763316 on 25326bf: `workspace` success, `gitleaks` success, `oracle-runtime` success (hosted e2e jobs reported in the test report). Run 40271440296 on 871664d: all 10 jobs success                                                                                                                                                  |
| **New-code coverage (A-16 changed + added files, 123 files)**   | lines **87.37 %** (5825/6667) · statements 85.40 % · functions 83.52 % · branches 76.42 %: **PASS** against 80 % lines                                                                                                                                                                                                                        |
| New-code coverage, files added by A-16 only (43 files)          | lines **80.88 %** (1366/1689) · statements 78.99 % · functions 75.16 % · branches 67.55 %                                                                                                                                                                                                                                                     |

### Per package (root run)

| Package                         | Test files | Passed | Skipped | Failed |
| ------------------------------- | ---------- | ------ | ------- | ------ |
| `apps/web`                      | 51         | 610    | 1       | 0      |
| `apps/api`                      | 27         | 412    | 1       | 0      |
| `packages/query-core`           | 33         | 447    | 6       | 0      |
| `pipeline/publish`              | 27         | 438    | 0       | 0      |
| `infra`                         | 13         | 145    | 1       | 0      |
| `scripts` (root)                | 4          | 107    | 0       | 0      |
| `profiles/travis-austin@1.0.0`  | 6          | 79     | 0       | 0      |
| `packages/contract`             | 4          | 64     | 0       | 0      |
| `packages/shared`               | 4          | 44     | 0       | 0      |
| `pipeline/bridge` (new in A-16) | 4          | 36     | 0       | 0      |
| `packages/eslint-config`        | 1          | 18     | 0       | 0      |
| `packages/api-client`           | 1          | 4      | 0       | 0      |

The skips are pre-existing and unrelated to A-16: the hosted `agent.ask` leg of `apps/api/test/parity-hosted.test.ts` (no `AGENT_URL`), five query-core skips and one skipped query-core file, and the infra bundling test gated on `COUNTYLENS_BUNDLE=1`.

## Coverage of new code

"New code" is every `.ts`, `.tsx` and `.mjs` source file in `git diff --name-only feature/oracle-pipeline...HEAD`, without test files and `tests/e2e/**`. Removed from the list: the build configs `vitest.config.ts` and `apps/web/vite.config.ts`, the test helper `pipeline/bridge/test/support.ts`, the deleted `ExploreSql.tsx` and `ExploreSql.engine.ts`, and three files touched only by the A-11 commits on this branch (`pipeline/oracle-runtime/travis/permits/bbb-search-url.ts`, `pipeline/publish/scripts/publish-run.ts`, `specs/011-publish-and-runs/run3/fetch-available.mjs`). `packages/query-core/src/derive.ts` and `pipeline/publish/src/publish-run.ts` have both A-11 and A-16 commits and stay in. v8 measures whole files, so for a modified file the figure covers the whole file, not only the lines A-16 changed.

### Line coverage by area (new code)

| Area                            | Lines covered | Lines %   |
| ------------------------------- | ------------- | --------- |
| `apps/api`                      | 1102/1200     | 91.83     |
| `apps/web`                      | 2158/2461     | 87.69     |
| `infra/src`                     | 382/386       | 98.96     |
| `packages/contract`             | 16/16         | 100       |
| `packages/query-core`           | 399/405       | 98.52     |
| `packages/shared`               | 68/70         | 97.14     |
| `packages/api-client`           | 5/6           | 83.33     |
| `pipeline/bridge`               | 279/377       | 74.01     |
| `pipeline/publish`              | 912/1097      | 83.14     |
| `pipeline/local-stack`          | 47/55         | 85.45     |
| `pipeline/oracle-runtime`       | 32/33         | 96.97     |
| `scripts/build-cost-limits.mjs` | 117/137       | 85.40     |
| `scripts/bundle-size.ts`        | 141/188       | 75.00     |
| `scripts/verify-manifest.ts`    | 167/236       | 70.76     |
| **All new code**                | **5825/6667** | **87.37** |

### A-16's main new files (lines / statements / branches / functions, %)

| File                                                                              | Lines | Statements | Branches | Functions |
| --------------------------------------------------------------------------------- | ----- | ---------- | -------- | --------- |
| `apps/api/src/engine/explore-index.ts`                                            | 97.14 | 96.15      | 84.61    | 100       |
| `apps/api/src/routers/admin.ts`                                                   | 90.17 | 87.50      | 61.64    | 91.89     |
| `apps/api/src/handlers/trpc.ts` (modified)                                        | 95.18 | 89.24      | 71.84    | 100       |
| `apps/api/src/trpc.ts` (modified, `adminProcedure`)                               | 80.95 | 78.00      | 60.71    | 83.33     |
| `apps/web/src/auth/RequireSession.tsx`                                            | 100   | 100        | 100      | 100       |
| `apps/web/src/auth/identity.ts`                                                   | 94.44 | 90.90      | 77.77    | 100       |
| `apps/web/src/auth/session.ts`                                                    | 88.88 | 85.00      | 85.71    | 100       |
| `apps/web/src/auth/signIn.ts`                                                     | 50.00 | 50.00      | 88.23    | 25.00     |
| `apps/web/src/auth/useAdmin.ts`                                                   | 59.45 | 54.54      | 30.76    | 58.33     |
| `apps/web/src/auth/admin-api.ts`                                                  | 24.39 | 20.83      | 0        | 5.88      |
| `apps/web/src/auth/config.ts`                                                     | 36.36 | 36.36      | 18.18    | 33.33     |
| `apps/web/src/auth/signOut.ts`                                                    | 0     | 0          | 100      | 0         |
| `apps/web/src/routes/AdminSignIn.tsx`                                             | 96.00 | 92.59      | 81.25    | 75.00     |
| `apps/web/src/routes/Activity.tsx`                                                | 69.64 | 71.64      | 84.81    | 68.18     |
| `apps/web/src/routes/RunsAdmin.tsx`                                               | 83.82 | 83.11      | 75.00    | 71.42     |
| `apps/web/src/routes/CoverageCostLimits.tsx`                                      | 100   | 100        | 60.00    | 100       |
| `apps/web/src/components/RunSelect.tsx`                                           | 100   | 100        | 94.73    | 100       |
| `apps/web/src/components/AdminNav.tsx`                                            | 91.30 | 92.30      | 84.61    | 90.90     |
| `apps/web/src/content/cost-limits.schema.ts`                                      | 85.71 | 85.71      | 75.00    | 100       |
| `apps/web/src/data/run-numbers.ts`                                                | 100   | 100        | 100      | 100       |
| `packages/contract/src/run-command.ts`                                            | 100   | 100        | 100      | 100       |
| `packages/contract/src/live-run.ts`                                               | 100   | 100        | 100      | 100       |
| `packages/query-core/src/contractor-gaps.ts`                                      | 100   | 92.30      | 92.00    | 100       |
| `pipeline/bridge/src/runner.ts`                                                   | 93.96 | 92.12      | 79.76    | 100       |
| `pipeline/bridge/src/loop.ts`                                                     | 90.56 | 89.18      | 85.10    | 81.81     |
| `pipeline/bridge/src/restate.ts`                                                  | 90.00 | 82.35      | 64.28    | 50.00     |
| `pipeline/bridge/src/live.ts`                                                     | 87.50 | 84.61      | 100      | 75.00     |
| `pipeline/bridge/src/idempotency.ts`                                              | 100   | 100        | 75.00    | 100       |
| `pipeline/bridge/src/stop.ts`                                                     | 100   | 100        | 100      | 100       |
| `pipeline/bridge/src/main.ts`                                                     | 0     | 0          | 0        | 0         |
| `pipeline/bridge/src/aws.ts`                                                      | 0     | 0          | 0        | 0         |
| `pipeline/bridge/src/exec.ts`                                                     | 0     | 0          | 0        | 0         |
| `pipeline/publish/src/explore-index.ts`                                           | 100   | 95.23      | 88.67    | 100       |
| `pipeline/publish/scripts/build-explore-index.ts`                                 | 76.80 | 74.08      | 53.16    | 65.85     |
| `scripts/build-cost-limits.mjs`                                                   | 85.40 | 83.55      | 56.45    | 91.66     |
| `scripts/bundle-size.ts` (modified)                                               | 75.00 | 76.47      | 62.22    | 83.78     |
| `infra/src/admin-queue.ts`                                                        | 100   | 100        | 100      | 100       |
| `infra/src/api-stack.ts` (modified: Cognito authorizer, admin queue, bridge user) | 99.45 | 96.84      | 71.42    | 100       |
| `infra/src/web-stack.ts` (modified: Cognito Vite variables)                       | 97.05 | 97.14      | 96.66    | 100       |
| `infra/src/config.ts` (modified)                                                  | 100   | 100        | 90.00    | 100       |

### Files under 80 % lines, and why

| File                                              | Lines % | Why                                                                                                                                                                                               |
| ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline/bridge/src/main.ts`                     | 0       | Process entry point: reads env, opens the SQS loop and waits on signals. Its logic lives in `loop.ts`/`runner.ts` (90.56 % / 93.96 %), which the tests drive with fakes                           |
| `pipeline/bridge/src/aws.ts`                      | 0       | Thin SQS receive/delete and S3 `PutObject` wrappers; the tests inject fakes in their place. The real calls are proven by the hosted admin run in the evidence                                     |
| `pipeline/bridge/src/exec.ts`                     | 0       | `child_process.spawn` wrapper; tests inject a fake runner                                                                                                                                         |
| `pipeline/publish/scripts/duckdb-engine.ts`       | 0       | Eight-line DuckDB wiring used by the identity gate script; the tests bind their own engine                                                                                                        |
| `apps/web/src/auth/signOut.ts`                    | 0       | Clears localStorage keys; the tests mock the auth module. Exercised by the hosted sign-out Playwright test                                                                                        |
| `apps/web/src/auth/admin-api.ts`                  | 24.39   | tRPC calls with the Bearer token; the web tests mock this module and the API side is tested in `apps/api/test/admin.test.ts`. Covered end to end by hosted Playwright (admin sign-in, start/stop) |
| `apps/web/src/auth/config.ts`                     | 36.36   | Reads the two Cognito Vite variables; the "not configured" and parse branches are not unit-tested                                                                                                 |
| `pipeline/publish/src/identity-gate.ts`           | 43.44   | Mostly pre-A-16 code (A-16 changed 41 lines); the DuckDB binding path runs in the publish script, not in unit tests                                                                               |
| `apps/web/src/data/run-loader.ts`                 | 44.44   | A-03 file, A-16 added 30 lines (run selection); the hosted Runs Playwright tests load it for real                                                                                                 |
| `apps/web/src/auth/signIn.ts`                     | 50.00   | SRP sign-in through `amazon-cognito-identity-js`; the SDK callbacks need a live user pool. The error-message mapping is covered (branches 88.23 %); the real sign-in is hosted Playwright         |
| `apps/web/src/auth/useAdmin.ts`                   | 59.45   | Hooks over `admin-api.ts`; the route tests mock the hooks' results                                                                                                                                |
| `apps/web/src/components/WelcomeCard.tsx`         | 62.50   | Dismiss and storage branches not unit-tested; shown on hosted screenshots                                                                                                                         |
| `apps/web/src/routes/Explore.tsx`                 | 68.00   | Route wrapper; its parts (`ExploreFilters`, `ExploreAi`) are at 94–95 %                                                                                                                           |
| `apps/web/src/routes/Activity.tsx`                | 69.64   | React route: loading/error states covered, polling paths are not; covered by hosted Playwright                                                                                                    |
| `apps/web/src/routes/RunsLog.tsx`                 | 70.32   | React route; error and empty branches partly unit-tested, rest hosted Playwright                                                                                                                  |
| `apps/api/src/engine/engine-config.ts`            | 70.58   | Env-reading defaults on the Lambda; the fallback branches are not unit-tested                                                                                                                     |
| `scripts/verify-manifest.ts`                      | 70.76   | CLI script; A-16 changed 16 lines, the network fetch paths are not unit-tested                                                                                                                    |
| `scripts/bundle-size.ts`                          | 75.00   | CLI script; the gate itself runs in CI (`Bundle gate` step) on every push                                                                                                                         |
| `apps/web/src/App.tsx`                            | 75.00   | Router entry; two lazy-load lines                                                                                                                                                                 |
| `pipeline/bridge/src` (whole)                     | 74.01   | Pulled under 80 % by `main.ts`, `aws.ts`, `exec.ts` above; the logic files are 87.5–100 %                                                                                                         |
| `pipeline/publish/scripts/build-explore-index.ts` | 76.80   | The DuckDB build and S3 upload paths run in the publish script; the tests cover the planning and binding functions                                                                                |
| `pipeline/publish/src/car-files.ts`               | 77.50   | Mostly pre-A-16 code; A-16 changed 40 lines                                                                                                                                                       |
| `apps/web/src/routes/PropertyDrawer.tsx`          | 78.57   | React route; the remaining branches are hosted Playwright                                                                                                                                         |

## Failures

None in the A-16 scope or in any root project (0 failed of 2413). The only local failures are the 23 A-04 `pipeline/oracle-runtime` tests listed in the summary, caused by a local missing `@dsnp/parquetjs` install; the same suite is green in CI (`oracle-runtime` job, run 40272763316).

## Known weak spots

- Branch coverage of new code is 76.42 %, under 80 %. The lowest are `apps/web/src/auth/admin-api.ts` (0 %), `useAdmin.ts` (30.76 %), `apps/api/src/routers/admin.ts` (61.64 %), `apps/api/src/trpc.ts` (60.71 %) and `CoverageCostLimits.tsx` (60 %). G7 asks for lines; this is recorded so it is not hidden.
- New files alone are at 80.88 % lines, just over the bar, because the bridge entry and AWS wrappers (`main.ts`, `aws.ts`, `exec.ts`, 75 lines at 0 %) are counted.
- Cognito sign-in, admin calls with a real token and the bridge's real SQS/S3 effects are only proven on the hosted runtime, not here.

## Conclusion

All unit tests pass: 2404 passed, 9 pre-existing skips, 0 failed in the root run, plus `pipeline/local-stack` and the e2e harness green; CI run 40272763316 on 25326bf has `workspace`, `gitleaks` and `oracle-runtime` green. Line coverage of A-16's new and changed code is **87.37 %**, over the 80 % G7 bar (A-16-added files alone 80.88 %). The files under 80 % are entry points, thin SDK wrappers, CLI scripts and React routes, which are covered by the hosted Playwright tests instead.
