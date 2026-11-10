import { describe, expect, it } from "vitest";
import { companyKey, phoneKey } from "../../src/domain/company-name.js";

describe("companyKey", () => {
  it.each([
    ["RELIABLE ROOFING OF TEXAS INC", "reliable roofing"],
    ["Reliable Roofing, Inc.", "reliable roofing"],
    ["Beldon Roofing Company", "beldon roofing"],
    ["Empire Roofing Companies LLC **MAIN**", "empire roofing"],
    ["Rhino Roofing and General Contracting LLC", "rhino roofing general contracting"],
    ["Rhino Roofing & General Contracting, L.L.C.", "rhino roofing general contracting"],
    ["The Home Depot USA Inc", "home depot usa"],
  ])("normalizes %s to %s", (name, key) => {
    expect(companyKey(name)).toBe(key);
  });

  it("has no key for an empty name", () => {
    expect(companyKey("  ")).toBeUndefined();
    expect(companyKey(undefined)).toBeUndefined();
  });
});

describe("phoneKey", () => {
  it("keeps the last ten digits", () => {
    expect(phoneKey("(512) 555-0142")).toBe("5125550142");
    expect(phoneKey("+1 512.555.0142")).toBe("5125550142");
  });

  it.each(["512-550-0000", "(512) 555-5555", "000-000-0000", "123-456-7890", "999.999.9999"])(
    "has no key for the placeholder number %s, which would link unrelated businesses",
    (placeholder) => {
      expect(phoneKey(placeholder)).toBeUndefined();
    },
  );

  it("has no key for too short a number", () => {
    expect(phoneKey("555-0142")).toBeUndefined();
    expect(phoneKey(undefined)).toBeUndefined();
  });
});
