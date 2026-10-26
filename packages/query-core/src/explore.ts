// T011 (A-13, AC-4/5/8, FR-004/005/008/015, contracts/explore-search.md): the one builder behind
// every Explore · Filters search, shared by the API's `explore.search` and later the agent/MCP
// (AD-19). It returns three read-only statements over the contract views:
//   - `rows`: the page of matching properties inside the radius, sorted and limited;
//   - `summary`: `total_within_r` (every match inside the radius) and `tenure_unknown` (rows
//     inside the radius, other filters applied, whose tenure is unknown: excluded by the tenure
//     filter and counted, FR-008);
//   - `close`: up to CLOSE_MATCH_LIMIT nearest matches outside the radius and within 2 × r, run
//     by the caller only when the search has zero results (FR-015).
// Geometry is A-oracle § 9: a lat/lon bounding box prefilters (`box`), then the haversine decides
// (`base`), both from builders.ts `geoSql`. Roofing permits come only from v_roofing_permit, which
// the profile classified; there is no text match on a description (P0-9). Roof age, tenure and
// open days are the views' own values relative to the run's as_of, so nothing here reads the
// clock. `toExploreRow` maps an engine row to the ExploreRow of data-model.md: provenance on
// every row and a `missing` reason for every gap, never a guessed value.
import { METRES_PER_MILE, MAX_ROWS, geoSql } from "./builders.js";
import { bbbReasonFor, contractorGapReason, noContractorPrinted } from "./contractor-gaps.js";
import type { Row } from "./engine.js";

export const EXPLORE_DEFAULT_LIMIT = 200;
export const CLOSE_MATCH_LIMIT = 10;
export const EXPLORE_MAX_PAGE = 10_000;
/** Days per year for `openYrs` and `open_years` (Julian year). */
export const DAYS_PER_YEAR = 365.25;

/** The box the `at` point must fall in (contracts/explore-search.md), around Travis County. */
export const EXPLORE_BOUNDS = Object.freeze({
  lat: [29.5, 31.0],
  lon: [-98.5, -97.0],
  radiusMi: [0.25, 25],
  roof: [0, 120],
  openYrs: [0, 60],
  tenure: [0, 100],
} as const);

export const PERMIT_FILTERS = ["open_or_stalled", "open", "stalled"] as const;
export type PermitFilter = (typeof PERMIT_FILTERS)[number];
export const EXPLORE_SORTS = ["nearest", "open_desc", "roof_desc"] as const;
export type ExploreSort = (typeof EXPLORE_SORTS)[number];

export interface ExploreSearchInput {
  /** The resolved centre: a gazetteer point or the `at` URL point. */
  readonly centre: { readonly lat: number; readonly lon: number };
  /** Statute miles, 0.25..25. */
  readonly radius_mi: number;
  /** Roof age ≥ years (integer 0..120); rows with an unknown roof age are not matches. */
  readonly roof?: number | undefined;
  readonly permit?: PermitFilter | undefined;
  /** Open or stalled for at least this many years (0..60); applies with `permit`. */
  readonly openYrs?: number | undefined;
  /** Tenure > years (integer 0..100); unknown tenure is excluded and counted. */
  readonly tenure?: number | undefined;
  /** Out-of-area owner (owner_is_out_of_area = true). */
  readonly ooa?: boolean | undefined;
  readonly sort?: ExploreSort | undefined;
  /** 1..1000, default 200. */
  readonly limit?: number | undefined;
  /** 0-based page of `limit` rows. */
  readonly page?: number | undefined;
}

export interface ExploreSql {
  readonly rows: string;
  readonly summary: string;
  readonly close: string;
}

const number = (name: string, value: number, [min, max]: readonly [number, number]): number => {
  if (typeof value !== "number" || !(value >= min && value <= max))
    throw new RangeError(`${name} must be a number in [${min}, ${max}], got ${String(value)}`);
  return value;
};
const integer = (name: string, value: number, range: readonly [number, number]): number => {
  if (!Number.isInteger(value)) throw new RangeError(`${name} must be an integer, got ${value}`);
  return number(name, value, range);
};

const STATUS_CLASSES: Record<PermitFilter, readonly string[]> = {
  open_or_stalled: ["open", "stalled"],
  open: ["open"],
  stalled: ["stalled"],
};

const ORDER: Record<ExploreSort, string> = {
  nearest: "distance_m, property_cid",
  open_desc: "permit_open_days DESC NULLS LAST, distance_m, property_cid",
  roof_desc: "roof_age_years DESC NULLS LAST, distance_m, property_cid",
};

/** The three Explore statements for one validated input (throws RangeError on a bad bound). */
export function exploreSearchSql(input: ExploreSearchInput): ExploreSql {
  const lat = number("lat", input.centre.lat, EXPLORE_BOUNDS.lat);
  const lon = number("lon", input.centre.lon, EXPLORE_BOUNDS.lon);
  const miles = number("radius_mi", input.radius_mi, EXPLORE_BOUNDS.radiusMi);
  const roof =
    input.roof === undefined ? undefined : integer("roof", input.roof, EXPLORE_BOUNDS.roof);
  const openYrs =
    input.openYrs === undefined
      ? undefined
      : number("openYrs", input.openYrs, EXPLORE_BOUNDS.openYrs);
  const tenure =
    input.tenure === undefined ? undefined : integer("tenure", input.tenure, EXPLORE_BOUNDS.tenure);
  const limit = integer("limit", input.limit ?? EXPLORE_DEFAULT_LIMIT, [1, MAX_ROWS]);
  const page = integer("page", input.page ?? 0, [0, EXPLORE_MAX_PAGE]);
  const sort = input.sort ?? "nearest";
  if (!(sort in ORDER)) throw new RangeError(`sort must be one of ${EXPLORE_SORTS.join(", ")}`);
  if (input.permit !== undefined && !(input.permit in STATUS_CLASSES))
    throw new RangeError(`permit must be one of ${PERMIT_FILTERS.join(", ")}`);

  const radiusM = Number((miles * METRES_PER_MILE).toFixed(3));
  const outerM = Number((2 * miles * METRES_PER_MILE).toFixed(3));

  // Permits: one per property, the longest-open open/stalled permit first, else the latest.
  const permitWhere: string[] = [];
  if (input.permit !== undefined) {
    permitWhere.push(
      `status_class IN (${STATUS_CLASSES[input.permit].map((c) => `'${c}'`).join(", ")})`,
    );
    if (openYrs !== undefined)
      permitWhere.push(`open_days >= ${Number((openYrs * DAYS_PER_YEAR).toFixed(4))}`);
  }
  const perm = `perm AS (
  SELECT property_cid AS permit_property_cid, permit_cid, permit_number,
    improvement_status AS permit_status, status_class AS permit_status_class,
    open_days AS permit_open_days, issue_date AS permit_issue_date,
    final_date AS permit_final_date, contractor_resolution, contractor_company_cid,
    contractor_name_as_printed, bbb_url, bbb_status, bbb_status_reason,
    table_cid AS permit_table_cid, source_url AS permit_source_url,
    captured_at AS permit_captured_at, missing AS permit_missing,
    row_number() OVER (
      PARTITION BY property_cid
      ORDER BY (status_class IN ('open', 'stalled')) DESC NULLS LAST, open_days DESC NULLS LAST,
        issue_date DESC NULLS LAST, permit_cid
    ) AS permit_rank
  FROM v_roofing_permit
  WHERE property_cid IN (SELECT property_cid FROM box)${permitWhere.map((w) => `\n    AND ${w}`).join("")}
)`;

  const propertyWhere: string[] = [];
  if (roof !== undefined) propertyWhere.push(`b.roof_age_years >= ${roof}`);
  if (input.ooa === true) propertyWhere.push("b.owner_is_out_of_area = true");
  const join = input.permit === undefined ? "LEFT JOIN perm" : "JOIN perm";

  /** `box` (bbox prefilter) then `base` (haversine distance, joins and non-tenure filters). */
  const ctes = (boxM: number): string => {
    const box = geoSql({ lat, lon, radiusM: boxM }, "p").bbox;
    const { distance } = geoSql({ lat, lon, radiusM: boxM }, "b");
    // box first: the permit ranking window sees only permits of properties inside the bbox.
    return `WITH box AS (
  SELECT p.*
  FROM v_property p
  WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
    AND ${box}
),
${perm},
base AS (
  SELECT b.*, ${distance} AS distance_m,
    k.permit_cid, k.permit_number, k.permit_status, k.permit_status_class, k.permit_open_days,
    k.permit_issue_date, k.permit_final_date, k.contractor_resolution, k.contractor_company_cid,
    k.contractor_name_as_printed, k.bbb_url, k.bbb_status, k.bbb_status_reason,
    k.permit_table_cid, k.permit_source_url, k.permit_captured_at, k.permit_missing
  FROM box b
  ${join} k ON k.permit_property_cid = b.property_cid AND k.permit_rank = 1${
    propertyWhere.length > 0 ? `\n  WHERE ${propertyWhere.join("\n    AND ")}` : ""
  }
)`;
  };

  const tenureCond = tenure === undefined ? "" : ` AND tenure_years > ${tenure}`;
  const rows = `${ctes(radiusM)}
SELECT * FROM base
WHERE distance_m < ${radiusM}${tenureCond}
ORDER BY ${ORDER[sort]}
LIMIT ${limit} OFFSET ${limit * page}`;
  const summary = `${ctes(radiusM)}
SELECT
  count(*) FILTER (WHERE distance_m < ${radiusM}${tenureCond})::INTEGER AS total_within_r,
  count(*) FILTER (WHERE distance_m < ${radiusM} AND tenure_years IS NULL)::INTEGER AS tenure_unknown
FROM base`;
  const close = `${ctes(outerM)}
SELECT * FROM base
WHERE distance_m >= ${radiusM} AND distance_m < ${outerM}${tenureCond}
ORDER BY distance_m, property_cid
LIMIT ${CLOSE_MATCH_LIMIT}`;
  return { rows, summary, close };
}

// ---------------------------------------------------------------------------------------------
// Rows (data-model.md ExploreResult)
// ---------------------------------------------------------------------------------------------

export interface MissingEntry {
  readonly field: string;
  readonly reason: string;
}

export interface ExploreProvenance {
  readonly cid: string | null;
  readonly source_url: string | null;
  readonly captured_at: string | null;
  readonly table: string | null;
  readonly table_cid: string | null;
  readonly run_id: string | null;
  readonly manifest_cid: string | null;
  readonly as_of: string | null;
}

export interface ExplorePermit {
  readonly cid: string | null;
  readonly number: string | null;
  /** The source's own status text: no lexicon carrier (ADR-0002), so always null with a reason. */
  readonly status_raw: null;
  readonly status_class: string | null;
  readonly open_years: number | null;
  /** The exact `open_days` of v_roofing_permit (an integer); `open_years` is its rounded-down view. */
  readonly open_days: number | null;
  readonly table_cid: string | null;
  /** The permit's own provenance (v_roofing_permit `source_url`, `captured_at`): the evidence chain
   *  of a permit-based roof age cites the permit source, not the property's. */
  readonly source_url?: string | null;
  readonly captured_at?: string | null;
  /** A-16: v_roofing_permit `issue_date` / `final_date` (YYYY-MM-DD); null with the view's reason. */
  readonly issue_date?: string | null;
  readonly final_date?: string | null;
  /** A-16: the printed contractor name and the BBB search link, on the permit (the Explore UI
   *  reads these; `contractor.name_as_printed` / `contractor.bbb_url` carry the same values). */
  readonly contractor_name_as_printed?: string | null;
  readonly bbb_url?: string | null;
}

export interface ExploreContractor {
  /** Contract v1.1: the name as printed on the permit (unverified); null with the view's reason
   *  (`source_missing`: the permit printed no contractor). */
  readonly name_as_printed: string | null;
  readonly resolution: string | null;
  readonly company_cid: string | null;
  /** A-16: the BBB SEARCH link built from the printed name (never fetched); null when none. */
  readonly bbb_url?: string | null;
}

export interface ExploreRow {
  readonly property_cid: string;
  /** v_property `unnormalized_address` (situs text; Run 3.1 publishes it for 441,940 of 441,961
   *  properties). Null with `not_in_export` when the run's export has none for the property. */
  readonly address: string | null;
  readonly dist_mi: number;
  /** 8-point compass bearing from the centre ("N", "NE", …). */
  readonly bearing: string;
  readonly lat: number;
  readonly lon: number;
  readonly roof_age_years: number | null;
  readonly roof_age_basis: string | null;
  readonly roof_age_confidence: string | null;
  readonly permit: ExplorePermit | null;
  readonly contractor: ExploreContractor | null;
  readonly bbb_status: string | null;
  readonly bbb_status_reason: string | null;
  readonly tenure_years: number | null;
  readonly tenure_basis: string | null;
  readonly owner_area_class: string | null;
  /** A-16: v_property `property_structure_built_year` (the year behind basis `built_year`). */
  readonly year_built?: number | null;
  /** A-16: v_property owner fields; null with the view's reason in `missing`. */
  readonly owner_name?: string | null;
  readonly owner_kind?: string | null;
  readonly last_ownership_transfer_date?: string | null;
  readonly provenance: ExploreProvenance;
  readonly missing: readonly MissingEntry[];
}

export interface CloseMatch {
  readonly row: ExploreRow;
  readonly miles_outside: number;
}

export interface ExploreResult {
  readonly total_within_r: number;
  readonly tenure_unknown: number;
  readonly rows: readonly ExploreRow[];
  readonly close_matches: readonly CloseMatch[];
  readonly as_of: {
    readonly runId: string;
    readonly manifestCid: string;
    readonly finishedAt: string;
  };
  readonly area: { readonly label: string; readonly lat: number; readonly lon: number };
  readonly engine: "server";
  readonly queryDurationMs: number;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function missingList(v: unknown, prefix = ""): MissingEntry[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((m: unknown) => {
    if (typeof m !== "object" || m === null) return [];
    const { field, reason } = m as { field?: unknown; reason?: unknown };
    return typeof field === "string" && typeof reason === "string"
      ? [{ field: `${prefix}${field}`, reason }]
      : [];
  });
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** Initial great-circle bearing from `from` to `to`, as an 8-point compass label. */
export function compassBearing(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): string {
  const rad = Math.PI / 180;
  const dLon = (to.lon - from.lon) * rad;
  const y = Math.sin(dLon) * Math.cos(to.lat * rad);
  const x =
    Math.cos(from.lat * rad) * Math.sin(to.lat * rad) -
    Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos(dLon);
  const deg = (Math.atan2(y, x) / rad + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8] ?? "N";
}

/** One engine row of `rows` / `close` → an ExploreRow, measured from `centre`. */
export function toExploreRow(row: Row, centre: { lat: number; lon: number }): ExploreRow {
  const lat = num(row.latitude) ?? 0;
  const lon = num(row.longitude) ?? 0;
  const hasPermit = str(row.permit_cid) !== null || str(row.permit_number) !== null;
  const openDays = num(row.permit_open_days);
  const contractorName = str(row.contractor_name_as_printed);
  // A-16: an index built before the derive.ts fix says contractor_unresolved for "none printed".
  const noContractor = hasPermit && noContractorPrinted(contractorName, row.contractor_company_cid);

  const address = str(row.unnormalized_address);
  const missing: MissingEntry[] = [
    ...missingList(row.missing),
    ...(address === null ? [{ field: "address", reason: "not_in_export" }] : []),
  ];
  if (hasPermit) {
    const permitMissing = missingList(row.permit_missing).map((m) => ({
      field: `permit.${m.field}`,
      reason: contractorGapReason(m.field, m.reason, noContractor),
    }));
    missing.push(...permitMissing, { field: "permit.status_raw", reason: "no_lexicon_carrier" });
    // The contractor section's own entry, with the view's real reason (never no_lexicon_carrier:
    // contract v1.1 publishes the printed name).
    if (contractorName === null) {
      const viewEntry = permitMissing.find((m) => m.field === "permit.contractor_name_as_printed");
      missing.push({
        field: "contractor.name_as_printed",
        reason: viewEntry?.reason ?? "source_missing",
      });
    }
  }
  const seen = new Set<string>();
  const unique = missing.filter((m) => (seen.has(m.field) ? false : (seen.add(m.field), true)));

  return {
    property_cid: str(row.property_cid) ?? "",
    address,
    dist_mi: Math.round(((num(row.distance_m) ?? 0) / METRES_PER_MILE) * 1000) / 1000,
    bearing: compassBearing(centre, { lat, lon }),
    lat,
    lon,
    roof_age_years: num(row.roof_age_years),
    roof_age_basis: str(row.roof_age_basis),
    roof_age_confidence: str(row.roof_age_confidence),
    permit: hasPermit
      ? {
          cid: str(row.permit_cid),
          number: str(row.permit_number),
          status_raw: null,
          status_class: str(row.permit_status_class),
          open_years: openDays === null ? null : Math.floor((openDays / DAYS_PER_YEAR) * 10) / 10,
          open_days: openDays === null ? null : Math.trunc(openDays),
          table_cid: str(row.permit_table_cid),
          source_url: str(row.permit_source_url),
          captured_at: str(row.permit_captured_at),
          issue_date: str(row.permit_issue_date),
          final_date: str(row.permit_final_date),
          contractor_name_as_printed: contractorName,
          bbb_url: str(row.bbb_url),
        }
      : null,
    contractor: hasPermit
      ? {
          name_as_printed: contractorName,
          resolution: str(row.contractor_resolution),
          company_cid: str(row.contractor_company_cid),
          bbb_url: str(row.bbb_url),
        }
      : null,
    bbb_status: str(row.bbb_status),
    bbb_status_reason: str(bbbReasonFor(row.bbb_status_reason, noContractor)),
    tenure_years: num(row.tenure_years),
    tenure_basis: str(row.tenure_basis),
    owner_area_class: str(row.owner_area_class),
    year_built: num(row.property_structure_built_year),
    owner_name: str(row.owner_name),
    owner_kind: str(row.owner_kind),
    last_ownership_transfer_date: str(row.last_ownership_transfer_date),
    provenance: {
      cid: str(row.cid),
      source_url: str(row.source_url),
      captured_at: str(row.captured_at),
      table: str(row.table),
      table_cid: str(row.table_cid),
      run_id: str(row.run_id),
      manifest_cid: str(row.manifest_cid),
      as_of: str(row.as_of),
    },
    missing: unique,
  };
}

/** Miles outside the radius for a close match (3 decimals; the page rounds for "+{x} mi"). */
export function milesOutside(row: Row, radiusMi: number): number {
  const miles = (num(row.distance_m) ?? 0) / METRES_PER_MILE;
  return Math.round((miles - radiusMi) * 1000) / 1000;
}
