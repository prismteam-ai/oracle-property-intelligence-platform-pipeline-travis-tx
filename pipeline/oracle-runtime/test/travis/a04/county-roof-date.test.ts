// ERR-68: the County group must carry the roof-age ledger row into structure.roof_date.
// planCountyGroup once passed roofAge: null for every record, so every structure.json had a
// null roof_date and v_property.roof_age_years was null for ~98% of properties.
import { describe, expect, it } from "vitest";
import { a04Record } from "../../fixtures/a04/tcad/export.js";
import { mapParcel } from "../../../travis/tcad/fields.js";
import { redactRecord } from "../../../travis/tcad/redact.js";
import {
  planCountyGroup,
  roofAgeEntryOf,
  type GroupInput,
  type RoofAgeEstimateRow,
} from "../../../travis/tcad/write-group.js";

const CIDS = {
  seed: "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu",
  county: "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq",
  propertyImprovement: "bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu",
};

const MAP_CTX = {
  jobId: "travis-a04-20261022052658",
  asOf: "2026-10-22",
  exportSha256: "6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346",
  capturedAt: "2026-10-19T21:33:41.241Z",
};
const mapOne = (raw: Record<string, unknown>) =>
  mapParcel(redactRecord(raw), { ...MAP_CTX, ordinal: 0, recordSha256: "a".repeat(64) });

const est = (
  tcad_id: string,
  roof_age_basis: RoofAgeEstimateRow["roof_age_basis"],
  roof_age_years: number | null,
): RoofAgeEstimateRow => ({ tcad_id, roof_age_basis, roof_age_years, as_of_date: "2026-10-22" });

function input(pID: number, roofAge?: GroupInput["roofAge"]): GroupInput {
  const raw = a04Record({ pID, geoID: `${pID}`.padStart(10, "0") });
  const m = mapOne(raw);
  return {
    pID: m.parcel.request_identifier,
    geoId: m.parcel.geo_id,
    propType: m.parcel.prop_type,
    record: redactRecord(raw).record,
    yearBuilt: m.parcel.property_structure_built_year,
    exportPoint: null,
    ...(roofAge === undefined ? {} : { roofAge }),
  };
}

const roofDateOf = (files: Record<string, string>): unknown =>
  (JSON.parse(files["structure.json"] as string) as Record<string, unknown>).roof_date;

describe("roofAgeEntryOf: only a built_year estimate is a TCAD date", () => {
  it("built_year gives the built year as YYYY (as-of year minus the age)", () => {
    expect(roofAgeEntryOf(est("100", "built_year", 39))).toEqual({
      pID: "100",
      roof_date: "1987",
      anchor: "property_built_year",
    });
    // pg returns numeric as a string; it is read the same
    expect(
      roofAgeEntryOf({ ...est("100", "built_year", 39), roof_age_years: "39" }).roof_date,
    ).toBe("1987");
  });

  it.each([
    ["permit", 2],
    ["new_construction", 1],
    ["unknown", null],
  ] as const)("%s gives no TCAD date", (basis, years) => {
    expect(roofAgeEntryOf(est("100", basis, years))).toEqual({
      pID: "100",
      roof_date: null,
      anchor: null,
    });
  });
});

describe("planCountyGroup: structure.roof_date from the ledger (ERR-68)", () => {
  it("a built_year ledger row writes roof_date '1987'", () => {
    const plan = planCountyGroup(
      [input(9001, roofAgeEntryOf(est("9001", "built_year", 39)))],
      CIDS,
    );
    expect(roofDateOf(plan.groups[0]?.files ?? {})).toBe("1987");
  });

  it("a permit or unknown row writes roof_date null and no missing-ledger warning path", () => {
    const plan = planCountyGroup(
      [
        input(9002, roofAgeEntryOf(est("9002", "permit", 2))),
        input(9003, roofAgeEntryOf(est("9003", "unknown", null))),
      ],
      CIDS,
    );
    for (const g of plan.groups) expect(roofDateOf(g.files)).toBeNull();
    for (const g of plan.groups) expect(JSON.stringify(g.files)).not.toContain("2024-");
  });

  it("a missing ledger row writes roof_date null (the transform warns no_roof_age_ledger_row)", () => {
    const plan = planCountyGroup([input(9004), input(9005, null)], CIDS);
    for (const g of plan.groups) expect(roofDateOf(g.files)).toBeNull();
  });

  it("a ledger row for another property still throws", () => {
    const wrong = roofAgeEntryOf(est("1", "built_year", 39));
    expect(() => planCountyGroup([input(9006, wrong)], CIDS)).toThrow(/roof-age/);
  });
});
