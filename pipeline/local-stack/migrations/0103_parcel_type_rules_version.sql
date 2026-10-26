-- A-04 0103_parcel_type_rules_version: which property_type rule set chose parcels.property_type
-- (DP-7: reproducibility). Added after 0102 (migrations are append-only). Internal Query DB only.
-- Rows loaded before this migration carry no version (NULL): they were typed by the pilot rule
-- set, where the no-improvement fallback was VacantLand; a re-load stamps the new version.

ALTER TABLE parcels
  ADD COLUMN IF NOT EXISTS property_type_rules_version text;

ALTER TABLE parcels
  ADD CONSTRAINT parcels_property_type_rules_version_check
    CHECK (property_type_rules_version IS NULL OR property_type_rules_version ~ '^property_type_rules@[0-9]{4}-[0-9]{2}-[0-9]{2}$');
