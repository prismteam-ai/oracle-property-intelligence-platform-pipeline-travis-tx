// T014 (A-03, ADR-0001 § Method "Queries", research R-04, contracts/api.md "bench"): the
// read-path proof queries the API Lambda runs on direct invoke over the raw Austin 3syk-w9eu
// Parquet under the private prefix (never a public route, never v_property).
//
// PERFORMANCE STAND-IN, NOT A ROOF CLASSIFICATION (P0-9). The "roof-age" query counts permits by
// the age of their issue_date because that has the same cost profile (one date column + the
// radius) as roof_age_years over structure.roof_date in v_property. It classifies nothing and its
// result is never shown as data. The bbox, haversine, selected columns and the fixed date are
// exactly the spike harness's (spikes/read-path/harness/src/main.ts), so the Lambda numbers
// compare with the browser numbers in docs/decisions/0001-read-path.md.
import { EARTH_RADIUS_M, MAX_ROWS, METRES_PER_MILE } from "./builders.js";

export const BENCH_STAND_IN_NOTE = "performance stand-in, not a roof classification";
/** The spike's fixed as-of date (2026-10-21). The bench never uses now(). */
export const BENCH_AS_OF = "2026-10-21";

export interface BenchParams {
  lat: number;
  lon: number;
  /** Radius in statute miles. */
  miles: number;
  /** The roof-age stand-in threshold, in whole years before BENCH_AS_OF. */
  minYears: number;
  /** Rows the radius query returns (≤ MAX_ROWS). */
  limit: number;
}

export const BENCH_PRESETS = {
  /** TC-NF-05 (G6): downtown Austin, 1 statute mile, "roofs" ≥ 15 years. */
  TC_NF_05: { lat: 30.2672, lon: -97.7431, miles: 1, minYears: 15, limit: 500 },
  /** ADR-0001: Pflugerville city point (travis-places@1.0.0), 5 statute miles (8,046.72 m),
   *  LIMIT 500, ≥ 15 years: the spike's own query, for comparability. */
  ADR_0001: { lat: 30.447765, lon: -97.602116, miles: 5, minYears: 15, limit: 500 },
} as const satisfies Record<string, BenchParams>;
export type BenchPreset = keyof typeof BENCH_PRESETS;

/** Metres of `miles`, rounded to the millimetre so 5 mi prints as the spike's 8046.72. */
const metres = (miles: number): number => Number((miles * METRES_PER_MILE).toFixed(3));

/** The spike's bbox and haversine over bare `latitude` / `longitude` columns. */
function spikeGeo(p: BenchParams): { radiusM: number; hav: string; bbox: string } {
  if (!(p.miles > 0)) throw new RangeError(`bench miles must be > 0, got ${p.miles}`);
  if (!Number.isInteger(p.limit) || p.limit < 1 || p.limit > MAX_ROWS)
    throw new RangeError(`bench limit must be an integer in [1, ${MAX_ROWS}], got ${p.limit}`);
  if (!Number.isInteger(p.minYears) || p.minYears < 0)
    throw new RangeError(`bench minYears must be a whole number, got ${p.minYears}`);
  const radiusM = metres(p.miles);
  const dLat = radiusM / 111_320;
  const dLon = dLat / Math.cos((p.lat * Math.PI) / 180);
  const hav = `2*${EARTH_RADIUS_M}*asin(sqrt(pow(sin(radians(latitude-${p.lat})/2),2)+cos(radians(${p.lat}))*cos(radians(latitude))*pow(sin(radians(longitude-(${p.lon}))/2),2)))`;
  const bbox = `latitude BETWEEN ${p.lat - dLat} AND ${p.lat + dLat} AND longitude BETWEEN ${p.lon - dLon} AND ${p.lon + dLon}`;
  return { radiusM, hav, bbox };
}

/** `table` is the relation the Lambda bound over the private parts (default `t`, as in the spike). */
export const benchCountSql = (table = "t"): string => `SELECT count(*) AS n FROM ${table}`;

/** The 500 nearest permits inside the radius, as the spike selected them. */
export function benchRadiusSql(p: BenchParams, table = "t"): string {
  const { radiusM, hav, bbox } = spikeGeo(p);
  return `SELECT permit_number, permit_type_desc, issue_date, original_address1, latitude, longitude, ${hav} AS d_m
FROM ${table} WHERE ${bbox} AND ${hav} < ${radiusM} ORDER BY d_m LIMIT ${p.limit}`;
}

/** Counts permits inside the radius issued ≥ minYears before BENCH_AS_OF: the stand-in (P0-9). */
export function benchRoofAgeSql(p: BenchParams, table = "t"): string {
  const { radiusM, hav, bbox } = spikeGeo(p);
  return `SELECT count(*) AS n FROM ${table} WHERE ${bbox} AND ${hav} < ${radiusM}
AND date_diff('year', TRY_CAST(substr(issue_date,1,10) AS DATE), DATE '${BENCH_AS_OF}') >= ${p.minYears}`;
}
