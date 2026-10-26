// T012 (A-14, agent-design.md § 2.2, 9): permitsSql() + its count statement, over
// v_roofing_permit ⋈ v_property. Radius is optional (omitted = county-wide, AC-10); status_class
// and minimum-open-years are the other two shared filters with listPermits' Zod schema.
// geoFilter() is the same bbox-prefilter-then-haversine shape as builders.ts's private geo()
// helper (same constants, same formula): that helper is not exported, and this join (permits to
// v_property's geometry) is a different relation shape than radiusSql/roofAgeSql, so it is
// re-expressed here rather than reaching into builders.ts's private scope. No string here ever
// carries unvalidated user text: permit_number is quoted through the same escaping builders.ts
// would use, and status_class values are checked against the closed enum before being embedded.
import { EARTH_RADIUS_M, MAX_ROWS, METRES_PER_MILE } from "./builders.js";

const MIN_METRES_PER_DEGREE = 110_574;
export const DAYS_PER_YEAR = 365.25;

export const PERMIT_STATUS_CLASS_VALUES = ["open", "stalled", "closed"] as const;
export type PermitStatusClass = (typeof PERMIT_STATUS_CLASS_VALUES)[number];

interface PermitsCentre {
  lat: number;
  lon: number;
}

export interface GeoFilter {
  bbox: string;
  distance: string;
  radiusM: number;
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

/** The bbox prefilter and the haversine distance (metres) over `<alias>.latitude/longitude`,
 *  the same shape builders.ts's radiusSql/roofAgeSql use. Shared by permitsSql and, through this
 *  export, tools/functions.ts's searchProperties (T011), so the two surfaces agree on distance. */
export function geoFilter(lat: number, lon: number, miles: number, alias = "p"): GeoFilter {
  inRange("lat", lat, -90, 90);
  inRange("lon", lon, -180, 180);
  inRange("miles", miles, Number.MIN_VALUE, 25);
  const radiusM = Number((miles * METRES_PER_MILE).toFixed(3));
  const dLat = radiusM / MIN_METRES_PER_DEGREE;
  // cos(lat) -> 0 as |lat| -> 90 deg, which would blow up dLon; Travis County (≈30.4N) is nowhere
  // near a pole, and tools/functions.ts's resolveArea doesn't yet reject an out-of-Travis bare
  // point (A-13 territory, per its own docstring), so this input range is not independently
  // bounded here either. A-14 review round, 2026-10-22: confirmed real but practically
  // unreachable for this story's data; not fixed here, tracked alongside the out-of-Travis
  // bare-point rejection as A-13-dependent follow-up work.
  const dLon = dLat / Math.cos((lat * Math.PI) / 180);
  const la = `${alias}.latitude`;
  const lo = `${alias}.longitude`;
  return {
    bbox: `${la} BETWEEN ${lat - dLat} AND ${lat + dLat} AND ${lo} BETWEEN ${lon - dLon} AND ${lon + dLon}`,
    distance: `2 * ${EARTH_RADIUS_M} * asin(sqrt(pow(sin(radians(${la} - (${lat})) / 2), 2) + cos(radians(${lat})) * cos(radians(${la})) * pow(sin(radians(${lo} - (${lon})) / 2), 2)))`,
    radiusM,
  };
}

const str = (s: string): string => `'${s.replace(/'/g, "''")}'`;

export interface PermitsFilter {
  centre?: (PermitsCentre & { miles: number }) | undefined;
  permitNumber?: string | undefined;
  propertyCid?: string | undefined;
  statusClass?: readonly string[] | undefined;
  openYearsMin?: number | undefined;
  sort?: "open_desc" | "nearest" | "issue_desc" | undefined;
  limit?: number | undefined;
}

function validateStatusClass(classes: readonly string[]): void {
  const known = new Set<string>(PERMIT_STATUS_CLASS_VALUES);
  for (const c of classes) if (!known.has(c)) throw new RangeError(`unknown status_class: ${c}`);
}

/** The WHERE clauses and the optional distance SELECT, shared by permitsSql and
 *  permitsCountSql so the two statements always agree on which rows are in scope. */
function build(filter: PermitsFilter, withGeo = true): { where: string[]; distanceSelect: string } {
  const where: string[] = [];
  let distanceSelect = "";
  if (filter.centre && withGeo) {
    const { lat, lon, miles } = filter.centre;
    const { bbox, distance, radiusM } = geoFilter(lat, lon, miles);
    where.push(
      `p.latitude IS NOT NULL AND p.longitude IS NOT NULL AND ${bbox} AND ${distance} < ${radiusM}`,
    );
    distanceSelect = `, ${distance} AS dist_m`;
  }
  if (filter.permitNumber !== undefined)
    where.push(`r.permit_number = ${str(filter.permitNumber)}`);
  if (filter.propertyCid !== undefined) where.push(`r.property_cid = ${str(filter.propertyCid)}`);
  if (filter.statusClass && filter.statusClass.length > 0) {
    validateStatusClass(filter.statusClass);
    where.push(`r.status_class IN (${filter.statusClass.map(str).join(", ")})`);
  }
  if (filter.openYearsMin !== undefined) {
    inRange("openYearsMin", filter.openYearsMin, 0, 60);
    where.push(`r.open_days >= ${(filter.openYearsMin * DAYS_PER_YEAR).toFixed(4)}`);
  }
  return { where, distanceSelect };
}

/** `nearest` needs a centre (dist_m is selected only then). Without one it falls back to the
 *  county-wide default, open days descending; callers echo the sort actually applied. */
export function effectivePermitSort(
  sort: PermitsFilter["sort"],
  hasCentre: boolean,
): NonNullable<PermitsFilter["sort"]> {
  if (sort === "nearest") return hasCentre ? "nearest" : "open_desc";
  return sort ?? "open_desc";
}

function orderClause(sort: PermitsFilter["sort"], hasCentre: boolean): string {
  sort = effectivePermitSort(sort, hasCentre);
  if (sort === "nearest") return "dist_m, r.cid";
  if (sort === "issue_desc") return "r.issue_date DESC NULLS LAST, r.cid";
  return "r.open_days DESC NULLS LAST, r.cid";
}

/** Permit-level rows (one per v_roofing_permit row) inside an optional radius, filtered by
 *  status_class / minimum open years / an exact permit_number or property_cid, sorted by
 *  open_days descending by default. county-wide when `centre` is omitted (AC-10). */
export function permitsSql(filter: PermitsFilter = {}): string {
  const limit = integer("limit", filter.limit ?? 500, 1, MAX_ROWS);
  const { where, distanceSelect } = build(filter);
  return `SELECT r.*${distanceSelect}
FROM v_roofing_permit r
JOIN v_property p ON p.property_cid = r.property_cid${
    where.length > 0 ? `\nWHERE ${where.join("\n  AND ")}` : ""
  }
ORDER BY ${orderClause(filter.sort, filter.centre !== undefined)}
LIMIT ${limit}`;
}

/** The true row count for the same filter as permitsSql, so `total`/`truncated` never come from
 *  `rows.length`. */
export function permitsCountSql(filter: PermitsFilter = {}): string {
  const { where } = build(filter);
  return `SELECT count(*) AS n
FROM v_roofing_permit r
JOIN v_property p ON p.property_cid = r.property_cid${
    where.length > 0 ? `\nWHERE ${where.join("\n  AND ")}` : ""
  }`;
}

/** Roofing permits an area search cannot place in the radius, counted with a LEFT JOIN so they are
 *  reported instead of silently dropped. Uses only the filters that do not depend on the property
 *  (permit_number, status_class, open_years_min): `property_link` = permits with no matching
 *  v_property row; `coordinates` = permits whose property row has a null latitude or longitude. */
export function permitsUnplacedCountSql(filter: PermitsFilter = {}): string {
  const { where } = build(filter, false);
  return `SELECT
  coalesce(sum(CASE WHEN p.property_cid IS NULL THEN 1 ELSE 0 END), 0) AS property_link,
  coalesce(sum(CASE WHEN p.property_cid IS NOT NULL AND (p.latitude IS NULL OR p.longitude IS NULL) THEN 1 ELSE 0 END), 0) AS coordinates
FROM v_roofing_permit r
LEFT JOIN v_property p ON p.property_cid = r.property_cid${
    where.length > 0 ? `\nWHERE ${where.join("\n  AND ")}` : ""
  }`;
}
