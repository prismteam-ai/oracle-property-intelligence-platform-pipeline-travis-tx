// T014 (A-03, AD-19, contracts/api.md): the product queries over the contract/v1 views, in one
// place, as SQL text for any QueryEngine (the Lambda's @duckdb/node-api and the browser's
// DuckDB-WASM). Nothing here derives a value: every column comes from the views, roof age is the
// view's roof_age_years (relative to the run's as_of) and as_of is always a parameter, never
// now(). The engine's TimeZone must be UTC (scripts/duckdb-engine.ts sets it) so the as_of date is
// the manifest's UTC calendar date.
import { PROVENANCE_COLUMNS, VIEWS } from "@countylens/contract";

/** The most rows one query returns (AD-21). */
export const MAX_ROWS = 1000;
export const DEFAULT_LIMIT = 500;
export const METRES_PER_MILE = 1609.344;
/** Mean Earth radius (IUGG), the value the ADR-0001 spike harness used. */
export const EARTH_RADIUS_M = 6371008.8;
/** Metres per degree of latitude at the equator, the smallest on Earth: dividing by it makes the
 *  bbox a superset of the circle everywhere, so the haversine is the only cut. */
const MIN_METRES_PER_DEGREE = 110_574;

const PERMIT_COLUMNS = [
  "permit_number",
  "improvement_status",
  "status_class",
  "issue_date",
  "final_date",
  "permit_close_date",
  "open_days",
  "contractor_resolution",
  "contractor_name_as_printed",
  "bbb_url",
] as const;

/** The Permits page list (FR-008): the permit columns, provenance and `missing`, one row per
 *  v_roofing_permit row, ordered by permit_number (cid breaks ties between edges of one permit). */
export function listRoofingPermitsSql(): string {
  const provenance = PROVENANCE_COLUMNS.map((c) => c.name).filter((n) => n !== "missing");
  const columns = [...PERMIT_COLUMNS, ...provenance, "missing"];
  const known = new Set(VIEWS.v_roofing_permit.map((c) => c.name));
  for (const c of columns)
    if (!known.has(c)) throw new Error(`listRoofingPermitsSql: v_roofing_permit has no ${c}`);
  return `SELECT ${columns.map((c) => `"${c}"`).join(", ")}
FROM v_roofing_permit
ORDER BY permit_number, cid`;
}

/** One row for runs.summary (contracts/api.md): the bound run's identity and its roofing-permit
 *  row count; the headline counts on the Runs page still come from the manifest (FR-009). */
export function runSummarySql(): string {
  return `SELECT r.run_id, r.manifest_cid, r.finished_at,
  (SELECT count(*)::INTEGER FROM v_roofing_permit) AS roofing_permit_rows
FROM v_run r`;
}

export interface Centre {
  /** Degrees, [-90, 90]. */
  lat: number;
  /** Degrees, [-180, 180]. */
  lon: number;
}

export interface RadiusInput extends Centre {
  /** Statute miles, (0, 25]. */
  miles: number;
  /** Rows returned, an integer in [1, MAX_ROWS]; default DEFAULT_LIMIT. */
  limit?: number;
}

export interface RoofAgeInput extends RadiusInput {
  /** Whole years, [1, 100]: rows with roof_age_years ≥ minYears, plus rows whose age is unknown. */
  minYears: number;
  /** The manifest finishedAt (ISO 8601 UTC instant); reported as as_of_date, never now(). */
  asOf: string;
}

const inRange = (name: string, value: number, min: number, max: number): number => {
  if (typeof value !== "number" || !(value >= min && value <= max))
    throw new RangeError(`${name} must be a number in [${min}, ${max}], got ${String(value)}`);
  return value;
};
const integer = (name: string, value: number, min: number, max: number): number => {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new RangeError(`${name} must be an integer in [${min}, ${max}], got ${String(value)}`);
  return value;
};

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const instant = (name: string, value: string): string => {
  if (typeof value !== "string" || !ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value)))
    throw new RangeError(`${name} must be an ISO 8601 UTC instant, got ${JSON.stringify(value)}`);
  return value;
};

interface Radius {
  lat: number;
  lon: number;
  radiusM: number;
  limit: number;
}

function radius(input: RadiusInput): Radius {
  const lat = inRange("lat", input.lat, -90, 90);
  const lon = inRange("lon", input.lon, -180, 180);
  const miles = inRange("miles", input.miles, Number.MIN_VALUE, 25);
  const limit = integer("limit", input.limit ?? DEFAULT_LIMIT, 1, MAX_ROWS);
  return { lat, lon, radiusM: Number((miles * METRES_PER_MILE).toFixed(3)), limit };
}

/** The bbox prefilter and the haversine distance (metres) over `<alias>.latitude/longitude`.
 *  Exported as `geoSql` for the Explore search builder (explore.ts, A-13), so every radius query
 *  shares one bbox and one haversine. */
export function geoSql(
  centre: { lat: number; lon: number; radiusM: number },
  alias = "p",
): { bbox: string; distance: string } {
  return geo({ ...centre, limit: 1 }, alias);
}

function geo({ lat, lon, radiusM }: Radius, alias = "p"): { bbox: string; distance: string } {
  const dLat = radiusM / MIN_METRES_PER_DEGREE;
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  const la = `${alias}.latitude`;
  const lo = `${alias}.longitude`;
  return {
    bbox: `${la} BETWEEN ${lat - dLat} AND ${lat + dLat} AND ${lo} BETWEEN ${lon - dLon} AND ${lon + dLon}`,
    distance: `2 * ${EARTH_RADIUS_M} * asin(sqrt(pow(sin(radians(${la} - (${lat})) / 2), 2) + cos(radians(${lat})) * cos(radians(${la})) * pow(sin(radians(${lo} - (${lon})) / 2), 2)))`,
  };
}

/** query.radius: every v_property row (with provenance) inside the radius, nearest first, plus
 *  `distance_m`. A lat/lon bbox prefilters, then the haversine decides. */
export function radiusSql(input: RadiusInput): string {
  const r = radius(input);
  const { bbox, distance } = geo(r);
  return `SELECT p.*, ${distance} AS distance_m
FROM v_property p
WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
  AND ${bbox}
  AND ${distance} < ${r.radiusM}
ORDER BY distance_m, p.cid
LIMIT ${r.limit}`;
}

/** query.roofAge: the radius rows whose roof_age_years ≥ minYears, and the rows whose age is
 *  unknown (they keep their `missing` reasons, e.g. no_roof_date), known ages first, nearest
 *  first. `as_of_date` is the manifest finishedAt passed in, the date roof_age_years counts to. */
export function roofAgeSql(input: RoofAgeInput): string {
  const r = radius(input);
  const minYears = integer("minYears", input.minYears, 1, 100);
  const asOf = instant("asOf", input.asOf);
  const { bbox, distance } = geo(r);
  return `SELECT p.*, ${distance} AS distance_m, CAST(CAST('${asOf}' AS TIMESTAMPTZ) AS DATE) AS as_of_date
FROM v_property p
WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
  AND ${bbox}
  AND ${distance} < ${r.radiusM}
  AND (p.roof_age_years >= ${minYears} OR p.roof_age_years IS NULL)
ORDER BY (p.roof_age_years IS NULL), distance_m, p.cid
LIMIT ${r.limit}`;
}
