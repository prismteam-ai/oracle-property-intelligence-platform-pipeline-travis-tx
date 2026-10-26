---
id: ERR-18
type: defect
feature: FEAT-A03
story: A-03
test_case: A-03-TC-NF-05
ac_reference: A-03-AC-4
severity: High
status: Closed
found_by: TC-NF-05 hosted bench (scripts/bench-lambda.ts)
found_date: 2026-10-21
fix_branch: 003-walking-skeleton
fix_commit: a1fd50a6f644f9e1f8bc40f8021ddb63d87f390f
retest_date: 2026-10-21
closed_date: 2026-10-21
---

# ERR-18: Lambda read-path fallback – radius and roof-age p95 above 3 s over the full Austin Parquet

## Brief description

TC-NF-05 runs the API Lambda's DuckDB fallback over the full 2,380,939-row Austin 3syk-w9eu Parquet (export-tables `--part-size 48m`, 40 parts, one row group each) on a private prefix: 20 timed direct invocations per query after one untimed warm-up. Radius and roof-age p95 miss the NFR-001 target of 3,000 ms by a factor of about 2, and COUNT only just meets it. ADR-0001 § "Lambda fallback sizing" found DuckDB compute for these queries is at most 175 ms, so the time goes on fetching footers and column chunks over presigned S3 URLs.

## Related requirement

- **Story:** A-03 · **AC:** A-03-AC-4 · **Requirement:** FR-004, NFR-001 (ARD NFR-01) · **Test case:** A-03-TC-NF-05

## Environment

| Item                  | Value                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL                   | direct invoke of Lambda `countylens-api` (eu-north-1, profile `assess`); no public route                                                                         |
| Build                 | `36783c1` (CountyLensApi as deployed for the hosted run)                                                                                                         |
| Data snapshot         | Austin 3syk-w9eu capture of 2026-10-21, 2,380,939 rows, `export-tables --part-size 48m` (40 parts, 188 MB) under `private/bench/<name>/` (removed after the run) |
| Browser / OS / device | n/a (Lambda arm64, 1,769 MB, timeout 15 s, DuckDB 1.5.6 `threads = 2`, httpfs)                                                                                   |
| Role                  | operator (direct invoke)                                                                                                                                         |

## Preconditions and test data

- The 48m parts are uploaded under a `private/bench/<name>/` prefix of the CID-copy bucket.
- Presets (packages/query-core/src/bench-sql.ts): `TC_NF_05` = 30.2672, -97.7431, 1 mi, ≥ 15 years, LIMIT 500; `ADR_0001` = 30.447765, -97.602116, 5 mi, ≥ 15 years, LIMIT 500.

## Steps to reproduce

1. `npx tsx scripts/bench-lambda.ts --function-name countylens-api --prefix private/bench/<name>/ --profile assess` (1 warm-up + 20 timed invocations per query × preset).
2. Read p50 / p95 of `queryDurationMs` (the query only; engine init and view bind excluded).

## Expected result

p95 < 3,000 ms for count, radius and roof-age on both presets (NFR-001, TC-NF-05).

## Actual result

| Query   | p95 (TC_NF_05) | p95 (ADR_0001) |
| ------- | -------------- | -------------- |
| count   | 2,843 ms       | n/a            |
| radius  | 6,194 ms       | 6,493 ms       |
| roofAge | 4,988 ms       | 4,871 ms       |

## Impact and severity

- **Impact:** AC-4's read-path proof fails. Every radius or roof-age query the API serves over a table this size takes 5–6.5 s.
- **Severity:** High. The demo still answers, but TC-NF-05, and with it the G7 evidence for AC-4, fails.

## Suggested investigation area

`apps/api/src/handlers/bench.ts` (re-presigns and re-binds on every invocation), `apps/api/src/engine/duckdb-instance.ts` (no cache settings), `apps/api/src/s3-read.ts`, `infra/src/api-stack.ts` (sizing).

## Root cause

Three causes add up. Each was measured locally (method below).

1. **Every invocation started cold.** `runBench` presigned new URLs and re-bound the view each time, and DuckDB caches footers, HTTP metadata and fetched bytes by URL. Every warm invocation therefore paid a HEAD and a footer GET per part (80 requests for COUNT: that is the whole 2.8 s) and then fetched every column chunk again.
2. **The reads are bound by latency, not bandwidth.** DuckDB fetches the column chunks of a part one range GET at a time per thread. With 2 threads, at most 2 requests are in flight.
3. **The two-step query cannot help on this layout.** Each part is one row group in insertion order. The 500 nearest permits (radius) fall in 39 of the 40 parts, and the roof-age candidates in 40 of 40. So the second step still fetches every part's whole column chunk.

The ADR's 85.6 MB (radius) and ~38 MB (roof-age) were browser (WASM) figures. DuckDB node reads **38.3 MB in 280 requests** (radius) and **16.0 MB in 200 requests** (roof-age): only the projected columns' chunks (latitude 7.65 MB, longitude 7.63 MB, permit_number 9.04 MB, original_address1 12.5 MB, plus the small ones).

## Measurement method (laptop, 2026-10-21)

The private-prefix object had been deleted (`ListObjectsV2 private/` returned nothing), so no in-region measurement was possible. The local harness serves `pipeline/data/raw/austin-parquet/v48m` (the same 40 parts) from a local HTTP server with Range support. The server stands in for S3: it adds a 30 ms first-byte delay and 40 MB/s per request, and counts every request and byte. The bench SQL from `bench-sql.ts` runs through `@duckdb/node-api` 1.5.6 + httpfs. Without the cache lever, each run binds fresh URLs (as the deployed Lambda does). Times are **modelled**; the request and byte counts are exact. Against the hosted numbers the model reads low by 2.07× for COUNT, 1.18× for radius and 1.34× for roof-age, so in-region latency per request is higher than 30 ms. The in-region proof is the hosted re-run.

## Measured per lever

| Lever                                                                                         | count: requests / MB / p95 | radius: requests / MB / p95                       | roofAge: requests / MB / p95                     |
| --------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| Baseline (deployed: fresh URLs, no caches, 2 threads)                                         | 80 / 0.7 / 1,371 ms        | 280 / 38.3 / 5,227–5,244 ms                       | 200 / 16.0 / 3,607–3,718 ms                      |
| 1. Two-step SQL (bbox on lat/lon → `filename`, `file_row_number` → other columns), no latency | n/a                        | 317 / 38.8 (+37 requests, +0.5 MB), 301 vs 188 ms | 240 / 16.7 (+40 requests, +0.7 MB), 185 vs 99 ms |
| 2a. Stable URLs + HTTP and Parquet metadata caches, warm                                      | 0 / 0 / 1 ms               | 200 / 37.7 / 3,921–3,936 ms                       | 120 / 15.4 / 2,248–2,287 ms                      |
| 2b. 2a + external file cache, `NO_VALIDATION`, warm                                           | 0 / 0 / 1 ms               | 0 / 0 / 102–103 ms                                | 0 / 0 / 44–48 ms                                 |
| 2b, first touch in a sandbox (2 threads)                                                      | 78 / 0.6 / 1,357 ms        | 278 / 38.3 / 5,374 ms                             | 198 / 16.0 / 3,691 ms                            |
| 3. 2b + DuckDB threads 4, first touch                                                         | 78 / 0.6 / 682 ms          | 278 / 38.3 / 2,717 ms                             | 198 / 16.0 / 1,849 ms                            |
| 3. 2b + DuckDB threads 4, warm                                                                | 0 / 0 / 2 ms               | 0 / 0 / 66 ms                                     | 0 / 0 / 22 ms                                    |

Lever 1 reads more bytes and makes more requests, so it is **not adopted** and no code for it was kept (the roof-age count matched the one-step query, 36,884; the radius rows were not compared row by row). ADR-0001 names it as "the next lever"; that advice holds only for a layout with several row groups per part, sorted by location, which AD-01's insertion order rules out.

## Fix

- **Lever 2 (adopted):** `openDuckDb({ cacheRemoteReads: true })` turns on `enable_http_metadata_cache`, `parquet_metadata_cache`, `enable_external_file_cache` and `validate_external_file_cache = 'NO_VALIDATION'` (apps/api/src/engine/duckdb-instance.ts, used by duckdb-node.ts). The bytes are immutable: `ipfs/<cid>` is content-addressed, and a bench part gets a new URL, and so a new cache key, when its ETag changes. `presignPrefix` reuses a part's presigned URL while its ETag is unchanged, for up to `PRESIGN_REUSE_MS` = 30 min (half the URL lifetime; apps/api/src/s3-read.ts). `runBench` re-binds the view only when the URLs change or the engine was re-opened, and otherwise reports `bindMs: 0` (apps/api/src/handlers/bench.ts). The production path already binds once per manifest CID for `BIND_TTL_MS`, so it gains the same caches. No /tmp part cache was added: the in-memory file cache already covers warm sandboxes (188 MB inside DuckDB's 1 GB cap), so ephemeral storage stays at 512 MB.
- **Lever 3 (adopted, because lever 2 leaves a sandbox's first query at the old cost):** Lambda memory goes from 1,769 MB to 3,008 MB (2 vCPU, more network) and `DUCKDB_THREADS` from 2 to 4 (infra/src/api-stack.ts `API_MEMORY_MB`, infra/test/api.test.ts, apps/api/src/engine/duckdb-node.ts). This adds per-invocation cost only: about 1.7× the GB-seconds per request, still no reserved or provisioned concurrency, and $0 idle.
- **AM-06 sizing update for the PO (ARD not edited):** AM-06 and ADR-0001 say "arm64, 1,769 MB, 15 s, DuckDB threads 2". The build now uses **arm64, 3,008 MB, 15 s, DuckDB threads 4**, with remote-read caching on. The PO decides whether to amend AM-06.

**Projection for the hosted re-run (not measured):** warm p95 (what TC-NF-05 times after its warm-up) is about 0.1 s for every query. A sandbox's first query, scaled by the hosted-to-model factors, comes to about 1.4 s (count), 3.2 s (radius) and 2.5 s (roof-age) at 4 threads. **The first radius in a new sandbox may still be ≥ 3 s.** If the re-run confirms that, the next options are more threads (the reads are bound by latency, not CPU), or warming the lat/lon chunks when a manifest is bound. The re-run should also record the warm-up invocation's `queryDurationMs` as the first-touch figure; `bench-lambda.ts` currently discards it.

## Evidence

- [x] Hosted TC-NF-05 numbers (above), 20 invocations per query × preset
- [x] Local lever harness: request and byte counts and modelled times per lever (table above)
- [x] Red then green: `apps/api/test/duckdb-node.test.ts` (ERR-18 cache settings; repeated query over the same URL makes 0 HTTP requests on a real local server; `DUCKDB_THREADS` = 4), `apps/api/test/runs.test.ts` (URL reuse per ETag and TTL; engine opened with `cacheRemoteReads`), `apps/api/test/bench.test.ts` (view kept while URLs unchanged; re-bind on change or re-open), `infra/test/api.test.ts` (MemorySize 3008)
- [x] Hosted re-run of TC-NF-05 after `cdk deploy CountyLensApi`: PASS in hosted run 2 (build `fbdb68b`)

## Resolution

| Field      | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root cause | Per-invocation re-presign and re-bind threw away DuckDB's footer and chunk caches (keyed by URL). Cold reads are bound by request latency with 2 threads. The two-step query cannot skip chunks on one-row-group parts.                                                                                                                                                                                                                                                                                                                                                   |
| Fix        | Remote-read caching with stable presigned URLs (lever 2), and 3,008 MB with DuckDB threads 4 (lever 3), on `003-walking-skeleton`. Commit: _(filled after commit)_                                                                                                                                                                                                                                                                                                                                                                                                        |
| Re-test    | TC-NF-05 PASS in hosted run 2 (Lambda 3,008 MB, DuckDB threads 4, build `fbdb68b`; 40 parts, 2,380,939 rows; 2026-10-21 16:15:31Z–16:17:04Z), queryDurationMs p50 / p95 over 20 warm runs, with the first query in a fresh sandbox: TC_NF_05 count 3 / 5 ms (first 6), radius 189 / 200 ms (first 2,818), roofAge 85 / 95 ms (first 82); ADR_0001 radius 191 / 200 ms (first 186), roofAge 85 / 93 ms (first 80). The bench copy was refused publicly (CloudFront 403, API 400 / 404), the prefix was emptied (40 keys HEAD 404 at 16:17:14Z) and the Lambda env restored |
| Status     | ☒ Closed (2026-10-21) ☐ Reopened · Re-tested: PASS in hosted run 2 (build `fbdb68b`, 2026-10-21) |
