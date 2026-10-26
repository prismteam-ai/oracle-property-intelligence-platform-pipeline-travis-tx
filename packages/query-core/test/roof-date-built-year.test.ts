// ERR-68, query side: a County structure with roof_date "1987" (the value the County group
// now writes for a built_year ledger row) and no permit gives v_property roof_age_basis
// built_year, confidence low, and a roof age of the run's as_of year minus 1987. A structure
// with a null roof_date (what the group wrote before the fix) gives an unknown basis.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bindFixture,
  propertyRows,
  type Fixture,
  type FixtureTables,
  type ManifestJson,
  type Row,
} from "./helpers/fixture-export.js";

const BUILT = "baguqeeraprop1987";
const NULL_DATE = "baguqeeraprop0000";
const edge = (from: string, to: string): Row => ({ from_cid: from, to_cid: to });

const TABLES: FixtureTables = {
  county: {
    property: [propertyRows(BUILT, 1987), propertyRows(NULL_DATE, 1987)],
    property_has_structure: [edge(BUILT, "sb"), edge(NULL_DATE, "sn")],
    structure: [
      { cid: "sb", roof_date: "1987", request_identifier: "x" },
      { cid: "sn", roof_date: null, request_identifier: "x" },
    ],
  },
  property_improvement: {},
};

let fx: Fixture;
let asOfYear = 0;
beforeAll(async () => {
  fx = await bindFixture(TABLES, (m: ManifestJson) => {
    m.coverage = Object.fromEntries(
      Object.entries(m.coverage).filter(([k]) => !k.startsWith("owner_")),
    );
    asOfYear = Number(String((m as unknown as Record<string, unknown>).finishedAt).slice(0, 4));
  });
});
afterAll(() => fx.close());

describe("roof_date from the built year, no permits (ERR-68)", () => {
  it("1987 with no permit is built_year, low confidence, as_of year minus 1987", async () => {
    const [row] = await fx.rows(
      `SELECT roof_date, roof_age_basis, roof_age_confidence, roof_age_years
       FROM v_property WHERE property_cid = '${BUILT}'`,
    );
    expect(asOfYear).toBeGreaterThan(2000);
    expect(row).toMatchObject({
      roof_date: "1987",
      roof_age_basis: "built_year",
      roof_age_confidence: "low",
      roof_age_years: asOfYear - 1987,
    });
  });

  it("a null roof_date (the pre-fix County group) stays unknown with no age", async () => {
    const [row] = await fx.rows(
      `SELECT roof_age_basis, roof_age_years FROM v_property WHERE property_cid = '${NULL_DATE}'`,
    );
    expect(row).toMatchObject({ roof_age_basis: "unknown", roof_age_years: null });
  });
});
