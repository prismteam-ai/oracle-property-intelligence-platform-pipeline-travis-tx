# Contract: tRPC `explore.search` (additive, query)

Input (Zod, all bounded):
- `area`: `{ place: string }` (gazetteer id) **or** `{ at: { lat: number (29.5..31.0), lon: number (-98.5..-97.0) } }`
- `radius_mi`: number 0.25..25
- `roof`: integer 0..120 (roof ≥ years), optional
- `permit`: `"open_or_stalled" | "open" | "stalled"`, optional; `openYrs`: number 0..60, optional
- `tenure`: integer 0..100 (tenure > years), optional; `ooa`: boolean, optional
- `sort`: `"nearest" | "open_desc" | "roof_desc"` (default `nearest`)
- `limit`: integer 1..1000 (default 200); `page`: integer ≥ 0

Each `ExploreRow.permit` carries `open_years` (one decimal, rounded down) and `open_days` (integer, the exact `open_days` of `v_roofing_permit`; the Permit chip puts it in `data-open-days`).

Output: `{ total_within_r, tenure_unknown, rows: ExploreRow[], close_matches: { row: ExploreRow, miles_outside: number }[], as_of: { runId, manifestCid }, engine: "server" }` — see [data-model.md](../data-model.md) ExploreResult.

Rules: SQL only from `packages/query-core` `exploreSearchSql`; bounding box then haversine (A-oracle § 9); no `LIKE '%ROOF%'` (P0-9); Powertools log line with `procedure = explore.search`, `queryDurationMs`, X-Ray subsegment `duckdb.query`. Errors map to `BAD_REQUEST` (input) or `INTERNAL_SERVER_ERROR` with a plain message, never a stack trace.

**As built (wave 1, 2026-10-21):** input also takes `manifestCid` (CIDv1, the run to bind, as `runs.summary` and `query.*` do); output also returns `area` (the resolved place or point) and `queryDurationMs`. The observability builder map names it `exploreSearchSql`.
