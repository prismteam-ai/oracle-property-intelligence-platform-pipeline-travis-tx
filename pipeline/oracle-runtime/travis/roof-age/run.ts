// A-07 T050 (Track D, contracts/estimator.md): the roof-age estimator invocation wrapper.
// `estimateOne` wires one property's facts into the vendored kit estimator (travis-roof-age-
// profile.ts -> kit/.../roof-age/estimator.ts), which is never reimplemented or modified here.
// The one business gate the kit estimator does not itself express is an implausible TCAD built
// year (a future year, or one before any Travis structure could plausibly have been built);
// that gate lives here, in the wrapper, not in the vendored estimator.
//
// The real audit/apply sequence (contracts/estimator.md) runs server-side, against live
// database data, in pipeline/local-stack/services/workflows/roof-age-{audit,backfill}.ts —
// both call `estimateOne`/`simpleBasisOf` directly rather than a file-based runner here.
import {
  estimateTravisRoofAge,
  type RoofAgeLedgerRow,
  type TravisRoofPermit,
} from "./travis-roof-age-profile.js";

/** The oldest plausible built year for a Travis County structure (D-9 era sanity gate). */
export const MIN_PLAUSIBLE_BUILT_YEAR = 1850;

export type BuiltYearReason = "future_built_year" | "implausibly_old_built_year" | null;

export interface RoofAgeRunRecord {
  pID: string;
  /** Run finishedAt; its UTC date is the estimator's asOfDate (never "today"). */
  finishedAt: string;
  /** TCAD propertyProfile[].imprvActualYearBuilt, or null, before the plausibility gate. */
  builtYear: number | null;
  permits: TravisRoofPermit[];
}

export interface RoofAgeRunRow extends RoofAgeLedgerRow {
  /** Why builtYear was dropped before reaching the estimator, or null when it was usable. */
  builtYearReason: BuiltYearReason;
}

/** The query-core comparison harness's simple basis label for one estimator row (T058). Never
 *  changes the estimate itself — a read-only projection of `anchor`/`workClassification` onto
 *  the same four labels `roofAgeBasis` (packages/query-core/src/derive.ts) already uses. */
export type SimpleRoofAgeBasis = "permit" | "new_construction" | "built_year" | "unknown";

export function simpleBasisOf(row: RoofAgeRunRow): SimpleRoofAgeBasis {
  const anchor = row.estimate.anchor;
  if (anchor === null) return "unknown";
  if (anchor.type === "property_built_year") return "built_year";
  return row.estimate.workClassification === "primary_roof_new_construction"
    ? "new_construction"
    : "permit";
}

function sanitizedBuiltYear(
  builtYear: number | null,
  asOfDate: string,
): { year: number | null; reason: BuiltYearReason } {
  if (builtYear === null) return { year: null, reason: null };
  const asOfYear = Number(asOfDate.slice(0, 4));
  if (builtYear > asOfYear) return { year: null, reason: "future_built_year" };
  if (builtYear < MIN_PLAUSIBLE_BUILT_YEAR)
    return { year: null, reason: "implausibly_old_built_year" };
  return { year: builtYear, reason: null };
}

/** Estimate one property's roof age through the wrapper's gates and the vendored estimator. */
export function estimateOne(record: RoofAgeRunRecord): RoofAgeRunRow {
  const asOfDate = record.finishedAt.slice(0, 10);
  const { year, reason } = sanitizedBuiltYear(record.builtYear, asOfDate);
  const row = estimateTravisRoofAge({
    pID: record.pID,
    finishedAt: record.finishedAt,
    builtYear: year,
    permits: record.permits,
  });
  return { ...row, builtYearReason: reason };
}
