---
id: DATA-MODEL-A-04
type: data-model
parent: PLAN-A-04
created: 2026-10-21
---

# Data model: A-04 county backbone

Internal Query DB (local Postgres, `elephant` DB) plus on-disk artifacts. **Nothing here is public.** Public names are the frozen `contract/v1` names; table and column names below are fixed with `testplans/A-04-test-cases.md` v0.2 § 3.4 (the test cases read them with `qdb_ro`). Each migration has one owner group; later migrations may `ALTER` earlier tables (file-disjoint), never edit them.

## Closed value lists (internal; checked by `CHECK` constraints)

| Column | Values | Public mapping (contract/v1) |
| --- | --- | --- |
| `parcels.prop_type` | `R`, `P`, `MH`, `MN` | R emitted; others `out_of_scope`, not emitted |
| `roll_reconciliation.class` | `loaded`, `dead`, `invalid`, `transform_failure` (no `confidential` class) | — |
| `parcels.owner_redaction_rule` | `sales_confidential_code` | owner fields absent, reason `owner_confidential` |
| `parcels.owner_missing_reason` | `owner_confidential`, `no_dated_sale`, `no_owner_record`, `owner_unparsed` | same names (frozen list) |
| `parcels.year_built_rule` | `profile_main`, `largest_main_improvement`, `none` | — |
| `parcels.year_built_missing_reason` | `source_missing` | `source_missing` |
| `parcels.roof_age_basis` / `roof_age_reason` | `unknown` / `no_roof_date` (A-04 sets only the unknown case; A-07 derives the rest) | `unknown` / `no_roof_date` |
| `parcels.tenure_basis` / `tenure_missing_reason` | `sale_date`, `unknown` / `no_dated_sale` | same |
| `parcels.owner_area_class` | `in_county`, `regional`, `out_of_area`, `unknown` | public v1: `unknown`, reason `not_in_export` |
| `parcels.owner_area_evidence` | `travis_zcta`, `regional_zcta`, `us_zcta_outside`, `foreign_mailing`, `no_zip`, `zip_not_zcta` | — |
| `parcels.export_point_kind` | `real`, `placeholder`, `duplicate`, `outside_county` (definition recorded by T024) | — |
| `parcels.coordinate_source` | `gis_centroid`, `permit_point`, `none` | `permit_point` → public `none` (D-9) |
| `parcels.coordinate_rule` | `centroid`, `interior_point`, `centroid_outside_polygon`, `largest_area`, `export_point`, `condo_building_point`, `permit_point` | — |
| `parcels.coordinate_reason` | `no_gis_feature`, `gis_null_geometry`, `no_permit_point`, `non_land_account` (exactly one when no point) | `no_coordinates` (R); `out_of_scope` (non-R) |
| `parcels.coordinate_review_flag` | `permit_far_from_gis` or null | — |
| `property_improvements.link_method` | `tcad_id`, `address_hash` or null | — |
| `property_improvements.link_rule` | `geoid_unique_r`, `geoid_plus_address`, `address_sig_v1` | — |
| `property_improvements.stale_tcad_id` | boolean (0304): the printed `tcad_id` is on no R account and the link came from the address (`address_hash`/`address_sig_v1`) | — |
| `property_improvements.unmatched_reason` | `no_tcad_id`, `no_tcad_geoid`, `address_unmatched`, `ambiguous_geoid`, `ambiguous_address` | — |
| `property_improvements.status_class` | profile classes `open`, `stalled`, `closed`, `exclude`, `needs_review` | same |
| `property_improvements.open_days_reason` | `no_issue_date`, `not_open` | `needs_review`, `not_open` |
| `source_tombstones.reason` | `source_removed` | — |

## 0000_core.sql (G-FIX)

| Table | Columns (type) | Keys / rules |
| --- | --- | --- |
| `schema_migrations` | `name text`, `sha256 text`, `applied_at timestamptz` | PK `name`; a changed sha256 for an applied name fails `migrate` |
| `backbone_runs` | `job_id text`, `track text` (`appraisal`, `gis`, `permits`), `mode text` (`pilot`, `full`, `backfill`, `incremental`, `coords`), `status text` (`running`, `waiting_human`, `blocked`, `complete`, `failed`), `started_at`, `finished_at`, `as_of date` (= `finishedAt` date), `export_sha256`, `profile_sha256`, `gazetteer_sha256`, `code_sha text` | PK `job_id`; `job_id` matches `^travis-a04-[a-z0-9-]+$` |
| `capture_receipts` | `id bigserial`, `job_id`, `source_key text`, `url text`, `http_status int`, `bytes bigint`, `sha256 text`, `captured_at`, `outcome text` (`ok`, `blocked`, `error`, `skipped_checkpoint`), `attempts int`, `ua text`, `page_key text`, `blocked_at timestamptz` | index `(job_id, source_key)`; `blocked` ⇒ `blocked_at` not null |
| `watermarks` | `track text`, `source_key text`, `value jsonb` (`{prefix, mergedCount, lastMergedAt, hashIndex}` for TCAD; `{lastId, maxUpdatedAt, sourceCountAtW}` for Austin), `job_id`, `updated_at` | PK `(track, source_key)`; written by the Loader atomically with its merge |
| `source_tombstones` | `source_key`, `row_key text`, `permit_number text`, `reason`, `first_missing_at`, `evidence_sha256`, `job_id` | PK `(source_key, row_key)` |
| `source_limitations` | `job_id`, `source_key`, `code text`, `text text`, `count bigint`, `evidence_url text` | PK `(job_id, source_key, code)`; the run report lists them; A-11 copies them into the manifest |
| `loader_merges` | `track`, `artifact_path`, `artifact_sha256`, `job_id`, `rows_written bigint`, `merged_at` | PK `(track, artifact_sha256)`: a re-merge is a no-op |

## 0101_tcad.sql (G-TCAD)

**`parcels`** (one row per TCAD account, all 493,246): `request_identifier text` PK (`String(pID)` as printed, P0-5) · `job_id` · `geo_id text` (primary `propertyIdentification[].geoID`, leading zeros kept; empty for P → null) · `prop_type` · `state_cd`, `property_type`, `property_usage_type` (versioned code map; unmapped → null + `enum_lacks_value`) · `situs_address jsonb` (primary situs) · `owner_name text` (null when redacted) · `owner_kind` · `owner_missing_reason` · `owner_redacted bool` · `owner_redaction_rule` · `owner_mailing_postal_code`, `owner_mailing_country` (null when redacted) · `owner_area_class`, `owner_is_out_of_area bool`, `owner_area_evidence`, `area_list_sha256` · `property_structure_built_year int`, `year_built_rule`, `year_built_missing_reason` · `roof_age_basis`, `roof_age_reason` · `last_ownership_transfer_date date`, `tenure_years numeric`, `tenure_basis`, `tenure_missing_reason`, `is_long_tenure bool` · `export_point_lat`, `export_point_lon double precision`, `export_point_kind` · `county_emit bool` (`prop_type = 'R'`) · `source_url text` (TCAD export request URL), `captured_at`, `export_sha256`, `record_ordinal bigint`, `record_sha256 text` (original bytes), `payload_redacted jsonb`.
Rules: `owner_redacted` ⇒ `owner_name`, mailing columns null and `owner_missing_reason = owner_confidential`; `tenure_basis = unknown` ⇒ `is_long_tenure` null; upsert `ON CONFLICT (request_identifier) DO UPDATE … WHERE parcels.record_sha256 IS DISTINCT FROM excluded.record_sha256`.

**`parcel_geoids`**: `geo_id text`, `request_identifier`, `prop_type` · PK `(geo_id, request_identifier)` · many accounts per geoID (11,589 R share 1,164).

**`property_structures`** (improvements as children): `request_identifier`, `ordinal int`, `imprv_type text`, `is_main_residential bool`, `living_area numeric`, `actual_year_built int`, `effective_year_built int` · PK `(request_identifier, ordinal)`.

**`roll_reconciliation`**: `job_id`, `record_ordinal bigint`, `request_identifier text` (null when unparseable), `geo_id text`, `class`, `detail text` · PK `(job_id, record_ordinal)`. Invariant: seed count = `loaded` + `dead` + `invalid` + `transform_failure`; every `parcels` row of the job has a `loaded` row. `dead` records are also kept in `runs/<jobId>/dead.json`.

## 0201_gis.sql (G-GIS)

**`gis_pages`**: `job_id`, `page_key text` (= `objectIdsSha256`), `artifact_run_id text` (GitHub run id), `url text`, `sha256 text`, `captured_at`, `feature_count int` · PK `(artifact_run_id, page_key)`.

**`gis_features`**: `object_id bigint` PK, `artifact_run_id`, `page_key`, `pid_value text`, `geoid_value text`, `area double precision`, `point_lat`, `point_lon double precision`, `point_method` (`centroid`, `interior_point`, `centroid_outside_polygon`), `null_geometry bool`, `layer_last_edit_date timestamptz`.

**`ALTER TABLE parcels ADD`**: `latitude double precision`, `longitude double precision`, `coordinate_source`, `coordinate_rule`, `coordinate_reason`, `coordinate_review_flag`, `coordinate_source_url text`, `coordinate_captured_at timestamptz`, `coordinate_sha256 text`, `coordinate_job_id text`. Written only by the assembler (through the Loader `gis` track). Rule: `coordinate_source = none` ⇔ `latitude IS NULL` ⇔ `coordinate_reason IS NOT NULL`.

## 0301_permits.sql (G-PERMITS)

**`permit_source_rows`**: `source text` (`austin-3syk-w9eu`), `row_id text` (`:id`), `permit_number`, `page_sha256`, `row_index int`, `content_sha256`, `updated_at timestamptz` (`:updated_at`), `captured_at`, `job_id`, `payload jsonb` · PK `(source, row_id)`. Every source row kept; duplicates counted.

**`property_improvements`** (current row per permit): `source`, `permit_number`, `issuing_jurisdiction text` (`austin`) · PK `(permit_number, issuing_jurisdiction)` · `located_jurisdiction text` (source `jurisdiction` column, e.g. `LAKEWAY FULL PURPOSE`), `in_travis bool`, `source_row_id`, `tcad_id text`, `request_identifier text` (linked pID, null when unmatched), `link_method`, `link_rule`, `link_confidence numeric`, `unmatched_reason`, `reroof_match bool` (profile include terms matched), `status_raw`, `status_class`, `profile_sha256`, `issue_date date`, `expiry_date date`, `open_days int`, `open_days_reason`, `latitude`, `longitude` (source point, Query DB only), `coordinate_review_flag`, `payload_sha256` (page bytes digest pointer), `content_sha256`, `previous_content_sha256`, `updated_in_job text`, `source_url text`, `captured_at`, `tombstoned bool default false`. Upsert `ON CONFLICT (permit_number, issuing_jurisdiction) DO UPDATE … WHERE property_improvements.content_sha256 IS DISTINCT FROM excluded.content_sha256` (sets `previous_content_sha256`, `updated_in_job`). Contractor fields stay in `permit_source_rows.payload` only.

## On-disk artifacts (gitignored)

| Path | Written by | Content |
| --- | --- | --- |
| `pipeline/data/raw/tcad/<zip>` + `.summary.json` | A-01 / G-TCAD | export + `{sha256, size, mtime, inode}` |
| `pipeline/data/seeds/travis-a04-pilot.csv` | G-TCAD `pilot-select.ts` | 25 pIDs with the selection reason per row |
| `pipeline/data/runs/<jobId>/chunks/c<N>.ndjson.gz` | TcadChunk | redacted, mapped records (deleted after merge) |
| `pipeline/data/runs/<jobId>/groups/county/<pID>.zip` | `write-group.ts` | County group, R only |
| `pipeline/data/raw/gis/us-runner-<run>/{meta.json,count.json,ids.json,pages/<pageKey>.json,receipts.jsonl,checkpoints/,complete.json?}` | runner | IDs + geometry only |
| `pipeline/data/artifacts/permits/travis/<jobId>/{raw/pages/page-NNNNNN.json.gz,receipts.jsonl,status/}` | AustinPermits | raw keyset pages |

## State transitions

- `backbone_runs.status`: `running` → `complete` | `failed`; `running` → `waiting_human` (403 / SHA mismatch / blocked) → `running` after `resolve` | `failed`; GIS import: `running` → `blocked` when the artifact has no `complete.json` (`gis: blocked at {ts}; coverage not complete`).
- Permit: new → current (upsert by `(permit_number, issuing_jurisdiction)`) → `tombstoned` (`source_removed`), never deleted.
