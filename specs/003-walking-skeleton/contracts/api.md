# API contract (A-03)

All procedures are tRPC v11 queries on the `trpc.ts` Lambda behind the HTTP API, reached same-origin as `GET /api/trpc/<procedure>?input=…` through the Amplify rewrite. Inputs are Zod-validated; procedures change additively only (ARD § 6). Every response carries headers `x-correlation-id` and `x-trace-id`.

## `runs.summary`

- **Input:** `{ manifestCid: CidV1 }`.
- **Behaviour:** GET `ipfs/<manifestCid>` from S3; reject unless `rawCid(bytes) === manifestCid`; parse `RunManifestV1`; bind the views (`bindManifest` with `partUrl` → presigned `ipfs/<cid>`); run `runSummarySql()`.
- **Output:** `{ manifestCid, verified: true, tablesBound: number, roofingPermitRows: number, queryDurationMs: number }`.
- **Errors:** `BAD_REQUEST` (not CIDv1), `NOT_FOUND` (not in the copy), `INTERNAL_SERVER_ERROR` (CID mismatch, logged). No route reads a non-`ipfs/` key: any other path under `/api/` → 404; a private key passed as `manifestCid` fails CIDv1 validation (400) and is never fetched.
- **Observability:** exactly one `logger.info` line with correlation ID and `queryDurationMs`; subsegment `duckdb.query` (annotations `manifestCid`, `query` = the builder name, not the SQL text); metrics `QueryDurationMs` (ms), `ItemsProcessed` (rows returned), `ItemsFailed` (failed queries, emitted as 0 on success) with dimension `procedure`. Log fields, annotations and metadata are identifiers and counts only (correlation ID, trace ID, `manifestCid`, `procedure`, durations, row counts): never row values, presigned URLs (`X-Amz-Signature`), env values or credentials (FR-007; T071 asserts it with a sentinel fixture).
- UI: Runs page "Server check" line; headline counts still come from the manifest (FR-009).

## `query.radius`

- **Input:** `{ manifestCid: CidV1, lat: number[-90,90], lon: number[-180,180], miles: number(0,25], limit: int[1,1000] = 500 }`.
- **Behaviour:** `radiusSql()` from `query-core` (bbox prefilter on lat/lon, haversine, `ORDER BY` distance) over `v_property` of the bound manifest.
- **Output:** `{ rows: RadiusRow[] (≤ 1,000, with provenance), queryDurationMs }`.

## `query.roofAge`

- **Input:** radius input + `{ minYears: int[1,100] }`.
- **Behaviour:** `roofAgeSql()` over `v_property.roof_age_years` within the radius; `as_of_date` = manifest `finishedAt` (never `now()`). Rows whose roof age is missing keep their `missing` reasons.
- **Output:** `{ rows, queryDurationMs }`.

In A-03 no page calls `query.radius` / `query.roofAge` (the Explorer is A-13); they exist so the fallback is deployed and measured. The published slice has no roof dates yet (estimator A-10), so `query.roofAge` returns rows with `no_roof_date` until then.

## Direct-invoke bench event (not an HTTP route)

- **Invocation:** `aws lambda invoke` / SDK `InvokeCommand` only (operator IAM). API Gateway events never carry `kind`.
- **Event:** `{ kind: "bench", query: "count" | "radius" | "roofAge", preset: "TC_NF_05" | "ADR_0001", prefix: string /^private\/bench\/[a-z0-9-]+\/$/ }` (Zod).
- **Behaviour:** list `*.parquet` under the prefix, presign, run `benchCountSql` / `benchRadiusSql` / `benchRoofAgeSql` (stand-ins with presets `TC_NF_05` and `ADR_0001`, `packages/query-core/src/bench-sql.ts`) with the same engine, threads and memory as the procedures.
- **Output:** `{ query, rows, queryDurationMs, initMs, coldStart }`; the same metric and log line as a procedure (`procedure = "bench.<query>"`).
