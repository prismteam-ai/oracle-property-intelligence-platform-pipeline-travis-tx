// The record kinds of the Coverage page (A-13 T021, AC-2, FR-002; spec US1 "property, ownership,
// permit, contractor by its five states, BBB by status, business, places, coordinates"). Static
// text only: which manifest coverage-key prefixes belong to a kind, which manifest source
// collected it and which published table (elephant-cli group/table, matched against the
// manifest's artifact names) holds its rows. No count lives here: counts come only from the
// manifest's coverage section (AD-04). A key no kind claims is listed under "Other" (tolerated).
import { COVERAGE_TEXTS } from "@countylens/shared";

/** Shown for a record kind with no key in the manifest's coverage section (TC-017). */
export const COVERAGE_KIND_MISSING = COVERAGE_TEXTS.kindAbsent;
/** Shown when a kind's rows are in no published table of this run. */
export const COVERAGE_TABLE_MISSING = "no published table for this kind in this run";
/** Shown when the kind's source is not among the manifest's sources. */
export const COVERAGE_SOURCE_MISSING = "source not in this run's manifest";
/** A kind with no coverage key whose rows are still in a published table of this run. */
export const COVERAGE_KIND_IN_TABLE = "No count recorded · rows are in the published table";
/** A kind with no coverage key, no reason of its own and no published table. */
export const COVERAGE_KIND_NOT_COLLECTED = "Not collected in this run";
/** The short "Source total" line when the manifest has no `source_total:{source}` key. */
export const COVERAGE_TOTAL_MISSING = "no source total recorded";
/** A source whose rows are read but not published as rows of their own (e.g. address points). */
export const COVERAGE_NOT_PUBLISHED = "not published as rows";

/**
 * Readable names of the manifest's sources (static words; the raw id stays beside them). A
 * source not listed here is shown by its id.
 */
export const SOURCE_TITLES: Readonly<Record<string, string>> = Object.freeze({
  "tcad-2026-certified-json": "TCAD 2026 certified roll",
  "austin-3syk-w9eu": "Austin building permits",
  "austin-address-points": "Austin address points",
});

/**
 * The coverage key that counts the published rows of a source's records (data audit
 * 2026-10-26): the county property rows come from the TCAD roll, the permit rows from the Austin
 * permit dataset. The numbers themselves are read from the manifest; a missing key shows "—".
 */
export const SOURCE_PUBLISHED_KEY: Readonly<Record<string, string>> = Object.freeze({
  "tcad-2026-certified-json": "parcels_published",
  "austin-3syk-w9eu": "permits_emitted",
});

export interface CoverageKind {
  readonly id: string;
  readonly title: string;
  readonly prefixes: readonly string[];
  /** Manifest `sources[].name` that collected the kind, when one source does. */
  readonly source: string | null;
  /** `{group}/{table}` under `tables/`, when the kind is published as a table. */
  readonly table: string | null;
  /**
   * Why the kind has no count when the run collects none (docs/source-limits.md); null when the
   * generic reasons apply (rows in a published table, or not collected).
   */
  readonly reason: string | null;
}

export const COVERAGE_KINDS: readonly CoverageKind[] = Object.freeze([
  {
    id: "property",
    title: "Property",
    prefixes: ["parcels_"],
    source: "tcad-2026-certified-json",
    table: "county/property",
    reason: null,
  },
  {
    id: "ownership",
    title: "Ownership",
    prefixes: ["owner_", "confidential_"],
    source: "tcad-2026-certified-json",
    table: "county/sales_history",
    reason: null,
  },
  {
    // README "reconcile duplicate entities": how each Austin permit record was matched to one TCAD
    // parcel, or why it was not linked (shared ids, ambiguous or unmatched addresses), from the
    // run's internal match. Listed before Permit so these keys are claimed here.
    id: "reconciliation",
    title: "Reconciliation · permits matched to TCAD parcels",
    prefixes: [
      "permits_ambiguous_",
      "permits_address_unmatched",
      "permits_no_tcad_",
      "permits_trade_sub_permit",
    ],
    source: "austin-3syk-w9eu",
    table: "property_improvement/property_improvement",
    reason: null,
  },
  {
    id: "permit",
    title: "Permit",
    prefixes: ["permits_", "roof_age_"],
    source: "austin-3syk-w9eu",
    table: "property_improvement/property_improvement",
    reason: null,
  },
  {
    id: "contractor",
    title: "Contractor · resolved, candidate, ambiguous, conflicting, unresolved",
    prefixes: ["contractor_"],
    source: "austin-3syk-w9eu",
    // The printed-name company links (Run 3 manifest limitation; data audit 2026-10-26, row 7).
    table: "property_improvement/property_improvement_has_contractor",
    reason: null,
  },
  {
    id: "bbb",
    title: "BBB by status",
    prefixes: ["bbb_"],
    source: null,
    table: null,
    // docs/source-limits.md: HTTP 403 Cloudflare challenge, never bypassed.
    reason: "Not collected · bbb.org blocks automated access",
  },
  {
    id: "business",
    title: "Business",
    prefixes: ["business_"],
    source: null,
    table: null,
    // The Comptroller registry is a lookup for the contractor match (see Known limitations).
    reason: "Not published · the business registry only feeds the contractor match",
  },
  {
    id: "places",
    title: "Places",
    prefixes: ["places_"],
    source: null,
    table: null,
    // The manifest profile travis-places is the Census place-name gazetteer that locates towns and
    // ZIPs for search; it publishes no place records (label review 2026-10-26).
    reason:
      "Not collected · no business-places source in this run (the place-name gazetteer only locates areas)",
  },
  {
    id: "coordinates",
    title: "Coordinates",
    prefixes: ["coordinates_"],
    source: "tcad-2026-certified-json",
    table: "county/geometry",
    reason: null,
  },
]);

export const OTHER_KIND: CoverageKind = Object.freeze({
  id: "other",
  title: "Other coverage keys",
  prefixes: [],
  source: null,
  table: null,
  reason: null,
});

/** A key's label when COVERAGE_LABELS has none: its words ("contractor_resolved" → "contractor resolved"). */
export function keyWords(key: string): string {
  return key.replace(/[_:]+/g, " ").trim();
}

/** The kind a coverage key belongs to (OTHER_KIND when none claims it). */
export function kindOf(key: string): CoverageKind {
  return COVERAGE_KINDS.find((k) => k.prefixes.some((p) => key.startsWith(p))) ?? OTHER_KIND;
}
