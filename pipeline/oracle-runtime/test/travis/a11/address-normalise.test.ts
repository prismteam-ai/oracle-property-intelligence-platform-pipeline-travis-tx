// A-11 Run 3 (ADR 0004): both sides of the address-point join reduce to the same key.
import { describe, expect, it } from "vitest";
import {
  canonicalNumber,
  canonicalStreet,
  layerKey,
  situsKey,
  zip5Of,
} from "../../../travis/gis/address-normalise.js";

describe("canonicalNumber", () => {
  it.each([
    ["1405", "1405", null],
    ["  0042 ", "42", null],
    ["12A", "12", "A"],
    ["7 1/2", "7", "1/2"],
  ])("%s", (raw, number, qualifier) => {
    expect(canonicalNumber(raw)).toEqual({ number, qualifier });
  });

  it.each([[""], ["ONE"], [`${String.fromCharCode(35)}4`]])("%j has no number", (raw) => {
    expect(canonicalNumber(raw)).toBeNull();
  });
});

describe("canonicalStreet: case, suffix abbreviations, directionals, unit designators", () => {
  it("upper-cases and removes punctuation", () => {
    expect(canonicalStreet("o'brien ln.").street).toBe("OBRIEN LN");
  });

  it.each([
    ["Bridgeway Drive", "BRIDGEWAY DR"],
    ["BRIDGEWAY DR", "BRIDGEWAY DR"],
    ["Davis Street", "DAVIS ST"],
    ["Kind Way", "KIND WAY"],
    ["Parmer Boulevard", "PARMER BLVD"],
    ["Lamar Blvd", "LAMAR BLVD"],
    ["Cypress Creek Trail", "CYPRESS CREEK TRL"],
    ["Ridge Oak Circle", "RIDGE OAK CIR"],
    ["Ridge Oak CI", "RIDGE OAK CIR"],
  ])("suffix %s -> %s", (raw, expected) => {
    expect(canonicalStreet(raw).street).toBe(expected);
  });

  it("maps only the street type, never a word in the middle of the name", () => {
    expect(canonicalStreet("St Johns Avenue").street).toBe("ST JOHNS AVE");
    expect(canonicalStreet("Saint Johns Ave").street).toBe("SAINT JOHNS AVE");
  });

  it.each([
    ["North Lamar Boulevard", "N LAMAR BLVD"],
    ["N Lamar Blvd", "N LAMAR BLVD"],
    ["Congress Avenue North", "CONGRESS AVE N"],
    ["Congress Ave N", "CONGRESS AVE N"],
    ["West Lake Drive", "W LAKE DR"],
  ])("directional %s -> %s", (raw, expected) => {
    expect(canonicalStreet(raw).street).toBe(expected);
  });

  it.each([
    ["BRIDGEWAY DR APT 2", "BRIDGEWAY DR", "2"],
    ["Bridgeway Dr Unit 12B", "BRIDGEWAY DR", "12B"],
    ["DAVIS ST STE 3104", "DAVIS ST", "3104"],
    ["KIND WAY BLDG A", "KIND WAY", "A"],
    ["KIND WAY # 270", "KIND WAY", "270"],
    [`KIND WAY ${String.fromCharCode(35)}270`, "KIND WAY", "270"],
  ])("unit designator %s is cut off the street", (raw, street, unit) => {
    expect(canonicalStreet(raw)).toEqual({ street, unit });
  });
});

describe("zip5Of", () => {
  it.each([
    ["78613", "78613"],
    ["78613-1234", "78613"],
    [" 78613 ", "78613"],
    ["7861", null],
    [null, null],
    ["", null],
  ])("%j", (raw, expected) => {
    expect(zip5Of(raw)).toBe(expected);
  });
});

describe("situsKey", () => {
  it("builds number|street and ignores the unit and the ZIP in the key", () => {
    const a = situsKey({
      street_number: "2725",
      street_prefix: null,
      street_name: "WOODALL",
      street_suffix: "DR",
      street_secondary: "1401",
      zip: "78613",
    });
    const b = situsKey({
      street_number: "2725",
      street_name: "Woodall",
      street_suffix: "Drive",
      street_secondary: "1402",
      zip: "78626",
    });
    expect(a?.key).toBe("2725|WOODALL DR");
    expect(b?.key).toBe(a?.key);
    expect(a?.unit).toBe("1401");
    expect(a?.zip5).toBe("78613");
  });

  it("takes the prefix directional from street_prefix", () => {
    expect(
      situsKey({
        street_number: "100",
        street_prefix: "E",
        street_name: "6TH",
        street_suffix: "ST",
      })?.key,
    ).toBe("100|E 6TH ST");
  });

  it.each([
    [null],
    [undefined],
    [{ street_number: null, street_name: "MAIN", street_suffix: "ST" }],
    [{ street_number: "", street_name: "MAIN", street_suffix: "ST" }],
    [{ street_number: "12", street_name: null, street_suffix: null }],
    [{ street_number: "12", street_name: "", street_suffix: "ST" }],
  ])("no key for %j", (s) => {
    expect(situsKey(s)).toBeNull();
  });
});

describe("layerKey equals situsKey for the same address", () => {
  it("City of Austin FULL_STREET_NAME reduces to the situs key", () => {
    const layer = layerKey({ address: 1405, full_street_name: "1405 BRIDGEWAY DR" });
    const situs = situsKey({
      street_number: "1405",
      street_name: "BRIDGEWAY",
      street_suffix: "DR",
      street_secondary: "2",
    });
    expect(layer?.key).toBe("1405|BRIDGEWAY DR");
    expect(layer?.key).toBe(situs?.key);
  });

  it("handles a directional prefix and a long suffix word", () => {
    expect(layerKey({ address: 610, full_street_name: "610 W DAVIS STREET" })?.key).toBe(
      "610|W DAVIS ST",
    );
  });

  it("carries the fraction and the letter suffix as a qualifier, not in the key", () => {
    const k = layerKey({
      address: 123,
      full_street_name: "123 MAIN ST",
      address_fraction: "1/2",
      address_suffix: " ",
    });
    expect(k?.key).toBe("123 1/2|MAIN ST");
    expect(k?.qualifier).toBe("1/2");
  });

  it("a fraction printed in the TCAD prefix field joins the layer's '<n> 1/2' record, not the base number", () => {
    const frac = situsKey({
      street_number: "9605",
      street_prefix: "1/2",
      street_name: "WILDHORSE RANCH",
      street_suffix: "TRL",
    });
    const base = situsKey({
      street_number: "9605",
      street_name: "WILDHORSE RANCH",
      street_suffix: "TRL",
    });
    const layerFrac = layerKey({
      address: 9605,
      full_street_name: "9605 1/2 WILDHORSE RANCH TRL",
      address_fraction: "1/2",
    });
    const layerBase = layerKey({ address: 9605, full_street_name: "9605 WILDHORSE RANCH TRL" });
    expect(frac?.key).toBe(layerFrac?.key);
    expect(base?.key).toBe(layerBase?.key);
    expect(frac?.key).not.toBe(base?.key);
  });

  it("no key for a record without a number or a street", () => {
    expect(layerKey({ address: null, full_street_name: "MAIN ST" })).toBeNull();
    expect(layerKey({ address: 0, full_street_name: "0 MAIN ST" })).toBeNull();
    expect(layerKey({ address: 5, full_street_name: null })).toBeNull();
  });
});
