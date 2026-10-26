# A-16 agent design

Read-only design consults, 2026-10-26, run in parallel: metagross (sign-in, infra, Coverage, Activity, web speed), machamp (command queue and bridge), machamp (per-run Explore index, AC-13), smeargle (prototype parity inventory, AC-12). Each section is that agent's answer, word for word. Nothing here was built or deployed by the consults.

---

## metagross (sign-in, infra, Coverage · Cost and Limits, Activity, web speed)

# A-16 design consult: metagross (read-only)
Repo root R = /Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx; B = /Users/hebagaber/Github/roofing-crm

## 1. Sign-in copied from Task B
Copy (rename crm -> countylens):
- B/apps/web/src/auth/{config,signIn,signOut,session,identity,RequireSession}.ts(x) -> R/apps/web/src/auth/. Keep SRP via amazon-cognito-identity-js (a Cognito client, not an LLM SDK). Session in localStorage key `countylens.session` (origin-scoped, one storageState serves 3 viewports). Vite vars VITE_COGNITO_USER_POOL_ID / _CLIENT_ID, set in R/infra/src/web-stack.ts Amplify env.
- B/infra/lib/crm-ops-stack.ts user pool (selfSignUpEnabled false, signInAliases email, accountRecovery NONE, SRP client, no secret, preventUserExistenceErrors) -> R/infra/src/api-stack.ts. Add `CfnUserPoolGroup "admin"`. DROP the lockout PreAuth/PostAuth Lambda (lockout-handler.ts): Cognito's own throttling is enough, saves a Lambda and a DynamoDB table; record as a Task-B difference.
- Pool stack: CountyLensApi (it already owns the JWT audience, SQS goes next to it; Web already depends on Api; Ops already depends on both, so no new edge or cycle). Deviation note against AD-23's rationale, no sixth stack.
- Authorizer: do NOT use HttpUserPoolAuthorizer. /trpc is one route shared with public procedures, so an authorizer would lock the public API. Use `adminProcedure` in R/apps/api/src/trpc.ts: middleware reads `Authorization: Bearer` from ctx.event (context.ts), verifies the ACCESS token with `aws-jwt-verify` CognitoJwtVerifier (tokenUse "access", pool + client from env, verifier built at module scope so JWKS is cached), requires `cognito:groups` to contain `admin`. Missing/expired/invalid -> TRPCError UNAUTHORIZED (401); not admin -> FORBIDDEN (403); log {procedure, reason, sub?} never the token; SQS send happens only after the middleware.
- New router R/apps/api/src/routers/admin.ts (me, run.start/stop/retry stubs per AC-7 contract, activity.summary), added to routers/index.ts.
- Web: route `/admin/sign-in` (ROUTES.adminSignIn in packages/shared/src/routes.ts, lazy entry in route-list.ts, page AdminSignIn.tsx per AdminSignIn*.dc.html; "code sent" state is Justified). RequireSession wraps Runs admin controls and `/activity`. Signed-out sees no controls.
- Hosted Playwright: R/tests/e2e/lib/auth.ts copied from B (COUNTYLENS_TEST_USERNAME/PASSWORD read from ~/.config/assessment/countylens-test.env, loaded by playwright.config, never in git; storageState playwright/.auth/admin.json gitignored; skip with a stated reason if unset). Operator creates the user once: `aws cognito-idp admin-create-user`, `admin-set-user-password --permanent`, `admin-add-user-to-group --group-name admin` (profile assess, eu-north-1).

## 2. Infra (all CDK, R/infra/src)
- api-stack.ts: API_TIMEOUT 29 s -> 15 s (CountyLensApi query function only; agent stays 25 s, MCP unchanged). Update comment at line ~90 and infra/test/api.test.ts.
- Per-route throttle on `POST|GET /trpc/explore.search`: tRPC has one route, so add a second HTTP route key per procedure is not possible. Smallest: add dedicated route `ANY /trpc/explore.search` (more specific than the proxy) to the same integration and set CfnStage routeSettings for that key (pattern at lines ~607-621 / 825). Constant EXPLORE_SEARCH_THROTTLE = {rateLimit 3, burstLimit 6}, exported next to MCP_THROTTLE.
- ops-stack.ts: add alarm "LambdaDuration" on api.fn.metricDuration p95 > 12 s (80% of 15 s), 1 period of 5 min, treatMissingData NOT_BREACHING, ALARM+OK to the topic via the existing `alarm()` helper (cap stays under the free 10 alarms: now 3 + duration + DLQ = 5 + existing agent/MCP ones; count it in the test).
- New in api-stack.ts: SQS command queue (visibility 60 s, retention 15 min = AC-9 expiry, DLQ maxReceiveCount 3), DLQ ApproximateNumberOfMessagesVisible >= 1 alarm in ops-stack.ts, API Lambda gets sqs:SendMessage on the queue only.
- Leftover `/aws/lambda/CountyLensSpike-*` log group: belongs to no stack. Do not import it. One operator step, logged in the evidence: `aws logs delete-log-group` (hard to reverse, ask the PO first), then a test that the cost doc row 6 is closed. If the PO prefers keeping it: `put-retention-policy 14`.
- New test infra/test/idle-cost.test.ts (AC-2, AC-11) over all five stacks via Template.fromStack: scheduler state DISABLED; resourceCountIs 0 for Secrets Manager (note: aiGatewaySecretArn is an imported ARN, assert no AWS::SecretsManager::Secret), AWS::RDS::DBInstance/DBCluster, AWS::KMS::Key (CMK), AWS::WAFv2::WebACL, AWS::Route53::HostedZone, and no ProvisionedConcurrencyConfig/ReservedConcurrentExecutions; every AWS::Logs::LogGroup RetentionInDays is 14 (access/query log 30); budget limit 10; no literal eu-north-1 in infra/src except config.ts default; UserPool AllowAdminCreateUserOnly true; queue has RedrivePolicy + DLQ alarm; no ingress rules / public queue policy (queue policy absent); grep gate for DB connection strings in apps/ and infra/.

## 3. Coverage . Cost and Limits (AC-4, AC-5)
Hand-curated, build-time: add `scripts/build-cost-limits.mjs` (runs in `pnpm build` of apps/web, prebuild) that parses docs/cost.md and docs/source-limits.md tables into `apps/web/src/content/cost-limits.generated.json` (gitignored? no: commit it so CI diff shows drift; a unit test regenerates and compares). Fields per row: label, value, asOf (ISO date from the doc's "as of" line), source, missingReason|null. Parser fails the build if a table row has no date or a value of 0 where the doc says "not available". Page: new sections in apps/web/src/routes/Coverage.tsx (or CoverageCostLimits.tsx imported by it) render rows with the existing Provenance and MissingReason components: "as of {date}", "Filebase usage: not available · {reason}", never a filled zero. Test compares rendered numbers to the JSON, and the JSON to the docs.

## 4. Activity (AC-10)
`admin.activity.summary` (adminProcedure) runs three CloudWatch Logs Insights queries (`StartQuery`/`GetQueryResults`, aws-sdk v3 client-cloudwatch-logs) against the query log group (30 d): questions per day, p95 duration, failures by outcome. Cache: module-scope Map keyed by query name with 5-min TTL (warm Lambda) and `cachedAt` in the response; cold path polls GetQueryResults up to 8 s. Returns each query string; web renders each number as a link to the CloudWatch Logs Insights console URL (region from config) with the query pre-filled. IAM: logs:StartQuery/GetQueryResults/StopQuery on that log group only. Page R/apps/web/src/routes/Activity.tsx behind RequireSession, per Activity*.dc.html.

## 5. Web speed items (smallest change)
- A13-2 SQL panel lazy binding: apps/web/src/routes/ExploreSql.engine.ts line ~53 `bindAllViews` binds every view up front. Bind only views referenced by the query (regex on FROM/JOIN identifiers) on first run, memoize bound names; show the existing STAGE_TEXTS.bind line.
- A13-3 LCP: apps/web/src/routes/Runs.shared.tsx `useLatestRun`/loadLatestRun in data/run-loader.ts: render the run list from runs-index first (state "list-ready") and fetch the manifest after; also `<link rel=preload>` for runs index in apps/web/index.html if present.
- A11-11 Permits first load: apps/web/src/engine/load-permits.ts + Permits.page.tsx: read only part 0 / first page for the first paint, load remaining parts after; tighten the 60 s limit to measured p95 x 2 in timing.ts.
- A11-9 fallback too large: load-permits.ts line ~149-152 exempts fallback from the cap; replace with an explicit typed error TooLargeOnFallback and a message in packages/shared text constants ("This copy is too large to read from the fallback gateway. Try again when the CID copy is back.") rendered by ErrorBanner in Permits.page.tsx.

## 6. Builder groups (disjoint files)
Group 1, infra + API (metagross/backend): infra/src/api-stack.ts, ops-stack.ts, web-stack.ts (env only), infra/test/*, apps/api/src/{trpc,context}.ts, routers/{admin,index}.ts, apps/api package.json.
Group 2, web + e2e: apps/web/src/{auth,routes,content}/*, routes/route-list.ts, scripts/build-cost-limits.mjs, tests/e2e/*, packages/shared/src/routes.ts + text constants.
Freeze first (before groups start): (a) admin tRPC contract: `admin.me`, `admin.run.{start,stop,retry}`, `admin.activity.summary` input/output Zod schemas in packages/contract (Group 2 reads, Group 1 writes first); (b) env names: VITE_COGNITO_USER_POOL_ID, VITE_COGNITO_USER_POOL_CLIENT_ID, COUNTYLENS_TEST_USERNAME/PASSWORD, admin group name `admin`; (c) ROUTES.adminSignIn and ROUTES.activity paths; (d) error codes 401/403 and the Bearer access-token header; (e) cost-limits.generated.json row schema; (f) the explore.search route key and throttle constant.

---

## machamp (command queue, DLQ, bridge, A-11 closures)

# A-16 Part 2: machamp design (queue, bridge, live.json, closure items)

## 1. Contracts (packages/contract/src/run-command.ts, exported from index.ts; zod .strict())
RunCommandV1 { schema:"oracle-travis-run-command.v1", commandId: uuid, action:"start"|"stop"|"retry",
  window: {kind:"austin_permits_since_watermark", sinceRunId:string} | null (null for stop),
  targetRunId?: string (stop/retry), mode:"publish"|"dry_run", requestedBy: string (Cognito sub, never email/token),
  requestedAt, expiresAt (= requestedAt + 15 min) : IsoDateTime }.
LiveRunV1 (runs/live.json) { schema:"oracle-travis-live-run.v1", state:"idle"|"running"|"stopping"|"stopped"|"failed"|"succeeded",
  runId|null, commandId|null, startedAt|null, updatedAt, step:string|null (gate, filebase, ...), bridgeSeenAt,
  lastCommand: {commandId, outcome:"accepted"|"rejected_active_run"|"expired"|"duplicate"|"cancelled", at}|null,
  limitations: string[] ("stopped by admin") }. No paths, tokens, DB strings.
Location: s3://<CID-copy bucket>/live/live.json (separate prefix; never in the manifest, never IPFS). Writer: bridge only
(PutObject on that key; heartbeat every 30 s while polling and between steps). Reader: API Lambda GetObject (read-only) ->
Runs page; staleness (bridgeSeenAt > 3 min) renders "Bridge offline". Cache: Cache-Control: no-store on the object; API
response max-age=5. runs/index.json stays append-only and published-only.

## 2. Infra (CDK, CountyLensOps or new Admin construct; infra/src/ops-stack.ts)
- Queue countylens-admin-commands: standard, SSE-SQS, visibility 120 s, retention 15 min (backstop), receive wait 20 s,
  DLQ countylens-admin-commands-dlq (retention 14 d), maxReceiveCount 3.
- Expiry: BOTH. Retention 15 min drops unread messages (no surprise runs); the bridge ALSO checks expiresAt (clock skew,
  redelivery after visibility timeout) and deletes+logs "expired" without running. Retention drop does not hit the DLQ,
  so "Bridge offline - command expired at T" is derived by the API from its own sent-record (commandId, expiresAt) vs live.json.
- Cancel by command ID: a Stop/cancel command is another message; the bridge keeps a short in-memory + live.json
  list of cancelled IDs and drops a matching Start it receives later. No SQS delete-by-attribute exists.
- One alarm: DLQ ApproximateNumberOfMessagesVisible >= 1, 1 period of 5 min, missing=NOT_BREACHING, alarm action
  -> existing alerts topic (this.topic in ops-stack). Idle cost $0.
- IAM: API role: sqs:SendMessage on the queue ARN only (+ s3:GetObject on live/live.json). Bridge: an IAM user/role used by
  profile assess: sqs:ReceiveMessage, sqs:DeleteMessage, sqs:ChangeMessageVisibility, sqs:GetQueueAttributes on the queue ARN;
  s3:PutObject on live/live.json only. Nothing on the DLQ for the bridge. No Lambda trigger, no inbound path (s2.2).
- Synth assertions (AC-11): DLQ + maxReceiveCount 3, alarm->topic, no resource policy allowing others, no SQS->Lambda
  event source, no connection string in apps/ or infra/.

## 3. Bridge (pipeline/bridge/, new package; tsx, no Python)
Loop: ReceiveMessage(WaitTimeSeconds 20, Max 1) -> validate RunCommandV1 -> idempotency file pipeline/data/bridge/commands.json
(commandId -> outcome; duplicate => delete, no rerun) -> expiresAt check -> act -> DeleteMessage after the outcome is recorded.
Start while running: reject (outcome rejected_active_run, delete, live.json lastCommand shows "A run is already running").
Active-run test = live.json state running/stopping AND acquireRunLock(pipeline/data/bridge/run.lock) (atomic, see 4b).
Stop: sets a stop flag; the runner checks it only between atomic steps (never inside upload/add/pin/index); the
publish driver steps are already receipted/resumable, so stopping after step N leaves nothing half-published, index step
never runs after a stop; live.json state stopped with limitation "stopped by admin" (also written to the run's limitations
only if the manifest is built; otherwise run notes).
Start runs, in order, the SAME gated path as Run 3, orchestrated by one function runIncremental(window):
 (1) Restate invoke of AustinPermits incremental via the ingress (POST workflow `austin-3syk-w9eu-incremental-<stamp>`,
     the verb `backbone permits --mode incremental`; durable, keyed by commandId so a re-invoke attaches, not duplicates);
 (2) link + reexport-permits for affected pIDs; batch-hash-validate-export.sh for the 5 permit batches (county group reused
     from base as in Run 2/3: no 10 county batches);
 (3) build-run-manifest.ts (requireLinkedPermits enforced, base = last runs/index.json entry);
 (4) publish-run.ts with steps gate -> filebase -> car-files -> manifest -> cid-copy -> gate-remote -> release -> index.
 No --skip/force exists; bridge never calls upload.ts/side scripts. bind-guard runs in manifest/index writing (assertBindable).
 mode dry_run passes --dry-run (gate real, nothing uploaded).
 NOTE "CountyIngest": the repo workflow names are TcadBackbone/AustinPermits (CountyIngest-style); wire by name AustinPermits,
 spec wording "CountyIngest" should be updated.
Smallest honest Start: Austin permits incremental since the last manifest watermark + permits-only run (county group reused).
Duration from the Run 3 log: capture+merge ~35 min (48 pages at >=1 s spacing), reexport ~3 min, 5 permit batches ~10 min,
publish ~30-60 min (CAR readback, CID copy). Expect 1-1.5 h end to end; demo = Start shows Running within 60 s;
dry_run mode (~45 min, no upload) or a window with zero new rows ("source unchanged") finishes sooner. Do not promise a
published run inside the demo unless rehearsed; Runs 2/3 side effect (story gap 2) only if PO says publish.

## 4. Closure items
- A11-6 CLOSE (cheap): in buildManifest (pipeline/publish/src/manifest.ts / run-manifest.ts) assert sum(5 permits_* keys)
  + linked permits == Austin source records (already in AC of requireLinkedPermits); throw otherwise; unit test with a mismatch.
- A11-8 minors: EXCEPTION; Majors closed already (M1-M3). Cheap add: receipt-on-confirm skip of re-probe; rest exception.
- A11-10(b) CLOSE: run-lock.ts takeover: rename the stale file to run.lock.stale.<pid>.<rand> (atomic) then tryCreate; the
  loser of the rename race gets ENOENT and fails closed; re-read owner after taking; same in batch-hash-validate-export.sh
  (use mv -n / mkdir lock). Test with two concurrent acquirers.
- A11-10(c) CLOSE: write-group.ts:133 pass coordinate only when parcel.coordinate_source !== "none" (mirror County flag); unit test.
- A11-10(d) CLOSE: run-manifest.ts:187 area: when permit count unchanged but facts exist, still apply permitLinkCoverage
  overrides (do not carry); unit test unchanged count with different exclusions.

## 5. Builder group (soofi-xyz-team-kit:machamp), files disjoint from apps/web, apps/api
T1 packages/contract/src/run-command.ts, live-run.ts, index.ts, test/ (schemas + fixtures)
T2 infra/src/admin-queue.ts (construct) + wiring in ops-stack.ts/app.ts + infra/test/admin-queue.test.ts (AC-9, AC-11)
T3 pipeline/bridge/{package.json,src/loop.ts,idempotency.ts,live.ts,runner.ts,stop.ts} + tests with an SQS stub (fake client)
T4 runner orchestration reusing publish-run.ts gated steps; test: dry-run on Run 3 manifest, assert gate step executes
T5 run-lock.ts atomic takeover + batch script (A11-10b) + tests
T6 write-group.ts coordinate flag (c) + test; run-manifest.ts (d) + manifest reconciliation (A11-6) + tests
T7 run-log/evidence stubs, docs/bridge README (start command, profile assess, kill switch)
Verify: fake-queue e2e (start, dup start, expired, stop mid-step), then one real SQS dry_run against the dev queue.
Interface to metagross: API imports RunCommandV1/LiveRunV1 from @countylens/contract, uses queue URL from env; no other coupling.

---

## machamp (per-run Explore index, AC-13; measured on this laptop 2026-10-26)

# A-16 AC-13 — per-run Explore index: machamp design consult

Read-only consult (2026-10-26). No repo file was edited. Scratch scripts and logs:
`/private/tmp/claude-501/-Users-hebagaber-Github-oracle-property-intelligence-platform-pipeline-travis-tx/2d0f647c-dca9-46ae-9b35-795965af8f06/scratchpad/index/scripts/` (`build.mts`, `query.mts`, `dist.mts`) and `.../scratchpad/index/out/*.log`.

## 0. Headline (measured on this laptop, real data)

| | Run 2 (`bafkreife3v…pcute`) | Run 3 (local manifest) |
| --- | --- | --- |
| Parts the 4 contract views need | 160 of 225, 356.5 MB | 190 of 255, 783 MB |
| Fetch + sha256 vs manifest | 69.7 s (CloudFront CID copy, 8 parallel, 0 retries, no Filebase) | 1.7 s (local files) |
| Bind (query-core `bindManifest`) | 0.3 s | 0.3 s |
| Materialize views → Parquet | 4.9 s | 15.2 s |
| **Total build** | **≈ 75 s** | **≈ 17 s** (+ ~2.5 min fetch once the parts are on the CID copy) |
| `v_property` | 441,961 rows, 40.6 MB | 441,961 rows, 45.5 MB |
| `v_roofing_permit` | 15,025 rows, 1.7 MB | 15,025 rows, 1.9 MB |
| `v_contractor` / `v_run` | 0 rows / 1 row | 4,139 rows (0.3 MB) / 1 row |
| Roof age known | 9,510 | 389,528 |
| Explore query on the index (summary + 200-row page + `toExploreRow`, 4 threads, 1 GB) | 68–188 ms | 67–182 ms |

Sample queries (Austin centre 30.2672,-97.7431, run 2 = warm): 5 mi no filter 101 ms (Run 2 total 72,341 / Run 3 92,834); 25 mi roof ≥ 15 151 ms (8,211 / 278,151); 10 mi open_or_stalled 129 ms (1,401 / 1,406); 25 mi roof_desc 184 ms (388,468 / 432,415). Today the same search is a 500 after 29 s.

Finding: `owner_area_class` is `unknown` for all 441,961 rows in **both** runs, so the out-of-area filter is always an honest empty (`field_not_published`/`not_in_export`). This is a data fact, not an index bug. The index must not hide it.

## 1. Execution shape and the external-dependency boundary

- **Shape:** one laptop script (operator step, like `publish-run.ts`). Not Step Functions or Glue: 160–190 objects, ~75 s, one run at a time. Distributed Map would only add cost and IaC. Glue is ruled out (no Python, and too small).
- **External call:** reads from our own CloudFront CID copy (`d2xsqoqv09bd0q.cloudfront.net/<cid>`), **synchronous and bounded**. It is an operator batch with no end user waiting, so no queue is needed. Throttle: 8 parallel requests. Retry with backoff (1, 2, 4 s; max 4 tries) on 429/5xx/network errors. 60 s timeout per request. Never use Filebase (it 429s after ~50 requests); a `--source local` flag reads the run's local parts instead (Run 3). Each part is accepted only when its sha256 equals the manifest's, and the manifest's raw CID is checked first. A mismatch is a hard stop and produces no partial index (fail-closed, like Task B's DLQ → hold).
- **Idempotency:** the S3 key is the manifest CID. The build is deterministic (the same parts give the same rows). Upload with `If-None-Match: *`; an existing index whose `index.json` matches is a no-op. `index.json` goes last, so a half upload is never visible (the reader looks for `index.json` only).
- **Recovery:** the part cache under `--work-dir` is keyed by CID, so a re-run fetches only missing parts. No DLQ is needed (single operator, exits non-zero with the failing part's name). Redrive = run the script again.
- **Cost gate:** about 0.36–0.78 GB of CloudFront egress per build (≈ $0.03–0.07, inside the free tier), 4 S3 PUTs, and ≈ 50 MB stored per run (≈ $0.001/month). The script prints the bytes to fetch and stops above a `--max-fetch-gb` (default 2).

## 2. What to port from Task B, and where it lands in Task A

Task A already has most of the plumbing in `pipeline/publish/scripts/` (`@duckdb/node-api 1.5.6-r.2`, the same version as `apps/api`, plus `@aws-sdk/client-s3` and query-core). Port the **pattern**, not the CRM schema.

| Task B source (`/Users/hebagaber/Github/roofing-crm/…`) | Port? | Task A destination |
| --- | --- | --- |
| `apps/sync/handlers/buildIndex.ts` `buildIndexFiles()`: bind with an explicit `partUrl` per artifact name (batched `bNN/` names), spill dir + memory limit, write Parquet | **Yes**, simplified: `COPY (SELECT * FROM v_*) TO … (FORMAT parquet)` directly. Drop the NDJSON + Zod round trip; the views are already the contract. | `pipeline/publish/src/explore-index.ts` (pure: plan, `indexDescriptor`, key naming; no DuckDB per AD-19) + `pipeline/publish/scripts/build-explore-index.ts` (DuckDB, CLI) |
| `mapPropertyRow`/`mapPermitRow`, `CRM_*_COLUMNS`, `@crm/index-schema` | **No.** That is Task B's own shape. Task A's frozen schema is its contract views (see 3). | — |
| `apps/sync/handlers/fetchPart.ts` (fetch + sha256 vs manifest, part cache) and `plan.ts` (manifest CID check, part list = `boundPartNames`) | **Yes** (logic only, no Lambda/Step Functions) | `pipeline/publish/scripts/build-explore-index.ts` (`fetchParts`), reusing `scripts/fetch-retry.ts`'s `withRetry` |
| `apps/sync/src/batchCoverage.ts` (`batchCoverage`, `manifestTableArtifactNames`): fail when a manifest batch is unbound or has 0 `county.property` rows | **Yes**, as a hard stop before upload | `pipeline/publish/src/explore-index.ts` |
| `apps/sync/test/buildIndex.batchCoverage.test.ts`, `plan.fullCounty.test.ts`, `fetchPart.test.ts`, `idempotency.test.ts` | **Yes**, adapted | `pipeline/publish/test/explore-index.test.ts` |
| `apps/api/src/adapters/duckDbParquet.ts` cold-load pattern (per-sandbox cache keyed by manifest CID, single in-flight load, cold-load timeout → typed error, per-query budget with `interrupt`) | **Yes** | `apps/api/src/engine/explore-index.ts` (new), called from `duckdb-node.ts` |
| Honest-empty outcomes (`empty_in_scope`, `field_not_published`) | **Already in Task A** (`packages/query-core/src/tools/functions.ts` `emptyReason`). No port. Add only an `index_not_built` reason (see 4). | — |

## 3. Index schema (frozen interface)

**Decision: the index is the materialized output of the four contract/v1 views. The columns are exactly those of `packages/query-core/views.sql`, in that order.** Then `exploreSearchSql`, `toExploreRow`, the six agent/MCP tool functions and `viewsReadBy` keep working byte for byte. No new SQL means no parity drift between Explore, the agent and MCP, and AD-19 holds. The freeze is enforced by a test: `DESCRIBE` of each index file equals `DESCRIBE` of the bound view on the fixture run.

- `v_property.parquet` (31 columns): property_cid, request_identifier, parcel_identifier, property_type, property_usage_type, property_structure_built_year, latitude, longitude, coordinate_source, roof_date, roof_age_years, roof_age_basis, roof_age_confidence, last_ownership_transfer_date, tenure_years, tenure_basis, is_long_tenure, owner_kind, owner_name, owner_area_class, owner_is_out_of_area, area_list_sha256, cid, source_url, captured_at, table, table_cid, run_id, manifest_cid, as_of, missing (LIST<STRUCT(field, reason)>). Sorted by `latitude, longitude, property_cid`, ROW_GROUP_SIZE 50,000, zstd. The latitude sort lets DuckDB skip row groups on the Explore bbox.
- `v_roofing_permit.parquet`: every column of the view (permit_cid, property_cid, status_class, open_days, issue/final dates, contractor_*, bbb_*, table_cid, missing, …), sorted by `property_cid, permit_cid`.
- `v_contractor.parquet`, `v_run.parquet`: the full views (small). `v_run` keeps coverage, sources and limitations, so `getCoverage` keeps working.
- One file per view, **no partitioning**: at 47 MB in total the Lambda downloads it whole. Partitioning would only add requests.
- **Size:** about 42–48 MB per run (Run 2: 42.3 MB; Run 3: 47.7 MB).
- **Provenance per row is already in the view:** `cid`, `table_cid`, `manifest_cid`, `run_id`, `as_of`, `source_url`, `captured_at`, `missing`.
- **`index.json` (written last), recording the source CIDs:**
  ```json
  { "schema": "countylens-explore-index.v1", "manifestCid": "bafk…", "runId": "…",
    "viewsSha256": "<sha256 of VIEWS_SQL>", "profileSha256": "<travis profile digest>",
    "builder": { "gitSha": "…", "duckdb": "1.5.6-r.2" }, "builtAt": "…",
    "files": { "v_property": { "key": "…/v_property.parquet", "sha256": "…", "bytes": 0, "rows": 441961 }, … },
    "sourceParts": [ { "name": "…/tables/b05/property/part-00000.parquet", "cid": "bafk…", "sha256": "…" } ],
    "batchCoverage": { … } }
  ```
  To check it: (1) `sourceParts` ⊆ the CID-verified manifest's artifacts, with identical cid/sha256; (2) `sourceParts` = `boundPartNames(manifest, 4 views)` exactly; (3) a `--verify` mode rebuilds and compares each view with `SELECT count(*) FROM (a EXCEPT ALL b) ∪ (b EXCEPT ALL a) = 0` and equal row counts. Use this, not the file sha256, because Parquet bytes can differ across DuckDB versions or threads. The index is **private derived data, never published or pinned**, so its own bytes have no CID (CLAUDE.md "publish only elephant-cli output").

## 4. Lambda read path

- **S3:** existing CID-copy bucket (name from config/CDK output, never hard-coded), prefix `private/explore-index/<manifestCid>/` (`index.json` + 4 Parquet). This is the same `private/` convention as `READPATH_PRIVATE_PREFIX`. The new env key is `EXPLORE_INDEX_PREFIX=private/explore-index/`.
- **IAM:** add `s3:GetObject` on `<bucket>/private/explore-index/*` to the API, MCP and agent roles (`infra/src/api-stack.ts`, `Data.grantApiRead`; update the cdk-nag suppressions and `infra/test/*.test.ts`). No ListBucket, Put or Delete. The laptop uploads with the `assess` profile; the upload is never a Lambda permission.
- **Engine change (one place):** in `apps/api/src/engine/duckdb-node.ts` `bind()`, read `index.json` first. When it exists, check `manifestCid` and `schema`, download the 4 files to `/tmp/countylens-index/<cid>/` (verify each sha256), then run `CREATE OR REPLACE VIEW v_property AS SELECT * FROM read_parquet('/tmp/…')` (same for the other 3) and return a `BoundRun` built from `index.json` plus the manifest. `bindOnce` and `lazyViewEngine` stay as they are, so **`explore.search`, `agent/tools.ts` and `mcp/tools.ts` need no change**. When there is no index: a small run (needed bytes ≤ 16 MB, e.g. `travis-202609-permits-…`) keeps today's `bindManifest` path. A large run returns a typed `index_not_built` error: Explore shows "Search index for this run is not built yet", the agent and MCP report it as a structured reason, and the request never tries the 29 s whole-county join again.
- **Sizing:** 48 MB in `/tmp` (default 512 MB ephemeral storage is enough). DuckDB `memory_limit` can drop from 2 GB to 512 MB–1 GB, and the Lambda from 3,008 MB to 1,769 MB (keep the CPU share). Put the timeouts back: API 15 s, MCP 15 s, agent 25 s (A-13 item 6).
- **Expected latency:** warm query ≈ 100–190 ms on the laptop, so ≈ 150–400 ms on Lambda with 2 vCPU (estimate). Cold start = in-region S3 GET of 48 MB (≈ 0.6–1.5 s) + init. **Explore p95 ≈ 0.5 s warm and ≈ 3 s on a cold sandbox (estimate).** Cold sandboxes can sit right at the 3 s line, so the cold-hit share must be measured. Mitigation if needed: prefetch at module init, which is free on the INIT phase of the first 10 s.

## 5. Run-agnostic (Run 3)

Confirmed. The same unchanged script built Run 3 from its manifest (190 parts, batched `bNN/` names). It found 389,528 known roof ages against Run 2's 9,510, and the same queries returned in 67–182 ms. Nothing in the script names a run. Inputs: `--manifest <path|cid>` and `--source cidcopy|local`. The profile digest guard in `bindManifest` rejects a run built with another profile. Run 3's parts are not yet on the CID copy (CloudFront 403), so until its publish finishes, build it with `--source local`, or after the `cid-copy` step.

## 6. Risks

1. **Read-path change needs an ADR-0001 amendment.** Private derived data serves what the user sees. Every row still carries the published `cid`/`table_cid`/`manifest_cid`, and `index.json` binds it to verified source CIDs. Record the amendment in the architecture constitution before the build.
2. **Stale or mismatched index:** the index is keyed by manifest CID and the reader checks `index.json.manifestCid` and `viewsSha256` against the API's `VIEWS_SQL`. A view-SQL change makes old indexes refuse (`index_stale`), so they must be rebuilt.
3. **The build depends on the CID copy holding every part.** The script stops on the first 403 and names the part. It never falls back to Filebase.
4. **Results changed against A-13's laptop number** (78,233 within 5 mi): the centres differ (gazetteer Austin point against 30.2672,-97.7431). Golden parity must compare the index against `bindManifest` on the **same** input, not old numbers.
5. **The out-of-area filter is always empty on Runs 2 and 3.** That is correct, but the demo must say why (`owner_area_class` unknown: no ZIP lookup in these runs).
6. **A-14 item 7 (permits with no property dropped by the inner join)** is inherited unchanged. Out of scope here; note it in the evidence.
7. **Cold-start p95 near 3 s:** measure 20 cold and 20 warm calls on the hosted URL.

## 7. Task list (2 builder groups, disjoint files)

**Group 1: pipeline builder (machamp / espeon), `pipeline/publish/**` only**
1. `pipeline/publish/src/explore-index.ts`: `INDEX_SCHEMA`, `indexKeys(prefix, cid)`, `IndexDescriptor` (Zod), `batchCoverage` port, `sourceParts` check. Pure code, no DuckDB.
2. `pipeline/publish/scripts/build-explore-index.ts`: CLI `--manifest --source cidcopy|local --work-dir --bucket --upload --verify --max-fetch-gb`. Flow: CID-check the manifest → `boundPartNames` → fetch (8 parallel, retry, sha256) → `bindManifest` → COPY 4 views → batch-coverage stop → `index.json` → upload with `If-None-Match`, `index.json` last.
3. `pipeline/publish/test/explore-index.test.ts`: fixture run → the schema of each file equals `DESCRIBE` of the bound view; an `EXCEPT ALL` parity of 0; a sha mismatch is a hard stop; an unbound batch is a hard stop; an existing index is a no-op.
4. Build and upload Run 2, then Run 3. Record the timings in `docs/evidence/A-16.md`.

**Group 2: API and infra builder (metagross), `apps/api/src/engine/**`, `apps/api/src/routers/explore.ts` (error mapping only), `infra/src/api-stack.ts`, `infra/test/**`**
1. `apps/api/src/engine/explore-index.ts`: read and verify `index.json`, download to `/tmp`, `CREATE VIEW` over `read_parquet`, single in-flight cold load, `index_not_built`/`index_stale` errors. Wire it into `duckdb-node.ts` `bind()`, and keep the small-run fallback.
2. Map `index_not_built` to a typed tRPC error, an agent tool error and an MCP `isError` with the reason. Lower `DUCKDB_MEMORY_LIMIT`.
3. CDK: `EXPLORE_INDEX_PREFIX` env, a GetObject grant on `private/explore-index/*` (3 roles), timeouts back to 15/15/25 s, memory 1,769 MB, a per-route throttle on `explore.search`, and a duration alarm (A-13 item 6).
4. Unit tests with a tiny local index fixture; infra assertion tests.

**Shared contract between the groups:** the `index.json` shape and the key layout in item 3 above. Freeze both in `specs/016-…/contracts/explore-index.md` before either group starts.

## 8. Verification (small sample first)

1. Local: build the fixture/small run (`travis-202609-permits-…`). The index and `bindManifest` give identical results for every Explore filter, the 6 MCP tools and 3 agent tools (row-set parity).
2. Local full: Run 2 parity on 5 Explore cases (done above for timing; add the `EXCEPT ALL` = 0 check).
3. Hosted on the branch preview: upload the Run 2 index, then run 20 cold and 20 warm `explore.search` calls. p95 must be under 3 s with no 5xx. Agent prompt D-8/D-9, and an MCP `search_properties` and `list_permits` on Run 2.
4. Un-park the A-13/A-14 `parkGap` cases, then run the full hosted Playwright suite.
