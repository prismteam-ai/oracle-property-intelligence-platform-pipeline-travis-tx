// T064 (A-02, FR-008): the 20-row sample for Task B, cut from the bound views only (never the
// Query DB, never raw captures). Each row is one v_roofing_permit row joined to its v_property row,
// with the columns of @countylens/contract SAMPLE_COLUMNS.
import { SAMPLE_COLUMNS, SAMPLE_PROPERTY_PREFIX, VIEWS } from "@countylens/contract";

export const SAMPLE_SIZE = 20;

/** The recorded, deterministic cut rule (also printed in contract/v1/README.md). */
export const SAMPLE_RULE =
  "v_roofing_permit joined to v_property on property_cid; ordered by status_class = 'stalled' first, " +
  "then rows with a non-null roof_age_years, then permit_cid ascending; the first 20 rows.";

const q = (name: string): string => `"${name}"`;

/** The SELECT that produces the sample rows, in SAMPLE_COLUMNS order. */
export function sampleSql(): string {
  const permit = new Set(VIEWS.v_roofing_permit.map((c) => c.name));
  const select = SAMPLE_COLUMNS.map((c) => {
    // request_identifier is the property's in the sample (the permit's is not sampled).
    if (permit.has(c.name) && c.name !== "request_identifier") return `r.${q(c.name)}`;
    if (
      c.name.startsWith(SAMPLE_PROPERTY_PREFIX) &&
      !VIEWS.v_property.some((p) => p.name === c.name)
    )
      return `p.${q(c.name.slice(SAMPLE_PROPERTY_PREFIX.length))} AS ${q(c.name)}`;
    return `p.${q(c.name)}`;
  });
  return `SELECT ${select.join(", ")}
FROM v_roofing_permit r
JOIN v_property p ON p.property_cid = r.property_cid
ORDER BY (r.status_class = 'stalled') DESC, (p.roof_age_years IS NOT NULL) DESC, r.permit_cid
LIMIT ${SAMPLE_SIZE}`;
}
