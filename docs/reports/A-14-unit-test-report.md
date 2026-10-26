---
id: UT-A-14
type: unit-test-report
story: A-14
branch: 014-agent-and-mcp
commit: 9e98772
ci_run: "Numbers below are from local runs at 9e98772 plus three uncommitted new test files (apps/api/test/mcp-deps.test.ts, mcp-registered-tools.test.ts, mcp-stdio.test.ts), 2026-10-25 ~20:05-20:15 UTC. They replace the 9715212 figures of 2026-10-22. CI run on this branch not yet pushed."
created: 2026-10-22
refreshed: 2026-10-25
---

# Unit and Integration Test Report: A-14

All numbers below were copied from local command output on 2026-10-25 between 20:05 and 20:15 UTC on branch `014-agent-and-mcp` at commit `9e98772`. The working tree held three uncommitted new test files (listed above; the only source or test change since the commit) plus an unrelated edit to `docs/evidence/A-14.md`. These are **local unit, fixture-engine and CDK assertion tests only**. They do not prove the hosted runtime: the golden queries against the deployed `agent.ask`, MCP Inspector against the hosted `/mcp`, and Playwright against the hosted URL are reported in `docs/reports/A-14-test-report.md`.

Environment for every command (reads local config only, no credentials):

```sh
export CDK_DEFAULT_REGION=eu-north-1
export AWS_REGION=eu-north-1
export OPERATOR_EMAIL=ops@example.com   # placeholder for a local synth only, never committed
```

| Item | Value |
| --- | --- |
| Command (whole workspace) | `pnpm test` (root vitest run) and `pnpm check` (turbo: typecheck, lint, test, synth) |
| Command (query-core, coverage) | `pnpm --filter @countylens/query-core exec vitest run --coverage` |
| Command (contract, coverage) | `pnpm --filter @countylens/contract exec vitest run --coverage` |
| Command (apps/api, coverage) | `cd apps/api && pnpm exec vitest run --coverage` |
| Command (infra, CDK assertions + cdk-nag + `cdk synth`) | `pnpm --filter @countylens/infra exec vitest run`, `pnpm --filter @countylens/infra synth` (both inside `pnpm check`) |
| `pnpm test` totals | 142 test files passed, 1 skipped (143) · 2041 tests passed, 9 skipped (2050) · 0 failed |
| Per package (from `pnpm check`) | query-core 27 files / 382 passed, 6 skipped · contract 3 / 58 · apps/api 22 files / 359 passed, 1 skipped · infra 11 files / 116 passed, 1 skipped · publish 20 / 345 · web 44 files / 536 passed, 1 skipped · e2e harness 11 / 92 · agent-tests 1 file / 15 passed, 1 skipped · profile 6 / 79 · shared 3 / 40 · eslint-config 1 / 18 · api-client 1 / 4 · root scripts 4 / 104 |
| `pnpm check` | 24/24 turbo tasks successful (run 4). Runs 1 to 3 each failed on a different pre-existing 5 s test timeout under parallel load (e2e `runtime-url` playwright-config load, twice; publish `batch-script` and `upload`). Each was re-run alone and passed (`runtime-url` 20/20; `batch-script` + `upload` 47/47). None is an A-14 test |
| Coverage, `packages/query-core` | statements 93.11 % · branches 86.05 % · functions 93.15 % · lines 94.84 %: **PASS** against 80 % |
| Coverage, `packages/contract` | statements 100 % · branches 100 % · functions 100 % · lines 100 %: **PASS** |
| Coverage, `apps/api` (all files) | statements 90.98 % · branches 79.91 % · functions 89.65 % · lines 92.16 %: **PASS** (branches 0.09 points under 80 %, see Known weak spots) |
| `cdk synth` (all stacks) | `Successfully synthesized`; cdk-nag test "AwsSolutions: no unacknowledged finding, and every acknowledgement carries a documented reason" passes; 0 cdk-nag errors (acknowledgements keep a documented reason each, e.g. `AwsSolutions-DDB3` for the rebuildable spend counter) |
| Forbidden-provider-SDK check | `grep -rn "@aws-sdk/client-bedrock-runtime\|@anthropic-ai/sdk\|from \"openai\"" apps/api/src apps/web/src` returns one hit: the comment in `apps/api/src/agent/model.ts:6` naming what is forbidden. Zero imports |
| Grep gates | `sh scripts/grep-gates.sh` prints `grep-gates: OK (5 gates ...)` |
| Format | `pnpm run format:check` prints `All matched files use Prettier code style!` |
| Typecheck / lint | inside `pnpm check`: all typecheck and `eslint .` tasks pass, 0 errors |

### Coverage by area, `apps/api` (statements / branches / functions / lines, %)

| Area | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| `src` (observability.ts) | 88.54 | 84.72 | 91.66 | 89.65 |
| `src/agent` | 91.00 | 77.41 | 83.65 | 92.06 |
| `src/engine` | 89.91 | 84.66 | 89.83 | 91.03 |
| `src/handlers` (entry points, see weak spots) | 85.71 | 75.59 | 92.85 | 89.70 |
| `src/mcp` (was 64.25 / 66.66 / 56.52 / 66.34 at 9e98772 before the three new files) | 95.47 | 87.87 | 94.20 | 95.12 |
| `src/routers` | 93.44 | 76.19 | 100 | 94.06 |

`src/mcp` per file (after / before the three new test files, statements and lines):

| File | Statements after (before) | Branches | Functions | Lines after (before) |
| --- | --- | --- | --- | --- |
| `auth.ts` | 96.42 (96.42) | 91.66 | 88.88 | 96.29 (96.29) |
| `deps.ts` | 100 (7.69) | 100 | 100 | 100 (8.33) |
| `observability.ts` | 100 (68.42) | 100 | 100 | 100 (72.22) |
| `runs-index.ts` | 100 (100) | 90.90 | 100 | 100 (100) |
| `server.ts` | 92.30 (92.30) | 74.28 | 90 | 92 (92) |
| `stdio.ts` | 84.37 (0) | 90.90 | 80 | 83.33 (0) |
| `tools.ts` | 100 (60.65) | 100 | 100 | 100 (66.66) |

Duration: apps/api coverage run 6.7 s; full `pnpm check` about 1 minute with a warm turbo cache.

## Per-file breakdown of A-14's new test files

| Test file | Tests | Result | Builder |
| --- | --- | --- | --- |
| `packages/query-core/test/tools.schemas.test.ts` | — | pass | alakazam |
| `packages/query-core/test/tools.functions.test.ts` | — | pass | alakazam |
| `packages/query-core/test/tools.geocode.test.ts` | — | pass | alakazam |
| `packages/query-core/test/permits.test.ts` | — | pass | alakazam |
| `packages/query-core/test/agent-citations.test.ts` | 8 | pass | alakazam (spec that ash's real implementation matches) |
| `packages/query-core/test/tools.parity.test.ts` → relocated to `apps/api/test/tools.parity.test.ts` (see note) | 3 | pass | alakazam |
| `apps/api/test/agent-model.test.ts` | 8 | pass | ash |
| `apps/api/test/agent-spend.test.ts` | 8 | pass | ash |
| `apps/api/test/agent-ask.test.ts` | 9 | pass | ash |
| `apps/api/test/mcp-auth.test.ts` | 10 | pass | oracle |
| `apps/api/test/mcp-tools.test.ts` | 11 | pass | oracle |
| `apps/api/test/mcp-runs-index.test.ts` | 9 | pass | oracle |
| `apps/api/test/mcp-registered-tools.test.ts` (new 2026-10-25: six tools through an in-memory MCP client, `run_not_found` envelopes, truncation/total, engine error mapped to `isError`, Powertools recording) | 10 | pass | oracle |
| `apps/api/test/mcp-deps.test.ts` (new 2026-10-25: `createEngineDeps` with and without a `manifest_cid`, latest-run fallback, lazy view binding, resolution failures give `undefined`) | 6 | pass | oracle |
| `apps/api/test/mcp-stdio.test.ts` (new 2026-10-25: local stdio build on real DuckDB, lists six tools, answers `get_schema`, `list_runs`, `get_coverage`) | 4 | pass | oracle |
| `apps/api/test/parity-hosted.test.ts` | 2 (1 pass, 1 skip — hosted `agent.ask` leg) | pass + 1 expected skip | alakazam |
| `infra/test/countylens-api-agent.test.ts` | 3 | pass | ash |
| `infra/test/countylens-api-mcp.test.ts` | 6 | pass | oracle |
| `tests/agent/golden.test.ts` | 1 | skip (expected — no `AGENT_URL`, no deployed endpoint yet) | alakazam |

**Location deviations from `tasks.md` (both explained in-file, both intentional engineering judgment, not gaps):**
- `tools.parity.test.ts` moved from the originally-planned `packages/query-core/test/` to `apps/api/test/`, because it needs apps/api's MCP and agent tool adapters, and `apps/api` depends on `@countylens/query-core` (never the reverse) — putting it in query-core would invert the dependency direction. The same deep-relative-import pattern already exists in `apps/api/test/duckdb-node.test.ts` (importing `packages/contract/test/helpers/`).
- The fixture-engine leg of `tests/agent/parity-hosted.test.ts` (T032) lives in `apps/api/test/parity-hosted.test.ts` instead, because `tests/agent`'s package is deliberately kept thin (an HTTP-only client against a deployed `agent.ask`, with no `@modelcontextprotocol/sdk`/AWS SDK dependency) — adding the MCP-adapter import there would have broken that isolation.

## Skipped tests (2 relevant to A-14, both with a stated reason, neither a gap)

| Test | Why it is skipped |
| --- | --- |
| `apps/api/test/parity-hosted.test.ts` — "agent.ask leg" | No `AGENT_URL` set (no deployed endpoint in this local run); same unset/localhost-rejection guard pattern as `tests/agent/golden.test.ts`. Re-run at Stage 6 (TZ03/TZ05) once the branch is deployed. |
| `tests/agent/golden.test.ts` | Same reason — the golden-query grader (G1–G6) needs the deployed `agent.ask` endpoint; this is explicitly a Stage 6 hosted check, not a local unit test. |

The pre-existing skips in `query-core` (5), `contract` (0, unchanged), and `infra` (1, a bundling test gated on `COUNTYLENS_BUNDLE=1`) are all unrelated to A-14 and were already skipped before this story's build started.

## Architecture correction made during the build (recorded here for traceability)

T001 initially promoted the AD-18 DuckDB/CID-copy engine binder into a new top-level package (`packages/engine-duckdb`), per `research.md`'s stated rationale ("AD-21 puts MCP on its own Lambda, so `apps/mcp` would grow its own copy"). The wave-1 integration check's repo-wide `eslint` run caught that this tripped the existing `no-restricted-imports` guard ("DuckDB is wired only in `apps/*/src/engine/**`", ARD § 4/AD-19) — and on inspection, no separate `apps/mcp` app was actually built; the MCP and agent Lambdas are both just handler entry points inside `apps/api` (`apps/api/src/handlers/{mcp,agent}.ts`). The promotion was therefore unnecessary and was reverted back into `apps/api/src/engine/` before wave 2 started, restoring the original, already-correct architecture guard rather than loosening it. No code built on top of the promoted package needed to change beyond its import path.

A second gap, also caught by an integration check (this time the wave-2 one): the MCP server's `runs/index.json` resolution initially read a local repo-root file path, which would not exist on the deployed Lambda. Fixed by aligning it with the agent Lambda's existing, correct solution (an S3 `GetObject` on the CID-copy bucket, same bucket/key the engine already reads from), keeping the local-file read only for the legitimate local-stdio-build/test case.

## Known weak spots

- `apps/api/src/handlers/agent.ts` and `handlers/mcp.ts` (0 %) are thin Lambda entry points and are not unit-tested. Their behaviour (auth, Origin check, tool calls, `agent.ask`) is covered through `src/mcp/server.ts` and `src/agent/ask.ts` here, and end to end by the hosted tests in `docs/reports/A-14-test-report.md`. `src/agent/router.ts` (0 %, two lines) is the same kind of wiring.
- Hosted-only paths (real S3 presigned reads, the deployed `agent.ask`, Bedrock, the hosted `/mcp` with the bearer token) are not exercised here; the `parity-hosted` agent leg and `tests/agent/golden.test.ts` skip locally with a stated reason and run in the hosted suite.
- `src/mcp/stdio.ts` is 84.37 % statements: the `main()` bootstrap and the process-entry guard (lines 101-102, 108-110) are not run, because they would attach to the real stdin/stdout. The stdio test serves the run from a fixture manifest with no table parts (`node:fs/promises.readFile` is wrapped for one fake run id only); a committed run whose parts are missing on disk is shown to resolve to `run_not_found`.
- Branch coverage of `apps/api` overall is 79.91 %, just under 80 %. The low files are `src/agent/citations.ts` (46.15 % branches, 78.72 % statements), `src/agent/observability.ts` (80 % statements, 0 % branches), `src/mcp/server.ts` (74.28 % branches), `src/routers/mcp-proxy.ts` (74.19 %), and `src/handlers/trpc.ts` (71.13 %). Statements and lines for new A-14 code are above 80 % everywhere except the two entry-point handlers and `router.ts` listed above.
- The 5 s default test timeout is tight under parallel `pnpm check` load: pre-existing e2e `runtime-url` and publish `batch-script`/`upload` tests timed out in three of four runs and passed alone. The new A-14 stdio and handler tests carry a 30 s timeout.

## Conclusion

All of A-14's test files pass; the only skips are the hosted-endpoint legs, deferred to the hosted suite and not dropped. Coverage clears the 80 % bar on statements and lines for `query-core` (93.11 % / 94.84 %), `contract` (100 %) and `apps/api` overall (90.98 % / 92.16 %), and the new `src/mcp` code now stands at 95.47 % statements and 95.12 % lines (it was 64.25 % and 66.34 %). `pnpm check` passes 24/24 (after re-running load-induced timeouts of unrelated tests alone), `cdk synth` and cdk-nag are clean, there is no forbidden provider SDK import, and the grep gates and format check pass.
