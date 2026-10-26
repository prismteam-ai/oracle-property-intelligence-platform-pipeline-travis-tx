-- A-04 0101_tcad (G-TCAD): the TCAD backbone in the internal Query DB (data-model.md § 0101).
-- Internal only, never exported or published. One row per TCAD account (all four types, D-5);
-- the owner columns are null on every redacted account (D-7, P0-15). Written only by the
-- Loader `tcad` track. Later migrations ALTER these tables (0201_gis adds parcels.coordinate_*).

CREATE TABLE IF NOT EXISTS parcels (
  request_identifier text PRIMARY KEY CHECK (request_identifier ~ '^[1-9][0-9]*$'),
  job_id text NOT NULL CHECK (job_id ~ '^travis-a04-[a-z0-9-]+$'),
  geo_id text,
  prop_type text NOT NULL CHECK (prop_type IN ('R', 'P', 'MH', 'MN')),
  state_cd text,
  property_type text,
  property_usage_type text,
  property_type_missing_reason text CHECK (property_type_missing_reason IN ('enum_lacks_value')),
  situs_address jsonb,
  owner_name text,
  owner_kind text CHECK (owner_kind IN ('person', 'company', 'mixed', 'unparsed')),
  owner_missing_reason text CHECK (owner_missing_reason IN ('owner_confidential', 'no_dated_sale', 'no_owner_record', 'owner_unparsed')),
  owner_redacted boolean NOT NULL DEFAULT false,
  owner_redaction_rule text CHECK (owner_redaction_rule IN ('sales_confidential_code')),
  owner_mailing_postal_code text,
  owner_mailing_country text,
  owner_area_class text NOT NULL CHECK (owner_area_class IN ('in_county', 'regional', 'out_of_area', 'unknown')),
  owner_is_out_of_area boolean,
  owner_area_evidence text CHECK (owner_area_evidence IN ('travis_zcta', 'regional_zcta', 'us_zcta_outside', 'foreign_mailing', 'no_zip', 'zip_not_zcta')),
  area_list_sha256 text NOT NULL CHECK (area_list_sha256 ~ '^[a-f0-9]{64}$'),
  property_structure_built_year int,
  year_built_rule text NOT NULL CHECK (year_built_rule IN ('profile_main', 'largest_main_improvement', 'none')),
  year_built_missing_reason text CHECK (year_built_missing_reason IN ('source_missing')),
  roof_age_basis text CHECK (roof_age_basis IN ('unknown')),
  roof_age_reason text CHECK (roof_age_reason IN ('no_roof_date')),
  last_ownership_transfer_date date,
  tenure_years numeric,
  tenure_basis text NOT NULL CHECK (tenure_basis IN ('sale_date', 'unknown')),
  tenure_missing_reason text CHECK (tenure_missing_reason IN ('no_dated_sale')),
  is_long_tenure boolean,
  export_point_lat double precision,
  export_point_lon double precision,
  export_point_kind text NOT NULL CHECK (export_point_kind IN ('real', 'placeholder', 'duplicate', 'outside_county')),
  county_emit boolean NOT NULL,
  source_url text NOT NULL,
  captured_at timestamptz NOT NULL,
  export_sha256 text NOT NULL CHECK (export_sha256 ~ '^[a-f0-9]{64}$'),
  record_ordinal bigint NOT NULL,
  record_sha256 text NOT NULL CHECK (record_sha256 ~ '^[a-f0-9]{64}$'),
  payload_redacted jsonb NOT NULL,
  -- D-7: a redacted account carries no owner name and no mailing column.
  CHECK (NOT owner_redacted OR (owner_name IS NULL AND owner_mailing_postal_code IS NULL
    AND owner_mailing_country IS NULL AND owner_missing_reason = 'owner_confidential'
    AND owner_redaction_rule = 'sales_confidential_code')),
  CHECK (owner_redacted OR owner_redaction_rule IS NULL),
  CHECK (owner_name IS NOT NULL OR owner_missing_reason IS NOT NULL),
  CHECK (tenure_basis <> 'unknown' OR (is_long_tenure IS NULL AND tenure_years IS NULL AND tenure_missing_reason = 'no_dated_sale')),
  CHECK (property_structure_built_year IS NOT NULL OR (year_built_missing_reason = 'source_missing'
    AND roof_age_basis = 'unknown' AND roof_age_reason = 'no_roof_date')),
  CHECK (county_emit = (prop_type = 'R'))
);
CREATE INDEX IF NOT EXISTS parcels_job ON parcels (job_id);
CREATE INDEX IF NOT EXISTS parcels_geo_id ON parcels (geo_id);
CREATE INDEX IF NOT EXISTS parcels_export_point ON parcels (export_point_lat, export_point_lon)
  WHERE export_point_kind IN ('real', 'duplicate');

-- Many accounts per geoID (11,589 R accounts share 1,164 geoIDs); geoID kept as printed.
CREATE TABLE IF NOT EXISTS parcel_geoids (
  geo_id text NOT NULL,
  request_identifier text NOT NULL REFERENCES parcels (request_identifier),
  prop_type text NOT NULL CHECK (prop_type IN ('R', 'P', 'MH', 'MN')),
  PRIMARY KEY (geo_id, request_identifier)
);

-- Improvements as children (FR-018).
CREATE TABLE IF NOT EXISTS property_structures (
  request_identifier text NOT NULL REFERENCES parcels (request_identifier),
  ordinal int NOT NULL,
  imprv_type text,
  is_main_residential boolean NOT NULL,
  living_area numeric,
  actual_year_built int,
  effective_year_built int,
  PRIMARY KEY (request_identifier, ordinal)
);

-- Every export record of a run, classified (FR-002): seed = loaded + dead + invalid +
-- transform_failure. There is no `confidential` class: confidential accounts are loaded.
CREATE TABLE IF NOT EXISTS roll_reconciliation (
  job_id text NOT NULL,
  record_ordinal bigint NOT NULL,
  request_identifier text,
  geo_id text,
  class text NOT NULL CHECK (class IN ('loaded', 'dead', 'invalid', 'transform_failure')),
  detail text,
  PRIMARY KEY (job_id, record_ordinal),
  CHECK (class <> 'loaded' OR request_identifier IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS roll_reconciliation_class ON roll_reconciliation (job_id, class);
