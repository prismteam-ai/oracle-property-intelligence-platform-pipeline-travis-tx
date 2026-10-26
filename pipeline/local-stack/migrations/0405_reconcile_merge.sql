-- A-07 T007 (Track D, data-model.md § "Reconciled property/owner/contractor record"): one row
-- per (job_id, entity_type, tcad_id) merge result. tcadId is the ONLY merge key (P0-5); a
-- candidate cluster whose source rows cite more than one TCAD id is refused and recorded in
-- reconcile_merge_refusals instead, never written here. Internal only, never exported.
CREATE TABLE IF NOT EXISTS reconcile_merges (
  job_id text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('property', 'owner', 'contractor')),
  tcad_id text NOT NULL,
  input_records integer NOT NULL CHECK (input_records >= 1),
  canonical_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, entity_type, tcad_id)
);
CREATE INDEX IF NOT EXISTS reconcile_merges_entity ON reconcile_merges (entity_type);

-- A refused merge: the merge rule (travis/reconcile/merge.ts) refused a cluster because its
-- source rows span two or more TCAD ids. Kept for audit; never promoted into reconcile_merges.
CREATE TABLE IF NOT EXISTS reconcile_merge_refusals (
  job_id text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('property', 'owner', 'contractor')),
  cluster_id text NOT NULL,
  tcad_ids text[] NOT NULL CHECK (array_length(tcad_ids, 1) >= 2),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, entity_type, cluster_id)
);
