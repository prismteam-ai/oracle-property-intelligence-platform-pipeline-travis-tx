import { describe, expect, it } from "vitest";
import { canonicalStreetType, streetAddressKey } from "../../src/domain/street-address.js";

describe("canonicalStreetType", () => {
  it.each([
    ["TERR", "TER"],
    ["BEND", "BND"],
    ["PS", "PASS"],
    ["TR", "TRL"],
    ["CRT", "CT"],
    ["DRIVE", "DR"],
    ["HY", "HWY"],
    ["view", "VW"],
  ])("maps the appraisal roll's %s to the address points' %s", (variant, canonical) => {
    expect(canonicalStreetType(variant)).toBe(canonical);
  });

  it("keeps types that are already canonical", () => {
    expect(canonicalStreetType("DR")).toBe("DR");
    expect(canonicalStreetType(" blvd ")).toBe("BLVD");
  });

  it("treats a missing type as empty", () => {
    expect(canonicalStreetType(undefined)).toBe("");
    expect(canonicalStreetType("  ")).toBe("");
  });
});

describe("streetAddressKey", () => {
  it.each([
    ["1234 W MAIN ST STE 100", "1234|W|MAIN|ST"],
    ["4108 Burnet Rd.", "4108||BURNET|RD"],
    ["2216 Barton Skwy #200", "2216||BARTON|SKWY"],
    ["500 East 7th Street", "500|E|7TH|ST"],
    ["9513 ORIOLE DR BLDG 2 UNIT 4", "9513||ORIOLE|DR"],
    ["12 OAK", "12||OAK|"],
  ])("keys %s like the appraisal roll's situs address", (address, key) => {
    expect(streetAddressKey(address)).toBe(key);
  });

  it("has no key without a house number", () => {
    expect(streetAddressKey("PO BOX 1234")).toBeUndefined();
    expect(streetAddressKey(undefined)).toBeUndefined();
  });
});
