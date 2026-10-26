-- A-11 Run 3 (ERR-71, docs/decisions/0003-tenure-from-transfer-deeds.md): parcels.tenure_basis
-- gains `deed_date` for an account whose latest dated transfer is a TCAD transfer deed.
-- Added after 0101_tcad was applied (migrations are append-only). The multi-column rule that
-- ties `unknown` to null tenure columns is unchanged and needs no edit.

ALTER TABLE parcels DROP CONSTRAINT IF EXISTS parcels_tenure_basis_check;
ALTER TABLE parcels
  ADD CONSTRAINT parcels_tenure_basis_check
    CHECK (tenure_basis IN ('sale_date', 'deed_date', 'unknown'));
