---
id: UT-A-03
type: unit-test-report
story: A-03
branch: 003-walking-skeleton
commit: fe2b26a
ci_run: "Numbers are from local runs on the operator machine at fe2b26a. The first fully green GitHub Actions ci run is 39641644469 on 5fbc811 (workspace, oracle-runtime, gitleaks, e2e-hosted all success)."
created: 2026-10-21
---

# Unit and Integration Test Report: A-03

All numbers below were copied from local command output on 2026-10-21 between 19:56:57 and 19:59:05 (EEST, UTC+3) on branch `003-walking-skeleton` at commit `fe2b26af76c1010c028802ab0d5d7e2386993852`, with a clean working tree (`git status --short` empty before and after). These are **local unit and CDK assertion tests only**. They do not prove the hosted runtime. The Playwright runs against the hosted URL are Stage 6 and are reported in `docs/reports/A-03-test-report.md`.

Environment for every command (reads local config only, no credentials):

```sh
export CDK_DEFAULT_REGION=$(aws configure get region --profile assess)   # eu-north-1
export AWS_REGION=$CDK_DEFAULT_REGION
export CDK_DEFAULT_ACCOUNT=515618610572 OPERATOR_EMAIL=ops@example.invalid
```

| Item | Value |
| --- | --- |
| Command (workspace, all 11 Vitest projects) | `pnpm vitest run --coverage` (with extra `--coverage.reporter=text --coverage.reporter=json-summary`), then `pnpm vitest run --reporter=json` to get per-project counts |
| Command (runtime) | `cd pipeline/oracle-runtime && npm test` |
| Command (infra, bundling on) | `cd infra && COUNTYLENS_BUNDLE=1 pnpm exec vitest run` |
| Suites / tests | workspace 68 files / 1,077 tests · runtime 45 files / 647 tests · infra (bundled) 6 files / 84 tests |
| Passed / failed / skipped | workspace 1,071 / 0 / 6 · runtime 647 / 0 / 0 · infra (bundled) 84 / 0 / 0 |
| Coverage, `packages/query-core` (src + gazetteer) | lines 96.15 % · branches 90.28 % · functions 98.45 % · statements 94.23 %: **PASS** against 80 % |
| Coverage, `packages/contract` (src) | 100 % lines, branches, functions and statements: **PASS** against 80 % |
| Coverage, whole workspace include set | lines 93.01 % · branches 82.12 % · functions 92.13 % · statements 91.14 % |
| Duration | workspace 10.18 s (Vitest) · runtime 5.70 s · infra (bundled) 8.48 s |

## Per project (workspace run at 19:56:57, `fe2b26a`)

Coverage is grouped by the root `vitest.config.ts` `coverage.include` globs and computed from `coverage/coverage-summary.json`. Test files under `infra`, `scripts` and `packages/eslint-config` are not in the coverage include set, so those rows show n/a.

| Project | Files | Passed | Skipped | Failed | Lines | Branches | Functions | Statements |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| packages/query-core | 17 | 237 | 5 | 0 | src 98.45 · gazetteer 88.17 | src 92.58 · gazetteer 81.36 | src 100 · gazetteer 90.00 | src 96.68 · gazetteer 85.59 |
| packages/contract | 3 | 58 | 0 | 0 | 100 | 100 | 100 | 100 |
| packages/shared | 2 | 33 | 0 | 0 | 100 | 100 | 100 | 100 |
| packages/api-client | 1 | 4 | 0 | 0 | 83.33 | 71.43 | 75.00 | 85.71 |
| packages/eslint-config | 1 | 18 | 0 | 0 | n/a | n/a | n/a | n/a |
| apps/api | 7 | 138 | 0 | 0 | 93.16 | 81.25 | 92.63 | 90.74 |
| apps/web | 11 | 166 | 0 | 0 | 92.87 | 83.52 | 86.76 | 90.59 |
| infra | 6 | 83 | 1 | 0 | n/a | n/a | n/a | n/a |
| scripts | 2 | 62 | 0 | 0 | n/a | n/a | n/a | n/a |
| profiles/travis-austin@1.0.0 | 6 | 79 | 0 | 0 | 90.83 | 85.54 | 95.00 | 90.91 |
| pipeline/publish | 12 | 193 | 0 | 0 | 91.42 | 77.73 | 91.86 | 89.54 |
| **Workspace total** | **68** | **1,071** | **6** | **0** | 93.01 | 82.12 | 92.13 | 91.14 |
| pipeline/oracle-runtime (own npm project) | 45 | 647 | 0 | 0 | not measured (no coverage script) | | | |

The story's 80 % requirement covers only `packages/query-core` and `packages/contract`, and both pass. These rows are under 80 % on one metric, which is not a story gate: `packages/api-client` (branches 71.43, functions 75.00) and `pipeline/publish` (branches 77.73). In this run the runtime package's coverage was not measured; the previous report's informational figure (branches 74.64 % on `570285d`) is not re-stated as current.

### Skipped tests (6): every skip comes from an explicit `skipIf` with a stated reason

| Test | Why it is skipped |
| --- | --- |
| `packages/query-core/test/carrier-emission.test.ts` › A-02-TC-004 | `PILOT_DIR is not set`. This is a pilot-export-backed A-02 case. |
| `packages/query-core/test/carriers.test.ts` › each carrier's pilot row exists | needs `PILOT_DIR` |
| `packages/query-core/test/sample.test.ts` › contract/v1 sample row-for-row | `PILOT_DIR is not set` |
| `packages/query-core/test/views.pilot.test.ts` › views over the pilot export (T058) | `PILOT_DIR is not set` |
| `packages/query-core/test/acceptance/a02.acceptance.test.ts` › A-02 pilot cases | `PILOT_DIR is not set` |
| `infra/test/api.test.ts` › COUNTYLENS_BUNDLE=1: the real asset holds the linux-arm64 DuckDB binary and the httpfs extension | runs only with `COUNTYLENS_BUNDLE=1`. It was run separately and passed (see S5.5). |

Two skips from the previous report are gone: the `pipeline/publish` manifest-recompute case now runs (a run index is committed), and the budget case no longer depends on `BUDGET_REGION` (the budget is now a custom resource in `CountyLensOps`, asserted unconditionally).

### Excerpts

```text
$ pnpm vitest run --coverage            # 19:56:57
 Test Files  67 passed | 1 skipped (68)
      Tests  1071 passed | 6 skipped (1077)
   Duration  10.18s
All files          |   91.14 |    82.12 |   92.13 |   93.01 |

$ cd pipeline/oracle-runtime && npm test # 19:57:49
 Test Files  45 passed (45)
      Tests  647 passed (647)
   Duration  5.70s
```

## Static checks and gates (19:58, `fe2b26a`)

| Command | Result |
| --- | --- |
| `pnpm turbo run typecheck lint` | exit 0. `Tasks: 9 successful, 9 total` (6 cached), 13 packages in scope. Tasks: `//:typecheck`, `//:lint`, `@countylens/{api,api-client,infra,web}:typecheck`, `@countylens/web:lint`, plus the `@countylens/query-core:build` dependency |
| `pnpm format:check` | exit 0. `All matched files use Prettier code style!` |
| `sh scripts/grep-gates.sh` | exit 0. `grep-gates: OK (5 gates …)` |
| `pnpm --filter @countylens/web run build` | exit 0. `✓ built in 556ms`. `compress-wasm: OK: 1 file(s)` (duckdb-eh wasm 34.3 MB → 7.7 MB gzip -9, raw .wasm deleted) |
| `pnpm exec tsx scripts/bundle-size.ts` | exit 0. `bundle-size: OK: 183082 bytes gzipped (178.8 KB) against limit 307200 (300.0 KB)` for `apps/web/dist/assets/*.js`, DuckDB chunks excluded. Counted chunks: index 111.1 KB gz, Skeleton 58.5 KB gz, Runs 5.0 KB gz, Permits 4.2 KB gz |

## CDK assertions (S5.5)

Commands, run in `infra/` with the environment above:

```text
$ COUNTYLENS_BUNDLE=1 pnpm exec vitest run                    # 19:57:55
 Test Files  6 passed (6)
      Tests  84 passed (84)          # includes the bundled-asset case
   Duration  8.48s
$ COUNTYLENS_BUNDLE=1 pnpm exec vitest run --reporter=verbose # rerun for test names: 84 passed
$ COUNTYLENS_BUNDLE=1 pnpm exec cdk synth --no-notices --quiet -o <scratchpad>/cdk.out   # 19:58:28
Successfully synthesized to <scratchpad>/cdk.out (exit 0)
```

`-o` pointed synth output at a scratch folder so the repo's `infra/cdk.out` was left untouched.

### AC-7 (observability, alarms, budget)

| Requirement | Assertion (file › test name) | Result |
| --- | --- | --- |
| Powertools JSON logs | `infra/test/api.test.ts` › is exactly one arm64 function: 3,008 MB (ERR-18, AM-06 sizing update), 15 s, X-Ray Active, JSON logs, SystemLogLevel WARN | PASS |
| Powertools JSON logs (one log line per request) | `apps/api/test/observability.test.ts` (workspace run, 0 failures) | PASS |
| X-Ray Active | `infra/test/api.test.ts` › is exactly one arm64 function … X-Ray Active …; `infra/test/stacks.test.ts` › A-03-TC-052: every Lambda traces Active; function log groups keep 14 days, the API access log 30 | PASS |
| X-Ray sampling rule FixedRate 1 | `infra/test/api.test.ts` › X-Ray: AWS::XRay::SamplingRule FixedRate 1 for service countylens-api (NFR-004) | PASS |
| QueryDurationMs / ItemsProcessed / ItemsFailed | `apps/api/test/observability.test.ts` (unit test of the handler, not a CDK assertion) | PASS |
| Log retention 14 days (function) | `infra/test/api.test.ts` › logs: the function log group keeps 14 days; it is the only log group besides the access log | PASS |
| Log retention 30 days (access / query log) | `infra/test/api.test.ts` › access log (the query log, AM-03): JSON lines with request id, route, status and latency into a 30-day group; identifiers and counts only | PASS |
| One self-resolving alarm per DLQ rule | `infra/test/stacks.test.ts` › A-03-TC-052: every AWS::SQS::Queue has a RedrivePolicy or is a DLQ with exactly one alarm (AD-12). There are **0 queues today**, so this passes vacuously. | PASS |
| Self-resolving alarms (ALARM + OK actions) | `infra/test/stacks.test.ts` › A-03-TC-052: three alarms (Lambda Errors ≥ 1 / 5 min, Throttles ≥ 1, HTTP API 5xx ≥ 1), each ALARM + OK → the topic, notBreaching | PASS |
| SNS email | `infra/test/stacks.test.ts` › A-03-TC-052: one SNS topic with exactly one email subscription from OPERATOR_EMAIL, SSL enforced; › the operator email is never in git | PASS |
| $10 budget | `infra/test/stacks.test.ts` › A-03-TC-052: the $10 MONTHLY COST budget is a custom resource in CountyLensOps (Create/Update/Delete), 80 % actual + 100 % forecast to the operator email, no budget action; › (N2) the budget name changes when the operator email changes; › the budget provider may only modify/view/tag budget/countylens-monthly-*; its Lambda traces Active and logs 14 days | PASS |

**Why the budget is a custom resource.** CloudFormation has no `AWS::Budgets::Budget` type in the project region (metagross M2), so `CountyLensOps` calls the global Budgets API through `Custom::CountyLensBudget`. The test asserts `AWS::Budgets::Budget` count 0 and `AWS::Budgets::BudgetsAction` count 0, unconditionally (no `BUDGET_REGION` skip).

### NFR-02 (nothing that bills while idle)

| Requirement | Assertion (file › test name) | Result |
| --- | --- | --- |
| No Route 53 hosted zone, no Secrets Manager secret, no KMS CMK, no WAFv2 (plus ACM certificate, RDS, Lambda Function URL) | `infra/test/stacks.test.ts` › creates nothing that bills while idle (A7, P0-19): banned resource types are absent | PASS |
| No provisioned or reserved concurrency | `infra/test/stacks.test.ts` › A-03-TC-053: no Lambda sets ReservedConcurrentExecutions or a ProvisionedConcurrencyConfig (AD-11); `infra/test/api.test.ts` › A-03-TC-053: no ReservedConcurrentExecutions, no ProvisionedConcurrencyConfig, no Function URL (AD-11, AD-09) | PASS |
| No WAF on the CID-copy CDN | `infra/test/data.test.ts` › has one distribution with OAC, origin path /ipfs, PriceClass_100 and no WAF | PASS |
| No Route 53 / ACM in the Web stack | `infra/test/web.test.ts` › creates nothing else: no Route 53, no ACM, no Lambda, no custom resource | PASS |
| Ops has no KMS key or secret | `infra/test/stacks.test.ts` › Ops has no Lambda, queue, key, secret or Function URL of its own; every alarm/topic is tagged | PASS |
| CI never deploys, no GitHub OIDC (AM-08) | `infra/test/stacks.test.ts` › AM-08: no GitHub OIDC provider and no role trusting token.actions.githubusercontent.com; `infra/test/ci-workflow.test.ts` › reads no AWS_DEPLOY_ROLE_ARN variable and no stored secret other than GITHUB_TOKEN | PASS |

**Count:** 17 AC-7 and NFR-02 rows. 17 PASS, 0 SKIP, 0 FAIL. Across the whole infra suite with bundling on: 84 PASS, 0 SKIP.

A `grep` of the synthesized templates for Route53, SecretsManager, KMS::Key, WAFv2, `AWS::Budgets::Budget`, ProvisionedConcurrency, ReservedConcurrent and SQS::Queue found no matches. Across all templates `RetentionInDays` appears as 14 (twice: the API function and the budget provider function) and 30 (once: the access log).

### Synth resource counts (bundling on)

| Stack | Resources | Types |
| --- | --- | --- |
| CountyLensData | 11 | S3 Bucket 1, BucketPolicy 1, CloudFront CachePolicy 1, ResponseHeadersPolicy 1, OriginAccessControl 1, Distribution 1, IAM Role 1, SSM Parameter 3, CDK Metadata 1 |
| CountyLensApi | 15 | Logs LogGroup 2, IAM Role 1, IAM Policy 1, Lambda Function 1, Lambda Permission 2, ApiGatewayV2 Api 1, Integration 1, Route 2, Stage 1, XRay SamplingRule 1, SSM Parameter 1, CDK Metadata 1 |
| CountyLensWeb | 4 | Amplify App 1, Amplify Branch 1, SSM Parameter 1, CDK Metadata 1 |
| CountyLensOps | 13 | SNS Topic 1, TopicPolicy 1, Subscription 1, CloudWatch Alarm 3, Logs LogGroup 1, Custom::CountyLensBudget 1, IAM Policy 2, IAM Role 1, Lambda Function 1 (the budget custom-resource provider), CDK Metadata 1 |
| CountyLensCert | 3 | Amplify Domain 1, SSM Parameter 1, CDK Metadata 1 |
| **Total** | **46** | |

Compared with the previous report (42 on `570285d`): Ops lost the GitHub `IAM OIDCProvider` and its deploy role (AM-08), and gained the budget custom resource with its provider Lambda, role, policies and log group.

## Tests written first (TDD)

The red-first line for each task group is recorded in `specs/003-walking-skeleton/run-log.md`, and this report does not repeat it. No test was red in this run.

## Failures and flakes

None in this run: every command above exited 0 on the first attempt. The earlier `apps/api/test/runs.test.ts` › re-binds after BIND_TTL_MS timeout seen under load on `570285d` did not recur.

## CI

Local numbers only. At 19:59:05 `gh run list --branch 003-walking-skeleton --limit 3` showed `ci` run 39638006386 (86694cc, "record fix commit in ERR-19") **in_progress** for 11m7s; runs 39626119607 (fbdb68b) and 39617581666 had **failed**. No green `ci` run exists yet on this branch, so T078 (delete `.github/workflows/pipeline-ci.yml` after the first green `ci.yml` run) is still pending. HEAD `fe2b26a` is not pushed and has no CI run.
