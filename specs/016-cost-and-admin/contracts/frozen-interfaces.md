# A-16 frozen interfaces (wave 1, 2026-10-26)

Every builder group codes against these names. Change one only by asking the main session.

| Interface | Value | Owner (writes) | Readers |
| --- | --- | --- | --- |
| `RunCommandV1`, `RUN_COMMAND_TTL_MS` (15 min) | `packages/contract/src/run-command.ts` | done (main) | G1 API, G3 bridge |
| `LiveRunV1`, `BRIDGE_STALE_MS` (3 min) | `packages/contract/src/live-run.ts` | done (main) | G1 API, G3 bridge, G2a Runs page (via API) |
| live status object | `s3://<CID-copy bucket>/live/live.json`, `Cache-Control: no-store` | G3 bridge | G1 API (`admin.runs.live`, response max-age 5) |
| Explore index | `s3://<CID-copy bucket>/private/explore-index/<manifestCid>/{v_property,v_roofing_permit,v_contractor,v_run}.parquet` + `index.json` (written last) | G4 | G4 reader in `apps/api/src/engine`; G1 grants GetObject |
| Index errors | `index_not_built`, `index_stale` | G4 | G2b (Explore error copy) |
| Env (web) | `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_USER_POOL_CLIENT_ID` | G1 (Amplify env in `web-stack.ts`) | G2a |
| Env (API Lambdas) | `COUNTYLENS_ADMIN_QUEUE_URL`, `COUNTYLENS_USER_POOL_ID`, `COUNTYLENS_USER_POOL_CLIENT_ID`, `EXPLORE_INDEX_PREFIX` (`private/explore-index/`), `LIVE_STATUS_KEY` (`live/live.json`) | G1 | G1 API, G4 reader |
| Env (tests) | `COUNTYLENS_TEST_USERNAME`, `COUNTYLENS_TEST_PASSWORD`, `COUNTYLENS_TEST_NONADMIN_USERNAME`, `COUNTYLENS_TEST_NONADMIN_PASSWORD` in `~/.config/assessment/countylens-test.env` (never committed) | operator | G2a e2e |
| Admin group | `admin` | G1 | G1, G2a |
| tRPC procedures | `admin.me` → `{ email, groups, isAdmin }`; `admin.run.start` `{ mode: "publish"|"dry_run" }` → `{ commandId, expiresAt }`; `admin.run.stop` `{ commandId? }`; `admin.run.retry` `{ targetRunId }`; `admin.runs.live` → `LiveRunV1 & { bridgeOnline: boolean, lastSent?: { commandId, expiresAt } }`; `admin.activity.summary` → `{ cachedAt, metrics: [{ id, label, value, unit, query, consoleUrl }] , perDay: [{ day, questions }] }` | G1 | G2a |
| Errors | 401 `UNAUTHORIZED` (missing/expired token), 403 `FORBIDDEN` (not admin), 409 `CONFLICT` "A run is already running" | G1 | G2a |
| Routes | `/admin/sign-in`, `/activity` (Runs admin controls live on the existing Runs route) | G2a | all |
| Cost/limits JSON | `apps/web/src/content/cost-limits.generated.json`: `{ cost: { asOf, source, rows: [{ component, idle, perUse, whoPays, missingReason }] , gross, credits }, limits: { asOf, rows: [{ source, throughput, pageSize, fullCapture, rateLimit, antiBot, optimisation, status, blockedDates, missingReason }] } }` | G2a | G2a |
| Throttle | `EXPLORE_SEARCH_THROTTLE = { rateLimit: 3, burstLimit: 6 }` in `infra/src/config.ts` | G1 | G1 |
| Queue | `infra/src/admin-queue.ts` exports `class AdminQueue extends Construct { queue; dlq; }` with props `{ alarmTopic: sns.ITopic }` | G3 | G1 instantiates in `api-stack.ts` |
