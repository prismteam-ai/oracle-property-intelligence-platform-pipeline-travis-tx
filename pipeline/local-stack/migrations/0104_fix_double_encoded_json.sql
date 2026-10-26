-- A-04: parcels.situs_address and parcels.payload_redacted were written as JSON text bound to a
-- jsonb parameter, so the driver encoded them twice and they landed as jsonb STRINGS
-- (jsonb_typeof = 'string'). Re-parse the inner text into the object it encodes.
-- Idempotent: only string-typed values are touched; a string whose text is not valid JSON is left
-- as it is (never fails the batch) and is counted by the verification query below.
CREATE OR REPLACE FUNCTION pg_temp.a04_unwrap_json(v jsonb) RETURNS jsonb AS $$
BEGIN
  RETURN (v #>> '{}')::jsonb;
EXCEPTION WHEN others THEN
  RETURN v;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE parcels SET situs_address = pg_temp.a04_unwrap_json(situs_address)
 WHERE jsonb_typeof(situs_address) = 'string';

UPDATE parcels SET payload_redacted = pg_temp.a04_unwrap_json(payload_redacted)
 WHERE jsonb_typeof(payload_redacted) = 'string';

-- Verification (run by hand; expect 0 string rows unless the inner text was not JSON):
--   SELECT jsonb_typeof(situs_address) t, count(*) FROM parcels GROUP BY 1;
--   SELECT jsonb_typeof(payload_redacted) t, count(*) FROM parcels GROUP BY 1;
