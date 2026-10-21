-- packages/query/schema.sql
-- THE interface between packages/deploy-build (writes) and packages/query + apps/api (read).
-- DuckDB 1.5.6. Every column's source and reader is documented in SCHEMA.md; keep both in step.
-- Conventions:
--   * JSON values are stored as VARCHAR holding JSON text (no json extension needed at query time).
--   * Dates are DATE where the source is date-only; timestamps are VARCHAR ISO-8601 as captured.
--   * "as printed" text is stored unmodified; *_norm columns hold the normalized form used for matching.
--   * Query-time values (open_duration_days, days_since_expiry, owner_tenure_years, long-open) are NOT stored;
--     SCHEMA.md gives the formulas over the static columns below.
--   * Run order: this file, bulk loads, then post_load.sql (indexes, FTS, CHECKPOINT).

CREATE SCHEMA IF NOT EXISTS lex;

-- ---------------------------------------------------------------------------------------------------
-- 1. Deploy and run metadata  (GET /v1/meta, /v1/runs, /v1/runs/{id}/manifest)
-- ---------------------------------------------------------------------------------------------------

-- Exactly one row. Mirrors data/deploy/<deploy_id>/deploy.json plus the pinned configuration.
CREATE TABLE deploy (
  deploy_id            VARCHAR NOT NULL PRIMARY KEY,   -- derived from inputs_sha256
  inputs_sha256        VARCHAR NOT NULL,
  deployed_at          VARCHAR NOT NULL,               -- build time, ISO-8601 UTC
  server_commit        VARCHAR NOT NULL,               -- git commit of this repository at build
  duckdb_version       VARCHAR NOT NULL,               -- '1.5.6'
  duckdb_sha256        VARCHAR,                        -- informational; filled by deploy.json after CHECKPOINT (may be NULL inside the file)
  run_id               VARCHAR NOT NULL,               -- the served run, e.g. 20261018T143520Z-t5-full
  manifest_cid         VARCHAR NOT NULL,               -- runs/<run_id>.publication.json manifest.cid
  cli_commit           VARCHAR NOT NULL,
  lexicon_manifest_url VARCHAR NOT NULL,
  kit_commit           VARCHAR NOT NULL,
  county               VARCHAR NOT NULL,               -- 'Travis County, TX'
  fips                 VARCHAR NOT NULL,               -- '48453'
  attribution_key_version   VARCHAR NOT NULL,          -- 'travis-attribution-key.v1'
  work_classifier_version   VARCHAR NOT NULL,          -- the Travis permit profile version
  roof_age_as_of       DATE NOT NULL,                  -- estimator as-of (roof_age_years = year(as_of) - roof_year)
  text_index_rows      BIGINT NOT NULL,
  text_index_stemmer   VARCHAR NOT NULL,               -- 'porter'
  text_index_stopwords VARCHAR NOT NULL,               -- 'english'
  text_index_ignore    VARCHAR NOT NULL,               -- regex keeping digits
  text_index_lower     BOOLEAN NOT NULL,
  text_index_strip_accents BOOLEAN NOT NULL,
  text_index_alias_version VARCHAR NOT NULL,
  bbb_status           VARCHAR NOT NULL,               -- 'blocked' while source access is blocked
  bbb_incomplete_reason VARCHAR,                       -- 'http_403_source_block'
  bbb_note             VARCHAR,
  matcher_versions     VARCHAR NOT NULL,               -- JSON {source_key: matcher_version}
  area_bounds          VARCHAR                         -- JSON {min_lat,max_lat,min_lon,max_lon} of loaded parcels (area_note box)
);

-- One row per export read (deploy.reads[]): permits, TCAD, and every business/licensing source.
CREATE TABLE deploy_reads (
  dataset      VARCHAR NOT NULL PRIMARY KEY,
  url          VARCHAR NOT NULL,
  fetched_at   VARCHAR NOT NULL,
  sha256       VARCHAR NOT NULL,
  rows         BIGINT NOT NULL,
  matched      BIGINT NOT NULL,
  unavailable  BIGINT NOT NULL,
  conflicting  BIGINT NOT NULL
);

-- Pre-aggregated scalar counts for /v1/meta.counts (key = the counts field name) and the evidence/unlinked maps
-- (key 'evidence_states.completed_date.confirmed_present', 'unlinked_reasons.no_candidate', ...).
CREATE TABLE meta_counts (
  name   VARCHAR NOT NULL PRIMARY KEY,
  value  BIGINT NOT NULL
);

-- /v1/meta.counts.by_source (one row per loaded business/licensing source).
CREATE TABLE source_loads (
  source_key                   VARCHAR NOT NULL PRIMARY KEY,   -- e.g. tx-comptroller-franchise-tax
  kind                         VARCHAR NOT NULL,               -- 'business' | 'license'
  dataset                      VARCHAR NOT NULL,
  rows_loaded                  BIGINT NOT NULL,
  in_scope_rows                BIGINT NOT NULL,
  out_of_county_candidate_rows BIGINT NOT NULL,
  withheld_record_ids          BIGINT NOT NULL,
  candidates                   BIGINT NOT NULL,
  fetched_at                   VARCHAR NOT NULL,
  matcher_version              VARCHAR NOT NULL
);

-- Limitations (/v1/meta.limitations, chat limitations). scope 'run' = from the run record; 'deploy' = added at build
-- (needs_review values, out_of_county permits, BBB block).
CREATE TABLE limitations (
  seq                  INTEGER NOT NULL PRIMARY KEY,
  scope                VARCHAR NOT NULL,
  source               VARCHAR NOT NULL,
  availability         VARCHAR NOT NULL,               -- unsupported | supported_partial | supported_full
  source_access_status VARCHAR NOT NULL,
  incomplete_reason    VARCHAR,
  detail               VARCHAR NOT NULL,
  evidence             VARCHAR,
  records_request      VARCHAR                         -- JSON or NULL
);

-- Distinct status/work-class values outside the profile mapping (listed under limitations; needs_review counts).
CREATE TABLE unmapped_values (
  kind   VARCHAR NOT NULL,                             -- 'status_current' | 'work_class' | 'permit_class'
  value  VARCHAR NOT NULL,
  n      BIGINT NOT NULL,
  PRIMARY KEY (kind, value)
);

-- Every run that ever published (GET /v1/runs, newest first by run_id). record_json is the verbatim runs/<id>.json.
CREATE TABLE runs (
  run_id        VARCHAR NOT NULL PRIMARY KEY,
  started_at    VARCHAR NOT NULL,
  finished_at   VARCHAR NOT NULL,
  manifest_cid  VARCHAR,
  record_json   VARCHAR NOT NULL
);

-- Pinned manifest bytes (GET /v1/runs/{run_id}/manifest): served unchanged.
CREATE TABLE manifests (
  run_id        VARCHAR NOT NULL PRIMARY KEY,
  manifest_cid  VARCHAR,
  size          BIGINT NOT NULL,
  sha256        VARCHAR NOT NULL,
  bytes         BLOB NOT NULL
);

-- Archive/schema/tables root per published group per shard. Every served row carries (group, shard).
CREATE TABLE group_roots (
  group_name    VARCHAR NOT NULL,                      -- 'county' | 'property_improvement'
  shard         VARCHAR NOT NULL,                      -- 's0001'
  archive_cid   VARCHAR NOT NULL,                      -- archive root (Run.cars[kind=archive].root_cid)
  schema_cid    VARCHAR NOT NULL,
  tables_cid    VARCHAR NOT NULL,                      -- CountyTables root; mirror key prefix tables/<tables_cid>/
  properties    BIGINT NOT NULL,
  PRIMARY KEY (group_name, shard)
);

-- Mirror objects (one per Parquet part) with the manifest's size and SHA-256; S3 key = 'tables/' || tables_cid || '/' || rel_path.
CREATE TABLE mirror_objects (
  tables_cid   VARCHAR NOT NULL,
  rel_path     VARCHAR NOT NULL,                       -- e.g. address/part-00000.parquet
  group_name   VARCHAR NOT NULL,
  shard        VARCHAR NOT NULL,
  table_name   VARCHAR NOT NULL,
  size         BIGINT NOT NULL,
  sha256       VARCHAR NOT NULL,
  object_cid   VARCHAR NOT NULL,
  PRIMARY KEY (tables_cid, rel_path)
);

-- ---------------------------------------------------------------------------------------------------
-- 2. Properties  (PropertySummary / PropertyDetail / Owner)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE properties (
  property_id        VARCHAR NOT NULL PRIMARY KEY,     -- TCAD PROP_ID as printed (lex county_parcel.parcel_identifier)
  geo_id             VARCHAR,                          -- TCAD geo_id as printed (seed source_geo_id)
  shard              VARCHAR NOT NULL,
  record_cid         VARCHAR NOT NULL,                 -- lex.county_property.cid
  property_cid       VARCHAR NOT NULL,
  data_group_cid     VARCHAR NOT NULL,                 -- county group root for this property
  request_identifier VARCHAR NOT NULL,
  source_http_request VARCHAR NOT NULL,                -- JSON {method,url,multiValueQueryString}, from lex.county_property.source_http_request
  source_dataset     VARCHAR NOT NULL,                 -- 'tcad-2026-certified-appraisal-export'
  source_url         VARCHAR NOT NULL,
  source_fetched_at  VARCHAR NOT NULL,
  source_run_id      VARCHAR NOT NULL,
  -- situs
  situs_line1        VARCHAR,                          -- 'num [prefix] street [suffix] [unit]' from seed source_situs_*
  situs_city         VARCHAR,                          -- seed source_situs_city (NULL on ~half of parcels)
  situs_zip          VARCHAR,
  situs_city_norm    VARCHAR,
  situs_norm         VARCHAR,                          -- normalized situs line1|zip used for owner_absentee
  -- coordinates
  lat                DOUBLE,
  lon                DOUBLE,
  coordinate_basis   VARCHAR CHECK (coordinate_basis IN ('parcel_centroid','permit')),
  year_built         INTEGER,                          -- lex.county_property.property_structure_built_year
  -- roof age (estimator elephant.roof-age-estimate.v1, as of roof_age_as_of)
  roof_year          INTEGER,
  roof_age_years     INTEGER,
  roof_age_basis     VARCHAR CHECK (roof_age_basis IN ('completed_replacement','new_construction','year_built')),
  roof_age_confidence VARCHAR NOT NULL CHECK (roof_age_confidence IN ('high','medium','low','none')),
  roof_age_anchor_permit_id   VARCHAR,
  roof_age_anchor_date        DATE,
  roof_age_anchor_date_field  VARCHAR,
  roof_age_anchor_year_built  BOOLEAN NOT NULL DEFAULT FALSE,   -- true => anchor is {source_field:'year_built'}
  roof_age_as_of     DATE NOT NULL,
  roof_age_caveats   VARCHAR[] NOT NULL,
  -- roofing permit signals (static; durations are query-time)
  last_roofing_permit_id    VARCHAR,
  last_roofing_permit_date  DATE,
  last_roofing_permit_status_group VARCHAR,
  last_roofing_permit_class VARCHAR,
  roofing_open_count        INTEGER NOT NULL DEFAULT 0,
  roofing_stalled_count     INTEGER NOT NULL DEFAULT 0,
  roofing_closed_count      INTEGER NOT NULL DEFAULT 0,
  roofing_needs_review_count INTEGER NOT NULL DEFAULT 0,
  open_roofing_min_open_since DATE,                    -- earliest open_since among open roofing permits; open duration = as_of - this
  stalled_roofing_max_duration_days INTEGER,           -- max stalled duration (expires_date|statusdate - open_since) among stalled roofing permits
  -- the same four signals per roofing class (search_properties roof_work_class combines the requested classes)
  roofing_open_count__primary_roof_replacement      INTEGER NOT NULL DEFAULT 0,
  roofing_stalled_count__primary_roof_replacement   INTEGER NOT NULL DEFAULT 0,
  open_roofing_min_open_since__primary_roof_replacement DATE,
  stalled_roofing_max_duration_days__primary_roof_replacement INTEGER,
  roofing_open_count__primary_roof_new_construction      INTEGER NOT NULL DEFAULT 0,
  roofing_stalled_count__primary_roof_new_construction   INTEGER NOT NULL DEFAULT 0,
  open_roofing_min_open_since__primary_roof_new_construction DATE,
  stalled_roofing_max_duration_days__primary_roof_new_construction INTEGER,
  roofing_open_count__repair_or_coating      INTEGER NOT NULL DEFAULT 0,
  roofing_stalled_count__repair_or_coating   INTEGER NOT NULL DEFAULT 0,
  open_roofing_min_open_since__repair_or_coating DATE,
  stalled_roofing_max_duration_days__repair_or_coating INTEGER,
  roofing_open_count__accessory_roof      INTEGER NOT NULL DEFAULT 0,
  roofing_stalled_count__accessory_roof   INTEGER NOT NULL DEFAULT 0,
  open_roofing_min_open_since__accessory_roof DATE,
  stalled_roofing_max_duration_days__accessory_roof INTEGER,
  permit_count       INTEGER NOT NULL DEFAULT 0,       -- all served permits of the property
  has_bbb_contractor BOOLEAN NOT NULL DEFAULT FALSE,
  -- owner (public roll fields); NULL when owner_confidential
  owner_confidential BOOLEAN NOT NULL DEFAULT FALSE,
  owner_name         VARCHAR,                          -- seed source_py_owner_name as printed
  mailing_line1      VARCHAR,
  mailing_line2      VARCHAR,                          -- source_py_addr_line2 and line3, space-joined
  mailing_city       VARCHAR,
  mailing_state      VARCHAR,
  mailing_zip        VARCHAR,
  mailing_norm       VARCHAR,
  deed_date          DATE,                             -- seed source_deed_dt (MM-DD-YYYY); NULL when blank
  owner_absentee     BOOLEAN,
  owner_out_of_area  BOOLEAN,
  -- unpublished_source of the TCAD row (backs geo_id, owner fields)
  tcad_dataset       VARCHAR NOT NULL,                 -- same as source_dataset
  tcad_url           VARCHAR NOT NULL,
  tcad_fetched_at    VARCHAR NOT NULL,
  tcad_source_http_request VARCHAR NOT NULL,           -- JSON
  tcad_row_sha256    VARCHAR NOT NULL,
  tcad_evidence_state VARCHAR NOT NULL CHECK (tcad_evidence_state IN ('confirmed_present','unavailable','conflicting')),
  tcad_fields        VARCHAR[] NOT NULL                -- fields the row backs: geo_id, owner_name, mailing_address, deed_date
);

-- Non-lexicon TCAD extras per parcel (extras.jsonl). Source of PropertyDetail.improvements[] (optional).
CREATE TABLE property_extras (
  property_id  VARCHAR NOT NULL PRIMARY KEY,
  shard        VARCHAR NOT NULL,
  prop_json    VARCHAR,
  entities_json VARCHAR,
  imp_atr_json VARCHAR,
  land_json    VARCHAR,
  imp_info_json VARCHAR
);

-- The kit's own per-shard roof-age estimate (reconcile-a1/roof-age.jsonl): reference for the deploy-time re-run (counts must reconcile).
CREATE TABLE roof_age_reference (
  property_id    VARCHAR NOT NULL PRIMARY KEY,
  roof_age_as_of DATE,
  roof_year      INTEGER,
  roof_age_years INTEGER,
  roof_age_basis VARCHAR,
  roof_age_confidence VARCHAR,
  anchor_json    VARCHAR,
  caveats        VARCHAR[],
  estimator_json VARCHAR,
  policy_json    VARCHAR
);

-- Search centers (GET /v1/search-centers): one row per distinct situs city and per situs ZIP, from the loaded roll only.
CREATE TABLE search_centers (
  center_id     VARCHAR NOT NULL PRIMARY KEY,          -- kind || ':' || name_norm
  kind          VARCHAR NOT NULL CHECK (kind IN ('city','zip')),
  name          VARCHAR NOT NULL,                      -- display, as printed (city upper-case as printed; ZIP digits)
  name_norm     VARCHAR NOT NULL,                      -- casefolded, punctuation and spaces removed
  lat           DOUBLE NOT NULL,                       -- centroid (mean of parcel lat/lon) of parcels with coordinates
  lon           DOUBLE NOT NULL,
  parcel_count  BIGINT NOT NULL,                       -- parcels with this situs city/zip (the basis string's count)
  basis         VARCHAR NOT NULL                       -- 'centroid of 41,203 parcels with situs city PFLUGERVILLE'
);
-- Reviewed aliases ('WESTLAKE' -> 'WEST LAKE HILLS'); alias_version is deploy.text_index_alias_version's sibling.
CREATE TABLE search_center_aliases (
  alias_norm    VARCHAR NOT NULL,
  center_id     VARCHAR NOT NULL,
  alias_version VARCHAR NOT NULL,
  PRIMARY KEY (alias_norm, center_id)
);

-- ---------------------------------------------------------------------------------------------------
-- 3. Permits  (PermitSummary / PermitDetail; only published, confirmed_present, linked permits)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE permits (
  permit_id          VARCHAR NOT NULL PRIMARY KEY,     -- lex.pi_property_improvement.permit_number
  property_id        VARCHAR NOT NULL,                 -- -> properties.property_id (link.propertyId)
  shard              VARCHAR NOT NULL,                 -- PI group shard
  record_cid         VARCHAR NOT NULL,                 -- lex.pi_property_improvement.cid
  property_cid       VARCHAR NOT NULL,
  data_group_cid     VARCHAR NOT NULL,                 -- property_improvement group root for this property
  request_identifier VARCHAR NOT NULL,
  source_http_request VARCHAR NOT NULL,                -- JSON, lex.pi_property_improvement.source_http_request
  source_url         VARCHAR,                          -- capture 'link' column (the permit's public page)
  -- link (property_link)
  link_match_method  VARCHAR NOT NULL CHECK (link_match_method IN ('exact','normalized_digits','tcad_permit_listing')),
  link_normalization_version VARCHAR,
  link_confidence    VARCHAR NOT NULL CHECK (link_confidence IN ('exact','normalized','official_listing')),
  -- as printed by the Socrata capture (unpublished_source)
  geo_id             VARCHAR,                          -- tcad_id
  permit_type        VARCHAR,                          -- permittype code (BP, EP, MP, PP, DS, ...)
  permit_type_desc   VARCHAR,
  permit_class       VARCHAR,
  work_class         VARCHAR,
  description        VARCHAR,
  status             VARCHAR,                          -- status_current
  status_date        DATE,                             -- statusdate
  applied_date       DATE,                             -- applieddate
  issued_date        DATE,                             -- issue_date
  expires_date       DATE,                             -- expiresdate
  completed_date     DATE,                             -- completed_date, NULL when blank or invalid
  completed_date_raw VARCHAR,                          -- raw value when invalid_quarantined
  completed_date_evidence VARCHAR NOT NULL CHECK (completed_date_evidence IN ('confirmed_present','unknown','invalid_quarantined')),
  lat                DOUBLE,                           -- capture latitude
  lon                DOUBLE,
  -- printed contractor fields
  contractor_trade        VARCHAR,
  contractor_company_name VARCHAR,
  contractor_full_name    VARCHAR,
  contractor_phone        VARCHAR,
  contractor_address1     VARCHAR,
  contractor_address2     VARCHAR,
  contractor_city         VARCHAR,
  contractor_zip          VARCHAR,
  contractor_attribution_key VARCHAR,                  -- -> contractors; NULL when the permit prints no company, full name or phone
  -- profile classification (kit worktree; cross-check permits-internal.jsonl)
  roof_work_class    VARCHAR NOT NULL CHECK (roof_work_class IN ('primary_roof_replacement','primary_roof_new_construction','repair_or_coating','accessory_roof','other','needs_review')),
  work_classifier_version VARCHAR NOT NULL,
  is_roofing         BOOLEAN NOT NULL,
  is_reroof          BOOLEAN NOT NULL,
  status_group       VARCHAR NOT NULL CHECK (status_group IN ('open','stalled','closed','needs_review')),
  status_group_basis VARCHAR NOT NULL CHECK (status_group_basis IN ('status','completed_date')), -- completed_date: profile said open/stalled, a completed_date closes it
  status_group_profile VARCHAR NOT NULL CHECK (status_group_profile IN ('open','stalled','closed','needs_review')), -- the profile's mapping of the printed status
  lifecycle_status   VARCHAR NOT NULL,                 -- estimator mapping: completed | other | ...
  -- open/stalled durations: static parts (query-time parts in SCHEMA.md)
  open_since         DATE,                             -- issued_date, else applied_date
  open_since_basis   VARCHAR CHECK (open_since_basis IN ('issued_date','applied_date')),
  static_duration_days  INTEGER,                       -- stalled only: (expires_date | status_date) - open_since
  static_duration_basis VARCHAR CHECK (static_duration_basis IN ('expires_date','statusdate')),
  -- status observation
  status_observed_at VARCHAR NOT NULL,                 -- fetched_at of the capture partition
  status_source      VARCHAR NOT NULL DEFAULT 'indexed' CHECK (status_source IN ('indexed','live')),
  -- radius basis: the linked property's lat/lon, else the permit's own
  radius_lat         DOUBLE,
  radius_lon         DOUBLE,
  -- unpublished_source
  capture_dataset    VARCHAR NOT NULL,                 -- 'austin-issued-construction-permits/3syk-w9eu'
  capture_file       VARCHAR NOT NULL,                 -- partition-BP-1977.csv
  capture_row_index  BIGINT NOT NULL,
  capture_url        VARCHAR NOT NULL,                 -- source_http_request.url of the partition receipt
  capture_fetched_at VARCHAR NOT NULL,
  capture_source_http_request VARCHAR NOT NULL,        -- JSON {method,url,multiValueQueryString} of the partition's receipt
  capture_row_sha256 VARCHAR NOT NULL,                 -- link rowSha256: the row as captured
  capture_receipt_sha256 VARCHAR NOT NULL,
  capture_evidence_state VARCHAR NOT NULL CHECK (capture_evidence_state = 'confirmed_present'),
  is_text_indexed    BOOLEAN NOT NULL                  -- building permits only (permit_type not in EP, MP, PP)
);

-- Documents for the FTS index (post_load.sql). Text is normalized by deploy-build: lower-case, accents stripped, alias
-- list applied (re-roof / re roof / reroof -> 'reroof'). Only is_text_indexed permits appear here.
CREATE TABLE permit_text (
  permit_id        VARCHAR NOT NULL PRIMARY KEY,
  description_norm VARCHAR,
  permit_class_norm VARCHAR,
  work_class_norm  VARCHAR
);

-- ---------------------------------------------------------------------------------------------------
-- 4. Contractors, candidates  (Contractor, RegistryCandidate, LicenseCandidate)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE contractors (
  contractor_attribution_key VARCHAR NOT NULL PRIMARY KEY,
  attribution_key_version    VARCHAR NOT NULL,
  company_name   VARCHAR,
  printed_names  VARCHAR[] NOT NULL,                   -- distinct contractor_full_name values, sorted
  trade          VARCHAR,
  phone          VARCHAR,
  address        VARCHAR,                              -- single line: address1[, address2], city zip as printed
  permit_count   INTEGER NOT NULL,
  open_permit_count INTEGER NOT NULL,                  -- status_group = 'open'
  roofing_permit_count INTEGER NOT NULL,
  needs_review_permit_count INTEGER NOT NULL,
  bbb_status     VARCHAR NOT NULL,                     -- 'blocked' | 'unavailable' | 'available'
  bbb_rating     VARCHAR,
  bbb_incomplete_reason VARCHAR,
  bbb_note       VARCHAR
);

CREATE TABLE registry_candidates (
  contractor_attribution_key VARCHAR NOT NULL,
  business_record_id VARCHAR NOT NULL,
  source          VARCHAR NOT NULL,
  dataset         VARCHAR NOT NULL,
  taxpayer_number VARCHAR,                             -- NULL when withheld
  sos_file_number VARCHAR,
  name            VARCHAR NOT NULL,
  scope           VARCHAR NOT NULL,
  matched_field   VARCHAR NOT NULL,                    -- 'company_name'
  printed_value   VARCHAR NOT NULL,
  normalized_name VARCHAR NOT NULL,
  match_method    VARCHAR NOT NULL,                    -- 'exact_unique_normalized_name'
  matcher_version VARCHAR NOT NULL,
  PRIMARY KEY (contractor_attribution_key, business_record_id)
);

CREATE TABLE license_candidates (
  contractor_attribution_key VARCHAR NOT NULL,
  license_record_id VARCHAR NOT NULL,
  source          VARCHAR NOT NULL,
  dataset         VARCHAR NOT NULL,
  license_number  VARCHAR,
  license_type    VARCHAR,
  name            VARCHAR NOT NULL,
  matched_field   VARCHAR NOT NULL,                    -- 'company_name' | 'printed_name'
  printed_value   VARCHAR NOT NULL,
  normalized_name VARCHAR NOT NULL,
  match_method    VARCHAR NOT NULL,
  matcher_version VARCHAR NOT NULL,
  PRIMARY KEY (contractor_attribution_key, license_record_id)
);

-- ---------------------------------------------------------------------------------------------------
-- 5. Business and license records  (BusinessRecord, LicenseRecord) -- never CID-backed
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE business_records (
  business_record_id VARCHAR NOT NULL PRIMARY KEY,     -- travis-record-id.v1 (plain SHA-256, or HMAC when withheld)
  source          VARCHAR NOT NULL,                    -- tx-comptroller-franchise-tax | tx-comptroller-sales-tax | tx-sos-veteran-owned-business
  dataset         VARCHAR NOT NULL,                    -- e.g. tx-comptroller-franchise-tax/9cir-efmm
  record_id       VARCHAR,                             -- key as printed, trimmed; NULL when withheld
  record_id_withheld VARCHAR CHECK (record_id_withheld IS NULL OR record_id_withheld = 'individual_owner'),
  taxpayer_number VARCHAR,                             -- trimmed; NULL when withheld (number search; never populated for sole owners)
  name            VARCHAR NOT NULL,
  name_norm       VARCHAR NOT NULL,                    -- matcher normalizer
  sos_file_number VARCHAR,
  organization_type VARCHAR,
  status_code     VARCHAR,
  status_date     VARCHAR,
  right_to_transact VARCHAR,
  naics_code      VARCHAR,
  address_line1   VARCHAR,
  address_line2   VARCHAR,
  address_city    VARCHAR,
  address_state   VARCHAR,
  address_zip     VARCHAR,
  address_kind    VARCHAR,                             -- 'mailing' | 'outlet'
  county_code     VARCHAR,
  scope           VARCHAR NOT NULL,                    -- 'travis' | 'out_of_county' | 'statewide'
  candidate_of_contractors INTEGER NOT NULL DEFAULT 0,
  candidate_of_owners      INTEGER NOT NULL DEFAULT 0,
  detail_url      VARCHAR,
  printed         VARCHAR NOT NULL,                    -- JSON object: every source column as printed, minus withheld columns
  -- unpublished_source
  us_url          VARCHAR NOT NULL,
  us_fetched_at   VARCHAR NOT NULL,
  us_source_http_request VARCHAR NOT NULL,             -- JSON
  row_sha256      VARCHAR NOT NULL,                    -- parquet _row_sha256 (already computed with withheld cells emptied)
  evidence_state  VARCHAR NOT NULL CHECK (evidence_state = 'confirmed_present'),
  us_fields       VARCHAR[] NOT NULL,
  -- travis-t3-privacy.v2: a sole-owner row carries no taxpayer number anywhere
  CHECK (record_id_withheld IS NULL OR (record_id IS NULL AND taxpayer_number IS NULL))
);

CREATE TABLE license_records (
  license_record_id VARCHAR NOT NULL PRIMARY KEY,
  source          VARCHAR NOT NULL,                    -- tdlr-license-files | tsbpe-responsible-master-plumber | austin-row-contractor-licenses
  dataset         VARCHAR NOT NULL,
  license_number  VARCHAR,
  license_type    VARCHAR,
  license_subtype VARCHAR,
  holder_name     VARCHAR,
  business_name   VARCHAR,
  name_norm       VARCHAR NOT NULL,                    -- normalized holder_name (search q)
  business_name_norm VARCHAR,
  issue_date      DATE,
  expiration_date DATE,
  business_city   VARCHAR,
  business_county VARCHAR,
  printed         VARCHAR NOT NULL,                    -- JSON object minus personal contact columns
  us_url          VARCHAR NOT NULL,
  us_fetched_at   VARCHAR NOT NULL,
  us_source_http_request VARCHAR NOT NULL,
  row_sha256      VARCHAR NOT NULL,
  evidence_state  VARCHAR NOT NULL CHECK (evidence_state = 'confirmed_present'),
  us_fields       VARCHAR[] NOT NULL
);

-- travis-t3-privacy.v2 audit: must return zero rows (deploy-build asserts it, tests assert it).
CREATE VIEW v_privacy_violations AS
  SELECT business_record_id FROM business_records
   WHERE record_id_withheld IS NOT NULL
     AND (record_id IS NOT NULL OR taxpayer_number IS NOT NULL OR printed LIKE '%"taxpayer_number"%')
  UNION ALL
  SELECT license_record_id FROM license_records
   WHERE printed LIKE '%mailing_address%' OR printed LIKE '%"phone_number"%' OR printed LIKE '%"addr1"%';

-- ---------------------------------------------------------------------------------------------------
-- 6. Published lexicon tables, loaded verbatim from the verified export-tables Parquet parts
--    (columns exactly as published; `shard` added; one file per part). Prefix county_ = group county,
--    pi_ = group property_improvement. The published `properties` tables become lex.properties_index.
--    lex.county_geometry.polygon is loaded as NULL (the mirror serves it; it would dominate the file).
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE lex.properties_index (
  group_name     VARCHAR NOT NULL,
  shard          VARCHAR NOT NULL,
  property_cid   VARCHAR NOT NULL,
  schema_cid     VARCHAR NOT NULL,                     -- the published table's column name (a schema CID)
  data_group_cid VARCHAR NOT NULL,                     -- its value
  PRIMARY KEY (group_name, shard, property_cid, schema_cid)
);

-- group county, published table address
CREATE TABLE lex.county_address (
  cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  request_identifier VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table address_has_geometry
CREATE TABLE lex.county_address_has_geometry (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table address_has_parcel
CREATE TABLE lex.county_address_has_parcel (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table company
CREATE TABLE lex.county_company (
  name VARCHAR,
  request_identifier VARCHAR,
  source_http_request VARCHAR,
  sunbiz_document_number VARCHAR,
  cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table company_has_mailing_address
CREATE TABLE lex.county_company_has_mailing_address (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table company_has_property
CREATE TABLE lex.county_company_has_property (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table geometry
CREATE TABLE lex.county_geometry (
  latitude DOUBLE,
  longitude DOUBLE,
  polygon VARCHAR,
  request_identifier VARCHAR,
  source_http_request VARCHAR,
  cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table lot
CREATE TABLE lex.county_lot (
  driveway_condition VARCHAR,
  driveway_material VARCHAR,
  fence_height VARCHAR,
  fence_length VARCHAR,
  fencing_type VARCHAR,
  landscaping_features VARCHAR,
  lot_area_sqft BIGINT,
  lot_condition_issues VARCHAR,
  lot_length_feet BIGINT,
  lot_size_acre DOUBLE,
  lot_type VARCHAR,
  lot_width_feet BIGINT,
  paving_area_sqft DOUBLE,
  paving_installation_date VARCHAR,
  paving_type VARCHAR,
  request_identifier VARCHAR,
  site_lighting_fixture_count DOUBLE,
  site_lighting_installation_date VARCHAR,
  site_lighting_type VARCHAR,
  source_http_request VARCHAR,
  view VARCHAR,
  cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table parcel
CREATE TABLE lex.county_parcel (
  parcel_identifier VARCHAR,
  request_identifier VARCHAR,
  source_http_request VARCHAR,
  cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table parcel_has_geometry
CREATE TABLE lex.county_parcel_has_geometry (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table person
CREATE TABLE lex.county_person (
  birth_date VARCHAR,
  first_name VARCHAR,
  last_name VARCHAR,
  middle_name VARCHAR,
  prefix_name VARCHAR,
  request_identifier VARCHAR,
  source_http_request VARCHAR,
  suffix_name VARCHAR,
  us_citizenship_status VARCHAR,
  veteran_status BOOLEAN,
  cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table person_has_mailing_address
CREATE TABLE lex.county_person_has_mailing_address (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table person_has_property
CREATE TABLE lex.county_person_has_property (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table property
CREATE TABLE lex.county_property (
  area_under_air VARCHAR,
  build_status VARCHAR,
  historic_designation BOOLEAN,
  hoa_cid VARCHAR,
  livable_floor_area VARCHAR,
  number_of_units BIGINT,
  number_of_units_type VARCHAR,
  ownership_estate_type VARCHAR,
  parcel_identifier VARCHAR,
  property_effective_built_year BIGINT,
  property_legal_description_text VARCHAR,
  property_manager_cid VARCHAR,
  property_structure_built_year BIGINT,
  property_type VARCHAR,
  property_usage_type VARCHAR,
  request_identifier VARCHAR,
  source_http_request VARCHAR,
  structure_form VARCHAR,
  subdivision VARCHAR,
  total_area VARCHAR,
  zoning VARCHAR,
  cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table property_has_address
CREATE TABLE lex.county_property_has_address (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table property_has_lot
CREATE TABLE lex.county_property_has_lot (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table property_has_parcel
CREATE TABLE lex.county_property_has_parcel (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table property_has_sales_history
CREATE TABLE lex.county_property_has_sales_history (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table property_has_structure
CREATE TABLE lex.county_property_has_structure (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table property_has_tax
CREATE TABLE lex.county_property_has_tax (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table sales_history
CREATE TABLE lex.county_sales_history (
  ownership_transfer_date VARCHAR,
  purchase_price_amount DOUBLE,
  request_identifier VARCHAR,
  sale_type VARCHAR,
  source_http_request VARCHAR,
  cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table sales_history_has_company
CREATE TABLE lex.county_sales_history_has_company (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table sales_history_has_person
CREATE TABLE lex.county_sales_history_has_person (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table structure
CREATE TABLE lex.county_structure (
  architectural_style_type VARCHAR,
  attachment_type VARCHAR,
  ceiling_condition VARCHAR,
  ceiling_height_average DOUBLE,
  ceiling_insulation_type VARCHAR,
  ceiling_structure_material VARCHAR,
  ceiling_surface_material VARCHAR,
  exterior_door_installation_date VARCHAR,
  exterior_door_material VARCHAR,
  exterior_wall_condition VARCHAR,
  exterior_wall_condition_primary VARCHAR,
  exterior_wall_condition_secondary VARCHAR,
  exterior_wall_insulation_type VARCHAR,
  exterior_wall_insulation_type_primary VARCHAR,
  exterior_wall_insulation_type_secondary VARCHAR,
  exterior_wall_material_primary VARCHAR,
  exterior_wall_material_secondary VARCHAR,
  finished_base_area BIGINT,
  finished_basement_area BIGINT,
  finished_upper_story_area BIGINT,
  flooring_condition VARCHAR,
  flooring_material_primary VARCHAR,
  flooring_material_secondary VARCHAR,
  foundation_condition VARCHAR,
  foundation_material VARCHAR,
  foundation_repair_date VARCHAR,
  foundation_type VARCHAR,
  foundation_waterproofing VARCHAR,
  gutters_condition VARCHAR,
  gutters_material VARCHAR,
  interior_door_material VARCHAR,
  interior_wall_condition VARCHAR,
  interior_wall_finish_primary VARCHAR,
  interior_wall_finish_secondary VARCHAR,
  interior_wall_structure_material VARCHAR,
  interior_wall_structure_material_primary VARCHAR,
  interior_wall_structure_material_secondary VARCHAR,
  interior_wall_surface_material_primary VARCHAR,
  interior_wall_surface_material_secondary VARCHAR,
  number_of_buildings BIGINT,
  number_of_stories DOUBLE,
  primary_framing_material VARCHAR,
  request_identifier VARCHAR,
  roof_age_years BIGINT,
  roof_condition VARCHAR,
  roof_covering_material VARCHAR,
  roof_date VARCHAR,
  roof_design_type VARCHAR,
  roof_material_type VARCHAR,
  roof_structure_material VARCHAR,
  roof_underlayment_type VARCHAR,
  secondary_framing_material VARCHAR,
  siding_installation_date VARCHAR,
  source_http_request VARCHAR,
  structural_damage_indicators VARCHAR,
  subfloor_material VARCHAR,
  unfinished_base_area BIGINT,
  unfinished_basement_area BIGINT,
  unfinished_upper_story_area BIGINT,
  window_frame_material VARCHAR,
  window_glazing_type VARCHAR,
  window_installation_date VARCHAR,
  window_operation_type VARCHAR,
  window_screen_material VARCHAR,
  cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group county, published table tax
CREATE TABLE lex.county_tax (
  agricultural_valuation_amount DOUBLE,
  building_depreciated_value_amount DOUBLE,
  building_replacement_cost_amount DOUBLE,
  city_taxable_value_amount DOUBLE,
  college_taxable_value_amount DOUBLE,
  county_taxable_value_amount DOUBLE,
  first_year_building_on_tax_roll BIGINT,
  first_year_on_tax_roll BIGINT,
  homestead_cap_loss_amount DOUBLE,
  hospital_taxable_value_amount DOUBLE,
  millage_rate DOUBLE,
  monthly_tax_amount DOUBLE,
  period_end_date VARCHAR,
  period_start_date VARCHAR,
  property_assessed_value_amount DOUBLE,
  property_building_amount DOUBLE,
  property_exemption_amount DOUBLE,
  property_land_amount DOUBLE,
  property_market_value_amount DOUBLE,
  property_taxable_value_amount DOUBLE,
  request_identifier VARCHAR,
  school_taxable_value_amount DOUBLE,
  source_http_request VARCHAR,
  special_district_taxable_value_amount DOUBLE,
  tax_year BIGINT,
  yearly_tax_amount DOUBLE,
  cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group property_improvement, published table address
CREATE TABLE lex.pi_address (
  cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  request_identifier VARCHAR,
  shard VARCHAR NOT NULL
);

-- group property_improvement, published table address_has_parcel
CREATE TABLE lex.pi_address_has_parcel (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group property_improvement, published table parcel
CREATE TABLE lex.pi_parcel (
  parcel_identifier VARCHAR,
  request_identifier VARCHAR,
  source_http_request VARCHAR,
  cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group property_improvement, published table property
CREATE TABLE lex.pi_property (
  area_under_air VARCHAR,
  build_status VARCHAR,
  historic_designation BOOLEAN,
  hoa_cid VARCHAR,
  livable_floor_area VARCHAR,
  number_of_units BIGINT,
  number_of_units_type VARCHAR,
  ownership_estate_type VARCHAR,
  parcel_identifier VARCHAR,
  property_effective_built_year BIGINT,
  property_legal_description_text VARCHAR,
  property_manager_cid VARCHAR,
  property_structure_built_year BIGINT,
  property_type VARCHAR,
  property_usage_type VARCHAR,
  request_identifier VARCHAR,
  source_http_request VARCHAR,
  structure_form VARCHAR,
  subdivision VARCHAR,
  total_area VARCHAR,
  zoning VARCHAR,
  cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group property_improvement, published table property_has_property_improvement
CREATE TABLE lex.pi_property_has_property_improvement (
  relationship_cid VARCHAR,
  from_cid VARCHAR,
  to_cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

-- group property_improvement, published table property_improvement
CREATE TABLE lex.pi_property_improvement (
  application_received_date VARCHAR,
  completion_date VARCHAR,
  contractor_type VARCHAR,
  fee DOUBLE,
  final_inspection_date VARCHAR,
  improvement_action VARCHAR,
  improvement_status VARCHAR,
  improvement_type VARCHAR,
  is_disaster_recovery BOOLEAN,
  is_owner_builder BOOLEAN,
  permit_close_date VARCHAR,
  permit_issue_date VARCHAR,
  permit_number VARCHAR,
  permit_required BOOLEAN,
  private_provider_inspections BOOLEAN,
  private_provider_plan_review BOOLEAN,
  request_identifier VARCHAR,
  source_http_request VARCHAR,
  cid VARCHAR,
  property_cid VARCHAR,
  data_group_cid VARCHAR,
  shard VARCHAR NOT NULL
);

