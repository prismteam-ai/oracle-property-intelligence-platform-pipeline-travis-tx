---
id: RESEARCH-A-04
type: research
parent: PLAN-A-04
created: 2026-10-21
---

# Research: A-04 county backbone

Phase 0 of [plan.md](plan.md). The Technical Context has no open "NEEDS CLARIFICATION": Round 1 (run-log 22:22–22:33) and the Stage 0 export read (run-log 22:09) answered them. Each entry: Decision · Rationale · Alternatives considered.

## R-01 TCAD input: reuse the A-01 export, no new download

- **Decision:** Use `pipeline/data/raw/tcad/2026_20Certified_20JSON_20SUPP_200_2007182026.zip` (SHA-256 `6f7a7585…4c2346`). A one-time summary `{sha256, size, mtime, inode}` is stored beside it; the file is re-hashed only when the summary changes (CR2-10). A mismatch with `travis-sources.yaml` `parcel.export_receipt` stops the run. A download happens only after a stop, as one identified request; a 403 / timeout writes a `blocked` receipt and waits on a durable promise (`WAITING_HUMAN`).
- **Rationale:** NFR-002 "no new TCAD download without a stop"; spec clarification 2; re-hashing 3.5 GB each run costs minutes.
- **Alternatives:** fresh download each run (etiquette, time); trust mtime only (unsafe).

## R-02 Export stream, key inventory, strict schema

- **Decision:** Stream the JSON entry once (`zip-entry.ts` + A-03 record splitter + `stream-json`), parse each record with a strict Zod schema of the keys the Stage 0 read found; any unknown top-level or `owners[]` / `sales[]` key fails the run with its name. The inventory (key → count) is written to the run report.
- **Rationale:** A §25.025 flag under an unexpected key would otherwise pass unseen (oracle § 1); D-7 rests on "no marker exists".
- **Alternatives:** permissive parse (silent miss); regex `/^confid/i` only (misses other names).

## R-03 §25.025 handling (D-7)

- **Decision:** `redact.ts` runs immediately after the parse: if any `sales[].confidentialCode` is non-empty or any `sales[].confidentialSale` is truthy, owner names, mailing lines and sale-party names are removed; `owner_redacted = true`, `owner_redaction_rule = sales_confidential_code`, `owner_missing_reason = owner_confidential`. The account is loaded and counted (`roll_reconciliation.class = loaded`). Limitations: `Confidential owner records redacted (Texas Tax Code §25.025): {n}` and `source export carries no §25.025 marker; conservative suppression on sale-confidentiality codes`. `tcad-county.ts` keeps its suppression as a second guard.
- **Rationale:** PO D-7; P0-15; 15,410 R accounts carry codes (Q ×15,874, O ×6).
- **Alternatives:** legacy-layout flag (no legacy data on disk; a download would need a stop); no redaction (P0-15 risk).

## R-04 Year built, tenure, owner area

- **Decision:** Year built rule (`year_built_rule`): `profile_main` = `propertyProfile[0].imprvActualYearBuilt` when an integer 1800…year(as_of) (0 = missing); else `largest_main_improvement` = the residential main improvement with the largest living area in `valuations[].details["cost-local"].improvements[]`; never min / max / effective year; else null with `year_built_missing_reason = source_missing` and `roof_age_basis = unknown`, `roof_age_reason = no_roof_date`. Tenure from the latest dated `sales[].saleDt`; none → `tenure_basis = unknown`, `is_long_tenure = null`, `tenure_missing_reason = no_dated_sale`. Owner area via the gazetteer `ownerArea(addrZip)` (`travis-places@1.0.0`, `GAZETTEER_SHA256`): Travis ZCTA → `in_county`; regional list → `regional`; other US ZCTA → `out_of_area`; `addrCountry` non-US / `addrInternational` → `out_of_area` with `owner_area_evidence = foreign_mailing`; no ZIP or unknown ZIP → `unknown`. `area_list_sha256` stamped on every row.
- **Rationale:** oracle § 1; D-6 reuse (disagreement #14); AC-3/AC-4.
- **Alternatives:** new ZIP lists (two digests, AD-26); minimum year (biases roof age).

## R-05 Coordinates: rank and the condo rule (D-1)

- **Decision:** `assemble-coordinates.ts`, after permit linking, for every R account:
  1. GIS feature joined by exact-string pID (fallback geoID if the layer has no pID field) → `gis_centroid`, `coordinate_rule` = `centroid` | `interior_point` | `centroid_outside_polygon` (no interior point computable, review flag) | `largest_area` (several features: largest area, tie lowest OBJECTID; others counted in `multi_feature`).
  2. TCAD export point with `export_point_kind = real` → `gis_centroid`, `export_point`.
  3. `condo_building_point`: the account shares its geoID with other R accounts and **exactly one** point exists on that geoID (a GIS feature on the geoID, else one distinct real export point) → that point, `gis_centroid`, provenance = the building feature's page URL, time, digest. Several distinct candidate points → no point (reason `no_gis_feature`), never a neighbour's.
  4. `permit_point`: mode of the linked Austin permits' lat/lon at 6 decimals, tie → latest `issue_date`; Query DB only (`coordinate_source = permit_point`, `coordinate_source_url` = the permit's Socrata URL). If a GIS point exists and the permit point is > 0.5 mi away → keep GIS, `coordinate_review_flag = permit_far_from_gis` on the parcel and the permit.
  5. Else null with exactly one `coordinate_reason`: `gis_null_geometry` (feature exists, geometry null), `no_permit_point` (no feature and no permit point but a linked permit exists), `no_gis_feature` (otherwise).
  Non-R accounts: `coordinate_reason = non_land_account`, no point. A4/F4 are not assumed to be condos; the rule depends only on the shared geoID (disagreement #8).
- **Rationale:** D-1; the 99% depends on the condo rule, not GIS paging (oracle fact 3); never geocode. **Amended 2026-10-25 (PO decision, ADR 0004):** one narrow exception, an exact and unique match of the situs to the City of Austin public address-point layer may give a point (rule `address_point`, lowest priority, never over a GIS point); nothing else is ever turned into a point and no geocoding service is used.
- **Alternatives:** nearest neighbour (invents points); Austin `condominium` flag as identity (only a hint).

## R-06 Centroid vs interior point

- **Decision:** Area-weighted shoelace centroid over all rings (holes subtracted), point-in-polygon test; outside → polylabel on the largest outer ring (precision 1e-7°). Planar maths in EPSG:4326 (`outSR=4326`, `geometryPrecision=7`).
- **Rationale:** parcel scale; L/U-shaped lots (FR-020).
- **Alternatives:** server `returnCentroid` (not universally supported on MapServer; unprobed).

## R-07 GIS venue and mode (D-2)

- **Decision:** `.github/workflows/a04-gis-capture.yml`, `on.push` to `004-property-backbone` with `paths: [.github/workflows/a04-gis-capture.yml, pipeline/oracle-runtime/travis/gis/runner-config.json]`, `permissions: contents: read`, `concurrency: gis-pages`, `timeout-minutes: 90`, no secrets, egress `loc=` logged; `npm ci` then `tsx travis/gis/runner-fetch.ts`; artifact `out/` 7-day retention; `actions/cache` for checkpoints keyed on the snapshot sha. **Mode = `runner-config.json` `mode` (`pilot` | `full`)**; push 1 pilot (metadata `?f=json`, count, ids, 1 page), push 2 full; then `if: false`. Decision record `docs/decisions/DEC-A-04-gis-runner.md` before push 1.
- **Rationale:** `workflow_dispatch` inputs need the workflow on the default branch; the fork's `main` never gets it. Push + paths filter is what D-2 approved.
- **Alternatives:** `-f mode=` dispatch (not runnable from a story branch); laptop (never connects).

## R-08 Kit ArcGIS adapter seam

- **Decision:** Vendor `permits/adapters/arcgis-feature-service.mjs` and its imports unmodified; call `createArcgisFeatureServiceAdapter(jurisdiction, { client })` and `enumerateAll({ pageConcurrency: 2, loadPageCheckpoint, onPage })`, with config `bulkPageSize: 2000` (only if `maxRecordCount ≥ 2000`), `bulkConcurrency: 2`, `parcelField: null`, `fieldMap: { parcelIdentifier: <pID field> }`. The injected `geometry-client.ts` rewrites only `objectIds=` page queries (`returnGeometry=true`, `outSR=4326`, `geometryPrecision=7`, minimal `outFields`), sends every request through `source-client.ts` (UA, 1 s / 60 s / 5 / full jitter, StopOnBlocked) and writes raw body + receipt before returning. We ignore the adapter's `records` and read our raw pages; the kit's snapshot and drift refusal (`arcgis_source_drift`) stay. The seam use is noted in VENDORED.md.
- **Rationale:** disagreement #9; the kit `PermitHttpClient` (4 attempts, 8 s cap) is bypassed to meet NFR-002.
- **Alternatives:** edit the vendored file (breaks A1); own pager (reimplements the kit).

## R-09 Austin backfill mechanics

- **Decision:** New `socrata-pages.ts` beside A-03's per-permit `socrata.ts` (which stays for run-month): `$select=*,:id,:updated_at,:created_at` (`$select=:id,*` returns 400), `$order=:id`, `$where=:id > '<last>'`, `$limit=50000`, ≤ 1 request/s, no app token. `AustinPermits` workflow keyed `austin-3syk-w9eu-<mode>-<jobId>`: one `ctx.run` per page returning `{lastId, sha256, rows, maxUpdatedAt}`; raw page `raw/pages/page-NNNNNN.json.gz` (digest over decoded bytes) + `receipts.jsonl`; the Loader merges. Watermark count: `count(*)` before; after paging `W = max(:updated_at)`, `count(*) where :updated_at <= W`, total again; pass = captured rows with `:updated_at ≤ W` equal the source count at W; rows above W counted separately; start ≠ end totals → key-set diff.
- **Rationale:** per-permit GETs would take ~27 days at 1 req/s; journal replay gives AC-17 resume without skipping.
- **Alternatives:** reuse the spike pages as record (no `:updated_at`, spike UA; disagreement #10).

## R-10 Incremental, re-stamp, tombstones

- **Decision:** Content digest = SHA-256 of JCS of the row without `:`-prefixed fields, `:@computed_region_*`, `issued_in_last_30_days`, `day_issued`. Incremental window `:updated_at > watermark`; re-stamp if window ≥ 50% of total, or ≥ 90% of window rows within a 6 h span → page the whole set by `:id`, upsert only rows whose content digest changed, limitation `source bulk re-stamp; delta by content digest`. Key-set diff on every full page-through: `:id` and `permit_number` gone → `source_tombstones` row `reason = source_removed` and `tombstoned = true` on the permit (never deleted); same `permit_number` under a new `:id` → re-key, not a tombstone.
- **Rationale:** 2026-10-19 12:22–12:43 UTC re-stamp of every row; FR-016, FR-021.
- **Alternatives:** trust `:updated_at` (rewrites 2.38 M rows).

## R-11 Linking (AD-16) and classification

- **Decision:** `link_method` / `link_rule`: `tcad_id` = exactly one R geoID → `tcad_id` / `geoid_unique_r`; shared geoID → linked only if exactly one candidate's situs signature equals the permit's → `tcad_id` / `geoid_plus_address`, else unmatched `ambiguous_geoid`; `tcad_id` not a roll geoID → unmatched `no_tcad_geoid` (no address fallback, e.g. 1982-012866 BP); `tcad_id` null → address fallback over all R with the vendored `address:v1` signature, unique only → `address_hash` / `address_sig_v1`, else `address_unmatched` / `ambiguous_address`; `tcad_id` null and no usable address → `no_tcad_id`. `in_travis = false` when unmatched and `original_zip` not a Travis ZCTA (counted separately). Classification only through `profiles/travis-austin@1.0.0` (rules SHA-256 `c8fd15cf…dfa6` stamped); `open_days = as_of − issue_date` for open/stalled; no `issue_date` → null, `open_days_reason = no_issue_date` (public `needs_review`); other classes → `not_open`. `as_of` = run `finishedAt`.
- **Rationale:** spec FR-013/014/016; lead note 2026-10-21 (address hash only when `tcad_id` is null).
- **Alternatives:** fuzzy address matching (identity risk).

## R-12 Local coverage SQL (A2 kept)

- **Decision:** `write-group.ts` writes the County group for R accounts only (one `<pID>.zip` each); geometry only when `coordinate_source = gis_centroid`. The lead runs `elephant-cli validate → hash → validate CAR → export-tables --part-size 48m` locally (no upload); `coverage-report.ts` binds `packages/query-core/views.sql` to the local parts with `bindManifest({ partUrl })` in the DuckDB CLI and runs `SELECT avg((latitude IS NOT NULL)::int) FROM v_property`; the Query DB value is `avg((latitude IS NOT NULL)::int)` over `parcels WHERE prop_type = 'R'`. Difference = permit-point count.
- **Rationale:** story independent test; P0-1/P0-2.
- **Alternatives:** coverage from the Query DB only (not the public shape).

## R-13 Shared seams and single writer

- **Decision:** G-FIX first: `app.ts` auto-registers `services/workflows/*.ts`; `loader.ts` = `Loader` virtual object `travis` (single writer, plug-in `services/tracks/*.ts`, `inactivityTimeout` / `abortTimeout` raised for multi-minute COPYs, idempotency by `(track, artifact sha256)` in `loader_merges`); `migrate.ts` applies `migrations/*.sql` in name order inside a transaction and records them; `report.ts` = `BackboneReport` service combining `services/report-sections/*.ts`; CLI dispatcher loads `travis/backbone/commands/*.ts`.
- **Rationale:** disjoint files for the one parallel wave (oracle § 4); P0-10.
- **Alternatives:** each group edits `app.ts` (merge conflicts).

## R-14 Join proof ("R7")

- **Decision:** 1,000 Austin rows with a `tcad_id`, seeded sample (seed recorded): resolve geoID → pID via `parcel_geoids`, re-scan the export independently (A-03 `scanTcadSubset`) and check the record carries that geoID exactly; report matched / `no_tcad_geoid` / `ambiguous_geoid` with 0 disagreements. Reverse: 1,000 random R pIDs from the export each have a `parcels` row with an identical `request_identifier`. Output in `docs/evidence/A-04.md`.
- **Rationale:** disagreement #15 accepted (D-9).

## R-15 Disk and run order

- **Decision:** Guard: every step stops below 5 GiB free (`disk-guard.ts`). Order: pilots → push 1 (GIS pilot) → Austin backfill (background) → TCAD full (queued after the backfill) ‖ push 2 GIS full on the runner → GIS import → link + classify → assemble → County group → local validate/hash/export-tables (one 10k chunk measured first) → coverage SQL → incremental Austin run. Spike data deleted after the re-capture and the baseline diff (PO "Delete after re-capture").
- **Rationale:** oracle §§ 5–6; one ingest run at a time.
