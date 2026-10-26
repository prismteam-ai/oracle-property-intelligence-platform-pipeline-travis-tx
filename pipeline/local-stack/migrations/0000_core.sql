-- A-04 0000_core (G-FIX): run bookkeeping shared by every track (data-model.md § 0000).
-- Internal Query DB only; nothing here is public. Later migrations may ALTER these tables,
-- never edit this file (services/migrate.ts refuses a changed sha256).

CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backbone_runs (
  job_id text PRIMARY KEY CHECK (job_id ~ '^travis-a04-[a-z0-9-]+$'),
  track text NOT NULL CHECK (track IN ('appraisal', 'gis', 'permits')),
  mode text NOT NULL CHECK (mode IN ('pilot', 'full', 'backfill', 'incremental', 'coords')),
  status text NOT NULL CHECK (status IN ('running', 'waiting_human', 'blocked', 'complete', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  as_of date,
  export_sha256 text,
  profile_sha256 text,
  gazetteer_sha256 text,
  code_sha text
);

-- FR-025: one ingest run (full TCAD, Austin backfill or incremental) running at a time.
CREATE UNIQUE INDEX IF NOT EXISTS backbone_runs_one_ingest_running
  ON backbone_runs ((true))
  WHERE status = 'running' AND mode IN ('full', 'backfill', 'incremental');

CREATE TABLE IF NOT EXISTS capture_receipts (
  id bigserial PRIMARY KEY,
  job_id text NOT NULL,
  source_key text NOT NULL,
  url text NOT NULL,
  http_status int,
  bytes bigint,
  sha256 text,
  captured_at timestamptz,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'blocked', 'error', 'skipped_checkpoint')),
  attempts int,
  ua text,
  page_key text,
  blocked_at timestamptz,
  CHECK (outcome <> 'blocked' OR blocked_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS capture_receipts_job_source ON capture_receipts (job_id, source_key);

-- Written by the Loader atomically with its merge. TCAD value {prefix, mergedCount,
-- lastMergedAt, hashIndex}; Austin value {lastId, maxUpdatedAt, sourceCountAtW}.
CREATE TABLE IF NOT EXISTS watermarks (
  track text NOT NULL,
  source_key text NOT NULL,
  value jsonb NOT NULL,
  job_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (track, source_key)
);

CREATE TABLE IF NOT EXISTS source_tombstones (
  source_key text NOT NULL,
  row_key text NOT NULL,
  permit_number text,
  reason text NOT NULL CHECK (reason IN ('source_removed')),
  first_missing_at timestamptz NOT NULL,
  evidence_sha256 text,
  job_id text NOT NULL,
  PRIMARY KEY (source_key, row_key)
);

CREATE TABLE IF NOT EXISTS source_limitations (
  job_id text NOT NULL,
  source_key text NOT NULL,
  code text NOT NULL,
  text text NOT NULL,
  count bigint,
  evidence_url text,
  PRIMARY KEY (job_id, source_key, code)
);

-- Merge idempotency: a re-merge of the same (track, artifact sha256) is a no-op.
CREATE TABLE IF NOT EXISTS loader_merges (
  track text NOT NULL,
  artifact_path text NOT NULL,
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  job_id text NOT NULL,
  rows_written bigint NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (track, artifact_sha256)
);
