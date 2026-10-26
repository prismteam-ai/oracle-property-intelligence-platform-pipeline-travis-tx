-- A-07 T004 (Track A): the contractor resolution ledger (data-model.md § "Contractor
-- resolution ledger row"). Append-only: a later resolution is a new row with a later
-- effective_on, never an update in place (resolver.md). Internal only.
CREATE TABLE IF NOT EXISTS contractor_resolution_ledger (
  id bigserial PRIMARY KEY,
  permit_key text NOT NULL,
  raw_contractor_name text,
  state text NOT NULL CHECK (state IN ('resolved', 'candidate', 'ambiguous', 'conflicting', 'unresolved')),
  reason_code text,
  -- Comptroller taxpayer number(s): empty for unresolved, 1 for resolved/candidate/conflicting,
  -- 2+ for ambiguous (resolver.md decision order).
  matched_record_ids text[] NOT NULL DEFAULT '{}',
  match_rule text NOT NULL,
  resolver_version text NOT NULL,
  registry_snapshot_digest text NOT NULL CHECK (char_length(registry_snapshot_digest) = 64),
  effective_on timestamptz NOT NULL,
  job_id text NOT NULL,
  -- exactly one of reason_code set / matched_record_ids non-empty holds per the state
  -- (data-model.md's ledger-row validation).
  CHECK (
    (reason_code IS NOT NULL AND cardinality(matched_record_ids) = 0)
    OR (reason_code IS NULL AND cardinality(matched_record_ids) > 0)
    OR (reason_code IS NULL AND state = 'unresolved' AND cardinality(matched_record_ids) = 0)
  )
);
CREATE INDEX IF NOT EXISTS contractor_resolution_ledger_permit ON contractor_resolution_ledger (permit_key, effective_on DESC);
CREATE INDEX IF NOT EXISTS contractor_resolution_ledger_state ON contractor_resolution_ledger (state);

-- The current (latest effective_on) verdict per permit, used by the five-state totals (T018)
-- and by Track D's contractor-cluster merge (T057, resolved-only).
CREATE OR REPLACE VIEW contractor_resolution_current AS
SELECT DISTINCT ON (permit_key) *
FROM contractor_resolution_ledger
ORDER BY permit_key, effective_on DESC, id DESC;
