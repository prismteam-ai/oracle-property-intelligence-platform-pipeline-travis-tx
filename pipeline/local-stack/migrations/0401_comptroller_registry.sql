-- A-07 T003 (Track A): the Texas Comptroller "Active Franchise Tax Permit Holders" registry
-- (Socrata `9cir-efmm`, data-model.md § "Company record"), staged and loaded by the single
-- shared adapter (oracle-runtime travis/adapters/socrata/tx-comptroller.ts) and the Loader's
-- `comptroller` track (pipeline/local-stack/services/tracks/comptroller.ts). Internal only;
-- nothing here is public (query-db-loading-matching: "the Query DB is not the public source").
-- Reused, never re-fetched, by Track C's business transform (T039).

-- One row per Comptroller taxpayer (Travis-scoped load, county code 227, D-1/D-6). Upserted
-- ON CONFLICT on taxpayer_number; updated_at is the Socrata `:updated_at` watermark field, so a
-- re-load only advances rows whose source side actually changed.
CREATE TABLE IF NOT EXISTS comptroller_registry (
  taxpayer_number text PRIMARY KEY,
  legal_name text NOT NULL,
  sos_status_code text,
  mailing_address text,
  sos_file_number text,
  source_url text NOT NULL,
  captured_at timestamptz NOT NULL,
  updated_at timestamptz,
  job_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS comptroller_registry_legal_name ON comptroller_registry (upper(legal_name));

-- One row per county-scoped load: the registry snapshot digest (sha256 of the sorted row set,
-- AD-26 pattern) a resolver run cites, plus the Socrata watermark and row count for the
-- registry-load-report.json (T019) and the manifest's `business_count` metric (Track C).
CREATE TABLE IF NOT EXISTS comptroller_registry_loads (
  job_id text PRIMARY KEY,
  scope text NOT NULL,
  row_count integer NOT NULL,
  watermark text,
  snapshot_digest text NOT NULL CHECK (char_length(snapshot_digest) = 64),
  source_url text NOT NULL,
  loaded_at timestamptz NOT NULL
);
