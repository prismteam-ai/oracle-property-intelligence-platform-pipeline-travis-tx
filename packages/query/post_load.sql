-- packages/query/post_load.sql  -- run by deploy-build after all bulk loads, before CHECKPOINT.

-- Secondary indexes the operations rely on.
CREATE INDEX idx_properties_geo_id ON properties (geo_id);
CREATE INDEX idx_permits_property ON permits (property_id);
CREATE INDEX idx_permits_contractor ON permits (contractor_attribution_key);
CREATE INDEX idx_business_name ON business_records (name_norm);
CREATE INDEX idx_business_number ON business_records (taxpayer_number);
CREATE INDEX idx_business_sos ON business_records (sos_file_number);
CREATE INDEX idx_license_name ON license_records (name_norm);
CREATE INDEX idx_license_number ON license_records (license_number);
CREATE INDEX idx_centers_norm ON search_centers (name_norm);

-- Full-text index for GET /v1/permits/text-search (decisions 20: porter, english stopwords, digits kept, lower, strip accents).
-- Creates schema fts_main_permit_text; query with fts_main_permit_text.match_bm25(permit_id, ?, fields := ?, conjunctive := ?).
PRAGMA create_fts_index('permit_text', 'permit_id', 'description_norm', 'permit_class_norm', 'work_class_norm',
  stemmer = 'porter', stopwords = 'english', ignore = '(\.|[^a-z0-9])+', strip_accents = 1, lower = 1, overwrite = 1);

ANALYZE;
CHECKPOINT;
