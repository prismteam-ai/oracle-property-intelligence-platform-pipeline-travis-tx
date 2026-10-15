import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";

describe("loadConfig", () => {
  it("treats empty env values as unset", () => {
    const c = loadConfig(
      { ORACLE_OVERTURE_RELEASE: "", ORACLE_COUNTY: "  ", ORACLE_ROOF_AGE_THRESHOLD_YEARS: "" },
      "/repo",
    );
    expect(c.overtureRelease).toBeUndefined();
    expect(c.county).toBe("travis");
    expect(c.roofAgeThresholdYears).toBe(15);
    expect(c.dbPath).toBe("/repo/data/travis.duckdb");
  });
});
