---
id: QUICKSTART-A-04
type: quickstart
parent: PLAN-A-04
created: 2026-10-21
---

# Quickstart: prove the A-04 backbone

A run guide, not code. Commands from the repo root on branch `004-property-backbone`; names from [contracts/cli.md](contracts/cli.md) and test plan § 3.3. Nothing here publishes anything; no command calls GIS from the laptop.

## Prerequisites

- `git rev-parse --abbrev-ref HEAD` → `004-property-backbone`; Node ≥ 22; `docker compose -f pipeline/local-stack/docker-compose.yml up -d` (Postgres + Restate); `npm --prefix pipeline/local-stack start` (services on :9080, registered with Restate); `restate` CLI; `gh` authenticated on the fork; `~/.local/share/elephant-cli-main/node_modules/.bin/elephant-cli` (44bb182); DuckDB CLI 1.5.6; ≥ 20 GiB free.
- `qdb_ro` helper from test plan § 3.3 defined in the shell.
- Migrations: `npm --prefix pipeline/local-stack run migrate` → applies `0000_core` … `0301_permits` once.

## 1. Unit and integration check (offline)

`(cd pipeline/oracle-runtime && npm test && npm run typecheck && npm run lint && npm run format:check)` and `(cd pipeline/local-stack && npm run typecheck && npm test)` → all green; every A-04 case is addressable as `npx vitest run test/travis/a04/<file> -t "A-04-TC-nnn"`.

## 2. Pilots

1. `npm --prefix pipeline/oracle-runtime run backbone -- pilot --select` → writes `pipeline/data/seeds/travis-a04-pilot.csv` (25 rows with reasons: `0223120506`, second anchor, P/MH/MN, coded-confidential, shared geoID, several improvements, no dated sale, no year built, out-of-area / regional / foreign mailing).
2. `npm --prefix pipeline/oracle-runtime run backbone -- pilot --seed pipeline/data/seeds/travis-a04-pilot.csv` → `job_id=…`; then `elephant-cli validate` on `pipeline/data/runs/<jobId>/groups/county` → exit 0; the transform coverage report lists every mapped field.
3. `npm --prefix pipeline/oracle-runtime run backbone -- permits --mode pilot` → one 50,000-row page captured, digested, loaded; then `permits --link`.
4. Check the seven pilot conditions (tasks T067); `backbone report --job <jobId> --json` shows no `blocked` or `waiting_human`.

## 3. GIS on the US runner

Set `"mode": "pilot"` in `pipeline/oracle-runtime/travis/gis/runner-config.json`, commit, push the branch → `gh run list --workflow a04-gis-capture.yml --branch 004-property-backbone` → `gh run download <id> -D pipeline/data/raw/gis/us-runner-<id>`; `egress.txt` reads `loc=US`. Then `"mode": "full"`, commit, push, download; `complete.json` present. Then the job gets `if: false`.

## 4. Full runs (one at a time)

1. `backbone -- permits --mode backfill` → report `permits.captured_at_watermark = source_total_at_watermark`.
2. `backbone -- ingest --track appraisal [--chunk-size 2000] [--window 3] [--batch-pause-ms 1000]` (ranges 100..20000, 1..8, 0..600000; the values shown are the SAFE DEFAULTS, about 360 MB of raw JSON in flight instead of 2.4 GB). Before each chunk the run pauses (durable sleep) and checks the Query DB (`select 1`, 5 s timeout); if it is down it WAITS 10 s, 20 s, 40 s, then 60 s at a time, up to 30 minutes, then fails with `health gate: Postgres/Docker unreachable for 30 min`. The poll prints `tcad: progress chunks=<done>/<total|?> started=<n> loaded=<n> rps=<records/s>` (counts and throughput only). Worker counts from the env file are capped at transform 6 / prepare 2 when the service starts (`TCAD_TRANSFORM_WORKERS=<1..8>` raises transform explicitly, never above 8; `TCAD_UNSAFE_CONCURRENCY=1` lifts the cap) → `monitoring-county-ingestion` reports complete; `qdb_ro "SELECT class, count(*) FROM roll_reconciliation WHERE job_id = '<jobId>' GROUP BY class"` → difference < 9,865, 0 unexplained.
3. `backbone -- coords --gis-artifact pipeline/data/raw/gis/us-runner-<id>`; `backbone -- permits --link`; `backbone -- coords --assemble-only`.
4. `backbone -- ingest --write-group --job <jobId>`; `elephant-cli validate` → `hash` → `validate` (CAR) → `export-tables --part-size 48m` into `pipeline/data/runs/<jobId>/tables/` (never uploaded).
5. `backbone -- coords --coverage --tables pipeline/data/runs/<jobId>/tables` → `coverage_public ≥ 0.99`, `coverage_qdb ≥ 0.99` over the 441,961 R accounts; difference = `permit_point`.
6. `backbone -- permits --mode incremental` → re-stamp verdict, rows written, tombstones.

### Confidential-name check in small slices

`scripts/verify-batched.sh <names-file>` (one string per line; the file and the names are never printed, and the SQL goes to psql on stdin). It runs through `docker exec … psql`, table by table, in heap-block ranges of at most 20,000 rows per call (`SLICE_ROWS`, default 20000) with a 2 s pause between slices (`PAUSE_SECONDS`), and prints only `table=… rows_scanned=… slices=… hits=…` plus `total_hits=`. Exit 0 = no hits, 1 = hits, 3 = Docker unreachable (it aborts cleanly and prints `START_TABLE=<table>` to resume from). Optional env: `PG_CONTAINER`, `PGUSER` (default `postgres`), `PGDATABASE` (default `elephant`).

## 5. Expected outcomes

| Check | Expected |
| --- | --- |
| Roll | loaded = N − dead − invalid; difference < 2% of N; 0 unexplained; confidential (15,410 R, re-measured) inside loaded |
| Coverage | ≥ 437,542 of 441,961 R both ways; non-land 51,285 with `non_land_account`; gap by reason sums to the rest |
| Austin | captured = source count at the watermark; ≥ 97% of reroof candidates linked; status split vs baseline; 1982-012866 BP `Suspended` / `open` / `no_tcad_geoid`, `open_days = as_of − 1982-06-23` |
| Jurisdictions | Austin captured with total + timestamp; 22 records-request rows in `limitations` with evidence URLs |
| Honesty | no confidential name in any output (TC-015 grep); no GIS request from the laptop (TC-NF-03); no Query DB export (TC-NF-02) |


## Real-Postgres integration test (throwaway database)

The unit tests use a fake `sql`; this test runs the TCAD, permits and GIS tracks plus migration
`0104_fix_double_encoded_json.sql` against a real server. It creates `a04_test_<random>`, applies
every migration through `services/migrate.ts`, asserts `jsonb_typeof(...) = 'object'` for
`parcels.situs_address`, `parcels.payload_redacted`, `permit_source_rows.payload` and every
watermark value, links an address-only permit to a synthetic parcel, and drops the database in
`finally`. It is skipped when `QDB_ADMIN_URL` is unset and never touches the `elephant` database.

```bash
cd pipeline/local-stack
QDB_ADMIN_URL='postgres://postgres:<password>@localhost:5432/postgres' \
  npx vitest run test/real-postgres.integration.test.ts
```

The role needs CREATEDB. The URL is read from the environment only and never printed.
After applying `0104` to the live database, check the result with
`SELECT jsonb_typeof(situs_address), count(*) FROM parcels GROUP BY 1;` (expect `object` and
`null` only).
