-- A-04 0201_gis (G-GIS): GIS runner pages and features, and the coordinate columns on parcels
-- (data-model.md § 0201). Internal Query DB only; nothing here is public. Applied after
-- 0101_tcad (parcels); written only through the Loader `gis` track. services/migrate.ts runs
-- this file in its own transaction.

CREATE TABLE IF NOT EXISTS gis_pages (
  job_id text NOT NULL CHECK (job_id ~ '^travis-a04-[a-z0-9-]+$'),
  -- the kit's objectIdsSha256 of the page's ids
  page_key text NOT NULL CHECK (page_key ~ '^[a-f0-9]{64}$'),
  -- the GitHub Actions run id of the US-runner artifact
  artifact_run_id text NOT NULL,
  url text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz NOT NULL,
  feature_count int NOT NULL CHECK (feature_count >= 0),
  PRIMARY KEY (artifact_run_id, page_key)
);

CREATE TABLE IF NOT EXISTS gis_features (
  object_id bigint PRIMARY KEY,
  artifact_run_id text NOT NULL,
  page_key text NOT NULL,
  pid_value text,
  geoid_value text,
  area double precision,
  point_lat double precision,
  point_lon double precision,
  point_method text CHECK (point_method IN ('centroid', 'interior_point', 'centroid_outside_polygon')),
  null_geometry bool NOT NULL,
  layer_last_edit_date timestamptz,
  FOREIGN KEY (artifact_run_id, page_key) REFERENCES gis_pages (artifact_run_id, page_key),
  CHECK (null_geometry = (point_lat IS NULL)),
  CHECK ((point_lat IS NULL) = (point_lon IS NULL)),
  CHECK ((point_lat IS NULL) = (point_method IS NULL))
);
CREATE INDEX IF NOT EXISTS gis_features_pid ON gis_features (pid_value);
CREATE INDEX IF NOT EXISTS gis_features_geoid ON gis_features (geoid_value);

-- Coordinates are written only by the assembler (travis/gis/assemble-coordinates.ts through the
-- Loader gis track). Before the first assembly every column is null.
ALTER TABLE parcels
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS coordinate_source text,
  ADD COLUMN IF NOT EXISTS coordinate_rule text,
  ADD COLUMN IF NOT EXISTS coordinate_reason text,
  ADD COLUMN IF NOT EXISTS coordinate_review_flag text,
  ADD COLUMN IF NOT EXISTS coordinate_source_url text,
  ADD COLUMN IF NOT EXISTS coordinate_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS coordinate_sha256 text,
  ADD COLUMN IF NOT EXISTS coordinate_job_id text;

ALTER TABLE parcels
  ADD CONSTRAINT parcels_coordinate_source_check
    CHECK (coordinate_source IN ('gis_centroid', 'permit_point', 'none')),
  ADD CONSTRAINT parcels_coordinate_rule_check
    CHECK (coordinate_rule IN ('centroid', 'interior_point', 'centroid_outside_polygon', 'largest_area', 'export_point', 'condo_building_point', 'permit_point')),
  ADD CONSTRAINT parcels_coordinate_reason_check
    CHECK (coordinate_reason IN ('no_gis_feature', 'gis_null_geometry', 'no_permit_point', 'non_land_account')),
  ADD CONSTRAINT parcels_coordinate_review_flag_check
    CHECK (coordinate_review_flag IN ('permit_far_from_gis')),
  ADD CONSTRAINT parcels_coordinate_sha256_check
    CHECK (coordinate_sha256 ~ '^[a-f0-9]{64}$'),
  -- coordinate_source = none ⇔ latitude null ⇔ coordinate_reason not null (once assembled)
  ADD CONSTRAINT parcels_coordinate_none_rule
    CHECK (
      coordinate_source IS NULL
      OR (
        (coordinate_source = 'none') = (latitude IS NULL)
        AND (latitude IS NULL) = (longitude IS NULL)
        AND (latitude IS NULL) = (coordinate_reason IS NOT NULL)
      )
    );

CREATE INDEX IF NOT EXISTS parcels_coordinate_source ON parcels (coordinate_source);
