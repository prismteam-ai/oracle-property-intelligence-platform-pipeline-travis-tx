// A-11 Run 3 (ADR 0004): the UI wording for coordinate_source covers the contract's closed list
// exactly, and names the City of Austin address layer for address_point.
import { describe, expect, it } from "vitest";
import { COLUMN_ENUMS } from "@countylens/contract";
import {
  ADDRESS_POINT_PROVENANCE_TEXT,
  COORDINATE_SOURCE_LABELS,
  sourceLabel,
} from "../src/index.js";

describe("coordinate_source labels (ADR 0004)", () => {
  it("has one label per contract value and nothing else", () => {
    expect(Object.keys(COORDINATE_SOURCE_LABELS).sort()).toEqual(
      [...COLUMN_ENUMS.coordinate_source].sort(),
    );
    expect(Object.isFrozen(COORDINATE_SOURCE_LABELS)).toBe(true);
  });

  it("address_point reads 'address point (City of Austin)'", () => {
    expect(COORDINATE_SOURCE_LABELS.address_point).toBe("address point (City of Austin)");
  });

  it("the provenance text says exact match, unit ignored, one point", () => {
    expect(ADDRESS_POINT_PROVENANCE_TEXT).toMatch(/City of Austin/);
    expect(ADDRESS_POINT_PROVENANCE_TEXT).toMatch(/exact match/);
    expect(ADDRESS_POINT_PROVENANCE_TEXT).toMatch(/unit ignored/);
  });

  it("the manifest source of an address point has a display name", () => {
    expect(sourceLabel("austin-address-points")).toMatch(/address points/);
  });
});
