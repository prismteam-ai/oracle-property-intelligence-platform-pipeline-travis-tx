-- A-04 0102_tcad_type_rule: how parcels.property_type was chosen (internal Query DB only).
-- Added after 0101_tcad was applied (migrations are append-only). `state_code_table` = the
-- STATE_CODES table (A-02 pilot mapping); `improvement_fallback` = a state code with no table
-- entry on an emitted (R) account, typed Building when the record prints at least one
-- improvement and VacantLand when it prints none. The note says which code and which fact.

ALTER TABLE parcels
  ADD COLUMN IF NOT EXISTS property_type_rule text,
  ADD COLUMN IF NOT EXISTS property_type_note text;

ALTER TABLE parcels
  ADD CONSTRAINT parcels_property_type_rule_check
    CHECK (property_type_rule IN ('state_code_table', 'improvement_fallback'));

-- Rows loaded before this migration only ever carried table-mapped types.
UPDATE parcels SET property_type_rule = 'state_code_table'
  WHERE property_type IS NOT NULL AND property_type_rule IS NULL;
