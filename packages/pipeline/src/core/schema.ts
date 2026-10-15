import type { Db } from "./db.js";

const provenance = `
  source_id VARCHAR NOT NULL,
  source_record_id VARCHAR NOT NULL,
  source_url VARCHAR,
  raw_sha256 VARCHAR,
  collected_at TIMESTAMPTZ,
  record_hash VARCHAR NOT NULL,
  first_seen_run VARCHAR NOT NULL,
  last_seen_run VARCHAR NOT NULL,
  last_changed_run VARCHAR NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT false
`;

export const ledgerDdl = `
CREATE TABLE IF NOT EXISTS runs (
  run_id VARCHAR PRIMARY KEY,
  mode VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  window_start DATE,
  window_end DATE,
  notes VARCHAR
);
CREATE TABLE IF NOT EXISTS run_sources (
  run_id VARCHAR NOT NULL,
  source_id VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  records_seen BIGINT DEFAULT 0,
  inserted BIGINT DEFAULT 0,
  updated BIGINT DEFAULT 0,
  unchanged BIGINT DEFAULT 0,
  deleted BIGINT DEFAULT 0,
  out_of_scope BIGINT DEFAULT 0,
  limitation VARCHAR,
  detail JSON,
  PRIMARY KEY (run_id, source_id)
);
CREATE TABLE IF NOT EXISTS raw_artifacts (
  run_id VARCHAR NOT NULL,
  source_id VARCHAR NOT NULL,
  url VARCHAR NOT NULL,
  local_path VARCHAR NOT NULL,
  bytes BIGINT NOT NULL,
  sha256 VARCHAR NOT NULL,
  http_status INTEGER,
  etag VARCHAR,
  last_modified VARCHAR,
  content_type VARCHAR,
  fetched_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (run_id, source_id, url)
);
CREATE TABLE IF NOT EXISTS source_watermarks (
  source_id VARCHAR PRIMARY KEY,
  watermark VARCHAR NOT NULL,
  updated_run VARCHAR NOT NULL
);
`;

export const canonicalDdl = `
CREATE TABLE IF NOT EXISTS county_boundary (
  geoid VARCHAR PRIMARY KEY,
  name VARCHAR,
  geom GEOMETRY,
  ${provenance}
);
CREATE TABLE IF NOT EXISTS parcels (
  prop_id VARCHAR PRIMARY KEY,
  geo_id VARCHAR,
  owner_name VARCHAR,
  owner_care_of VARCHAR,
  legal_description VARCHAR,
  land_use_state_code VARCHAR,
  land_use_local_code VARCHAR,
  land_value DOUBLE,
  improvement_value DOUBLE,
  market_value DOUBLE,
  situs_address VARCHAR,
  situs_number VARCHAR,
  situs_street VARCHAR,
  situs_city VARCHAR,
  situs_state VARCHAR,
  situs_zip VARCHAR,
  mail_address VARCHAR,
  mail_line1 VARCHAR,
  mail_line2 VARCHAR,
  mail_city VARCHAR,
  mail_state VARCHAR,
  mail_zip VARCHAR,
  legal_area DOUBLE,
  legal_area_unit VARCHAR,
  gis_area DOUBLE,
  gis_area_unit VARCHAR,
  tax_year VARCHAR,
  year_built INTEGER,
  latitude DOUBLE,
  longitude DOUBLE,
  ${provenance}
);
CREATE TABLE IF NOT EXISTS parcel_geometries (
  prop_id VARCHAR PRIMARY KEY,
  geom GEOMETRY,
  record_hash VARCHAR NOT NULL
);
CREATE TABLE IF NOT EXISTS permits (
  permit_number VARCHAR PRIMARY KEY,
  permit_type VARCHAR,
  permit_type_desc VARCHAR,
  permit_class VARCHAR,
  permit_class_mapped VARCHAR,
  work_class VARCHAR,
  description VARCHAR,
  status VARCHAR,
  status_date DATE,
  applied_date DATE,
  issued_date DATE,
  expires_date DATE,
  completed_date DATE,
  tcad_id VARCHAR,
  address VARCHAR,
  city VARCHAR,
  zip VARCHAR,
  jurisdiction VARCHAR,
  latitude DOUBLE,
  longitude DOUBLE,
  contractor_trade VARCHAR,
  contractor_company_name VARCHAR,
  contractor_full_name VARCHAR,
  contractor_phone VARCHAR,
  contractor_address VARCHAR,
  contractor_city VARCHAR,
  contractor_zip VARCHAR,
  applicant_org VARCHAR,
  total_job_valuation DOUBLE,
  project_id VARCHAR,
  master_permit_number VARCHAR,
  permit_link VARCHAR,
  is_roofing BOOLEAN,
  roofing_match VARCHAR,
  is_open BOOLEAN,
  ${provenance}
);
CREATE TABLE IF NOT EXISTS businesses (
  taxpayer_number VARCHAR PRIMARY KEY,
  name VARCHAR,
  name_key VARCHAR,
  address VARCHAR,
  city VARCHAR,
  state VARCHAR,
  zip VARCHAR,
  county_code VARCHAR,
  organization_type VARCHAR,
  sos_file_number VARCHAR,
  sos_charter_date DATE,
  sos_status_code VARCHAR,
  right_to_transact_code VARCHAR,
  responsibility_begin_date DATE,
  ${provenance}
);
CREATE TABLE IF NOT EXISTS places (
  place_id VARCHAR PRIMARY KEY,
  name VARCHAR,
  name_key VARCHAR,
  taxonomy_primary VARCHAR,
  taxonomy_hierarchy VARCHAR[],
  basic_category VARCHAR,
  confidence DOUBLE,
  latitude DOUBLE,
  longitude DOUBLE,
  address VARCHAR,
  locality VARCHAR,
  postcode VARCHAR,
  phone VARCHAR,
  website VARCHAR,
  source_datasets VARCHAR[],
  overture_release VARCHAR,
  ${provenance}
);
CREATE TABLE IF NOT EXISTS geo_places (
  geoid VARCHAR PRIMARY KEY,
  name VARCHAR,
  basename VARCHAR,
  place_kind VARCHAR,
  latitude DOUBLE,
  longitude DOUBLE,
  ${provenance}
);
CREATE TABLE IF NOT EXISTS tcad_properties (
  prop_id VARCHAR PRIMARY KEY,
  geo_id VARCHAR,
  prop_type_cd VARCHAR,
  prop_val_yr VARCHAR,
  owner_name VARCHAR,
  mail_line1 VARCHAR,
  mail_line2 VARCHAR,
  mail_line3 VARCHAR,
  mail_city VARCHAR,
  mail_state VARCHAR,
  mail_zip VARCHAR,
  situs_address VARCHAR,
  situs_city VARCHAR,
  situs_zip VARCHAR,
  legal_description VARCHAR,
  legal_acreage DOUBLE,
  appraised_value DOUBLE,
  assessed_value DOUBLE,
  deed_book VARCHAR,
  deed_page VARCHAR,
  deed_date DATE,
  deed_date_raw VARCHAR,
  year_built INTEGER,
  latest_improvement_year INTEGER,
  roof_attributes VARCHAR[],
  ${provenance}
);
CREATE TABLE IF NOT EXISTS bbb_profiles (
  bbb_id VARCHAR PRIMARY KEY,
  name VARCHAR,
  name_key VARCHAR,
  rating VARCHAR,
  accredited BOOLEAN,
  phone VARCHAR,
  address VARCHAR,
  city VARCHAR,
  state VARCHAR,
  zip VARCHAR,
  profile_url VARCHAR,
  categories VARCHAR[],
  ${provenance}
);
`;

export async function migrate(db: Db): Promise<void> {
  await db.exec(ledgerDdl);
  await db.exec(canonicalDdl);
}
