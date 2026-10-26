// T059 (A-02, mew § B.5, data-model.md § Derivation rules): one function per derived column.
// Each rule exists twice, side by side: a TypeScript function (unit-tested, used by tools and the
// UI) and the SQL macro that views.sql calls. test/derive.test.ts runs the same table of cases
// through both. No macro matches text: only enum equality, date arithmetic and prefix equality of
// ISO dates at the roof date's own precision. `as_of` is always the manifest finishedAt.
import { RULES } from "@countylens/profile-travis-austin";
import { ownerArea } from "../gazetteer/travis-places@1.0.0/index.js";
import { decodeZctaBitmap } from "../gazetteer/travis-places@1.0.0/schema.js";
import ownerAreaJson from "../gazetteer/travis-places@1.0.0/owner-area.json" with { type: "json" };

export type RoofAgeBasis = "permit" | "new_construction" | "built_year" | "unknown";
export type RoofAgeConfidence = "high" | "medium" | "low" | "none";
export type StatusClass = "open" | "stalled" | "closed";
export type AreaClass = "in_county" | "regional" | "out_of_area" | "unknown";

/** The UTC calendar date of an ISO instant, as [year, month, day]. */
function utcDate(iso: string): [number, number, number] {
  const d = new Date(iso);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

function ymd(date: string): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

/** Completed years from a full date to the as_of date. */
function completedYears(date: string, asOf: string): number {
  const [y, m, d] = ymd(date);
  const [ay, am, ad] = utcDate(asOf);
  return ay - y - (am < m || (am === m && ad < d) ? 1 : 0);
}

/** Whole years from structure.roof_date (YYYY, YYYY-MM or YYYY-MM-DD) to as_of; 0 allowed. */
export function roofAgeYears(roofDate: string | null, asOf: string): number | null {
  if (roofDate === null) return null;
  const [ay, am] = utcDate(asOf);
  if (roofDate.length === 4) return ay - Number(roofDate);
  if (roofDate.length === 7) {
    const months = ay * 12 + am - (Number(roofDate.slice(0, 4)) * 12 + Number(roofDate.slice(5)));
    return Math.floor(months / 12);
  }
  if (roofDate.length === 10) return completedYears(roofDate, asOf);
  return null;
}

/** True when `date` (an ISO date) equals `roofDate` at the roof date's own precision. */
export function dateMatchesAtPrecision(roofDate: string | null, date: string | null): boolean {
  return roofDate !== null && date !== null && date.slice(0, roofDate.length) === roofDate;
}

/**
 * mew B.5. `replacementMatch`: a linked Roofing/Replacement permit's completion_date or
 * permit_close_date matches roof_date; `newMatch`: the same with improvement_action New.
 */
export function roofAgeBasis(
  roofDate: string | null,
  replacementMatch: boolean,
  newMatch: boolean,
  builtYear: number | null,
): RoofAgeBasis {
  if (roofDate === null) return "unknown";
  if (replacementMatch) return "permit";
  if (newMatch) return "new_construction";
  if (roofDate.length === 4 && Number(roofDate) === builtYear) return "built_year";
  return "unknown";
}

const CONFIDENCE: Record<RoofAgeBasis, RoofAgeConfidence> = {
  permit: "high",
  new_construction: "medium",
  built_year: "low",
  unknown: "none",
};

export const roofAgeConfidence = (basis: RoofAgeBasis): RoofAgeConfidence => CONFIDENCE[basis];

/** Why an unknown basis is unknown. */
export const roofBasisReason = (roofDate: string | null): "no_roof_date" | "basis_unmatched" =>
  roofDate === null ? "no_roof_date" : "basis_unmatched";

/** Whole years from the latest ownership_transfer_date to as_of. */
export const tenureYears = (date: string | null, asOf: string): number | null =>
  date === null ? null : completedYears(date, asOf);

export const tenureBasis = (
  date: string | null,
  source: "sale" | "deed" | null = null,
): "sale_date" | "deed_date" | "unknown" =>
  date === null ? "unknown" : source === "deed" ? "deed_date" : "sale_date";

/** More than 10 years; null (never "long") when the tenure is unknown. */
export const isLongTenure = (years: number | null): boolean | null =>
  years === null ? null : years > 10;

/** The owner's mailing ZIP against the travis-places lists (gazetteer ownerArea()). */
export const ownerAreaClass = (zip: string | null): AreaClass => ownerArea(zip).class;

export const ownerIsOutOfArea = (cls: AreaClass): boolean | null =>
  cls === "unknown" ? null : cls !== "in_county";

/** Every US ZCTA with its area class, the lookup bindManifest() loads as meta.zcta_area. */
export function zctaAreaRows(): { zcta: string; area_class: Exclude<AreaClass, "unknown"> }[] {
  return decodeZctaBitmap(ownerAreaJson.all_us_zctas.bitmap_base64).map((zcta) => {
    const area = ownerArea(zcta);
    if (area.class === "unknown") throw new Error(`zcta ${zcta} has no area class`);
    return { zcta, area_class: area.class };
  });
}

/**
 * A-11 Run 3 (ADR 0004): a geometry whose source_http_request is a GET on this City of Austin
 * layer is an address point; every other geometry is the TCAD/GIS point (`gis_centroid`).
 */
export const ADDRESS_POINT_LAYER_MARKER =
  "services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/LOCATION_address_points/";

export function coordinateSource(
  lat: number | null,
  lon: number | null,
  permitLat: number | null,
  permitLon: number | null,
  geometryUrl: string | null = null,
): "gis_centroid" | "address_point" | "permit_point" | "none" {
  if (lat !== null && lon !== null) {
    return geometryUrl !== null && geometryUrl.includes(ADDRESS_POINT_LAYER_MARKER)
      ? "address_point"
      : "gis_centroid";
  }
  if (permitLat !== null && permitLon !== null) return "permit_point";
  return "none";
}

/** (jurisdiction, improvement_status) → status_class, from the profile's jurisdictions,
 *  status_map and published_encoding (the same rows as the generated SQL status map). */
const STATUS_TO_CLASS = (() => {
  const map = new Map<string, StatusClass>();
  for (const j of Object.keys(RULES.jurisdictions)) {
    for (const cls of ["open", "stalled", "closed"] as const) {
      for (const word of RULES.status_map[cls]) {
        map.set(`${j}\u0000${RULES.published_encoding.by_word[word] ?? "\u0000null"}`, cls);
      }
    }
  }
  return map;
})();

/**
 * D-4a, scoped to the profile's jurisdictions (donphan M2): a null status is stalled only for a
 * profile jurisdiction and only when the permit has an issue date. Any other jurisdiction, an
 * unmapped status (e.g. InProgress) or a null status without an issue date has no class (null;
 * the view records needs_review).
 */
export function statusClass(
  jurisdiction: string | null,
  status: string | null,
  issueDate: string | null,
): StatusClass | null {
  if (jurisdiction === null || (status === null && issueDate === null)) return null;
  return STATUS_TO_CLASS.get(`${jurisdiction}\u0000${status ?? "\u0000null"}`) ?? null;
}

export const isOpen = (cls: StatusClass | null): boolean => cls === "open";

/** final_date is empty because the permit is not closed, (closed) the source lacks it, or the
 *  class itself is unknown. */
export const finalDateReason = (
  cls: StatusClass | null,
): "not_closed" | "source_missing" | "needs_review" =>
  cls === null ? "needs_review" : cls === "closed" ? "source_missing" : "not_closed";

/**
 * as_of − issue_date in days for open and stalled permits (≥ 0) that have no completion date;
 * otherwise null. A permit with a final_date is finished (an Expired status after completion is an
 * administrative lapse), and one with an implausible final_date (before the issue date or after
 * as_of) is a data-quality gap: neither gets an interval (ERR-70).
 */
export function openDays(
  cls: StatusClass | null,
  issueDate: string | null,
  asOf: string,
  finalDate: string | null = null,
): number | null {
  if ((cls !== "open" && cls !== "stalled") || issueDate === null || finalDate !== null)
    return null;
  const [y, m, d] = utcDate(asOf);
  const days = (Date.UTC(y, m - 1, d) - Date.parse(`${issueDate}T00:00:00Z`)) / 86_400_000;
  return Math.max(0, days);
}

/** Why open_days is empty: not_open (closed, or finished with a plausible final_date),
 *  source_missing (no issue date), needs_review (no class, or an implausible final_date).
 *  `asOf` is required (A11-16): without it a finished permit could disagree with the SQL macro. */
export const openDaysReason = (
  cls: StatusClass | null,
  issueDate: string | null,
  asOf: string,
  finalDate: string | null = null,
): "not_open" | "source_missing" | "needs_review" => {
  if (cls === null) return "needs_review";
  if (cls !== "open" && cls !== "stalled") return "not_open";
  if (issueDate === null) return "source_missing";
  if (finalDate === null) return "not_open";
  return terminalDateAccepted(finalDate, issueDate, asOf) ? "not_open" : "needs_review";
};

/** Why a published improvement_status is null: stalled means the carrier exists but its enum has
 *  no value for the source word (Expired); otherwise the null is unexplained. */
export const statusMissingReason = (
  cls: StatusClass | null,
): "enum_lacks_value" | "needs_review" => (cls === "stalled" ? "enum_lacks_value" : "needs_review");

/** The kit estimator's terminal-date rule: present, not after as_of, not before the issue date. */
export function terminalDateAccepted(
  date: string | null,
  issueDate: string | null,
  asOf: string,
): boolean {
  if (date === null) return false;
  const [y, m, d] = utcDate(asOf);
  const asOfDay = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return date <= asOfDay && (issueDate === null || date >= issueDate);
}

/** Owner kind of the property's current owners (person_has_property / company_has_property): company when any company, else person, else unknown. */
export const ownerKind = (persons: number, companies: number): "person" | "company" | "unknown" =>
  companies > 0 ? "company" : persons > 0 ? "person" : "unknown";

export type OwnerGapReason =
  "owner_unparsed" | "owner_confidential" | "no_owner_record" | "needs_review";

/**
 * Why a property has no owner (ERR-69: owners hang on the property, not on the sale). The export cannot tell the cases apart, so the
 * run's coverage counts decide: when exactly one of owner_unparsed / owner_confidential /
 * owner_no_record is non-zero every such row is in it; when several are, needs_review.
 */
export function ownerGapReason(
  unparsed: number | null,
  confidential: number | null,
  noRecord: number | null,
): OwnerGapReason {
  const u = (unparsed ?? 0) > 0;
  const c = (confidential ?? 0) > 0;
  const n = (noRecord ?? 0) > 0;
  if (Number(u) + Number(c) + Number(n) > 1) return "needs_review";
  return u ? "owner_unparsed" : c ? "owner_confidential" : "no_owner_record";
}

/** No dated sale: nothing to link an owner to (no_dated_sale); else the run's gap reason. */
export const ownerMissingReason = (
  hasDatedSale: boolean,
  gap: OwnerGapReason,
): OwnerGapReason | "no_dated_sale" => (hasDatedSale ? gap : "no_dated_sale");

/**
 * resolved only when the contractor company carries an official registry id. A company published
 * from the printed permit name has none (ERR-66: "as printed, unverified"), so it stays unresolved.
 */
export const contractorResolution = (registryId: string | null): "resolved" | "unresolved" =>
  registryId === null ? "unresolved" : "resolved";

/** The company CID only when the permit has exactly one contractor edge (never pick one). */
export const soleContractor = (edges: number, minCid: string | null): string | null =>
  edges === 1 ? minCid : null;

/**
 * Several contractor edges are ambiguous (needs_review). No edge means the permit printed no
 * contractor (A-16 PO audit item 8: source_missing, "Contractor not printed on permit"), not a
 * failed match; contractor_unresolved is left for a single edge whose value is still missing.
 */
export const contractorMissingReason = (
  edges: number,
): "contractor_unresolved" | "needs_review" | "source_missing" =>
  edges > 1 ? "needs_review" : edges === 0 ? "source_missing" : "contractor_unresolved";

/** BBB is never contacted (A-01: 403 challenge). A printed name means the lookup is blocked. */
export const bbbStatus = (name: string | null): "blocked" | "not_checked" =>
  name === null ? "not_checked" : "blocked";

/** No printed name: there is nothing to look up (source_missing); else BBB blocks the lookup. */
export const bbbStatusReason = (name: string | null): "bbb_blocked" | "source_missing" =>
  name === null ? "source_missing" : "bbb_blocked";

/** Longest printed name that goes into a BBB search link (code points). */
export const BBB_NAME_MAX = 120;

/**
 * The BBB SEARCH link for a printed contractor name (never fetched). The city is the permit
 * authority's, because the company record has none. URL shape UNVERIFIED: a human must click one
 * example before it ships. Mirrors the SQL macro bbb_search_url and travis/permits/bbb-search-url.ts.
 */
export const bbbSearchUrl = (name: string | null): string | null =>
  name === null
    ? null
    : "https://www.bbb.org/search?find_country=USA&find_text=" +
      encodeURIComponent(Array.from(name).slice(0, BBB_NAME_MAX).join("").trimEnd()).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ) +
      "&find_loc=Austin%2C%20TX";

interface HttpRequest {
  url?: string;
  multiValueQueryString?: Record<string, string[]>;
}

/** The record's request URL with its query string (as fetched), from source_http_request. */
export function sourceUrl(request: string | null): string | null {
  if (request === null) return null;
  const r = JSON.parse(request) as HttpRequest;
  if (r.url === undefined) return null;
  const query = Object.entries(r.multiValueQueryString ?? {}).flatMap(([k, values]) =>
    values.map((v) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`),
  );
  return query.length > 0 ? `${r.url}?${query.join("&")}` : r.url;
}

export const urlHost = (url: string | null): string | null =>
  url === null ? null : new URL(url).host;

/** The SQL macros views.sql calls, keyed by name. */
export const DERIVE_MACROS: Readonly<Record<string, string>> = {
  as_of_date: "(ts) AS CAST(timezone('UTC', ts) AS DATE)",
  miss: "(f, r) AS struct_pack(field := CAST(f AS VARCHAR), reason := CAST(r AS VARCHAR))",
  roof_age_years: `(roof_date, as_of) AS CAST(CASE length(roof_date)
      WHEN 4 THEN year(as_of_date(as_of)) - TRY_CAST(roof_date AS INTEGER)
      WHEN 7 THEN (year(as_of_date(as_of)) * 12 + month(as_of_date(as_of))
        - (TRY_CAST(left(roof_date, 4) AS INTEGER) * 12 + TRY_CAST(right(roof_date, 2) AS INTEGER))) // 12
      WHEN 10 THEN date_sub('year', TRY_CAST(roof_date AS DATE), as_of_date(as_of))
    END AS INTEGER)`,
  date_matches_at_precision:
    "(roof_date, d) AS coalesce(left(d, length(roof_date)) = roof_date, false)",
  roof_age_basis: `(roof_date, replacement_match, new_match, built_year) AS CASE
      WHEN roof_date IS NULL THEN 'unknown'
      WHEN replacement_match THEN 'permit'
      WHEN new_match THEN 'new_construction'
      WHEN length(roof_date) = 4 AND TRY_CAST(roof_date AS BIGINT) = built_year THEN 'built_year'
      ELSE 'unknown'
    END`,
  roof_age_confidence: `(basis) AS CASE basis
      WHEN 'permit' THEN 'high' WHEN 'new_construction' THEN 'medium'
      WHEN 'built_year' THEN 'low' ELSE 'none' END`,
  roof_basis_reason:
    "(roof_date) AS CASE WHEN roof_date IS NULL THEN 'no_roof_date' ELSE 'basis_unmatched' END",
  tenure_years: "(d, as_of) AS CAST(date_sub('year', d, as_of_date(as_of)) AS INTEGER)",
  // A-11 Run 3 (ERR-71): a latest transfer taken from a TCAD deed (transfer_source = 'deed') is
  // deed_date; the default NULL keeps the one-argument call meaning sale_date.
  tenure_basis:
    "(d, src := NULL) AS CASE WHEN d IS NULL THEN 'unknown' WHEN src = 'deed' THEN 'deed_date' ELSE 'sale_date' END",
  is_long_tenure: "(years) AS years > 10",
  owner_area_class: "(zcta_class) AS coalesce(zcta_class, 'unknown')",
  // Why an owner's area class is unknown: no owner, no mailing edge, a run whose export carries no
  // mailing ZIP, a run that named no area list, a missing ZIP, or a ZIP that is not a ZCTA.
  owner_area_reason: `(kind, owner_reason, n_mailing, n_zip, zips_emitted, lookup_loaded) AS CASE
      WHEN kind = 'unknown' THEN coalesce(owner_reason, 'no_owner_record')
      WHEN coalesce(n_mailing, 0) = 0 THEN 'no_mailing_address'
      WHEN NOT zips_emitted THEN 'not_in_export'
      WHEN NOT lookup_loaded THEN 'out_of_scope'
      WHEN n_zip = 0 THEN 'source_missing'
      ELSE 'zip_not_zcta' END`,
  // v1.2: why an owner mailing ZIP/state is empty (no owner, no mailing address, or an export
  // without address fields).
  owner_mailing_reason: `(kind, owner_reason, n_mailing, field_emitted) AS CASE
      WHEN kind = 'unknown' THEN coalesce(owner_reason, 'no_owner_record')
      WHEN coalesce(n_mailing, 0) = 0 THEN 'no_mailing_address'
      WHEN NOT field_emitted THEN 'not_in_export'
      ELSE 'source_missing' END`,
  owner_is_out_of_area: `(cls) AS CASE cls
      WHEN 'in_county' THEN false WHEN 'regional' THEN true WHEN 'out_of_area' THEN true END`,
  coordinate_source: `(lat, lon, permit_lat, permit_lon, geometry_url) AS CASE
      WHEN lat IS NOT NULL AND lon IS NOT NULL
        THEN CASE WHEN coalesce(contains(geometry_url, '${ADDRESS_POINT_LAYER_MARKER}'), false)
                  THEN 'address_point' ELSE 'gis_centroid' END
      WHEN permit_lat IS NOT NULL AND permit_lon IS NOT NULL THEN 'permit_point'
      ELSE 'none' END`,
  status_class_of: `(juris, status, issue_date) AS (
      SELECT sm.status_class FROM travis_austin_status_map sm
      WHERE sm.jurisdiction = juris
        AND sm.improvement_status IS NOT DISTINCT FROM status
        AND (status IS NOT NULL OR issue_date IS NOT NULL))`,
  // PO 2026-10-26 (found by the Roofing CRM team): status_class_of guesses a permit with no City
  // status word from its issue date alone. Two corrections, only for that guess, never for a City
  // status word: (1) an accepted completion date means the permit finished; (2) a later roofing
  // permit on the same property that finished supersedes it (`last_finished_issue`: the latest
  // issue date among the property's finished roofing permits).
  status_class_final: `(cls, status, issue_date, final_date, as_of, last_finished_issue) AS CASE
      WHEN status IS NULL AND cls IN ('open', 'stalled')
        AND terminal_date_accepted(final_date, issue_date, as_of) THEN 'closed'
      WHEN status IS NULL AND cls IN ('open', 'stalled')
        AND superseded_by_later_permit(cls, status, issue_date, final_date, as_of, last_finished_issue)
        THEN 'closed'
      ELSE cls END`,
  superseded_by_later_permit: `(cls, status, issue_date, final_date, as_of, last_finished_issue) AS
      coalesce(status IS NULL AND cls IN ('open', 'stalled')
        AND NOT terminal_date_accepted(final_date, issue_date, as_of)
        AND issue_date < last_finished_issue, false)`,
  is_open: "(cls) AS coalesce(cls = 'open', false)",
  final_date_reason: `(cls, superseded) AS CASE WHEN cls IS NULL THEN 'needs_review'
      WHEN superseded THEN 'superseded_by_later_permit'
      WHEN cls = 'closed' THEN 'source_missing' ELSE 'not_closed' END`,
  open_days: `(cls, issue_date, as_of, final_date) AS CASE
      WHEN cls IN ('open', 'stalled') AND issue_date IS NOT NULL AND final_date IS NULL
      THEN CAST(greatest(as_of_date(as_of) - issue_date, 0) AS INTEGER) END`,
  open_days_reason: `(cls, issue_date, as_of, final_date) AS CASE WHEN cls IS NULL THEN 'needs_review'
      WHEN cls IN ('open', 'stalled') AND issue_date IS NULL THEN 'source_missing'
      WHEN cls IN ('open', 'stalled') AND final_date IS NOT NULL
        AND NOT terminal_date_accepted(final_date, issue_date, as_of) THEN 'needs_review'
      ELSE 'not_open' END`,
  status_missing_reason:
    "(cls) AS CASE WHEN cls = 'stalled' THEN 'enum_lacks_value' ELSE 'needs_review' END",
  terminal_date_accepted: `(d, issue_date, as_of) AS coalesce(d <= as_of_date(as_of)
      AND (issue_date IS NULL OR d >= issue_date), false)`,
  owner_kind_of: `(persons, companies) AS CASE WHEN companies > 0 THEN 'company'
      WHEN persons > 0 THEN 'person' ELSE 'unknown' END`,
  owner_gap_reason: `(u, c, n) AS CASE
      WHEN CAST(coalesce(u, 0) > 0 AS INTEGER) + CAST(coalesce(c, 0) > 0 AS INTEGER)
        + CAST(coalesce(n, 0) > 0 AS INTEGER) > 1 THEN 'needs_review'
      WHEN coalesce(u, 0) > 0 THEN 'owner_unparsed'
      WHEN coalesce(c, 0) > 0 THEN 'owner_confidential'
      ELSE 'no_owner_record' END`,
  contractor_resolution:
    "(registry_id) AS CASE WHEN registry_id IS NULL THEN 'unresolved' ELSE 'resolved' END",
  sole_contractor: "(edges, min_cid) AS CASE WHEN edges = 1 THEN min_cid END",
  contractor_missing_reason:
    "(edges) AS CASE WHEN edges > 1 THEN 'needs_review' WHEN edges = 0 THEN 'source_missing' ELSE 'contractor_unresolved' END",
  bbb_status: "(name) AS CASE WHEN name IS NULL THEN 'not_checked' ELSE 'blocked' END",
  bbb_status_reason:
    "(name) AS CASE WHEN name IS NULL THEN 'source_missing' ELSE 'bbb_blocked' END",
  bbb_search_url: `(name) AS CASE WHEN name IS NULL THEN NULL
      ELSE 'https://www.bbb.org/search?find_country=USA&find_text='
        || replace(replace(replace(replace(replace(url_encode(rtrim(left(name, 120))),
             '!', '%21'), '''', '%27'), '(', '%28'), ')', '%29'), '*', '%2A')
        || '&find_loc=Austin%2C%20TX' END`,
  source_url: `(req) AS json_extract_string(req, '$.url') || coalesce('?' || nullif(array_to_string(
      flatten(list_transform(
        coalesce(json_keys(req, '$.multiValueQueryString'), []::VARCHAR[]),
        lambda k: list_transform(
          CAST(json_extract(req, '$.multiValueQueryString."' || k || '"') AS VARCHAR[]),
          lambda v: url_encode(k) || '=' || url_encode(v)))), '&'), ''), '')`,
  url_host: "(u) AS split_part(u, '/', 3)",
};

/** CREATE OR REPLACE MACRO statements for every derivation. */
export const deriveMacrosSql = (): string =>
  Object.entries(DERIVE_MACROS)
    .map(([name, body]) => `CREATE OR REPLACE MACRO ${name}${body};`)
    .join("\n");
