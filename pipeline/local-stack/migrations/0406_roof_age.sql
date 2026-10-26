-- A-07 T008 (Track D, data-model.md § "Roof-age estimate", contracts/estimator.md): one row
-- per reconciled property's roof-age estimate. Written only by the roof-age run
-- (pipeline/oracle-runtime/travis/roof-age/run.ts) invoking the unmodified, vendored kit
-- estimator; never derived here in SQL (that derivation lives, separately and for comparison
-- only, in packages/query-core's view-side rules). roofAgeYears is null iff basis = 'unknown'.
CREATE TABLE IF NOT EXISTS roof_age_estimates (
  tcad_id text PRIMARY KEY REFERENCES parcels (request_identifier),
  job_id text NOT NULL,
  roof_age_basis text NOT NULL
    CHECK (roof_age_basis IN ('permit', 'new_construction', 'built_year', 'unknown')),
  roof_age_confidence text NOT NULL
    CHECK (roof_age_confidence IN ('high', 'medium', 'low', 'none')),
  roof_age_years numeric,
  as_of_date date NOT NULL,
  source_records jsonb NOT NULL,
  profile_version text NOT NULL,
  profile_sha256 text NOT NULL CHECK (profile_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((roof_age_basis = 'unknown') = (roof_age_years IS NULL))
);
CREATE INDEX IF NOT EXISTS roof_age_estimates_basis ON roof_age_estimates (roof_age_basis);
