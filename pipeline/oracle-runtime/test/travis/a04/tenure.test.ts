// A-04 T022/T023 (AC-4, FR-004): tenure from the latest dated sale and year built by one
// recorded rule; missing data gets a reason, never a guess. Synthetic test input.
import { describe, expect, it } from "vitest";
import { tenureOf, LONG_TENURE_YEARS } from "../../../travis/tcad/tenure.js";
import { yearBuiltOf } from "../../../travis/tcad/year-built.js";
import { a04Record } from "../../fixtures/a04/tcad/export.js";

const AS_OF = "2026-10-22";

describe("A-04-TC-012 no sale date → tenure_basis unknown, never tenure > 10", () => {
  it("A-04-TC-012 the latest dated saleDt gives the tenure (as_of = run finishedAt)", () => {
    const t = tenureOf(
      [{ saleDt: "2001-03-04 00:00:00" }, { saleDt: "2010-06-01 00:00:00" }, { saleDt: null }],
      AS_OF,
    );
    expect(t).toMatchObject({
      last_ownership_transfer_date: "2010-06-01",
      tenure_basis: "sale_date",
      tenure_missing_reason: null,
      is_long_tenure: true,
    });
    expect(t.tenure_years).toBeCloseTo(16.39, 1);
    expect(LONG_TENURE_YEARS).toBe(10);
    expect(tenureOf([{ saleDt: "2020-01-01" }], AS_OF).is_long_tenure).toBe(false);
  });

  it("A-04-TC-012 no dated sale → unknown, null tenure, null is_long_tenure, no_dated_sale", () => {
    for (const sales of [[], [{ saleDt: null }, { saleDt: "" }, { saleDt: "not a date" }]]) {
      expect(tenureOf(sales, AS_OF)).toEqual({
        last_ownership_transfer_date: null,
        tenure_years: null,
        tenure_basis: "unknown",
        tenure_missing_reason: "no_dated_sale",
        is_long_tenure: null,
      });
    }
  });
});

describe("A-04-TC-013 no year built → roof_age_basis unknown with reason", () => {
  it("A-04-TC-013 propertyProfile[0].imprvActualYearBuilt in 1800…year(as_of) → profile_main", () => {
    const y = yearBuiltOf(a04Record({ pID: 1, geoID: "01", yearBuilt: 1941 }), AS_OF);
    expect(y).toEqual({
      property_structure_built_year: 1941,
      year_built_rule: "profile_main",
      year_built_missing_reason: null,
      roof_age_basis: null,
      roof_age_reason: null,
    });
  });

  it("A-04-TC-013 0 / out of range in the profile → the largest main residential improvement", () => {
    for (const yearBuilt of [0, 1700, 2031]) {
      const r = a04Record({
        pID: 2,
        geoID: "02",
        yearBuilt,
        improvements: [
          { stateCd: "A1", livingArea: 900, actualYearBuilt: 1950, effectiveYearBuilt: 1990 },
          { stateCd: "A1", livingArea: 2100, actualYearBuilt: 1978, effectiveYearBuilt: 2005 },
          { stateCd: "F1", livingArea: 5000, actualYearBuilt: 1930 },
        ],
      });
      expect(yearBuiltOf(r, AS_OF)).toMatchObject({
        property_structure_built_year: 1978,
        year_built_rule: "largest_main_improvement",
      });
    }
  });

  it("A-04-TC-013 no year anywhere → null, source_missing, roof_age_basis unknown / no_roof_date", () => {
    const r = a04Record({
      pID: 3,
      geoID: "03",
      yearBuilt: 0,
      improvements: [{ stateCd: "A1", livingArea: 1200, actualYearBuilt: 0 }],
    });
    expect(yearBuiltOf(r, AS_OF)).toEqual({
      property_structure_built_year: null,
      year_built_rule: "none",
      year_built_missing_reason: "source_missing",
      roof_age_basis: "unknown",
      roof_age_reason: "no_roof_date",
    });
  });

  it("A-04-TC-013 never the minimum, maximum or effective year", () => {
    const r = a04Record({
      pID: 4,
      geoID: "04",
      yearBuilt: 0,
      improvements: [
        { stateCd: "A1", livingArea: 1500, actualYearBuilt: 1990, effectiveYearBuilt: 2015 },
        { stateCd: "A1", livingArea: 800, actualYearBuilt: 1925 },
        { stateCd: "A1", livingArea: 700, actualYearBuilt: 2019 },
      ],
    });
    expect(yearBuiltOf(r, AS_OF).property_structure_built_year).toBe(1990);
  });
});
