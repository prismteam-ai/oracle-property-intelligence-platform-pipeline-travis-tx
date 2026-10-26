---
id: CONTRACT-A-04-CLI
type: contract
parent: PLAN-A-04
created: 2026-10-21
---

# Contract: `backbone` CLI

`npm --prefix pipeline/oracle-runtime run backbone -- <verb> [flags]` → `tsx travis/backbone/cli.ts` (G-FIX). The dispatcher loads `travis/backbone/commands/<verb>.ts` (each exports a `BackboneCommand`, [seams.md](seams.md)); an unknown verb exits 64 with the list of verbs. Flags are parsed with Zod; a bad flag exits 64. The CLI talks only to the Restate ingress (`RESTATE_INGRESS_URL`, default `http://localhost:8080`), never to Postgres, and prints counts and paths only (never owner fields, payloads or connection strings).

| Verb (owner) | Flags | Starts / does | Last line |
| --- | --- | --- | --- |
| `pilot` (G-TCAD) | `--seed <csv>` (default `pipeline/data/seeds/travis-a04-pilot.csv`); `--select` writes the seed with `pilot-select.ts` instead of running | `TcadBackbone` with the seed's pIDs, then `write-group` for those pIDs, then prints the `elephant-cli validate` command to run | `job_id=travis-a04-pilot-<yyyymmddhhmm>` |
| `ingest` (G-TCAD) | `--track appraisal` (only value); `--write-group --job <jobId>` writes the County group (R only, `gis_centroid` geometry only) after `coords` instead of ingesting; `--join-proof --job <jobId> --seed <int>` runs the read-only 1,000-row geoID→pID proof + reverse instead (last line `join_proof=pass\|fail matched=<n> disagreements=<n>`); `--join-proof` and `--write-group` submit the long handler with Restate `/send` + an idempotency key and poll `…/<idempotency-key>/output`, so no single HTTP call outlives the client's 300 s timeout | `TcadBackbone` over the whole export (fan-out `TcadChunk`); refuses to start while another `backbone_runs` row is `running` | `job_id=travis-a04-<yyyymmddhhmm>` |
| `coords` (G-GIS) | `--gis-artifact <dir>` (required unless `--assemble-only` / `--coverage`); `--assemble-only` (skip import); `--coverage --tables <dir>` runs `coverage-report.ts` instead (DuckDB over the local `export-tables` parts + the Query DB count; last line `coverage_public=<p> coverage_qdb=<q> permit_point=<n>`) | `GisImport` (refuses "complete" without `complete.json`), then `assemble-coordinates` after permit linking | `job_id=travis-a04-coords-<…>` |
| `permits` (G-PERMITS) | `--mode backfill\|incremental\|pilot` (`pilot` = `maxPages 1`); `--link` (link + classify over the loaded rows) | `AustinPermits` workflow; `--link` runs link + classify through the Loader | `job_id=travis-a04-permits-<mode>-<…>` |
| `report` (G-FIX + sections) | `--job <jobId>` (required), `--json` | `BackboneReport/get` (read-only) | the JSON ([report.md](report.md)) or a text summary; with `--json`, stdout is only the JSON and the `job_id=<id>` line goes to stderr (pipe-safe); the text summary keeps `job_id=` last on stdout |

Exit codes: 0 ok · 2 `blocked` (a source refused, receipt written; never retried) · 3 `waiting_human` · 4 disk guard (< 5 GiB free) · 64 usage · 1 other error.

Only the five verbs of test plan § 3.3 exist (`pilot`, `ingest`, `coords`, `permits`, `report`); `--select`, `--write-group`, `--join-proof`, `--assemble-only`, `--coverage` and `--link` are extra flags on them.
