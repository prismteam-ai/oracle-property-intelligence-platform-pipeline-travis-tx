-- A-04 (G-FIX): store the profile's roofing verdict beside reroof_match.
-- reroof_match stays "the profile's include terms matched" (the baseline population of the status
-- split); these columns keep what the frozen profile travis-austin@1.0.0 decided about the row
-- (roofing | not_roofing | needs_review), why (include_term, an exclude id such as solar_pv,
-- trade_permit, a needs_review id, no_include_term) and the improvement type and action it
-- publishes. Nullable: unclassified rows (not yet linked) carry NULL.
ALTER TABLE property_improvements ADD COLUMN IF NOT EXISTS roofing_verdict text;
ALTER TABLE property_improvements ADD COLUMN IF NOT EXISTS roofing_reason text;
ALTER TABLE property_improvements ADD COLUMN IF NOT EXISTS improvement_type text;
ALTER TABLE property_improvements ADD COLUMN IF NOT EXISTS improvement_action text;
ALTER TABLE property_improvements DROP CONSTRAINT IF EXISTS property_improvements_roofing_verdict_check;
ALTER TABLE property_improvements
  ADD CONSTRAINT property_improvements_roofing_verdict_check
  CHECK (roofing_verdict IN ('roofing', 'not_roofing', 'needs_review'));
