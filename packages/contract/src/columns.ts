// The single column list of contract/v1 (mew § B and C.7; data-model.md § Views with the
// D-4 adjustments). It generates the Zod row schemas (rows.ts), the README table and the
// view-shape test. Lexicon fields keep their exact names; the only aliases are in ALIASES.
// Change rule: adding a column or an enum member is additive; a rename, retype or change of
// meaning needs contract/v2.
import type { MissingReason } from "./provenance.js";

export type ColumnKind =
  | "cid"
  | "string"
  | "enum"
  | "integer"
  | "double"
  | "boolean"
  | "date"
  | "timestamptz"
  | "missing"
  | "json"
  | "list";

export interface Column {
  name: string;
  /** DuckDB type as DESCRIBE prints it. */
  type: string;
  kind: ColumnKind;
  /** False only for the "never null" columns. */
  nullable: boolean;
  enum?: readonly string[];
  meaning: string;
  /** Lexicon class.property, a relationship path, or the derivation rule. */
  source: string;
  /** The reason written to `missing` when the value is empty (null when never empty). */
  missingReason: MissingReason | null;
}

/** The AD-07 frozen aliases (mew C.2): the only names that are not exact lexicon names. */
export const ALIASES = {
  issue_date: "property_improvement.permit_issue_date",
  final_date: "property_improvement.completion_date",
} as const;

export const COLUMN_ENUMS = {
  roof_age_basis: ["permit", "new_construction", "built_year", "unknown"],
  roof_age_confidence: ["high", "medium", "low", "none"],
  bbb_status: ["rated", "not_found", "blocked", "not_checked"],
  status_class: ["open", "stalled", "closed"],
  owner_area_class: ["in_county", "regional", "out_of_area", "unknown"],
  coordinate_source: ["gis_centroid", "address_point", "permit_point", "none"],
  tenure_basis: ["sale_date", "deed_date", "unknown"],
  contractor_resolution: ["resolved", "unresolved"],
  owner_kind: ["person", "company", "unknown"],
} as const satisfies Record<string, readonly string[]>;

type EnumName = keyof typeof COLUMN_ENUMS;

const V = "VARCHAR";
const MISSING_TYPE = "STRUCT(field VARCHAR, reason VARCHAR)[]";

function col(
  name: string,
  kind: Exclude<ColumnKind, "enum">,
  type: string,
  nullable: boolean,
  source: string,
  meaning: string,
  missingReason: MissingReason | null,
): Column {
  return { name, type, kind, nullable, meaning, source, missingReason };
}

function enumCol(
  name: EnumName,
  nullable: boolean,
  source: string,
  meaning: string,
  missingReason: MissingReason | null,
): Column {
  return {
    name,
    type: V,
    kind: "enum",
    nullable,
    enum: COLUMN_ENUMS[name],
    meaning,
    source,
    missingReason,
  };
}

/** mew § B.1: on every row of v_property, v_roofing_permit and v_contractor. */
export const PROVENANCE_COLUMNS: readonly Column[] = [
  col("cid", "cid", V, false, "export extra column `cid`", "The record's CID", null),
  col(
    "source_url",
    "string",
    V,
    true,
    "source_http_request: url + its multiValueQueryString (URL-encoded); else the data group's manifest sources[].url (no missing entry for the fallback)",
    "URL of the request that fetched the record's source page",
    "not_in_export",
  ),
  col(
    "captured_at",
    "timestamptz",
    "TIMESTAMP WITH TIME ZONE",
    false,
    "manifest sources[].captured_at of the source whose url the record's request uses, else of the data group's source (source-level: the latest successful receipt)",
    "When that source was captured (source-level, not per record)",
    null,
  ),
  col(
    "table",
    "string",
    V,
    false,
    "export table name",
    "The export table the row's main record came from",
    null,
  ),
  col(
    "table_cid",
    "cid",
    V,
    false,
    "tables.car CountyTables part link → manifest artifacts[]",
    "CIDv1 of the Parquet part holding the row",
    null,
  ),
  col("run_id", "string", V, false, "manifest runId", "The run that produced the row", null),
  col(
    "manifest_cid",
    "cid",
    V,
    false,
    "CIDv1 of the manifest JCS bytes",
    "The run manifest's CID",
    null,
  ),
  col(
    "as_of",
    "timestamptz",
    "TIMESTAMP WITH TIME ZONE",
    false,
    "manifest finishedAt",
    "The run's finish time; every derivation uses it, never now()",
    null,
  ),
  col(
    "missing",
    "missing",
    MISSING_TYPE,
    false,
    "built per row",
    "One {field, reason} entry for every null or uncarried field in the row",
    null,
  ),
];

const V_PROPERTY: readonly Column[] = [
  col(
    "property_cid",
    "cid",
    V,
    false,
    "property.cid (the from_cid of every property_has_* edge; the export extra `property_cid` is the Seed root, not this)",
    "The property record's CID; the key v_roofing_permit.property_cid joins on",
    null,
  ),
  col(
    "request_identifier",
    "string",
    V,
    false,
    "property.request_identifier",
    "TCAD pID exactly as printed (P0-5)",
    null,
  ),
  col(
    "parcel_identifier",
    "string",
    V,
    true,
    "property.parcel_identifier",
    "Parcel identifier",
    "source_missing",
  ),
  col(
    "property_type",
    "string",
    V,
    true,
    "property.property_type (lexicon enum)",
    "Property type",
    "source_missing",
  ),
  col(
    "property_usage_type",
    "string",
    V,
    true,
    "property.property_usage_type (lexicon enum)",
    "Usage type",
    "source_missing",
  ),
  col(
    "property_structure_built_year",
    "integer",
    "INTEGER",
    true,
    "property.property_structure_built_year",
    "Year the main structure was built",
    "source_missing",
  ),
  col(
    "latitude",
    "double",
    "DOUBLE",
    true,
    "geometry.latitude via property_has_parcel → parcel_has_geometry",
    "Latitude",
    "no_coordinates",
  ),
  col(
    "longitude",
    "double",
    "DOUBLE",
    true,
    "geometry.longitude via property_has_parcel → parcel_has_geometry",
    "Longitude",
    "no_coordinates",
  ),
  enumCol(
    "coordinate_source",
    false,
    "derived: geometry → gis_centroid, or address_point when geometry.source_http_request is the City of Austin address-point layer (ADR 0004), permit address → permit_point (address not in export), else none",
    "Where the coordinates came from",
    null,
  ),
  col(
    "roof_date",
    "string",
    V,
    true,
    "latest accepted terminal date (completion_date or permit_close_date, ≤ as_of, ≥ issue date) of a closed Roofing permit via property_has_property_improvement (Replacement, else New); else structure.roof_date via property_has_structure (TCAD built year only)",
    "Roof date, YYYY[-MM[-DD]]",
    "no_roof_date",
  ),
  col(
    "roof_age_years",
    "integer",
    "INTEGER",
    true,
    "derived: whole years from roof_date to as_of (never structure.roof_age_years)",
    "Roof age in whole years; 0 allowed",
    "no_roof_date",
  ),
  enumCol("roof_age_basis", false, "derived (mew B.5)", "Evidence behind roof_date", null),
  enumCol("roof_age_confidence", false, "derived (mew B.5)", "Confidence of roof_age_years", null),
  col(
    "last_ownership_transfer_date",
    "date",
    "DATE",
    true,
    "latest dated sales_history.ownership_transfer_date (TCAD sale or transfer deed) via property_has_sales_history",
    "Latest dated ownership transfer",
    "no_dated_sale",
  ),
  col(
    "tenure_years",
    "integer",
    "INTEGER",
    true,
    "derived: whole years from last_ownership_transfer_date to as_of",
    "Owner tenure",
    "no_dated_sale",
  ),
  enumCol(
    "tenure_basis",
    false,
    "derived: deed_date when the latest transfer is a TCAD transfer deed, sale_date when it is a TCAD sale, else unknown",
    "Evidence behind tenure_years",
    null,
  ),
  col(
    "is_long_tenure",
    "boolean",
    "BOOLEAN",
    true,
    "derived: tenure_years > 10; null when unknown",
    "Long tenure flag",
    "no_dated_sale",
  ),
  enumCol(
    "owner_kind",
    false,
    "derived from person_has_property / company_has_property (the current owners of the property): company when any company, else person, else unknown",
    "Owner kind",
    null,
  ),
  col(
    "owner_name",
    "string",
    V,
    true,
    "person.first_name + last_name (by last, first name), then company.name (by name), each once, '; '-separated, read through person_has_property / company_has_property (ERR-69; independent of any sale)",
    "Owner display name; reason owner_unparsed, owner_confidential, no_owner_record or needs_review",
    "no_owner_record",
  ),
  enumCol(
    "owner_area_class",
    false,
    "derived: the current owners' mailing ZIP (address.postal_code via person_has_mailing_address / company_has_mailing_address) against the travis-places area lists; most local class among co-owners; unknown with reason no_mailing_address, zip_not_zcta, out_of_scope (no area list in the run) or not_in_export (the export emits no address.postal_code: Runs 1 to 3; from Run 3.1 it does, v1.2); a mailing address without a ZIP reads source_missing",
    "Owner mailing area class",
    null,
  ),
  col(
    "owner_is_out_of_area",
    "boolean",
    "BOOLEAN",
    true,
    "derived: true for regional/out_of_area, false for in_county, null for unknown",
    "Owner mails from outside Travis",
    "not_in_export",
  ),
  col(
    "area_list_sha256",
    "string",
    V,
    false,
    "manifest profiles[] (travis-places)",
    "Digest of the ZIP and regional lists",
    null,
  ),
  // v1.2 (additive, Run 3.1, PO 2026-10-26): the address fields, now emitted by export-tables
  // with the oneOf-columns patch (pipeline/publish/patches/elephant-cli-export-oneof.patch).
  col(
    "unnormalized_address",
    "string",
    V,
    true,
    "address.unnormalized_address via property_has_address: the situs as TCAD prints it, one line (street, city, state, ZIP)",
    "Property (situs) address as printed",
    "source_missing",
  ),
  col(
    "owner_mailing_postal_code",
    "string",
    V,
    true,
    "address.postal_code (first 5 characters) of the current owners' mailing addresses via person_has_property / company_has_property and person_has_mailing_address / company_has_mailing_address; distinct values sorted, '; '-separated; reasons no_mailing_address, source_missing (address without a ZIP), not_in_export (Runs 1 to 3) or the owner reason",
    "Owner mailing ZIP",
    "no_mailing_address",
  ),
  col(
    "owner_mailing_state_code",
    "string",
    V,
    true,
    "address.state_code of the same mailing addresses; distinct values sorted, '; '-separated",
    "Owner mailing state",
    "no_mailing_address",
  ),
  ...PROVENANCE_COLUMNS,
];

const BBB_SOURCE =
  "blocked when the permit prints a contractor name (BBB is never contacted, A-01 403 challenge), else not_checked";

const V_ROOFING_PERMIT: readonly Column[] = [
  col("permit_cid", "cid", V, false, "property_improvement.cid", "The permit's CID", null),
  col(
    "property_cid",
    "cid",
    V,
    false,
    "from_cid of property_has_property_improvement",
    "The permit's property",
    null,
  ),
  col(
    "jurisdiction",
    "string",
    V,
    true,
    "derived: source_http_request host → profile jurisdiction map",
    "Issuing jurisdiction",
    "needs_review",
  ),
  col(
    "permit_number",
    "string",
    V,
    true,
    "property_improvement.permit_number",
    "Permit number as printed",
    "source_missing",
  ),
  col(
    "request_identifier",
    "string",
    V,
    true,
    "property_improvement.request_identifier",
    "Permit request identifier: the stable key of the permit record across runs (equals permit_number in Run 2)",
    "source_missing",
  ),
  col(
    "improvement_type",
    "string",
    V,
    false,
    "property_improvement.improvement_type (set only by the profile)",
    "Lexicon improvement type",
    null,
  ),
  col(
    "improvement_action",
    "string",
    V,
    false,
    "property_improvement.improvement_action (set only by the profile)",
    "Lexicon improvement action",
    null,
  ),
  col(
    "improvement_status",
    "string",
    V,
    true,
    "property_improvement.improvement_status",
    "Lexicon status; null for Expired (D-4a)",
    "enum_lacks_value",
  ),
  enumCol(
    "status_class",
    true,
    "generated status map on (jurisdiction, improvement_status): Austin Permitted/Planned/OnHold → open, Completed → closed, null status + issue date → stalled (D-4a); no map row (other jurisdiction, unmapped status, null status without issue date) → null",
    "Open, stalled or closed; null only when it cannot be derived",
    "needs_review",
  ),
  col("is_open", "boolean", "BOOLEAN", false, "derived: status_class = 'open'", "Open flag", null),
  col(
    "issue_date",
    "date",
    "DATE",
    true,
    ALIASES.issue_date,
    "Issue date (frozen alias)",
    "source_missing",
  ),
  col(
    "final_date",
    "date",
    "DATE",
    true,
    ALIASES.final_date,
    "Final date (frozen alias)",
    "not_closed",
  ),
  col(
    "permit_close_date",
    "date",
    "DATE",
    true,
    "property_improvement.permit_close_date",
    "Close date",
    "source_missing",
  ),
  col(
    "final_inspection_date",
    "date",
    "DATE",
    true,
    "property_improvement.final_inspection_date",
    "Final inspection date",
    "source_missing",
  ),
  col(
    "open_days",
    "integer",
    "INTEGER",
    true,
    "derived: as_of − issue_date for open and stalled permits that have no final_date; null when final_date is set (finished, reason not_open) or implausible (before issue_date or after as_of, reason needs_review)",
    "Days open (never counted for a finished permit)",
    "not_open",
  ),
  enumCol(
    "contractor_resolution",
    false,
    "derived: resolved only when the contractor company carries an official registry id (company.sunbiz_document_number); a company published from the printed permit name has none, so it stays unresolved (v1.1, ERR-66)",
    "Contractor identity state (AD-24)",
    null,
  ),
  col(
    "contractor_company_cid",
    "cid",
    V,
    true,
    "to_cid of the only property_improvement_has_contractor edge",
    "Contractor company as printed (unverified; resolved only with a registry id)",
    "contractor_unresolved",
  ),
  // v1.1 (additive, ERR-66, PO 2026-10-25)
  col(
    "contractor_name_as_printed",
    "string",
    V,
    true,
    "company.name via the only property_improvement_has_contractor edge: the contractor the permit prints (the company, else the contractor person, ERR-72), AS PRINTED, UNVERIFIED (not a registry identity)",
    "Contractor as printed on the permit (unverified)",
    "contractor_unresolved",
  ),
  enumCol("bbb_status", false, BBB_SOURCE, "BBB lookup state", null),
  col(
    "bbb_status_reason",
    "string",
    V,
    true,
    "bbb_blocked when a contractor name is printed, else contractor_unresolved",
    "Why there is no BBB rating",
    null,
  ),
  // v1.1 (additive, ERR-66): no BBB rating is published; the link is a search URL we build
  col(
    "bbb_rating",
    "string",
    V,
    true,
    "always null: BBB blocks the lookup (A-01), no rating is published",
    "BBB rating not published (BBB blocked the lookup)",
    "bbb_blocked",
  ),
  col(
    "bbb_url",
    "string",
    V,
    true,
    "derived: BBB search URL built from contractor_name_as_printed and city Austin; never fetched; shape unverified",
    "Search BBB for this contractor",
    "source_missing",
  ),
  col(
    "profile_version",
    "string",
    V,
    false,
    "manifest profiles[] (travis-austin)",
    "Classification profile version",
    null,
  ),
  col(
    "profile_sha256",
    "string",
    V,
    false,
    "manifest profiles[] (travis-austin)",
    "Classification profile digest",
    null,
  ),
  ...PROVENANCE_COLUMNS,
];

const V_CONTRACTOR: readonly Column[] = [
  col("contractor_company_cid", "cid", V, false, "company.cid", "The company's CID", null),
  col("name", "string", V, true, "company.name", "Company name", "source_missing"),
  enumCol(
    "contractor_resolution",
    false,
    "derived: resolved only with an official registry id on the company; a printed-name company stays unresolved (v1.1)",
    "Contractor identity state",
    null,
  ),
  col(
    "identity_source",
    "string",
    V,
    true,
    "derived: company.source_http_request host",
    "Official identity source",
    "needs_review",
  ),
  enumCol("bbb_status", false, BBB_SOURCE, "BBB lookup state", null),
  col(
    "bbb_status_reason",
    "string",
    V,
    true,
    "as v_roofing_permit",
    "Why there is no BBB rating",
    null,
  ),
  col(
    "permit_count",
    "integer",
    "INTEGER",
    false,
    "count of property_improvement_has_contractor rows",
    "Permits",
    null,
  ),
  col(
    "roofing_permit_count",
    "integer",
    "INTEGER",
    false,
    "the same count limited to v_roofing_permit",
    "Roofing permits",
    null,
  ),
  ...PROVENANCE_COLUMNS,
];

const V_RUN: readonly Column[] = [
  col("run_id", "string", V, false, "manifest runId", "Run ID", null),
  col("county_fips", "string", V, false, "manifest fips", "County FIPS", null),
  col(
    "started_at",
    "timestamptz",
    "TIMESTAMP WITH TIME ZONE",
    false,
    "manifest startedAt",
    "Run start",
    null,
  ),
  col(
    "finished_at",
    "timestamptz",
    "TIMESTAMP WITH TIME ZONE",
    false,
    "manifest finishedAt (= as_of)",
    "Run finish",
    null,
  ),
  col("manifest_cid", "cid", V, false, "CIDv1 of the manifest", "Manifest CID", null),
  col(
    "previous_manifest_cid",
    "cid",
    V,
    true,
    "manifest previousManifestCid",
    "Previous run's manifest",
    "first_run",
  ),
  col(
    "tables_root_cids",
    "list",
    "STRUCT(data_group VARCHAR, cid VARCHAR)[]",
    false,
    "manifest artifacts[] kind=directory",
    "export-tables roots per data group",
    null,
  ),
  col(
    "sources",
    "list",
    'STRUCT("name" VARCHAR, watermark VARCHAR, captured_at VARCHAR, records BIGINT, added BIGINT, changed BIGINT, removed BIGINT, limitations VARCHAR[])[]',
    false,
    "manifest sources[]",
    "Sources with counts and deltas",
    null,
  ),
  col(
    "coverage",
    "json",
    "JSON",
    false,
    "manifest coverage",
    "Coverage counts with derivations (AD-04, AD-28)",
    null,
  ),
  col(
    "profile_version",
    "string",
    V,
    false,
    "manifest profiles[] (travis-austin)",
    "Classification profile version",
    null,
  ),
  col(
    "profile_sha256",
    "string",
    V,
    false,
    "manifest profiles[] (travis-austin)",
    "Classification profile digest",
    null,
  ),
  col(
    "area_list_sha256",
    "string",
    V,
    false,
    "manifest profiles[] (travis-places)",
    "Area list digest",
    null,
  ),
  col(
    "limitations",
    "list",
    "VARCHAR[]",
    false,
    "manifest limitations[]",
    "The run's stated limitations, in manifest order (empty list when none)",
    null,
  ),
  col(
    "missing",
    "missing",
    MISSING_TYPE,
    false,
    "built per row",
    "One {field, reason} entry for every null column (previous_manifest_cid on a first run); every other v_run column is never null",
    null,
  ),
];

export const VIEWS = {
  v_property: V_PROPERTY,
  v_roofing_permit: V_ROOFING_PERMIT,
  v_contractor: V_CONTRACTOR,
  v_run: V_RUN,
} as const satisfies Record<string, readonly Column[]>;

export type ViewName = keyof typeof VIEWS;

/** A field a view would carry but cannot in v1: it appears only in each row's `missing`. */
export interface UncarriedField {
  field: string;
  reason: MissingReason;
  /** The class.property that would carry it, or why none exists. */
  carrier: string;
  /** What the view does instead (ADR-0002 fallback). */
  fallback: string;
}

const NO_PERMIT_CARRIER = "no property_improvement property (ADR-0002)";

/**
 * The no-carrier and not-emitted fields per view (ADR-0002; story edge case 2: a carrier the
 * export does not emit is treated as no carrier until the export includes it). Every row of the
 * view lists each one in `missing` with this reason.
 */
export const UNCARRIED = {
  v_property: [
    {
      field: "city_name",
      reason: "source_missing",
      carrier:
        "address.city_name via property_has_address: TCAD prints the situs as one unnormalized line, so the record has no separate city",
      fallback: "the city is inside unnormalized_address (v1.2)",
    },
    {
      field: "postal_code",
      reason: "source_missing",
      carrier:
        "address.postal_code via property_has_address: TCAD prints the situs as one unnormalized line, so the record has no separate ZIP",
      fallback: "the ZIP is inside unnormalized_address (v1.2)",
    },
  ],
  v_roofing_permit: [
    {
      field: "status_raw",
      reason: "no_lexicon_carrier",
      carrier: NO_PERMIT_CARRIER,
      fallback: "Expired is published as improvement_status null → status_class stalled (D-4a)",
    },
    {
      field: "expiry_date",
      reason: "no_lexicon_carrier",
      carrier: NO_PERMIT_CARRIER,
      fallback: "not published",
    },
    {
      field: "description",
      reason: "no_lexicon_carrier",
      carrier: NO_PERMIT_CARRIER,
      fallback: "the profile classifies it before export; improvement_type/action carry the result",
    },
    {
      field: "work_class_raw",
      reason: "no_lexicon_carrier",
      carrier: NO_PERMIT_CARRIER,
      fallback: "the profile classifies it before export; improvement_type/action carry the result",
    },
  ],
  v_contractor: [
    {
      field: "bbb_rating",
      reason: "no_lexicon_carrier",
      carrier: "no business-rating class (fact_sheet has no fields)",
      fallback: "bbb_status = not_checked with a reason",
    },
    {
      field: "bbb_url",
      reason: "no_lexicon_carrier",
      carrier: "no business-rating class (fact_sheet has no fields)",
      fallback: "not published",
    },
  ],
} as const satisfies Record<Exclude<ViewName, "v_run">, readonly UncarriedField[]>;

/** Prefix of the property's own provenance columns in the sample row. */
export const SAMPLE_PROPERTY_PREFIX = "property_";

const SAMPLE_SHARED = new Set(["cid", "run_id", "manifest_cid", "as_of"]);
const PROVENANCE_NAMES = new Set(PROVENANCE_COLUMNS.map((c) => c.name));

/**
 * contract/v1/sample.parquet: one v_roofing_permit row (all its columns, unprefixed) joined to its
 * v_property row. The property's non-provenance columns keep their names (none collide); its
 * provenance columns are prefixed `property_`, except cid (= property_cid) and the run-level
 * run_id, manifest_cid and as_of, which equal the permit's.
 */
export const SAMPLE_COLUMNS: readonly Column[] = [
  // The property's request_identifier keeps the plain name in the sample; the permit's equals
  // permit_number in Run 2 and is left out of the 20-row sample.
  ...V_ROOFING_PERMIT.filter((c) => c.name !== "request_identifier"),
  ...V_PROPERTY.filter((c) => c.name !== "property_cid" && !PROVENANCE_NAMES.has(c.name)),
  ...PROVENANCE_COLUMNS.filter((c) => !SAMPLE_SHARED.has(c.name)).map((c) => ({
    ...c,
    name: `${SAMPLE_PROPERTY_PREFIX}${c.name}`,
    meaning: `The property's ${c.meaning.charAt(0).toLowerCase()}${c.meaning.slice(1)}`,
  })),
];

export function columnNames(view: ViewName): string[] {
  return VIEWS[view].map((c) => c.name);
}
