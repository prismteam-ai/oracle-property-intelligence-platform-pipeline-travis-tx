// A-04 T022 (AC-4, FR-004, FR-018): one year-built rule, recorded as `year_built_rule`
// (agent-design § 1; Stage 0 fields):
//   1 profile_main: propertyProfile[0].imprvActualYearBuilt when it is an integer from 1800 to
//     the year of as_of (0 is how the export prints "missing"): TCAD's own main-improvement year.
//   2 largest_main_improvement: else, among valuations[].details["cost-local"].improvements[]
//     that are residential (improvement stateCd in PTD category A, B or M) with a valid
//     actualYearBuilt, the one with the largest living area, its actualYearBuilt. The export
//     has no main flag. Living area = the sum of details[].area over the floor details
//     (imprvDetailType 1ST / 2ND / 3RD / 1/2 / FBSMT, as printed); ties keep source order.
//   3 none: never the minimum, maximum or effective year. Year null, year_built_missing_reason
//     source_missing, roof_age_basis unknown, roof_age_reason no_roof_date (A-07 derives the rest).
export type YearBuiltRule = "profile_main" | "largest_main_improvement" | "none";

export interface YearBuiltFields {
  property_structure_built_year: number | null;
  year_built_rule: YearBuiltRule;
  year_built_missing_reason: "source_missing" | null;
  roof_age_basis: "unknown" | null;
  roof_age_reason: "no_roof_date" | null;
}

export const MIN_YEAR = 1800;
/** Improvement stateCd prefixes read as residential (PTD categories A, B, M). */
export const RESIDENTIAL_STATE_PREFIX = /^[ABM]/;
/** Detail types counted as living area (floors and a finished basement, as printed). */
export const LIVING_DETAIL_TYPES: ReadonlySet<string> = new Set([
  "1ST",
  "2ND",
  "3RD",
  "1/2",
  "FBSMT",
]);

export interface Improvement {
  imprvType: string | null;
  stateCd: string | null;
  isMainResidential: boolean;
  livingArea: number | null;
  actualYearBuilt: number | null;
  effectiveYearBuilt: number | null;
}

type Obj = Record<string, unknown>;
const objs = (v: unknown): Obj[] =>
  Array.isArray(v) ? v.filter((x): x is Obj => typeof x === "object" && x !== null) : [];
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : null;

const validYear = (y: number | null, maxYear: number): y is number =>
  y !== null && Number.isInteger(y) && y >= MIN_YEAR && y <= maxYear;

/** Every improvement of the record, in source order (children rows of property_structures). */
export function improvementsOf(record: Obj): Improvement[] {
  const out: Improvement[] = [];
  for (const v of objs(record.valuations)) {
    const details = v.details as Obj | null | undefined;
    const cost = details?.["cost-local"] as Obj | null | undefined;
    for (const imp of objs(cost?.improvements)) {
      const stateCd = str(imp.stateCd);
      const floors = objs(imp.details).filter((d) =>
        LIVING_DETAIL_TYPES.has(str(d.imprvDetailType) ?? ""),
      );
      const area = floors.reduce((sum, d) => sum + (num(d.area) ?? 0), 0);
      out.push({
        imprvType: str(imp.imprvType),
        stateCd,
        isMainResidential: stateCd !== null && RESIDENTIAL_STATE_PREFIX.test(stateCd),
        livingArea: floors.length === 0 ? null : area,
        actualYearBuilt: num(imp.actualYearBuilt),
        effectiveYearBuilt: num(imp.effYearBuilt),
      });
    }
  }
  return out;
}

export function yearBuiltOf(record: Obj, asOf: string): YearBuiltFields {
  const maxYear = Number(asOf.slice(0, 4));
  if (!Number.isInteger(maxYear)) throw new Error(`year built: as_of ${asOf} is not a date`);
  const profile = objs(record.propertyProfile)[0];
  const fromProfile = num(profile?.imprvActualYearBuilt);
  const found = (year: number, rule: YearBuiltRule): YearBuiltFields => ({
    property_structure_built_year: year,
    year_built_rule: rule,
    year_built_missing_reason: null,
    roof_age_basis: null,
    roof_age_reason: null,
  });
  if (validYear(fromProfile, maxYear)) return found(fromProfile, "profile_main");
  let best: Improvement | null = null;
  for (const imp of improvementsOf(record)) {
    if (!imp.isMainResidential || !validYear(imp.actualYearBuilt, maxYear)) continue;
    if (best === null || (imp.livingArea ?? 0) > (best.livingArea ?? 0)) best = imp;
  }
  if (best !== null && best.actualYearBuilt !== null)
    return found(best.actualYearBuilt, "largest_main_improvement");
  return {
    property_structure_built_year: null,
    year_built_rule: "none",
    year_built_missing_reason: "source_missing",
    roof_age_basis: "unknown",
    roof_age_reason: "no_roof_date",
  };
}
