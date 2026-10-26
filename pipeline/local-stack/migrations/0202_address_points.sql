-- A-11 Run 3 (ADR 0004, PO decision 2026-10-25): the City of Austin address-point layer as an
-- internal lookup table, and the new coordinate values it allows on parcels. Internal Query DB
-- only; nothing here is public. Written only through the Loader `gis` track (kind
-- `address_points`), from the cache the `fetch-address-layer` command wrote (receipt + sha256).
-- The matcher itself is pure (oracle-runtime travis/gis/address-points.ts); this table only
-- holds the layer so the assembly reads it inside its transaction.

CREATE TABLE IF NOT EXISTS address_points (
  object_id bigint PRIMARY KEY,
  place_id bigint,
  address integer,
  full_street_name text,
  address_fraction text,
  address_suffix text,
  address_type integer,
  lat double precision NOT NULL,
  lon double precision NOT NULL
);

-- One row: which capture of the layer the table holds (the cache receipt).
CREATE TABLE IF NOT EXISTS address_point_layer (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  layer_url text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  record_count integer NOT NULL CHECK (record_count >= 0),
  source_count integer NOT NULL CHECK (source_count >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  layer_last_edit_date timestamptz
);

-- parcels.coordinate_* (0201): add `address_point` as a source and a rule, and the two reasons
-- for an address that did not give a unique, in-county point. Same constraint names as 0201.
ALTER TABLE parcels
  DROP CONSTRAINT IF EXISTS parcels_coordinate_source_check,
  DROP CONSTRAINT IF EXISTS parcels_coordinate_rule_check,
  DROP CONSTRAINT IF EXISTS parcels_coordinate_reason_check;

ALTER TABLE parcels
  ADD CONSTRAINT parcels_coordinate_source_check
    CHECK (coordinate_source IN ('gis_centroid', 'address_point', 'permit_point', 'none')),
  ADD CONSTRAINT parcels_coordinate_rule_check
    CHECK (coordinate_rule IN ('centroid', 'interior_point', 'centroid_outside_polygon', 'largest_area', 'export_point', 'condo_building_point', 'address_point', 'permit_point')),
  ADD CONSTRAINT parcels_coordinate_reason_check
    CHECK (coordinate_reason IN ('no_gis_feature', 'gis_null_geometry', 'no_permit_point', 'non_land_account', 'address_point_ambiguous', 'address_point_outside_county'));
