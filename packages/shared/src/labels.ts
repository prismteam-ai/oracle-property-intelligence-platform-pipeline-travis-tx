// Human labels for the contract's closed list of missing reasons (spec.md § Missing-reason
// labels, FR-011; PO decision D-2, 2026-10-21). The contract defines no labels: these are the
// UI wording, one row per reason, and the UI shows them wherever a value is missing (XI).
// Also the fixed Runs/Permits texts of plan.md § "Fixed texts and config keys" (T081): this
// file is the only source of those strings; apps/web imports them, never retypes them.
//
// Adding a reason to contract/v1 is additive and must add a row here. `satisfies
// Record<MissingReason, string>` makes tsc fail on a missing or an unknown key, and
// test/missing-labels.test.ts walks MISSING_REASONS at run time (A-03-TC-027).
import {
  MISSING_REASONS,
  type COLUMN_ENUMS,
  type COVERAGE_DERIVATIONS,
  type MissingReason,
} from "@countylens/contract";

export const MISSING_REASON_LABELS = Object.freeze({
  no_lexicon_carrier: "No place for this field in the published data model",
  not_in_export: "Not included in the published tables",
  source_missing: "Not on the source record",
  no_coordinates: "No coordinates for this parcel",
  no_roof_date: "No roof date found",
  basis_unmatched: "No roof-age basis matched",
  no_dated_sale: "No dated sale or deed on record",
  no_owner_record: "No owner record on the TCAD account",
  no_mailing_address: "No owner mailing address",
  zip_not_zcta: "ZIP is not a Census ZIP area",
  not_open: "Permit is not open",
  not_closed: "Permit is not closed",
  contractor_unresolved: "Contractor not matched to a company",
  bbb_blocked: "BBB blocked the lookup",
  bbb_not_found: "No BBB profile found",
  needs_review: "Needs review: could not be derived",
  first_run: "First run: no previous manifest",
  out_of_scope: "Outside Travis County",
  enum_lacks_value: "Status has no matching value (e.g. Expired)",
  owner_unparsed: "Owner name could not be parsed",
  owner_confidential: "Owner is confidential (TCAD)",
  superseded_by_later_permit: "Superseded by a later finished roofing permit",
} satisfies Record<MissingReason, string>);

/**
 * A-11 Run 3 (ADR 0004): the UI wording for `coordinate_source`, one row per value of the
 * contract's closed list. `address_point` is the City of Austin address-point layer: an exact,
 * unique match of the situs address, a building-level point (median 24 m from the GIS point on
 * the accounts that have both). `satisfies` makes tsc fail on a missing or an unknown key.
 */
export const COORDINATE_SOURCE_LABELS = Object.freeze({
  gis_centroid: "Parcel point (Travis County GIS)",
  address_point: "address point (City of Austin)",
  permit_point: "Permit location",
  none: "No coordinates",
} satisfies Record<(typeof COLUMN_ENUMS.coordinate_source)[number], string>);

/**
 * Provenance line shown with an `address_point`: where the point comes from and how it was
 * matched. The per-property request URL is on the published geometry record.
 */
export const ADDRESS_POINT_PROVENANCE_TEXT =
  "City of Austin public address-point layer, exact match on house number and street (unit ignored); one point only";

/**
 * D-2: a contractor field whose reason is `source_missing` means the source record printed no
 * contractor. This replaces the generic `source_missing` label for contractor fields only.
 */
export const CONTRACTOR_NOT_PRINTED_LABEL = "Contractor not printed on permit";

/** v1.1 (ERR-66): the BBB search link text, and the rating note shown beside it. */
export const BBB_SEARCH_LINK_LABEL = "Search BBB for this contractor";
export const BBB_RATING_NOT_PUBLISHED_LABEL = "BBB rating not published (BBB blocked the lookup)";

/**
 * Runs-page labels for manifest `coverage` counts (TC-012, TC-031). These are counts, not row
 * reasons: a permit without a TCAD id is never published, so no row can carry it (spec "Story
 * labels"). Texts verbatim from plan.md § "Fixed texts and config keys" (= test plan § 3).
 */
export const COVERAGE_LABELS = Object.freeze({
  permits_emitted: "Permits published",
  // pipeline/oracle-runtime/travis/permits/link.ts: the permit's TCAD id is on no real-property
  // account and its address matches none either (label audit 2026-10-26; was "No TCAD id …").
  permits_no_tcad_geoid: "TCAD id matches no property account",
  // tcad_id null and no usable address (street + ZIP5) to fall back on.
  permits_no_tcad_id: "No TCAD id or usable address on source record",
  // The other permit → parcel reconciliation outcomes (pipeline/oracle-runtime/travis/permits/link.ts).
  permits_ambiguous_geoid: "TCAD id shared by several accounts, address did not decide",
  permits_ambiguous_address: "Address matches several parcels",
  permits_address_unmatched: "No TCAD id; address matches no parcel",
  permits_trade_sub_permit: "Trade sub-permits set aside (electrical, plumbing, mechanical)",
  // County group rows counted from the published tables (pipeline/publish COUNTY_ROW_COVERAGE).
  owner_sales_published: "Ownership sales published",
  owner_persons_published: "Owners published as persons",
  owner_companies_published: "Owners published as companies",
  coordinates_published: "Parcel coordinates published",
});
export type CoverageLabelKey = keyof typeof COVERAGE_LABELS;

/** How a manifest coverage count was derived: one of the contract's `COVERAGE_DERIVATIONS` (AD-28). */
export type Derivation = (typeof COVERAGE_DERIVATIONS)[number];

/**
 * Runs-page helper text shown under each coverage count (FR-009, AD-28): what the count was
 * derived from. `satisfies Record<Derivation, string>` makes tsc fail on a missing or an
 * unknown key, and test/labels-extra.test.ts walks COVERAGE_DERIVATIONS at run time.
 */
export const DERIVATION_LABELS = Object.freeze({
  published_rows: "Counted from published rows",
  capture_receipt: "From the capture receipt",
  aggregate_match: "From the run's internal match (not recomputable from public data)",
} satisfies Record<Derivation, string>);

/** Runs-page publication state (P0-4, TC-010): public by CID; Atlas registration is not claimed. */
export const PUBLICATION_STATE_TEXT = "Public by CID · Atlas registration pending";

/** Runs-page error banners for `runs/index.json` (TC-014). */
export const RUN_INDEX_TEXTS = Object.freeze({
  /** The index is missing, is not JSON, or does not match the contract schema. */
  unreadable: "Run index could not be read from this site",
  /** The index reads fine but `runs` is `[]`. */
  empty: "No runs published yet",
});

/** Permit rows rendered per page: all rows stay in memory, one page is in the DOM. Twenty keeps
 *  the page a few screens tall (200 rows made it 53,000–73,000 px). */
export const PERMITS_PAGE_SIZE = 20;

/** Permits-page empty state and error banners (TC-029; engine failure; unreadable rows). */
export const PERMITS_TEXTS = Object.freeze({
  /** Only when `coverage.permits_emitted.count` is 0 and the query returns 0 rows. */
  empty: "No permits published in this run",
  /** The listed row count differs from the manifest's `permits_emitted.count` (FR-009). */
  countMismatch: (rows: number, count: number): string =>
    `Row count does not match the manifest: ${rows} listed, ${count} published`,
  engineFailure: "Query engine could not start",
  /** A listed row does not match contract/v1 `v_roofing_permit` (ERR-11); the detail goes to the console. */
  rowsUnreadable: "Permit rows could not be read from this run",
  /** The pager range line; `first`/`last` are 1-based and inclusive. */
  showing: (first: number, last: number, total: number): string =>
    `Showing ${first}\u2013${last} of ${total.toLocaleString("en-US")}`,
  previousPage: "Previous page",
  nextPage: "Next page",
  pagesLabel: "Permits pages",
});

/** Accessible names of the two progress bars (TC-024); `aria-valuetext` carries the stage text. */
export const PROGRESS_LABELS = Object.freeze({
  runs: "Loading run",
  permits: "Loading permits",
});

/** A contractor field: any view column named `contractor_*` (contract/v1 columns). */
export function isContractorField(field: string): boolean {
  return field.startsWith("contractor_");
}

/**
 * The label the UI shows for one `{field, reason}` entry of a row's `missing` list.
 * Throws, naming the reason, when the reason has no label (a contract/UI gap, never blank).
 */
export function missingLabel(field: string, reason: MissingReason): string {
  if (reason === "source_missing" && isContractorField(field)) {
    return CONTRACTOR_NOT_PRINTED_LABEL;
  }
  return missingReasonLabel(reason);
}

/** The table label of one reason; throws, naming the reason, when it is not in the map. */
export function missingReasonLabel(reason: string): string {
  const label = (MISSING_REASON_LABELS as Readonly<Record<string, string | undefined>>)[reason];
  if (label === undefined || label === "") {
    throw new Error(`No label for missing reason "${reason}"`);
  }
  return label;
}

/**
 * FR-011 coverage check: every reason in `reasons` has a non-empty label, and the map has no
 * label for a reason outside `reasons`. Throws naming the first gap. Defaults to the contract's
 * closed list, so `assertMissingReasonLabels()` is the live check.
 */
export function assertMissingReasonLabels(reasons: readonly string[] = MISSING_REASONS): void {
  for (const reason of reasons) missingReasonLabel(reason);
  const orphans = Object.keys(MISSING_REASON_LABELS).filter((key) => !reasons.includes(key));
  if (orphans.length > 0) {
    throw new Error(
      `Labels for reasons outside the closed list: ${orphans.map((o) => `"${o}"`).join(", ")}`,
    );
  }
}
