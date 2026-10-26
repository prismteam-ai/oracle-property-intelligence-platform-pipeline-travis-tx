-- A-04 0303_permit_page_key (DP-5): which captured page a current permit row came from.
-- page_key is the page's key in capture_receipts (page-NNNNNN); payload_sha256 already holds
-- the page's SHA-256, so the pair points at the raw page artifact. Existing rows stay NULL
-- until their page is next merged. Internal only.
ALTER TABLE property_improvements ADD COLUMN IF NOT EXISTS page_key text;
