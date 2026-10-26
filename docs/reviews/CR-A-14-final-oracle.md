---
id: CR-A-14-final-oracle
story: A-14
reviewer: soofi-xyz-team-kit:oracle (read-only, MCP server and shared data path)
reviewed_commit: 3be4ff9
previous_score: 82 (cf741bd)
score: 80
---

# A-14 final review, oracle domain

**Score: 80/100** (gate: 75). Passes. No Critical finding. The score is two points under the previous 82 because the hosted run exposed gaps that were then documented, not closed (see M1, M2); the code itself is better than at `cf741bd`.

## Verified by reading

- **Per-request server (the production bug).** `apps/api/src/mcp/server.ts:167-177` builds a new `McpServer` plus a new stateless transport for every request and closes the server in `finally`. The comment at lines 164-166 states the cause (one transport per server; the shared server failed every later call). The header comment at lines 49-52 is stale: it still says "One McpServer per Lambda sandbox" (Minor m1). `handlers/mcp.ts` creates deps and `obs` once, which is correct.
- **Auth.** `auth.ts:54-85` reads the token from SSM (SecureString, `decrypt: true`), caches it per sandbox, has no default, and does not cache a failed load. `auth.ts:107,119` hashes both values with SHA-256 and compares with `timingSafeEqual` (fixed length, never `===`). A missing parameter throws and the request fails with a 5xx, never a silent pass. No DuckDB import in `auth.ts`, so a 401 cannot reach a bind. Order in `server.ts:150-159`: Origin, then token, then engine. Any `Origin` header gives 403 (the SDK's empty allowlist would have meant "allow all", the module avoids that; good reasoning at lines 17-26).
- **Token in the repo.** `git grep` for `Bearer ` and token assignments finds only test fixtures (`correct-token`, `nope`), `$MCP_TOKEN` placeholders in `docs/mcp.md` and evidence, and an unrelated bearer in `pipeline/publish`. No token file is tracked (`.env`/token name search: only design tokens CSS and two evidence JSON files named `no-token`/`wrong-token`). I cannot know the real value, so this is a pattern check, not proof; the PO's own 0-count run (git history, both log groups, JS bundle) is recorded in `docs/evidence/A-14-mcp.md` and I did not repeat it.
- **Proxy cannot bypass auth by design, and cannot exceed the row cap.** `routers/mcp-proxy.ts` never imports `auth.ts`, never calls `/mcp`, never reads SSM. The tool name is a closed enum of the six schema keys (line 47), so no seventh or SQL tool. Arguments pass through the same strict Zod schemas the MCP server registers (`runTool`, lines 115-123), `limit` is `max(1000)` (`schemas.ts:53,65`), and the error path returns a plain message with no stack or SQL (lines 143-145). Argument size is capped at 4,096 bytes. Caveat: the proxy is an unauthenticated public procedure (by design; it serves the same published data as the site) and its 5 rps bucket is per sandbox (`mcp-proxy.ts:14-15,155`), so it is a courtesy limit; the real limit is the query API's stage throttle (10 rps / burst 20). The contract still says the proxy "adds the token" (`contracts/mcp-tools.md:19`) while the code deliberately does not (m2).
- **Six tools, no SQL tool.** `tools.ts:242-308` registers exactly the six names with the query-core schema objects as `inputSchema`; `MCP_TOOL_SCHEMAS` is the same object map. Envelopes returned unchanged (`truncated`, `total`, `empty_reason`). Evidence TC-026 shows a `sql` argument rejected.
- **lazy-views.** `engine/lazy-views.ts` binds only the views the SQL names, through `bindOnce`. `bindOnce` keeps one global bound state; this is safe because a Lambda sandbox serves one request at a time. The wrapper is applied in `deps.ts:24` for both the MCP and the proxy path, so there is one data path.
- **runs-index.** `runs-index.ts:37-45` has a 5 s timeout, requires 2xx, Zod-validates, and throws instead of returning an empty index. Local-file fallback only when `RUNS_INDEX_URL` is unset. `RUNS_INDEX_URL` is set on the query, MCP and agent Lambdas (`api-stack.ts:351,545` and the agent env block).
- **Infra, MCP block (`api-stack.ts:479-660`).** Own role, own log group only, one `ssm:GetParameter` on the exact parameter ARN (no wildcard, no Secrets Manager, no KMS statement needed with the AWS-managed key), plus the shared CID-copy read grant (`ipfs/*`, `private/bench/*`). Route-level throttle on `POST /mcp` only (rate 5, burst 10) via the L1 stage, with the stage depending on the routes (lines 613-624, the rollback fix). Health route has no auth and no data access. Memory `MCP_MEMORY_MB = API_MEMORY_MB` (3,008 MB, AM-09) with the reason in the comment; same for the agent (`AGENT_MEMORY_MB`).
- **Infra, Agent block (`api-stack.ts:664-880`).** Two Bedrock statements: invoke on the single `eu.anthropic.claude-sonnet-4-6` inference-profile ARN in this account and region, and invoke on the `anthropic.claude-sonnet-4-6` foundation model with a `bedrock:InferenceProfileArn` StringLike condition (region wildcard justified in the cdk-nag acknowledgement). That is least privilege for cross-region inference; no `bedrock:*`, no `Resource: *`. DynamoDB access is `grantReadWriteData` on the one spend table. Agent route throttle 2 rps / burst 5 on both GET and POST, stage depends on the routes.

## Verified by running

- `pnpm exec vitest run` in `apps/api`: 19 files, 294 passed, 1 skipped (the hosted parity test, skipped without `AGENT_URL`).
- `pnpm --filter @countylens/infra exec vitest run`: 11 files, 116 passed, 1 skipped.
- Not run: any hosted call, the Playwright suite, `cdk synth`/`cdk diff` against AWS, the token-leak greps against CloudWatch and the deployed bundle (as instructed: no deployed agent, MCP server or AWS).

## Findings

### Major

- **M1. The MCP server has no per-call deadline, so on the full-county run a data call dies at the Lambda timeout instead of returning a typed answer.** `api-stack.ts:76` sets `MCP_TIMEOUT` to 15 s; `server.ts:167-177` and `tools.ts:211-235` impose no abort, unlike the agent's 23 s abort (T036). When the Lambda is killed, API Gateway answers a bare 5xx, not a JSON-RPC error or the typed envelope the contract promises ("never a thrown 500", `tools.ts:14-16`). Also, with no `manifest_cid`, `deps.ts:17-21` picks the latest run, which is the full-county run that times out, so every un-pinned data call fails on the hosted server; `docs/evidence/A-14-mcp.md` has to pin the old small run on every call. This is the recorded full-county exception, so the failure itself is not scored. What counts against the score is the missing graceful degradation (a timeout error envelope with the reason) and that `DEC-A-14-agent-mcp-full-county.md` (line 47) says the MCP tools "do the same" as the agent at "HTTP 500 after 25 s" while the MCP timeout is 15 s; the number is wrong for MCP. The documentation is otherwise honest and complete.
- **M2. Transient failures are reported as `run_not_found`.** `deps.ts:25-27` swallows every error (S3, bind, runs-index fetch, DuckDB) into `undefined`, and `tools.ts:129-130` turns that into an empty `run_not_found` envelope with `total: 0`. A client cannot tell "unknown CID" from "the server failed", and may conclude a run does not exist. Open as T042 in `tasks.md:153`; not fixed. Honest in the task list, but it affects the correctness of the tool answer.

### Minor

- **m1.** Stale comment `server.ts:49-52` ("One McpServer per Lambda sandbox ... a fresh transport") contradicts the fix at lines 164-167. Edit the comment.
- **m2.** `contracts/mcp-tools.md:19` still says the tRPC proxy "adds the token"; the code (and `mcp-proxy.ts:7-10`) calls the tools in process with no token. The code is the safer design; the contract text should be amended.
- **m3. ERR-64 (burst gives mostly 503, not 429).** Recorded and approved (`DEC-A-14-mcp-burst-503.md`, ERR-64, TC-021 left red). The documentation is honest and measured (14/1/25 split, evidence file, three ways to close). Two small inconsistencies: `DEC-A-14-agent-mcp-full-county.md` line 48 says the auth checks "(401, 429)" are unaffected, which the ERR-64 measurements contradict; and the root cause (account concurrency of 10 shared by three Lambdas, no reserved concurrency on MCP) means one bursting MCP client can starve the agent and query API for about a second. The DEC mentions that sharing; it is a real blast-radius point, not just a status-code point.
- **m4. T046 (token pre-load at init) not done.** `auth.ts:79-85` loads on the first request, not at cold start. A missing parameter still fails fast and without a default (a 5xx plus one clear log line), so the contract's "fail fast" holds per request; TC-028 is untested on a staging stack. Say so in the report (the task list does).
- **m5. No token-rotation TTL.** Revocation takes effect only when a warm sandbox recycles (`auth.ts:47-49`). Documented and accepted in `CR-A-14.md` finding 10; fine for the evaluation window.
- **m6. `SpendAlarm` has no action** (T043 open, `api-stack.ts` alarm block). Out of my domain, noted because the Agent block is in scope: the 80% alarm cannot notify anyone.
- **m7. The proxy's rate limit is per sandbox** (see above), so under load across several sandboxes the effective limit is higher than 5 rps. It is stated in the file header; not a defect, but do not present it as the route throttle.
- **m8. Registered tool descriptions omit the 1,000-row cap and `truncated`** (CR-A-14 finding 11, accepted). `get_schema` and `docs/mcp.md` cover it.

## How honestly the recorded exceptions are documented

Good. The full-county timeout has a decision record with a measured table, the six fixes found on the way (including the Bedrock IAM gap and the stage/route ordering failure, both invisible to unit tests), what works and what does not, and a cost estimate to close it. `docs/evidence/A-14-mcp.md` pins the small run on every call and says so, calls the AC-8 agreement "vacuous", says a truncated response was not demonstrated hosted, and lists TC-017 as skipped. ERR-64 keeps the failing test red instead of weakening it. The only honesty gaps are the two wording inconsistencies in m3 and M1.

## What I did not verify

Deployed behaviour, the stage's actual throttle settings, the token-leak counts (taken from the PO's recorded run), the MCP Inspector and donphan transcripts, and Origin/health behaviour through API Gateway (tested in unit tests only). The 20-call p95 figure (415 ms) is from the evidence file, on the small run only.

## Bottom line

Auth, the closed six-tool surface, the row cap, the per-request server fix, the SSM-only token and least-privilege IAM (including both Bedrock statements) are correct and tested. Remaining gaps are the missing MCP deadline and the over-broad `run_not_found` (M1, M2), both partly recorded; neither blocks the gate.
