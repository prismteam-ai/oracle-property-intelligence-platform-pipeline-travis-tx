// Parcel-gap reconciliation from the certified export (PO decision 2026-10-20).
//
// The GIS layer counts parcel polygons; the certified roll counts appraisal accounts. The
// two differ for known reasons that the export itself shows: accounts that are not land
// (business personal property, mobile homes, minerals), condominium units that share their
// building's parcel and carry no geometry point of their own, and newly platted inventory
// lots the county GIS has not drawn yet. This module turns the streaming counts into
// catalog blocks and plain text. It never changes the raw gap, the roll count (the
// canonical denominator) or the GIS count, and GIS is never substituted for the roll.
//
// The reconciliation is count-level: it subtracts category totals, it does not join GIS
// features to accounts. Whatever is left is reported as an unexplained residual.
//
// OR-m1: no official table of the TCAD state subcodes (A4, F4, O1, C1) was found (web
// search 2026-10-20: neither TCAD's published reports nor the Comptroller's Property
// Classification Guide snippets define them), so every subcode meaning is labelled
// "state-code reading, unverified". "No export geometry point" is what the export shows;
// it stands in for "no parcel polygon of its own" and is never stated as that fact.
import type {
  AccountBreakdownBlock,
  ExportReceipt,
  GapReconciliation,
  Measurement,
} from "./catalog.schema.js";
import type { AccountBreakdown } from "./probes/tcad.js";

export const BREAKDOWN_METHOD = "streaming count of the certified export";

/** Export Layouts `prop_type_cd` (the JSON export prints Mobile Home as MH, not M). */
export const PROP_TYPE_MEANINGS: Readonly<Record<string, string>> = {
  R: "real property",
  P: "business personal property",
  MH: "mobile home",
  MN: "mineral",
};
const PROP_TYPE_MEANING_SOURCE =
  "TCAD Export Layouts (Legacy 8.0.33 Appraisal Export Layout, prop_type_cd: R = Real, P = Business Personal Property, M = Mobile Home, MN = Mineral); the 2026 JSON export prints the mobile-home type as MH";

export const UNVERIFIED = "state-code reading, unverified";

/** State property tax codes the reconciliation relies on (readings, not official meanings). */
export const STATE_CD_MEANINGS: Readonly<Record<string, string>> = {
  A4: `residential condominium (${UNVERIFIED})`,
  F4: `commercial condominium (${UNVERIFIED})`,
  O1: `inventory (${UNVERIFIED})`,
  C1: `vacant lots and tracts (${UNVERIFIED})`,
};
const STATE_CD_MEANING_SOURCE =
  "Category letters follow the Texas Comptroller property categories (A residential, C vacant lots and tracts, F commercial, O residential inventory); the subcodes A4, F4, O1 and C1 are TCAD codes whose descriptions are not printed in the JSON export (the Export Layouts define a STATE_CD file but it is not part of the download), and no official TCAD or Comptroller table defining them was found (web search 2026-10-20), so each subcode meaning is a state-code reading, unverified; with_condo_unit shows how often propertyCharacteristics[].condoUnit is filled and is not used as proof";

/** Above this share of filled condoUnit, an inventory code reads as mostly condo inventory. */
const MOSTLY = 0.5;

/** The meaning of a no-geometry state code, with the condoUnit evidence where it decides. */
function stateCdMeaning(row: { state_cd: string; count: number; with_condo_unit: number }) {
  const base = STATE_CD_MEANINGS[row.state_cd];
  if (base === undefined) return undefined;
  if (INVENTORY_STATE_CODES.includes(row.state_cd) && row.count > 0) {
    const share = row.with_condo_unit / row.count;
    if (share > MOSTLY) {
      return `inventory; mostly condo inventory by the condoUnit field (${Math.round(share * 100)}% filled; ${UNVERIFIED})`;
    }
  }
  return base;
}

/** Non-land account types: no parcel polygon of their own in the GIS. */
export const NON_LAND_PROP_TYPES = ["P", "MH", "MN"] as const;
/** Condominium state codes (a state-code reading): units would share their building's parcel. */
export const CONDO_STATE_CODES = ["A4", "F4"] as const;
/** Inventory state codes (a state-code reading). */
export const INVENTORY_STATE_CODES: readonly string[] = ["O1"];

const LIKELY_RESIDUAL_CAUSE =
  "unexplained; consistent with the county GIS refreshing every 1 to 2 months while the roll is certified once (a likely cause, not verified)";

function sumTypes(b: AccountBreakdown, types: readonly string[]): number {
  return b.by_prop_type.filter((r) => types.includes(r.prop_type)).reduce((n, r) => n + r.count, 0);
}

function sumNoGeometryCodes(b: AccountBreakdown, codes: readonly string[]): number {
  return b.real_estate.without_geometry_by_state_cd
    .filter((r) => codes.includes(r.state_cd))
    .reduce((n, r) => n + r.count, 0);
}

function countOf(b: AccountBreakdown, type: string): number {
  return b.by_prop_type.find((r) => r.prop_type === type)?.count ?? 0;
}

function codeCount(b: AccountBreakdown, code: string): number {
  return b.real_estate.without_geometry_by_state_cd.find((r) => r.state_cd === code)?.count ?? 0;
}

/** "condoUnit filled on X of Y": the measured coverage of the condoUnit field for the codes. */
function condoUnitCoverage(b: AccountBreakdown, codes: readonly string[]): string {
  const rows = b.real_estate.without_geometry_by_state_cd.filter((r) => codes.includes(r.state_cd));
  const filled = rows.reduce((n, r) => n + r.with_condo_unit, 0);
  const total = rows.reduce((n, r) => n + r.count, 0);
  return `condoUnit filled on ${filled} of ${total}`;
}

/** Measured condominium units without their own geometry point (drives `acknowledged`). */
export function condoUnitsWithoutGeometry(b: AccountBreakdown): number {
  return sumNoGeometryCodes(b, CONDO_STATE_CODES);
}

/** The catalog block for the breakdown, with the export receipt's provenance. */
export function accountBreakdownBlock(
  b: AccountBreakdown,
  receipt: ExportReceipt,
  zipEntry: string | null,
): AccountBreakdownBlock {
  const states = b.real_estate.without_geometry_by_state_cd.map((r) => ({
    state_cd: r.state_cd,
    count: r.count,
    with_condo_unit: r.with_condo_unit,
    ...(stateCdMeaning(r) ? { meaning: stateCdMeaning(r) } : {}),
  }));
  return {
    source_url: receipt.url,
    captured_at: receipt.captured_at,
    method: BREAKDOWN_METHOD,
    export_sha256: receipt.sha256,
    ...(zipEntry ? { zip_entry: zipEntry } : {}),
    records: b.records,
    inactive_flagged: b.inactive_flagged,
    by_prop_type: b.by_prop_type.map((r) => ({
      prop_type: r.prop_type,
      count: r.count,
      ...(PROP_TYPE_MEANINGS[r.prop_type] ? { meaning: PROP_TYPE_MEANINGS[r.prop_type] } : {}),
    })),
    prop_type_meaning_source: PROP_TYPE_MEANING_SOURCE,
    real_estate: {
      prop_type: "R",
      accounts: b.real_estate.accounts,
      distinct_geo_ids: b.real_estate.distinct_geo_ids,
      accounts_sharing_a_geo_id: b.real_estate.accounts_sharing_a_geo_id,
      accounts_without_geo_id: b.real_estate.accounts_without_geo_id,
      with_geometry_point: b.real_estate.with_geometry_point,
      without_geometry_point: b.real_estate.without_geometry_point,
      ...(states.length > 0 ? { without_geometry_by_state_cd: states } : {}),
    },
    state_cd_meaning_source: STATE_CD_MEANING_SOURCE,
  };
}

/** Rounds to 2 decimals, as gap_pct is. */
function pct2(part: number, whole: number): number {
  return Math.round((part / whole) * 100 * 100) / 100;
}

/** The count-level reconciliation of roll - GIS. Requires GIS below the roll. */
export function reconcileGap(
  b: AccountBreakdown,
  assessed: number,
  gis: number,
): GapReconciliation {
  if (!(assessed > 0) || gis >= assessed) {
    throw new Error(
      `parcel-gap: GIS ${gis} is not below the roll ${assessed}; there is no shortfall to reconcile`,
    );
  }
  const nonLand = sumTypes(b, NON_LAND_PROP_TYPES);
  const condos = condoUnitsWithoutGeometry(b);
  const inventory = sumNoGeometryCodes(b, INVENTORY_STATE_CODES);
  const typeList = NON_LAND_PROP_TYPES.map((t) => `${t} ${countOf(b, t)}`).join(", ");
  const condoList = CONDO_STATE_CODES.map((c) => `${c} ${codeCount(b, c)}`).join(", ");
  const components = [
    {
      component: "non_land_accounts",
      count: nonLand,
      reason: `business personal property, mobile-home and mineral accounts (${typeList}) are appraisal accounts, not land parcels, so they are not expected to have a parcel polygon of their own in the GIS`,
    },
    {
      component: "condo_accounts_without_export_point",
      count: condos,
      reason: `real-property accounts with state codes ${condoList} and no export geometry point, read as condominium units that share their building's parcel polygon (${UNVERIFIED}; ${condoUnitCoverage(b, CONDO_STATE_CODES)})`,
    },
    {
      component: "inventory_accounts_without_export_point",
      count: inventory,
      reason: `real-property accounts with state code ${INVENTORY_STATE_CODES.join(", ")} and no export geometry point: inventory; mostly condo inventory by the condoUnit field (${condoUnitCoverage(b, INVENTORY_STATE_CODES)}; ${UNVERIFIED})`,
    },
  ];
  const gap = assessed - gis;
  const explained = components.reduce((n, c) => n + c.count, 0);
  const residual = gap - explained;
  return {
    gap,
    components,
    explained,
    residual,
    residual_pct_of_roll: pct2(residual, assessed),
    method:
      "count-level: category totals from the certified export subtracted from roll minus GIS; not a feature-to-account join",
    residual_note: LIKELY_RESIDUAL_CAUSE,
  };
}

function counted(gis: Measurement): string {
  const via = gis.captured_via ? ` from a ${gis.captured_via}` : "";
  return `counted${via} at ${gis.captured_at}`;
}

function reconciliationSentence(r: GapReconciliation, receipt: ExportReceipt): string {
  const parts = r.components.map((c) => `${c.count} ${c.component.replace(/_/g, " ")}`);
  return (
    `reconciled by count from the certified export (${BREAKDOWN_METHOD}, receipt captured_at ${receipt.captured_at}): ` +
    `${parts.join(" + ")} = ${r.explained} of the ${r.gap}; ` +
    `the residual ${r.residual} (${r.residual_pct_of_roll.toFixed(2)}% of the roll) is ${LIKELY_RESIDUAL_CAUSE}; ` +
    "this is a count-level reconciliation, not a feature-to-account join"
  );
}

function gapHead(assessed: number, gis: Measurement, gapPct: number): string {
  const value = gis.value ?? 0;
  return `GIS ${value} features vs certified roll ${assessed} (${assessed - value} fewer, ${gapPct.toFixed(2)}% below the roll), ${counted(gis)}`;
}

/** parcel.gap_reason: the raw gap and how much of it the export explains. */
export function gapReasonText(
  assessed: number,
  gis: Measurement,
  gapPct: number,
  r: GapReconciliation,
  receipt: ExportReceipt,
): string {
  return `${gapHead(assessed, gis, gapPct)}; ${reconciliationSentence(r, receipt)}`;
}

/** parcel.discrepancy_explanation: the same plus the threshold consequence. */
export function discrepancyExplanationText(
  assessed: number,
  gis: Measurement,
  gapPct: number,
  thresholdPct: number,
  r: GapReconciliation,
  receipt: ExportReceipt,
): string {
  const consequence =
    gapPct > thresholdPct
      ? `the raw gap is above the ${thresholdPct}% threshold, so GIS-only seeding is blocked`
      : `the raw gap is within the ${thresholdPct}% threshold`;
  return (
    `${gapHead(assessed, gis, gapPct)}; ${consequence}; ${reconciliationSentence(r, receipt)}; ` +
    "the certified roll stays the canonical denominator and GIS is never substituted"
  );
}
