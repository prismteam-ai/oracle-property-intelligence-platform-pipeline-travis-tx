// T027 (A-02, FR-002 owner_area_class): ownerArea() from the gazetteer's owner-area list.
import { describe, expect, it } from "vitest";
import { ownerArea } from "../gazetteer/travis-places@1.0.0/index.js";

describe("travis-places@1.0.0 ownerArea()", () => {
  it.each(["78753", "78701", "78660", "78753-1234"])("a Travis ZCTA %s is in_county", (zip) => {
    expect(ownerArea(zip)).toEqual({ class: "in_county", zcta: zip.slice(0, 5) });
  });

  it.each([
    ["78626", "Williamson"],
    ["78666", "Hays"],
    ["78602", "Bastrop"],
    ["78644", "Caldwell"],
    ["78611", "Burnet"],
    ["78636", "Blanco"],
  ])("a regional-county ZCTA %s (%s) is regional", (zip) => {
    expect(ownerArea(zip)).toEqual({ class: "regional", zcta: zip });
  });

  it.each(["10001", "90210", "77002"])("any other US ZCTA %s is out_of_area", (zip) => {
    expect(ownerArea(zip)).toEqual({ class: "out_of_area", zcta: zip });
  });

  it.each(["99999", "00000"])(
    "a 5-digit value that is not a ZCTA (%s) is unknown/zip_not_zcta",
    (zip) => {
      expect(ownerArea(zip)).toEqual({ class: "unknown", reason: "zip_not_zcta" });
    },
  );

  it.each([undefined, null, "", "   "])(
    "a missing mailing ZIP (%j) is unknown/no_mailing_address",
    (zip) => {
      expect(ownerArea(zip)).toEqual({ class: "unknown", reason: "no_mailing_address" });
    },
  );

  it("a malformed value is unknown/zip_not_zcta", () => {
    expect(ownerArea("ABCDE")).toEqual({ class: "unknown", reason: "zip_not_zcta" });
  });
});
