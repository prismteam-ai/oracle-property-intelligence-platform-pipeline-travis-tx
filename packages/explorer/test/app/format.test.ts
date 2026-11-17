import { describe, expect, it } from "vitest";
import { formatValue } from "../../src/format.js";

describe("formatValue", () => {
  it("keeps coordinates precise enough to find the house", () => {
    expect(formatValue(30.442527570434454, "latitude")).toBe("30.442528");
    expect(formatValue(-97.62038, "longitude")).toBe("-97.620380");
  });

  it("shows identifiers, years and ZIP codes as written", () => {
    expect(formatValue(276120, "prop_id")).toBe("276120");
    expect(formatValue(1977, "year_built")).toBe("1977");
    expect(formatValue("78660", "situs_zip")).toBe("78660");
  });

  it("groups counts and keeps two decimals for other measures", () => {
    expect(formatValue(2381903, "rows")).toBe("2,381,903");
    expect(formatValue(4.8712, "distance_miles")).toBe("4.87");
  });

  it("spells out coded values", () => {
    expect(formatValue("completed_replacement", "roof_age_anchor")).toBe("completed replacement");
    expect(formatValue("out_of_state", "owner_locality")).toBe("out of state");
    expect(formatValue("2007-105523 BP", "permit_number")).toBe("2007-105523 BP");
  });
});
