import { z } from "zod";
import type { Row, Snapshot } from "./snapshot.js";

const MILES_PER_DEG_LAT = 69.0;

export const centerSchema = z
  .object({
    latitude: z.number().min(-90).max(90).optional().describe("Center latitude (WGS84)."),
    longitude: z.number().min(-180).max(180).optional().describe("Center longitude (WGS84)."),
    place: z
      .string()
      .min(2)
      .optional()
      .describe(
        "City or place name in/near Travis County, e.g. 'Pflugerville'. Used when lat/lon are absent.",
      ),
    radiusMiles: z.number().positive().max(50).default(5).describe("Search radius in miles."),
  })
  .describe("Search center: give latitude+longitude (GPS / map pin) or a place name.");

export const agedRoofInput = centerSchema.extend({
  minRoofAgeYears: z.number().int().min(0).max(150).default(15),
  ownerLocationClass: z.enum(["local", "regional_texas", "out_of_state", "unknown"]).optional(),
  limit: z.number().int().min(1).max(500).default(50),
});

export const openPermitInput = centerSchema.extend({
  minOpenYears: z.number().min(0).max(100).default(0),
  includeExpiredWithoutFinal: z
    .boolean()
    .default(false)
    .describe("Also include permits that expired without a final inspection (stalled work)."),
  limit: z.number().int().min(1).max(500).default(50),
});

export const ownerLocationInput = centerSchema.extend({
  classes: z
    .array(z.enum(["regional_texas", "out_of_state"]))
    .default(["regional_texas", "out_of_state"]),
  limit: z.number().int().min(1).max(500).default(50),
});

export const tenureInput = centerSchema.extend({
  minYearsSinceTransfer: z.number().min(0).max(100).default(10),
  limit: z.number().int().min(1).max(500).default(50),
});

export const textSearchInput = z.object({
  query: z
    .string()
    .min(2)
    .describe("Free text, e.g. 'tile roof replacement storm damage' or a contractor name."),
  openOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20),
});

export const sqlInput = z.object({
  sql: z
    .string()
    .min(6)
    .describe(
      "A single read-only SELECT/WITH query over tables property_leads, roofing_permits, permits, parcels, contractors, businesses, places, bbb_profiles, geo_places.",
    ),
});

export type Center = {
  latitude: number;
  longitude: number;
  radiusMiles: number;
  resolvedFrom: string;
};

export class QueryError extends Error {}

export async function geocodePlace(s: Snapshot, place: string): Promise<Row[]> {
  return s.all(
    `SELECT geoid, name, basename, place_kind, latitude, longitude,
       jaro_winkler_similarity(lower(basename), lower(?)) AS score
     FROM geo_places ORDER BY score DESC, place_kind LIMIT 5`,
    [place.replace(/,?\s*(tx|texas)$/i, "").trim()],
  );
}

export async function resolveCenter(s: Snapshot, c: z.infer<typeof centerSchema>): Promise<Center> {
  if (c.latitude !== undefined && c.longitude !== undefined) {
    return {
      latitude: c.latitude,
      longitude: c.longitude,
      radiusMiles: c.radiusMiles,
      resolvedFrom: "coordinates",
    };
  }
  if (!c.place) throw new QueryError("Provide latitude+longitude or a place name.");
  const hits = await geocodePlace(s, c.place);
  const best = hits[0];
  if (!best || Number(best.score) < 0.85) {
    throw new QueryError(
      `Could not resolve place '${c.place}'. Closest: ${hits.map((h) => h.name).join(", ")}`,
    );
  }
  return {
    latitude: Number(best.latitude),
    longitude: Number(best.longitude),
    radiusMiles: c.radiusMiles,
    resolvedFrom: `${String(best.name)} (US Census TIGER ${String(best.place_kind)} internal point, GEOID ${String(best.geoid)})`,
  };
}

export function radiusSql(c: Center, alias = ""): { where: string; distance: string } {
  const p = alias ? `${alias}.` : "";
  const dLat = c.radiusMiles / MILES_PER_DEG_LAT;
  const dLon = c.radiusMiles / (MILES_PER_DEG_LAT * Math.cos((c.latitude * Math.PI) / 180));
  const distance = `(3958.8 * 2 * asin(sqrt(power(sin(radians(${p}latitude - ${c.latitude}) / 2), 2) +
    cos(radians(${c.latitude})) * cos(radians(${p}latitude)) * power(sin(radians(${p}longitude - (${c.longitude})) / 2), 2))))`;
  const where = `${p}latitude BETWEEN ${c.latitude - dLat} AND ${c.latitude + dLat}
    AND ${p}longitude BETWEEN ${c.longitude - dLon} AND ${c.longitude + dLon}
    AND ${distance} <= ${c.radiusMiles}`;
  return { where, distance };
}

const leadColumns = `prop_id, geo_id, situs_address, situs_zip, latitude, longitude, owner_name, mail_address,
  owner_location_class, land_use_state_code, market_value, roof_year, roof_age_years, roof_age_basis,
  roof_age_confidence, roof_evidence_date, roof_evidence_permit_number, open_roofing_permit_count,
  oldest_open_roofing_permit_days, oldest_open_roofing_permit_number, last_roofing_permit_number,
  last_roofing_permit_date, parcel_source_id, parcel_source_url, parcel_collected_at`;

export async function findAgedRoofProperties(s: Snapshot, input: z.infer<typeof agedRoofInput>) {
  const c = await resolveCenter(s, input);
  const r = radiusSql(c);
  const ownerFilter = input.ownerLocationClass
    ? `AND owner_location_class = '${input.ownerLocationClass}'`
    : "";
  const stats = (
    await s.all(`SELECT count(*)::INTEGER AS properties_in_radius,
        count(*) FILTER (WHERE roof_age_years >= ${input.minRoofAgeYears})::INTEGER AS matches,
        count(*) FILTER (WHERE roof_age_basis = 'no_evidence')::INTEGER AS no_roof_evidence,
        count(*) FILTER (WHERE roof_age_years >= ${input.minRoofAgeYears} AND roof_age_basis = 'final_roof_replacement_permit')::INTEGER AS matches_from_reroof_permit,
        count(*) FILTER (WHERE roof_age_years >= ${input.minRoofAgeYears} AND roof_age_basis = 'final_new_construction_permit')::INTEGER AS matches_from_new_construction_permit,
        count(*) FILTER (WHERE roof_age_years >= ${input.minRoofAgeYears} AND roof_age_basis = 'tcad_year_built')::INTEGER AS matches_from_year_built
      FROM property_leads WHERE ${r.where} ${ownerFilter}`)
  )[0];
  const rows = await s.all(`SELECT ${leadColumns}, round(${r.distance}, 2) AS distance_miles
    FROM property_leads WHERE ${r.where} ${ownerFilter} AND roof_age_years >= ${input.minRoofAgeYears}
    ORDER BY roof_age_years DESC, distance_miles LIMIT ${input.limit}`);
  return {
    center: c,
    criteria: {
      minRoofAgeYears: input.minRoofAgeYears,
      ownerLocationClass: input.ownerLocationClass ?? null,
    },
    stats,
    results: rows,
    method:
      "Roof year = latest finaled City of Austin re-roof permit for the parcel; else latest finaled new-construction permit for a primary structure; else TCAD year built when loaded. Properties with no evidence cannot be evaluated and are counted in stats.no_roof_evidence.",
  };
}

const permitColumns = `permit_number, prop_id, status, is_open, expired_without_final, roofing_match, description,
  applied_date, issued_date, status_date, expires_date, completed_date, open_days, address, zip, latitude, longitude,
  contractor_id, contractor_name, contractor_company_name, contractor_full_name, contractor_phone,
  contractor_taxpayer_number, contractor_bbb_id, contractor_bbb_rating, contractor_bbb_accredited,
  total_job_valuation, permit_link, source_id, source_url, collected_at`;

export async function findOpenRoofingPermits(s: Snapshot, input: z.infer<typeof openPermitInput>) {
  const c = await resolveCenter(s, input);
  const r = radiusSql(c);
  const minDays = Math.round(input.minOpenYears * 365.25);
  const statusFilter = input.includeExpiredWithoutFinal
    ? `(is_open AND open_days >= ${minDays}) OR (expired_without_final AND date_diff('day', coalesce(issued_date, applied_date), current_date) >= ${minDays})`
    : `is_open AND open_days >= ${minDays}`;
  const stats = (
    await s.all(`SELECT count(*)::INTEGER AS roofing_permits_in_radius,
        count(*) FILTER (WHERE is_open)::INTEGER AS open_in_radius,
        count(*) FILTER (WHERE ${statusFilter})::INTEGER AS matches,
        count(*) FILTER (WHERE (${statusFilter}) AND contractor_bbb_rating IS NOT NULL)::INTEGER AS matches_with_bbb_rating,
        count(*) FILTER (WHERE (${statusFilter}) AND contractor_id IS NOT NULL)::INTEGER AS matches_with_contractor
      FROM roofing_permits WHERE ${r.where}`)
  )[0];
  const rows = await s.all(`SELECT ${permitColumns}, round(${r.distance}, 2) AS distance_miles
    FROM roofing_permits WHERE ${r.where} AND (${statusFilter})
    ORDER BY coalesce(open_days, date_diff('day', coalesce(issued_date, applied_date), current_date)) DESC LIMIT ${input.limit}`);
  return {
    center: c,
    criteria: {
      minOpenYears: input.minOpenYears,
      includeExpiredWithoutFinal: input.includeExpiredWithoutFinal,
    },
    stats,
    results: rows,
    method:
      "Open = City of Austin permit status in (Active, Pending, On Hold, Pending Permit, Re Review, Inactive Pending Revision); open_days measured from issue (or application) date to the snapshot as-of date. BBB rating is shown only when a BBB profile was matched unambiguously to the contractor.",
  };
}

export async function findOwnersByLocation(s: Snapshot, input: z.infer<typeof ownerLocationInput>) {
  const c = await resolveCenter(s, input);
  const r = radiusSql(c);
  const classes = input.classes.map((x) => `'${x}'`).join(", ");
  const stats = await s.all(
    `SELECT owner_location_class, count(*)::INTEGER AS properties FROM property_leads WHERE ${r.where} GROUP BY 1 ORDER BY 2 DESC`,
  );
  const rows =
    await s.all(`SELECT ${leadColumns}, mail_city, mail_state, mail_zip, round(${r.distance}, 2) AS distance_miles
    FROM property_leads WHERE ${r.where} AND owner_location_class IN (${classes})
    ORDER BY roof_age_years DESC NULLS LAST, distance_miles LIMIT ${input.limit}`);
  return {
    center: c,
    stats,
    results: rows,
    method:
      "Owner location from the TCAD mailing address: local = mailing ZIP is a Travis County situs ZIP; regional_texas = elsewhere in Texas; out_of_state = non-TX mailing state.",
  };
}

export async function findLongTenureOwners(s: Snapshot, input: z.infer<typeof tenureInput>) {
  const c = await resolveCenter(s, input);
  const r = radiusSql(c);
  const known = (
    await s.all(
      `SELECT count(*)::INTEGER AS n FROM property_leads WHERE last_deed_date IS NOT NULL`,
    )
  )[0];
  const rows =
    await s.all(`SELECT ${leadColumns}, last_deed_date, round(${r.distance}, 2) AS distance_miles
    FROM property_leads WHERE ${r.where} AND last_deed_date IS NOT NULL
      AND date_diff('year', last_deed_date, current_date) >= ${input.minYearsSinceTransfer}
    ORDER BY last_deed_date LIMIT ${input.limit}`);
  return {
    center: c,
    results: rows,
    dataAvailability: {
      propertiesWithDeedDate: Number(known?.n ?? 0),
      limitation:
        Number(known?.n ?? 0) === 0
          ? "Deed/sale dates are not loaded yet: they come from the TCAD appraisal export, which is blocked from the current (non-US) runner and is scheduled for the AWS us-east-2 run. No ownership-tenure answer can be given from current data."
          : null,
    },
  };
}

export async function getProperty(s: Snapshot, propId: string) {
  const lead = (await s.all(`SELECT * FROM property_leads WHERE prop_id = ?`, [propId]))[0];
  if (!lead) throw new QueryError(`Unknown prop_id ${propId}`);
  const roofing = await s.all(
    `SELECT ${permitColumns} FROM roofing_permits WHERE prop_id = ? ORDER BY issued_date DESC NULLS LAST`,
    [propId],
  );
  const permits = await s.all(
    `SELECT permit_number, permit_type_desc, work_class, description, status, issued_date, completed_date, contractor_company_name, permit_link, source_url
     FROM permits WHERE prop_id = ? ORDER BY issued_date DESC NULLS LAST LIMIT 50`,
    [propId],
  );
  return { property: lead, roofingPermits: roofing, recentPermits: permits };
}

export async function getContractor(s: Snapshot, ref: { contractorId?: string; name?: string }) {
  const rows = ref.contractorId
    ? await s.all(`SELECT * FROM contractors WHERE contractor_id = ?`, [ref.contractorId])
    : await s.all(
        `SELECT *, jaro_winkler_similarity(lower(display_name), lower(?)) AS score FROM contractors
         ORDER BY score DESC, roofing_permit_count DESC LIMIT 5`,
        [ref.name ?? ""],
      );
  const top = rows[0];
  if (!top) throw new QueryError("No contractor found");
  const id = String(top.contractor_id);
  const business = top.taxpayer_number
    ? await s.all(`SELECT * FROM businesses WHERE taxpayer_number = ?`, [
        String(top.taxpayer_number),
      ])
    : [];
  const bbb = top.bbb_id
    ? await s.all(`SELECT * FROM bbb_profiles WHERE bbb_id = ?`, [String(top.bbb_id)])
    : [];
  const recent = await s.all(
    `SELECT ${permitColumns} FROM roofing_permits WHERE contractor_id = ? ORDER BY issued_date DESC NULLS LAST LIMIT 25`,
    [id],
  );
  return {
    contractor: top,
    candidates: rows.slice(1),
    business: business[0] ?? null,
    bbb: bbb[0] ?? null,
    recentRoofingPermits: recent,
  };
}

export async function searchPermitText(s: Snapshot, input: z.infer<typeof textSearchInput>) {
  const rows = await s.all(
    `SELECT ${permitColumns
      .split(",")
      .map((x) => `p.${x.trim()}`)
      .join(", ")}, t.score
     FROM (SELECT permit_number, fts_main_permit_text.match_bm25(permit_number, ?) AS score FROM permit_text) t
     JOIN roofing_permits p USING (permit_number)
     WHERE t.score IS NOT NULL ${input.openOnly ? "AND p.is_open" : ""}
     ORDER BY t.score DESC LIMIT ${input.limit}`,
    [input.query],
  );
  return {
    query: input.query,
    results: rows,
    method:
      "BM25 full-text retrieval over roofing-permit descriptions, contractor names and addresses.",
  };
}

const FORBIDDEN =
  /\b(insert|update|delete|drop|create|alter|attach|detach|copy|export|import|install|load|pragma|set|call|checkpoint|vacuum|getenv|current_setting|glob)\b|\bread_\w+\s*\(|\b(parquet_scan|sniff_csv|query_table)\s*\(|['"][^'"]*(\/|https?:)/i;

export async function runReadOnlySql(s: Snapshot, input: z.infer<typeof sqlInput>) {
  const sql = input.sql.trim().replace(/;+\s*$/, "");
  if (!/^(select|with)\b/i.test(sql) || sql.includes(";") || FORBIDDEN.test(sql)) {
    throw new QueryError("Only a single read-only SELECT/WITH statement is allowed.");
  }
  const rows = await s.all(`SELECT * FROM (${sql}) LIMIT 500`);
  return { rowCount: rows.length, rows };
}

export async function getRunSummary(s: Snapshot) {
  const run = s.runJson as {
    run?: Row;
    sources?: Row[];
    runHistory?: Row[];
    derived?: Row;
    asOf?: string;
  };
  return {
    snapshot: { base: s.source.base, runId: s.source.runId, rootCid: s.source.rootCid },
    asOf: run.asOf,
    run: run.run,
    sources: run.sources,
    derived: run.derived,
    coverage: s.coverage,
    runHistory: run.runHistory,
    tables: Object.fromEntries(Object.entries(s.schema).map(([k, v]) => [k, v.description])),
  };
}

export function describeSchema(s: Snapshot) {
  return s.schema;
}
