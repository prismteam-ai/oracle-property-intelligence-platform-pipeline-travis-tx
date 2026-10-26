---
id: CR-A-16
type: code-review-log
story: A-16
branch: 016-cost-and-admin
reviewed_commit: 916c979
tools: [metagross, machamp, audino, "/code-review medium"]
created: 2026-10-26
---

# Code Review Log: A-16 cost, admin, prototype parity, full-county index

One review round on the whole branch (light lane), all four in parallel on 2026-10-26 02:00–02:10 EEST, read-only. Pass mark 75.

## Scores

| Reviewer | Score | Critical | Major | Result |
| --- | --- | --- | --- | --- |
| metagross (infra, API, web) | 81 | 0 | 2 | PASS |
| machamp (index, queue, bridge, pipeline) | 78 | 0 | 3 | PASS |
| audino (frontend quality) | 82 | 0 | 0 | PASS |
| `/code-review medium` | — | 0 | 2 High, 6 Medium, 2 Low | findings below |

## What was fixed (all Majors and High/Medium code-review findings)

| Finding | Fix | Commit |
| --- | --- | --- |
| metagross M1: batched `explore.search` skips its route throttle (also code-review 8) | A batch naming `explore.search` is refused (400) before any work; hosted check 400 | `1f984ae`, deployed 02:20 |
| metagross M2: Activity counts every request as a question | Activity queries filter to `explore.search` and `query.*` paths | `1f984ae` |
| machamp M1: a bridge-published run gets no Explore index | `explore-index` step after `cid-copy`, before the run is listed | `2b424b1` |
| machamp M2: retry cannot re-run a failed capture (once-per-key workflow) | New Restate key per failed capture attempt (`progress.json`) | `2b424b1` |
| machamp M3: a failed run alerts no one | One SNS message to the Ops topic on failure (`COUNTYLENS_ALERTS_TOPIC_ARN`) | `2b424b1` |
| code-review 1 (High): Retry targets the latest published run | Retry targets the failed/stopped run and keeps the dry-run choice | `8f6517f` |
| code-review 2 (High): env seed overrides the bridge's saved state | Saved `state.json` wins; env seeds only the first run | `2b424b1` |
| code-review 3: run lock never released if a later step throws | Released in a catch before `#drive` takes over | `2b424b1` |
| code-review 4: passing `--sample` exits 3, hosted TC-040 expects 0 | Exit 0 again; the log line says SAMPLE VERIFIED | `8f6517f` |
| code-review 5: `.takeover` guard never treated as stale | Stale guard (> 60 s) cleared in `run-lock.ts` (shell script unchanged, minor) | `2b424b1` |
| code-review 6: runner ignores `window.sinceRunId` | Base run from the command; fails closed if not in the index | `2b424b1` |
| code-review 7: empty error message crashes the final status write | Reason defaulted | `2b424b1` |
| code-review 9: Retry always sends publish | Retry carries the mode | `8f6517f` |
| audino minors 1–5 | One tab stop per result row; explicit table roles; Activity tiles hidden when empty; CSV formula escaping; parity doc states updated | `1486be4` |
| metagross minor: a real Start publishes in one click | Confirmation before a real publish | `1486be4` |

## Not fixed (recorded, minor)

- code-review 10: `tryUnitLock` duplicates `acquireRunLock` (cleanup only).
- metagross minors: AccessDenied on `live.json` shown as "bridge never reported"; refresh token stored but unused; the bridge uses the operator profile, not a CDK-scoped role; the p95 duration alarm covers the query API only.
- machamp minors: no overall capture timeout; Ctrl-C does not wait for the current step; no failed state after a crash mid-run; a view-SQL change refuses every older index until rebuilt (by design); no /tmp eviction.

## Full reviews


### metagross

#### CR-A-16 — metagross (infra, admin API, web, cost JSON)

Branch `016-cost-and-admin` vs `feature/oracle-pipeline`. Read-only review, 2026-10-26.

**Score: 81 / 100 — PASS (≥ 75)**

## Strengths
- Service choices are right for $0 idle: Cognito Lite (no Plus/MAU billing), SQS standard + SSE-SQS (no CMK), DLQ + one self-resolving alarm, no WAF/Secrets Manager/provisioned concurrency; pool and queue folded into `CountyLensApi` (no sixth stack, no Api→Ops cycle: topic imported by name).
- `adminProcedure` (apps/api/src/trpc.ts:101-133) is clean: aws-jwt-verify on the ACCESS token with clientId, 401 strictly before 403, refusals log `{procedure, reason, sub?}` only, verifier errors swallowed so no token fragments reach logs, `isDev:false` (ERR-72) holds.
- Least privilege on the API role: `sqs:SendMessage` on the queue ARN only; `logs:StartQuery` scoped to the query log group; S3 read adds exactly `private/explore-index/*` and the single `live/live.json` key. No queue policy, no SQS→Lambda trigger; pull-only bridge keeps P0-1 (no inbound path).
- `idle-cost.test.ts` asserts the P0-19 list in synth (scheduler disabled, no SM/KMS/WAF/R53/NAT, no provisioned/reserved concurrency, retention, budget, no region literal, no DSN), plus AC-11 queue/pool shape.
- Cost/limits page reads only the generated JSON built from `docs/cost.md` / `docs/source-limits.md`, with a `--check` drift test, gross vs credits apart, partial day apart, and "Not available · reason" everywhere (P0-11). Admin/Activity CSS added uses tokens only (no hex/rgb/inline styles found in the diff).
- Web auth: fixed error copy (never echoes Cognito text), 401 clears the session, signed-out visitors trigger no admin request, `RequireSession` redirects instead of blank screens; Zod parses every admin response.

## Findings

### Critical
None.

### Major
1. **`explore.search` route throttle is bypassable by batching** — infra/src/api-stack.ts:425-438 + apps/api/src/handlers/trpc.ts:189. The 3 rps / burst 6 limit applies only to the literal route key `ANY /trpc/explore.search`; a batched call `/trpc/explore.search,explore.search,…?batch=1` matches `/trpc/{proxy+}` (10 rps stage) and runs N searches in one invocation. The shared client never batches it, but any caller can. Fix: in the handler (or `createContext`), reject with 400 any batch whose procedure list includes `explore.search` (or set `allowBatching` off for that procedure via a path check before `trpc(...)`).
2. **Activity "questions" counts every HTTP request, including the admin page's own 5 s polls** — apps/api/src/routers/admin.ts:90-95 (with apps/web/src/auth/useAdmin.ts:66 `LIVE_POLL_MS`). `stats count(*) … by bin(1d)` over the whole access log labels admin.runs.live polls, admin.me, runs.summary, etc. as "questions"; one hour on Runs adds ~720. That is a provenance/honesty miss on a demo-visible number (P0-11). Fix: filter the perDay/requests queries to the question procedures (e.g. `filter path like /explore\.search|agent\./` or routeKey) and exclude `admin.*`; say in the label what is counted.

### Minor
1. apps/api/src/routers/admin.ts:154 — `AccessDenied` on live.json is treated as "bridge never reported", hiding an IAM regression as a normal empty state. Fix: only `NoSuchKey`/`NotFound` → undefined; log and 500 on AccessDenied.
2. apps/api/src/routers/admin.ts:158 — `JSON.parse(text)` is outside any try; a truncated live.json throws a raw SyntaxError instead of the intended "Run status is malformed". Fix: wrap in try and map to the same TRPCError.
3. apps/api/src/routers/admin.ts:365-371 — `admin.run.stop` puts a **commandId** into `targetRunId`; contract field semantics are mixed. Fix: add `targetCommandId` to `RunCommandV1` (or document that stop's targetRunId is a commandId and test it in the bridge).
4. apps/api/src/routers/admin.ts:197-200 + 350-364 — check-then-send is not atomic; two quick Starts both pass `refuseWhileRunning`. The bridge lock/idempotency covers it, but there is no test that two Starts yield one run. Fix: add a bridge test; optionally disable Start client-side while `queued`.
5. frozen-interfaces.md says `admin.runs.live` has "response max-age 5"; no Cache-Control is set anywhere in the API. Safe (nothing caches authed responses), but the contract and code disagree. Fix: set `Cache-Control: private, no-store` for `admin.*` via `responseMeta` and update the frozen text.
6. apps/web/src/auth/admin-api.ts:6-11, 140-148 — the `as unknown as AdminTrpc` cast was meant to go "once admin is in AppRouter"; it is now (routers/index.ts), so admin calls are untyped against the server. Fix: use the typed `ApiClient` and drop the hand-written `AdminTrpc`.
7. apps/web/src/auth/session.ts:12-16 — the refresh token is stored in localStorage but never used (the session simply ends at 1 h). Unneeded exposure to XSS. Fix: don't persist it, or implement refresh.
8. apps/web/src/routes/RunsAdmin.tsx:193, 219 — Start defaults to a real **publish** (permanent CIDs) with one click and no confirm. Fix: confirm dialog for publish mode, or default the dry-run toggle on.
9. pipeline/bridge/README.md:18-21, 85 — the bridge runs on the broad `assess` operator profile; the receive/delete/PutObject(live.json) least-privilege set is documented, not enforced in CDK. Fix: a CDK-managed `countylens-bridge` role (assumed by the profile) with exactly those actions.
10. infra/src/ops-stack.ts:149-162 — the p95 duration alarm covers `countylens-api` only; the agent and MCP Lambdas (same engine, same index) have none. Fix: add the same alarm for MCP (15 s) and agent (25 s) or record why not.
11. infra/test/idle-cost.test.ts — CloudWatch alarms are free only up to 10 **per account**; CountyLens now has 8 and the account also hosts `roofing-crm`. docs/cost.md:56 claims "inside the free 10" without counting Crm alarms. Fix: assert the CountyLens alarm count in synth and check the account total in cost.md.
12. apps/web/src/auth/useAdmin.ts:72-80 — live polling continues while the tab is hidden (a Lambda + S3 GET every 5 s). Fix: pause on `document.visibilityState === "hidden"`.

## Confidence
Medium-high. I read the branch diff for infra (`admin-queue.ts`, `api-stack.ts`, `ops-stack.ts`, `data-stack.ts`, `web-stack.ts`, `config.ts`), `trpc.ts`, `context.ts`, `routers/admin.ts`, the web auth module, RunsAdmin/Activity/CoverageCostLimits headers and control logic, `build-cost-limits.mjs` and `idle-cost.test.ts` assertions. I did not run tests, synth or the hosted URL, and did not review the bridge runner, explore-index build/reader or parity CSS line by line (machamp/audino areas). The batching bypass is from reading the routes and the tRPC adapter defaults, not a live probe.

### machamp

#### CR-A-16 · machamp (batch workflows) · branch 016-cost-and-admin

**Score: 78 / 100 (pass, ≥ 75)**

Scope: per-run Explore index (builder, reader, bind, error mapping), admin queue construct, laptop bridge (loop, idempotency, expiry, stop, runner), pipeline closures (run-lock, unit lock, write-group coordinate, run-manifest overrides, verify-manifest exit codes, publish receipts). Read-only: diff `feature/oracle-pipeline...016-cost-and-admin`, plus S3 ListObjectsV2 on `private/explore-index/` (two runs, about 42 MB each).

## Service choices

- The Explore index runs as a laptop batch: published parts go through DuckDB into Parquet on a private S3 prefix, and the Lambda reads it from /tmp. That is the right size for this job. 356 MB in and 42 MB out does not justify Glue or Step Functions, and the job reads only published, SHA-checked bytes (ADR-0001 Amendment 1).
- The admin queue is SQS Standard with SSE-SQS, 15-minute retention, 20 s long poll, a DLQ after 3 receives, and one self-resolving alarm. The laptop bridge is the consumer. For an attended, single-operator pipeline whose capture runs on a local Restate stack, this async, queued boundary is the right call: no inbound path to the laptop, and backpressure comes from one message at a time plus one run at a time.

## Strengths

- Cost gate on the index fetch: `fetchBudget`, 2 GB ceiling (`pipeline/publish/src/explore-index.ts:156`). Bounded retries: 1/2/4 s on 429/5xx, 4 tries, 60 s timeout. Every part's SHA-256 is checked against the manifest, and public gateways are refused.
- The upload is idempotent and fail-closed: `If-None-Match "*"`, Parquet files first, `index.json` last. An identical index is a no-op and a different one is a conflict, never an overwrite (`build-explore-index.ts:560-610`). The batch-coverage hard stop (unbound or empty county batches) is ported from Task B.
- The reader checks schema, manifest CID, view-SQL hash and per-file SHA-256. It writes to /tmp atomically, runs one load per CID, and does not cache failures (`apps/api/src/engine/explore-index.ts:132-193`). A run with no index and too big to bind answers typed `index_not_built` / `index_stale` instead of timing out after 29 s. Explore maps this to PRECONDITION_FAILED, and the agent and MCP get an `isError` result.
- Bridge ordering: idempotency record → live.json → delete. Malformed messages are left for the DLQ. Expiry is checked, and a Stop can cancel a Start that has not arrived yet. The Restate key derives from the run ID. Per-run `progress.json` lets a Retry resume without repeating finished steps. Stop is honoured only between atomic steps. The bridge never skips the gate: it always goes through `publish-run.ts --step`.
- Lock closures are correct: hard-link publish, so a lock is never empty; an exclusive takeover guard; an owner re-read under the guard (`run-lock.ts`, `publish-run.ts tryUnitLock`). The receipt is re-checked after the lock is taken. `verify-manifest` exits 3 on a sample pass, so 0 always means a full verification. `publish-worker.sh` reports the step's real exit code.
- Tests cover each of these branches, including races through hooks.

## Findings

### Critical

None.

### Major

1. **A run started from the admin page is published without an Explore index** (`pipeline/bridge/src/runner.ts:334-337`, `PUBLISH_STEP_ORDER` at `runner.ts:20-29`). The bridge publishes a full-county incremental run (Run 3+, 441,961 properties). Nothing builds or uploads its index, so Explore, the agent and MCP on the newest run answer `index_not_built` until someone runs `build-explore-index.ts` by hand. The batch has no "done" check for its output (staged verification and recovery principles). **Fix:** in publish mode, add an `explore-index` step after `publish-gate-remote` and before `publish-release`: `build-explore-index.ts --manifest runs/<runId>/manifest.json --verify --upload` (it is already idempotent and cost-gated). The run is not "succeeded" until the index exists.
2. **Retry cannot re-run a failed capture** (`pipeline/bridge/src/runner.ts:121-122`, `restate.ts:32-55`). A Retry reuses the run ID, so the job ID and the Restate workflow key are the same. A Restate workflow runs once per key. If `capture-merge` ended with a non-zero `exitCode` (a transient source failure, not exit 2), Retry attaches to the finished workflow and gets the same failed output forever. The only way out is a fresh Start. This breaks the recovery and redrive principle for the step that fails most. **Fix:** keep the key while the workflow is still running. Once `capture-merge` has recorded a failed output, derive a new key (for example, add a `-r<n>` attempt suffix stored in `progress.json`).
3. **A terminal run failure alerts no one** (`pipeline/bridge/src/loop.ts:188-194`). The SNS topic only receives DLQ messages, that is, malformed commands. A run that fails or hangs is written only to `live.json`. The failure-alerting principle requires a notification when batch work does not complete. **Fix:** on `failed`, publish one message to the existing Ops alarm topic (grant `sns:Publish` on that one topic to the bridge user). Or emit a `RunFailed` metric with an alarm, plus a "bridge heartbeat missing while state=running" alarm.

### Minor

4. **The capture wait has no overall timeout** (`pipeline/bridge/src/restate.ts:43-56`). The `signal` option is never passed (`main.ts:67`). A workflow suspended on a human promise keeps the bridge "running" forever and rejects every Start. **Fix:** set a ceiling (for example, 2× the 35-minute capture) and fail the step with a clear reason.
5. **Ctrl-C does not wait for the active run** (`pipeline/bridge/src/main.ts:100-112`). `run()` returns on abort and the heartbeat stops while the run continues, so the Runs page shows "offline". SIGINT also reaches the foreground child step, which then dies in the middle of the step. **Fix:** on SIGINT, call `stop.request()`, then `await bridge.idle()` before `stopBeat()`. Spawn children `detached` or ignore SIGINT in them.
6. **A crash mid-run leaves no failed outcome** (`pipeline/bridge/src/live.ts:26-38`, `loop.ts:154`). On restart, `live.json` resets to idle, the command stays `accepted`, and the UI never learns the run died. **Fix:** at startup, if `work/*/progress.json` has an unfinished run, write `state: failed`, `limitations: ["bridge restarted mid-run"]`, and the run ID so the user can Retry.
7. **`cmd.window.sinceRunId` is ignored** (`pipeline/bridge/src/runner.ts:173-180`). Preflight builds on the last entry of `runs/index.json`, whatever window the admin saw. **Fix:** fail preflight when `window.sinceRunId !== lastRun.runId` ("runs moved on; reload").
8. **A view-SQL change locks out every index** (`pipeline/publish/src/explore-index.ts:272-277` with `apps/api/src/engine/explore-index.ts:118`). A deploy that changes `VIEWS_SQL` makes all full-county indexes `index_stale`. The rebuild then conflicts under the same `<cid>/` prefix until an operator deletes it. **Fix:** key the prefix by `<manifestCid>/<viewsSha256[0:12]>/` so a rebuild sits beside the old index.
9. **Index cache has no eviction** (`apps/api/src/engine/explore-index.ts:146`). At about 42 MB per run against 512 MB of ephemeral storage, roughly 10 runs per sandbox fill /tmp. **Fix:** keep the newest N CIDs, or size `ephemeralStorageSize` to match.
10. **A stale takeover guard blocks forever** (`pipeline/local-stack/scripts/run-lock.ts:85-86`, same in `publish-run.ts tryUnitLock`). A process killed while holding `<lock>.takeover` leaves it behind, and later starts fail closed until someone removes it by hand. The window is small because the code is synchronous. **Fix:** treat a guard older than about 60 s (mtime) as stale and say so in the message.

## Confidence

Medium-high. The code paths are read in full for the bridge, the queue, the lock and the index modules, and the S3 index layout was checked live. Not run: bridge tests, a hosted admin Start/Stop (evidence says pending, TZ03/TZ05), and Restate's exact behaviour on a re-send to a completed workflow key. Finding 2 assumes standard Restate workflow-once semantics with failures returned as output (`exitCode`), which is what `runner.ts:186-192` implies.

### audino

#### CR-A-16 frontend review (audino)

Branch 016-cost-and-admin vs feature/oracle-pipeline. Reviewed from source and tests; no hosted run or visual diff against the boards.

## Score: 82 / 100 (passes at 75)

## Strengths
- Atlas tokens only in all new CSS (no raw colours or px except 1px borders and sr-only clips); `--space-9` (48 px) min-height on buttons, chips, summaries, inputs; consistent 2 px primary `:focus-visible` outlines.
- Missing data always says why: `Not available · {reason}` (Coverage cost and limits, Activity metrics, Filebase usage), "Blocked" with dates, unclassified catalog parts, SQL bind note, first-page Permits note.
- Provenance on every new display: "as of", source doc, Logs Insights query behind each Activity number, cached-at time.
- Full state coverage: loading, error with Retry, empty ("Not enough activity yet"), not-admin, expired, unavailable, lockout and refusal on sign-in. Roles are right (role=alert, role=status, aria-invalid + describedby, labelled sections).
- Each deviation from the boards is documented in file headers and in the parity doc. Cost e2e compares the page with the parsed docs, not its own data file, so it would catch a data regression.

## Findings

### Critical
None.

### Major
None.

### Minor
1. (Test strength) tests/e2e/A-16-admin.spec.ts:297-300. The only axe run is skipped without admin credentials and covers three admin pages only. Coverage cost/limits, the Explore results table and the sync badge have no axe, focus or 48 px target assertion in e2e. Fix: add `runAxe` plus a bounding-box >= 48 check on Coverage and Explore in the public a16-cost project.
2. apps/web/src/components/ResultTable.tsx:96. Each `tr` has `tabIndex=0` and a "Details" button, so keyboard users get two tab stops per row with an unlabelled row role. Fix: drop `tabIndex`/row key handler and keep the Details button (click on the row can stay as a mouse convenience).
3. apps/web/src/routes/CoverageCostLimits.module.css:34,50. `display:block` on table/tr/td below 840 px strips table semantics in Safari/VoiceOver; `data-label` pseudo-content is not announced reliably. Fix: add `role="table|row|cell|columnheader"` on the elements, or render stacked cards below 840 px.
4. apps/web/src/routes/Activity.tsx:158-195. The empty banner says "Nothing is counted as zero", but when metrics are 0 the tiles below still show "0". Fix: hide the metric tiles when `empty`, or show "Not available" for zero-only logs.
5. apps/web/src/routes/Activity.tsx:59. The CSV writes query text unescaped for spreadsheets (a leading `=`, `+`, `-` or `@` is a formula). Fix: prefix such cells with `'`.
6. Parity (docs/evidence/A-16-prototype-parity.md): Stale, partial and rate-limited SyncBadge states, the Activity top-areas and per-query table, and the Runs pipeline diagram and Gantt are not built. All are justified in the file headers, but the "after" verdicts for AC-12 should say Differs (justified) and not Match.

## Confidence
Medium-high on code, CSS and test reading. Not verified: rendered contrast, pixel layout against the boards, actual axe results (requires admin credentials and the hosted URL).

### code-review-medium

#### CR-A-16: /code-review medium (016-cost-and-admin vs feature/oracle-pipeline)

| # | Severity | File:line | Summary | Failure scenario | Suggested fix |
|---|---|---|---|---|---|
| 1 | High | apps/web/src/routes/RunsAdmin.tsx:236 | Retry sends latest *published* runId (`latest.runId`, Runs.tsx:108) instead of the failed bridge run `live.runId` | A run fails at publish-car-files. Retry targets Run 3: the runner regex rejects it, or a prior bridge run's progress.json makes it a no-op "succeeded". The failed run never resumes | Send `live.runId` (enable only when live.state is failed/stopped) |
| 2 | High | pipeline/bridge/src/runner.ts:164 | `c.permitsSeedJob ?? state.permitsSeedJob` means the env var always overrides state.json | The README sets BRIDGE_PERMITS_SEED_JOB, so Run B seeds from the Run 3 job, drops Run A's increments, and the published manifest regresses | Prefer state.json and use env only as the first-run fallback (same for countyDir) |
| 3 | Medium | pipeline/bridge/src/loop.ts:148 | Lock taken before idem.record/live.update/queue.delete; a throw leaks it (release never called, #active unset) | SQS DeleteMessage fails, so the lock is held by the live self pid and every later Start is `rejected_active_run` until restart. The redelivered message is dropped as a duplicate | try/catch after tryLock that calls release() on failure, or take the lock after the bookkeeping |
| 4 | Medium | scripts/verify-manifest.ts:610 | A passing `--sample` now exits 3, but hosted e2e TC-040 (tests/e2e/verify-manifest.spec.ts:150, :269) expects 0 | The hosted Playwright run goes red on a valid manifest | Restore exit 0 for a passing sample, or update the spec and test plan together |
| 5 | Medium | pipeline/local-stack/scripts/run-lock.ts:84 (also publish-run.ts tryUnitLock, batch-hash-validate-export.sh `mkdir $GUARD`) | The `.takeover` guard is never considered stale | SIGKILL/Ctrl-C while holding the guard means every future stale takeover fails ("another process is taking over"), and the bridge batches step fails forever | Write the owner pid and mtime into the guard and reclaim it when stale; add a bash trap that removes GUARD |
| 6 | Medium | pipeline/bridge/src/runner.ts:177 | Ignores command `window.sinceRunId` and uses the last entry of local runs/index.json | A stale or unsorted local index means a wrong base run, a wrong previousManifestCid and wrong coverage carry-over | Use window.sinceRunId; fail if it is absent from the local index |
| 7 | Medium | pipeline/bridge/src/loop.ts:189 | The final live.update in #drive can throw (LiveRunV1 rejects `limitations:[""]`), which is an unhandled rejection | An empty error message crashes the bridge, live.json stays "running", and the API returns 409 on Start/Retry until stale | Default the reason to non-empty text; add a .catch on #active |
| 8 | Medium | infra/src/api-stack.ts:426 | The explore.search throttle applies only to the literal route, and tRPC batching still reaches it via `/trpc/{proxy+}` | `GET /trpc/explore.search,explore.search?batch=1` bypasses the route cost cap (A13-6/A14-3) | Disable allowBatching (or reject batched paths containing explore.search) |
| 9 | Low | apps/api/src/routers/admin.ts:378 | admin.run.retry always sends mode "publish", so a dry-run retry is impossible | Retrying `travis-dryrun-…` fails with "not a publish run the bridge started" | Derive the mode from the runId prefix, or hide Retry for dry runs |
| 10 | Low (cleanup) | pipeline/publish/src/publish-run.ts:414 | tryUnitLock duplicates the acquireRunLock algorithm in run-lock.ts | Fixes (e.g. finding 5) drift between the copies | Call acquireRunLock(lockPath,{pid,alive}) and map a throw to undefined |
