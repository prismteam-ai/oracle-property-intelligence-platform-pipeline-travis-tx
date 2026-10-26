-- A-04: a permit whose tcad_id is on no roll account (a retired geoID) but whose address matches
-- exactly one R account is linked by address (link_method address_hash, link_rule address_sig_v1);
-- stale_tcad_id records that the printed tcad_id did not resolve. Internal only.
ALTER TABLE property_improvements ADD COLUMN IF NOT EXISTS stale_tcad_id boolean NOT NULL DEFAULT false;
