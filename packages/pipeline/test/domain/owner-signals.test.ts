import { describe, expect, it } from "vitest";
import { OwnerLocality, ownerLocality, ownershipYears } from "../../src/domain/owner-signals.js";

describe("ownerLocality", () => {
  it.each([
    [{ state: "TX", zip: "78704", country: undefined }, OwnerLocality.Local],
    [{ state: "TX", zip: "78664", country: "US" }, OwnerLocality.Local],
    [{ state: "TX", zip: "77002", country: undefined }, OwnerLocality.Regional],
    [{ state: "CA", zip: "94105", country: "USA" }, OwnerLocality.OutOfState],
    [{ state: "ON", zip: undefined, country: "CA" }, OwnerLocality.Foreign],
    [{ state: undefined, zip: undefined, country: undefined }, OwnerLocality.Unknown],
  ])("classifies a mailing address %o as %s", (mailing, locality) => {
    expect(ownerLocality(mailing)).toBe(locality);
  });

  it("does not call a Texas owner local without a ZIP code", () => {
    expect(ownerLocality({ state: "TX", zip: undefined, country: undefined })).toBe(
      OwnerLocality.Regional,
    );
  });
});

describe("ownershipYears", () => {
  it("counts whole years since the deed", () => {
    expect(ownershipYears("2013-12-31", "2026-10-27")).toBe(12);
    expect(ownershipYears("2016-10-27", "2026-10-27")).toBe(10);
  });

  it("has no answer for a missing or impossible deed date", () => {
    expect(ownershipYears(undefined, "2026-10-27")).toBeUndefined();
    expect(ownershipYears("0021-04-22", "2026-10-27")).toBeUndefined();
    expect(ownershipYears("2027-01-01", "2026-10-27")).toBeUndefined();
  });
});
