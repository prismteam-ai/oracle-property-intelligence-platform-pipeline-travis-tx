-- A-04 0301_permits (G-PERMITS): Austin permits in the internal Query DB (data-model.md § 0301).
-- Internal only; nothing here is public. Written only by the Loader `permits` track.
-- Classification is the profile's (travis-austin@1.0.0, computed in TypeScript and stamped
-- with its SHA-256); this file holds no term list and no text matching.

-- Every source row kept (one per Socrata :id); contractor and applicant fields live only here,
-- in the raw payload (no contractor row is written in A-04, AD-06).
CREATE TABLE IF NOT EXISTS permit_source_rows (
  source text NOT NULL,
  row_id text NOT NULL,
  permit_number text NOT NULL,
  page_sha256 text NOT NULL CHECK (char_length(page_sha256) = 64),
  row_index int NOT NULL,
  content_sha256 text NOT NULL CHECK (char_length(content_sha256) = 64),
  updated_at timestamptz,
  captured_at timestamptz NOT NULL,
  job_id text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (source, row_id)
);
CREATE INDEX IF NOT EXISTS permit_source_rows_permit ON permit_source_rows (source, permit_number);

-- The current row per permit: (permit_number, issuing_jurisdiction). Austin-issued permits
-- located in another city stay issuing_jurisdiction = 'austin' (FR-022).
CREATE TABLE IF NOT EXISTS property_improvements (
  source text NOT NULL,
  permit_number text NOT NULL,
  issuing_jurisdiction text NOT NULL,
  located_jurisdiction text,
  in_travis boolean,
  source_row_id text NOT NULL,
  tcad_id text,
  request_identifier text,
  link_method text CHECK (link_method IN ('tcad_id', 'address_hash')),
  link_rule text CHECK (link_rule IN ('geoid_unique_r', 'geoid_plus_address', 'address_sig_v1')),
  link_confidence numeric,
  unmatched_reason text CHECK (unmatched_reason IN ('no_tcad_id', 'no_tcad_geoid', 'address_unmatched', 'ambiguous_geoid', 'ambiguous_address')),
  reroof_match boolean,
  status_raw text,
  status_class text CHECK (status_class IN ('open', 'stalled', 'closed', 'exclude', 'needs_review')),
  profile_sha256 text,
  issue_date date,
  expiry_date date,
  open_days int,
  open_days_reason text CHECK (open_days_reason IN ('no_issue_date', 'not_open')),
  latitude double precision,
  longitude double precision,
  coordinate_review_flag text CHECK (coordinate_review_flag IN ('permit_far_from_gis')),
  payload_sha256 text NOT NULL,
  content_sha256 text NOT NULL CHECK (char_length(content_sha256) = 64),
  previous_content_sha256 text,
  updated_in_job text NOT NULL,
  source_url text NOT NULL,
  captured_at timestamptz NOT NULL,
  tombstoned boolean NOT NULL DEFAULT false,
  PRIMARY KEY (permit_number, issuing_jurisdiction),
  -- a linked row has a method and a rule and no reason; an unlinked row the reverse
  CHECK ((request_identifier IS NULL) = (link_method IS NULL)),
  CHECK (request_identifier IS NULL OR unmatched_reason IS NULL),
  CHECK (open_days IS NULL OR open_days_reason IS NULL)
);
CREATE INDEX IF NOT EXISTS property_improvements_request_identifier ON property_improvements (request_identifier);
CREATE INDEX IF NOT EXISTS property_improvements_located ON property_improvements (located_jurisdiction);

-- The `permits --link` job is its own run (backbone_runs.as_of is the date open_days uses).
ALTER TABLE backbone_runs DROP CONSTRAINT IF EXISTS backbone_runs_mode_check;
ALTER TABLE backbone_runs ADD CONSTRAINT backbone_runs_mode_check CHECK (mode IN ('pilot', 'full', 'backfill', 'incremental', 'coords', 'link'));
