// A-07 T051 (Track D3, contracts/estimator.md § "View comparison"): diffs this package's own
// view-side roof-age derivation (src/derive.ts: roofAgeBasis/roofAgeConfidence/roofAgeYears,
// the same functions the SQL views call) against the vendored kit estimator's output, for the
// 25 audited properties, at the same as-of date. Never reimplements either side; only compares
// them. Lives outside src/ (not published through index.ts) because it is a Track D build/audit
// tool, not part of the public query-core API surface (NFR-004/SC-006).
import {
  roofAgeBasis,
  roofAgeConfidence,
  roofAgeYears,
  type RoofAgeBasis,
  type RoofAgeConfidence,
} from "./src/derive.js";

/** One property's inputs to both sides of the comparison. */
export interface RoofAgeComparisonRow {
  tcadId: string;
  /** The manifest finishedAt / as-of date, ISO (YYYY-MM-DD), same value both sides use. */
  asOf: string;
  /** structure.roof_date as the view would read it (YYYY, YYYY-MM or YYYY-MM-DD), or null. */
  roofDate: string | null;
  /** A linked Roofing/Replacement permit's completion/close date matches roof_date. */
  replacementMatch: boolean;
  /** The same with improvement_action New. */
  newMatch: boolean;
  builtYear: number | null;
  /** The vendored kit estimator's output for the same property/as-of. */
  estimator: {
    basis: RoofAgeBasis;
    confidence: RoofAgeConfidence;
    roofAgeYears: number | null;
  };
}

export type RoofAgeComparisonField = "basis" | "confidence" | "roofAgeYears";

export interface RoofAgeComparisonRowResult {
  tcadId: string;
  agree: boolean;
  viewSide: { basis: RoofAgeBasis; confidence: RoofAgeConfidence; roofAgeYears: number | null };
  estimatorSide: {
    basis: RoofAgeBasis;
    confidence: RoofAgeConfidence;
    roofAgeYears: number | null;
  };
  mismatchFields: RoofAgeComparisonField[];
}

export interface RoofAgeComparisonSummary {
  total: number;
  agreeCount: number;
  /** True only when all 25 audited properties were supplied and every one agrees (SC-005/006). */
  agreeAll25: boolean;
  rows: RoofAgeComparisonRowResult[];
}

export function compareRoofAgeDerivations(
  rows: readonly RoofAgeComparisonRow[],
): RoofAgeComparisonSummary {
  const results = rows.map((row): RoofAgeComparisonRowResult => {
    const basis = roofAgeBasis(row.roofDate, row.replacementMatch, row.newMatch, row.builtYear);
    const confidence = roofAgeConfidence(basis);
    const years = roofAgeYears(row.roofDate, row.asOf);
    const viewSide = { basis, confidence, roofAgeYears: years };
    const mismatchFields: RoofAgeComparisonField[] = [];
    if (basis !== row.estimator.basis) mismatchFields.push("basis");
    if (confidence !== row.estimator.confidence) mismatchFields.push("confidence");
    if (years !== row.estimator.roofAgeYears) mismatchFields.push("roofAgeYears");
    return {
      tcadId: row.tcadId,
      agree: mismatchFields.length === 0,
      viewSide,
      estimatorSide: row.estimator,
      mismatchFields,
    };
  });
  const agreeCount = results.filter((r) => r.agree).length;
  return {
    total: results.length,
    agreeCount,
    agreeAll25: results.length === 25 && agreeCount === 25,
    rows: results,
  };
}
