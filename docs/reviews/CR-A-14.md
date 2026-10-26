---
id: CR-A-14
type: code-review-log
story: A-14
branch: 014-agent-and-mcp
reviewed_commit: cf741bd
tools: [alakazam, ash, oracle, donphan, "/code-review medium"]
created: 2026-10-22
---

# Code Review Log: A-14 Answer roofing-lead questions through a source-backed agent and an MCP server

One review round (light lane L5), run on the whole branch diff (`feature/oracle-pipeline...HEAD`) at commit `08e95b7`, with fixes applied and the three reviewers who scored under 75 re-run against commit `cf741bd`.

## Runs

| Run | Tool | Effort | Date | Commit | Findings |
| --- | --- | --- | --- | --- | --- |
| 1 | `soofi-xyz-team-kit:alakazam` (read-only reviewer) | — | 2026-10-22 | `08e95b7` | score 70/100, 1 Critical, 2 Minor |
| 1 | `soofi-xyz-team-kit:ash` (read-only reviewer) | — | 2026-10-22 | `08e95b7` | score 61/100, 1 Critical (Powertools), 1 Major, 1 Minor |
| 1 | `soofi-xyz-team-kit:oracle` (read-only reviewer) | — | 2026-10-22 | `08e95b7` | score 68/100, 1 Critical (Powertools), 1 Major, 1 Minor |
| 1 | `soofi-xyz-team-kit:donphan` (read-only, consumer-side) | — | 2026-10-22 | `08e95b7` | score 83/100, 0 Critical, 1 Medium usability gap |
| 1 | `/code-review medium` | medium | 2026-10-22 | `08e95b7` | 8 findings, all CONFIRMED on verification, 1 Critical (no agent HTTP route) |
| 2 (re-review) | `soofi-xyz-team-kit:alakazam` | — | 2026-10-22 | `cf741bd` | score 85/100 (up from 70), Critical fixed, confirmed by re-running the test suite |
| 2 (re-review) | `soofi-xyz-team-kit:ash` | — | 2026-10-22 | `cf741bd` | score 88/100 (up from 61), all 4 required fixes confirmed, incl. direct `cdk.out` template inspection |
| 2 (re-review) | `soofi-xyz-team-kit:oracle` | — | 2026-10-22 | `cf741bd` | score 82/100 (up from 68), both fixes confirmed |

**donphan was not re-run** — nothing in the fix pass touched the MCP consumer-facing surface (`docs/mcp.md`, tool descriptions) its review covered; its 83/100 from run 1 stands.

## Findings

| # | Severity | File:line | Finding | Resolution | Commit |
| --- | --- | --- | --- | --- | --- |
| 1 | Critical | `infra/src/api-stack.ts` (agent block) | Agent Lambda had no HTTP API route/integration at all — `agent.ask` unreachable over HTTP. Found independently by `/code-review medium` and alakazam. | Fixed: added `AgentHttp` (its own `apigwv2.HttpApi`), `/agent/{proxy+}` route with `HttpLambdaIntegration`, own stage/throttle/output. Confirmed in `cdk.out`'s synthesized template (real `AWS::ApiGatewayV2::Route`/`Integration` resources, not a dangling `CfnOutput`). | `cf741bd` |
| 2 | Critical | `apps/api/src/agent/*.ts`, `apps/api/src/mcp/*.ts`, both `handlers/*.ts` | Zero Powertools Logger/Metrics/Tracer on either new Lambda's request path. The agent Lambda's `SpendAlarm` watched an EMF metric (`AiSpendUsd`) that was never emitted — a permanently dead alarm. Found independently by ash's and oracle's own reviews, on both their own and each other's area. | Fixed: new `apps/api/src/agent/observability.ts` and `apps/api/src/mcp/observability.ts`; both handlers wrapped with the same middy stack (`injectLambdaContext`/`captureLambdaHandler`/`logMetrics`) `handlers/trpc.ts` already uses; `ask.ts` now emits `AiSpendUsd`; every MCP tool call and auth failure is logged/metered. Confirmed wired (not just imported) by both re-reviewers reading the actual call sites. | `cf741bd` |
| 3 | Critical | `packages/query-core/src/tools/functions.ts` (`searchProperties`) | `empty_reason` misattributed to `field_not_published` whenever every in-radius row happened to be null on a filtered field, even when the true blocker was a different, non-nullable filter (e.g. `status_class`). Found by `/code-review medium`. | Fixed: replaced the coincidence check with a provable per-field relaxation test (hold every other filter fixed, relax one null-trackable field at a time, report `field_not_published` only when exactly one relaxation alone unblocks ≥1 row). Regression test added (`tools.functions.test.ts`, "review F1"); re-reviewed by alakazam and confirmed as a real causal fix, not a point patch. | `cf741bd` |
| 4 | Major | `apps/api/src/agent/spend.ts` | Spend-cap check was read-then-act, not atomic — concurrent requests could both pass the cap check before either committed, allowing the $3/day cap to be overrun. Found by alakazam's review. | Fixed: `reserveSpend()` does one atomic conditional `UpdateCommand` (reserve + check in a single DynamoDB call); `ask.ts` reserves before any model call and trues up after. Confirmed by ash's re-review (dedicated test asserts one atomic call, not a Get-then-Update pair). | `cf741bd` |
| 5 | Major | `apps/api/src/agent/ask.ts` (`composeStructuredParts`) | `how`/`query`/`missing` were derived only from the LAST tool call's output, silently dropping real filtered-result data when a turn's final call was `geocodePlace` (no data fields) after an earlier data-bearing call. Found independently by `/code-review medium` and alakazam. | Fixed: now aggregates across every envelope-shaped tool output in the turn (filtered by presence of `applied`, so `geocodePlace`'s differently-shaped output doesn't clobber real data). Dedicated test added for the `searchProperties` → `geocodePlace`(last) scenario; confirmed by ash's re-review. | `cf741bd` |
| 6 | Major (test-only) | `apps/api/test/parity-hosted.test.ts` | The hosted `agent.ask` leg sent a request shape (`{question, sessionQuestionCount}` to `/agent.ask`) that doesn't match the real tRPC contract (`{prompt, ...}` via `{"json":...}` to `/agent/ask`) — the test would never have actually verified anything if `AGENT_URL` were set. Found by `/code-review medium`. | Fixed: request shape corrected to the real contract. Still correctly skipped locally (no `AGENT_URL`); will run for real at Stage 6. | `cf741bd` |
| 7 | Minor | `packages/query-core/src/tools/functions.ts` | Sequential `await`s for the `unknown_excluded`/radius-total COUNT queries, unlike the rows/total query's `Promise.all`. | Fixed alongside the Critical #3 fix (same function) — now batched via `Promise.all`. | `cf741bd` |
| 8 | Minor | `apps/api/src/mcp/tools.ts` (`getCoverageTool`) | Three independent, untyped "run not found" envelope shapes risked silent drift from each other. | Fixed: consolidated into one `runNotFoundRunEcho()` builder shared by `runNotFoundEnvelope<R>()` and a new `runNotFoundCoverage()`, the latter typed against `getCoverage`'s real return type so a future shape change fails compilation instead of drifting silently. | `cf741bd` |
| 9 | Minor (accepted, documented) | `packages/query-core/src/permits.ts:49` (`geoFilter`) | `dLon = dLat / cos(lat)` is undefined-ish near ±90° latitude. | Accepted, not fixed: Travis County (≈30.4°N) is nowhere near a pole; the one-line deferral comment was missing (an earlier fixer honestly flagged this rather than claiming it existed) and has now been added, tying it to the same A-13-dependent out-of-Travis-point validation already deferred elsewhere in the file. | `cf741bd` |
| 10 | Minor (accepted, documented) | `apps/api/src/mcp/auth.ts` | No token-rotation TTL — a revoked token stays valid on an already-warm Lambda until it recycles. | Accepted: already documented in the file's own comments and in `apps/api/test/mcp-auth.test.ts`; confirmed still accurate by oracle's re-review. Acceptable for a short evaluation window; call out in Stage 6 evidence rather than hide it. | — |
| 11 | Minor (usability, accepted) | `apps/api/src/mcp/tools.ts` registered tool descriptions | Tool descriptions in `tools/list` don't mention row caps/truncation/`empty_reason` inline — a cold client reading only live tool metadata (not `docs/mcp.md`) could miss this. Found by donphan's consumer-side review. | Accepted, documented in `docs/mcp.md` (which `get_schema` output backs); not re-worded under Stage 5 time pressure. Low severity since the behavior is still mechanically correct and discoverable via `get_schema`. | — |
| — | — | — | `cdk synth` ENOENT (missing DuckDB extension) oracle's re-review hit mid-run | Investigated, not a defect: re-ran `cdk synth` alone (not concurrently with another subagent's synth) — exit 0, clean. Concluded it was a local-cache race between two subagents synthesizing at the same time, not a code regression. | — |

## Constitution and architecture check

| Rule | Result | Note |
| --- | --- | --- |
| Zod on every tRPC input; no `any` | ✅ | Every tool/procedure input is `.strict()` Zod; `agent.ask`'s `AgentAskInput` likewise. |
| LLM calls only through the Vercel AI SDK | ✅ | `getModel()` is the only `AI_PROVIDER` read site; static-analysis test asserts no forbidden provider SDK import anywhere under `apps/api/src/agent/`. |
| Powertools logger, tracer and metrics in every Lambda | ✅ (after fix) | Was ❌ at the first review pass (findings #2); fixed and confirmed wired, not decorative, by both re-reviews. |
| No secrets or PII in code or logs | ✅ | MCP token: SSM SecureString only, fail-fast, no default, never logged (auth.ts's `recordAuthFailure` never logs header/token values). AI Gateway key: existence-only check. |
| P0 rules in `docs/architecture-constitution.md` | ✅ | No SQL tool (P0-13); no fabricated rows (empty-result reasons always typed); no direct provider SDK (constitution VI); DuckDB wiring confined to `apps/*/src/engine/**` (the `engine-duckdb` package promotion was itself reverted during the build for tripping this exact guard — see `run-log.md`). |

**Open Critical findings:** 0.

## Final round (2026-10-25, head `3be4ff9`)

One more reviewer round on the final code, after about 45 commits since the first review (agent honesty rules, lazy view binding, per-request MCP server, the 23 s abort, spend release, run echo). Each reviewer wrote its own file.

| Reviewer | Score | Previous | File | Top findings |
| --- | --- | --- | --- | --- |
| `alakazam` | 80 | 85 | `CR-A-14-final-alakazam.md` | `matches[]`/`missing[]`/`query` accumulate across loosened retries (T050, A-16); honesty flags are English regexes (T049, A-16) |
| `ash` | 84 | 88 | `CR-A-14-final-ash.md` | spend reservation erased on a billed call and a flat cost estimate (fixed in `40808ca`); unbounded `turns`/`overrides` (fixed) |
| `oracle` | 80 | 82 | `CR-A-14-final-oracle.md` | no per-call deadline on the MCP server, transient errors reported as `run_not_found` (T042, A-16) |
| `donphan` | 80 | 83 | `CR-A-14-final-donphan.md` | answers did not name the run searched and `how` did not cite the gazetteer (fixed in `40808ca`); permits without a property row are dropped upstream (A-16) |
| `/code-review medium` | 9 findings | 8 | (this log) | release-on-timeout spend bug, invalid `nearest` sort without an area, unbounded client text, all fixed in `40808ca`; the rest carried to A-16 |

All four scores are at least 75; no Critical finding. The fixes made after the round are in `40808ca` and re-verified on the hosted site (golden run 5, MCP rerun, responsive, UI). The findings not built are listed in `stories/A-16-cost-and-admin.md` under "Carried forward from A-14".
