---
id: ERR-19
type: defect
feature: FEAT-A03
story: A-03
test_case: A-03-TC-NF-04
ac_reference: A-03-AC-7
severity: High
status: Closed
found_by: hosted Playwright (TC-NF-04, hosted run 2)
found_date: 2026-10-21
fix_branch: 003-walking-skeleton
fix_commit: 9191b3cae0e87b9613a5278b78ad2337ab91c8c2
retest_date: 2026-10-21
closed_date: 2026-10-21
---

# ERR-19: API cold start – a cold `runs.summary` takes 5.3–6.3 s, above NFR-004's 3 s

## Brief description

TC-NF-04 forces a new Lambda sandbox and loads the hosted Runs page once. The cold `runs.summary` took 5.3–6.3 s (X-Ray `Init` 563–693 ms plus the `## index.handler` subsegment 4,701–5,637 ms). NFR-004 sets the limit for a cold start, DuckDB init included, at 3 s. Almost all of the handler time went to binding the views. The bind created a view over every emitted table (23 for the published run), and each view cost two sequential range requests over a presigned URL. The query that followed needs only 4 tables and ran in about 10 ms.

## Related requirement

- **Story:** A-03 · **AC:** A-03-AC-7 · **Requirement:** NFR-004 ("cold start incl. DuckDB init < 3 s") · **Test case:** A-03-TC-NF-04

## Environment

| Item                  | Value                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| URL                   | https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com/runs (→ `/api/runs.summary` → Lambda `countylens-api`, eu-north-1) |
| Build                 | `fbdb68b` (CountyLensApi as deployed for hosted run 2)                                                                        |
| Data snapshot         | manifest `bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i` (23 table parts, 1.2–78.5 KB each)                     |
| Browser / OS / device | Chromium (Playwright) · macOS; Lambda arm64, 3,008 MB, DuckDB 1.5.6 `threads = 4`, httpfs from the bundled directory          |
| Role                  | anonymous visitor (page); operator (`assess` profile) for the env-nonce cold start and the X-Ray reads                        |

## Preconditions and test data

- CountyLensApi deployed at `fbdb68b`; the Runs page shows the run above.
- The cold start is forced by the env-nonce method in `tests/e2e/lib/ops.ts` (`forceColdStart`), and the env is restored afterwards.

## Steps to reproduce

1. `RUNTIME_URL=https://003-walking-skeleton.d2lx0utip89u18.amplifyapp.com pnpm --filter @countylens/e2e e2e --grep TC-NF-04` (profile `assess`).
2. Read the cold trace: `aws xray batch-get-traces --trace-ids 1-6ad8e594-2137ace954e063076e0737a0 --region eu-north-1 --profile assess`.
3. On the `AWS::Lambda::Function` segment, add `Init` and `## index.handler`.

## Expected result

`Init` + handler (`Invocation` when Lambda emits it, else `## index.handler`) < 3,000 ms for the first request in a new sandbox (NFR-004, TC-NF-04).

## Actual result

| Trace                                         | Init   | `## index.handler` (all inside `duckdb.query`) | Cold start |
| --------------------------------------------- | ------ | ---------------------------------------------- | ---------- |
| `1-6ad8e594-2137ace954e063076e0737a0` (run 2) | 693 ms | 5,637 ms (`duckdb.query` 5,629 ms)             | 6,330 ms   |
| re-run (b4)                                   | 563 ms | 4,701 ms                                       | ≈ 5,264 ms |

The test also failed its "has an Invocation duration" check. The function segment has no `Invocation` subsegment, only `## index.handler`, `Overhead` and `Init`. The REPORT-log fallback found nothing, because the function's SystemLogLevel is WARN by design and so Lambda writes no `platform.report` line.

## Impact and severity

- **Impact:** the first visitor after a deploy or after idle waits about 6 s for the Runs page's "Server check" line. TC-NF-04 fails, and with it the G7 evidence for AC-7.
- **Severity:** High. The demo still answers, but a non-functional requirement has failed on the hosted runtime.

## Suggested investigation area

`apps/api/src/engine/duckdb-node.ts` (`bind`), `packages/query-core/src/bind-manifest.ts` (one view per emitted table), `tests/e2e/observability.spec.ts` (`lambdaPhases`, REPORT fallback).

## Root cause

**Product.** `bindManifest` ran `CREATE VIEW … AS SELECT * FROM read_parquet('<presigned URL>')` for every emitted table, one table at a time. DuckDB binds a view when it is created, so each statement made a HEAD and a footer GET before the next one could start. Eleven of the 23 tables (address, parcel, properties, …) are read by no view at all. `runs.summary` reads `v_roofing_permit` and `v_run`, which need 4 tables. The parts are tiny (≤ 78.5 KB), so the cost is round trips, not bytes.

Measured locally with `@duckdb/node-api` 1.5.6 + httpfs and the published parts (fetched read-only from the Filebase gateway; CID copy unchanged), served by a local HTTP server that adds a fixed latency per request:

| Bind                                            | Requests | 0 ms/request | 30 ms/request | 100 ms/request |
| ----------------------------------------------- | -------- | ------------ | ------------- | -------------- |
| Before: all 23 tables over URLs                 | 46       | 196 ms       | 1,836 ms      | 4,961 ms       |
| Views of `runs.summary` only, over URLs         | 6        | n/a          | n/a           | 867 ms         |
| Views of `runs.summary` only, local parts (fix) | 0        | 72 ms        | 72 ms         | 72 ms          |

Every view creation took 2 × the injected latency, plus about 4 ms. At about 100 ms per request (TLS setup + S3 first byte on a new sandbox), the model gives 4.96 s for the bind, which matches the hosted 4.7–5.6 s handler. The query itself made 0 requests in every case, because the footer read had already cached each part. `roofing_permit_rows` = 35 in every row of the table.

**Test.** `lambdaPhases` looked only for an `Invocation` subsegment. On this function, X-Ray reports the handler as the Powertools subsegment `## index.handler`. The REPORT-log fallback cannot work under SystemLogLevel WARN.

## Fix

- **Bind only what the query reads** (`packages/query-core/src/view-plan.ts`, new). views.sql is split at each `CREATE OR REPLACE VIEW`, and for each statement the plan records the `county.*` / `property_improvement.*` tables and the earlier views it reads, derived from the SQL itself. `viewsReadBy(sql)` names the contract views a builder reads. `tablesForViews` and the new `bindManifest(…, { views })` option (`bind-manifest.ts`) bind only those tables (emitted ones over their parts, absent ones as empty typed tables) and run only those view statements. The default (no `views`) still binds everything, so the browser path is unchanged. The four contract views are dropped at the start of every bind, so a subset bind never leaves a previous run's view behind. contract/v1 and views.sql are untouched.
- **Fetch small parts once, in parallel** (`apps/api/src/s3-read.ts` `localPart`, `apps/api/src/engine/duckdb-node.ts`). A needed part with codec `raw` and declared size ≤ 256 KiB (one raw-leaves chunk, `PREFETCH_MAX_PART_BYTES`) is fetched with one `GetObject` of `ipfs/<cid>`. Its bytes must hash to the CID (else INTERNAL_SERVER_ERROR and nothing is written). It is kept under `/tmp/countylens-parts/<cid>`, and DuckDB binds the local file. All fetches run in parallel. Larger parts keep the presigned range reads with the ERR-18 caches. The httpfs load from the bundled extension directory is unchanged.
- **Warm reuse.** `bindOnce(cid, views)` re-binds only for a new CID, after `BIND_TTL_MS`, or when a query needs a view outside the bound set. In that last case it re-binds the same run with the union of both view sets, and the manifest and parts come from `/tmp`. Binds and queries take turns on the one DuckDB connection, so a re-bind never drops a view under a query that is running (for example, in a tRPC batch). `runs.summary` passes `viewsReadBy(runSummarySql())`, and `query.radius` / `query.roofAge` pass their builders' views. `tablesBound` now counts the published tables behind the bound views (2 for the published run, which emits no contractor edges), no longer every emitted table.
- **Test** (`tests/e2e/lib/cold-start.ts`, new, used by `observability.spec.ts`). The cold start is read from X-Ray only. On the `AWS::Lambda::Function` segment it is `Init`/`Initialization` plus `Invocation` when present, else the Powertools `## index.handler` subsegment. The REPORT-log fallback is removed. The assertion stays at `cold start (Init + handler) < 3,000 ms`.

**Expected hosted cold start (estimate, not measured):** Init ≈ 0.6–0.7 s (unchanged), plus a handler of ≈ 0.4–0.7 s. The handler is the manifest GET (≈ 0.1–0.2 s with SDK setup), 3 part GETs in parallel (≈ 0.1 s), DuckDB open + `LOAD httpfs` (≈ 0.1–0.2 s), the local bind (72 ms on the laptop, ≈ 0.15 s on 2 vCPU) and the query (≈ 10 ms). That totals **≈ 1.0–1.4 s < 3 s**.

## Evidence

- [x] X-Ray trace `1-6ad8e594-2137ace954e063076e0737a0` (function segment: `## index.handler` 5,637 ms ⊃ `duckdb.query` 5,629 ms; `Init` 693 ms; no `Invocation`)
- [x] Hosted run 2 logs (TC-NF-04 failed twice: run 2 batch and the re-run)
- [x] Local profile: requests and timings per bind (table above). The published run gives identical rows from a full bind and a subset bind: `runSummarySql` (1 row), `listRoofingPermitsSql` (35 rows), `radiusSql` 25 mi (14 rows).
- [x] Red then green: `packages/query-core/test/view-plan.test.ts` (statement split, view and table sets, subset bind = full bind on real DuckDB, unread tables never passed to `partUrl`, stale views dropped). `apps/api/test/runs.test.ts`: only the needed parts are fetched, verified and bound from `/tmp` with no presigned URL; a part > 256 KiB stays presigned; a part with the wrong hash gives INTERNAL_SERVER_ERROR and is not cached; a later radius query re-binds with the union from `/tmp`. `tests/e2e/lib/cold-start.test.ts` uses the hosted trace shape.
- [x] Hosted re-run of TC-NF-04 after `cdk deploy CountyLensApi` (hosted run 3, build `86694cc`, 2026-10-21 16:52:18Z): **PASS**. Cold trace `1-6ad8eddd-11c91b3a6ff67e456052d4ea` (correlation ID `FmoawjXUAi0EKYg=`): `Init` 593 ms + `## index.handler` 1,932 ms = **2,525 ms** < 3,000 ms, read from X-Ray. Warm: response p50 212 / p95 243 / max 367 ms over 30 calls, all 200; `QueryDurationMs` p50 18.7 / p95 21.8 ms. Source: Playwright attachment `tc-nf-04-evidence.json`.

## Resolution

| Field      | Value                                                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root cause | The cold bind created one view per emitted table (23), two sequential range requests each over presigned URLs (≈ 46 round trips), for a query that reads 4 tables. The test read only `Invocation` and relied on a REPORT line that SystemLogLevel WARN never writes. |
| Fix        | Bind only the views the query reads; small parts fetched once, in parallel, CID-verified, bound from `/tmp`; union re-bind on the same run; X-Ray-only cold-start reading. Branch `003-walking-skeleton`. Commit: `9191b3c`                             |
| Re-test    | PASS, hosted run 3 (build `86694cc`), 2026-10-21: cold start 2,525 ms (`Init` 593 + `## index.handler` 1,932 ms), warm response p95 243 ms |
| Status     | ☒ Closed (2026-10-21) ☐ Reopened · Re-tested: PASS in hosted run 3 (build `86694cc`, 2026-10-21) |
