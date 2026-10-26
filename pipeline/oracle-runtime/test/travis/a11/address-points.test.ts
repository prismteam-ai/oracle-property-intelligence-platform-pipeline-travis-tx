// A-11 Run 3 (ADR 0004): exact, unique matching of a situs to the City of Austin address layer.
import { describe, expect, it } from "vitest";
import {
  ADDRESS_LAYER_URL,
  TRAVIS_BBOX,
  buildAddressPointSet,
  distanceDistribution,
  insideTravis,
  percentile,
  recordUrl,
  type AddressPointRecord,
} from "../../../travis/gis/address-points.js";

const PROV = {
  layerUrl: ADDRESS_LAYER_URL,
  retrievedAt: "2026-10-25T00:49:51Z",
  sha256: "a".repeat(64),
};

let oid = 0;
const rec = (
  address: number,
  full: string,
  lat = 30.27,
  lon = -97.74,
  extra: Partial<AddressPointRecord> = {},
): AddressPointRecord => ({
  object_id: (oid += 1),
  place_id: 1000 + oid,
  address,
  full_street_name: full,
  address_fraction: null,
  address_suffix: null,
  address_type: 1,
  lat,
  lon,
  ...extra,
});

const situs = (n: string, name: string, suffix: string, secondary: string | null = null) => ({
  street_number: n,
  street_prefix: null,
  street_name: name,
  street_suffix: suffix,
  street_secondary: secondary,
  zip: "78701",
});

describe("buildAddressPointSet.match", () => {
  const set = buildAddressPointSet(
    [
      rec(1405, "1405 BRIDGEWAY DR", 30.3, -97.7),
      // ambiguous: two distinct points on the same number and street (two cities)
      rec(100, "100 MAIN ST", 30.1, -97.8),
      rec(100, "100 MAIN ST", 30.5, -97.5),
      // the same point listed twice is ONE point
      rec(200, "200 OAK LN", 30.2, -97.6),
      rec(200, "200 OAK LN", 30.2, -97.6),
      // outside the Travis County box (a foreign point)
      rec(300, "300 ELM ST", 29.0, -95.0),
      // not an Address record (hydrant): never indexed
      rec(400, "400 PINE CT", 30.2, -97.6, { address_type: 4 }),
      // a unit-less layer: building point for a condo
      rec(610, "610 DAVIS STREET", 30.26, -97.75),
    ],
    PROV,
  );

  it("unique: one point, with the record URL as provenance and the unit reported as ignored", () => {
    const m = set.match(situs("1405", "BRIDGEWAY", "DR", "2"));
    expect(m.status).toBe("unique");
    if (m.status !== "unique") return;
    expect(m.point).toMatchObject({ lat: 30.3, lon: -97.7 });
    expect(m.point.url).toBe(recordUrl(m.point.object_id));
    expect(m.point.url.startsWith(ADDRESS_LAYER_URL)).toBe(true);
    expect(m.unit_ignored).toBe("2");
  });

  it("a unit designator printed inside the street name is cut off and still matches", () => {
    const m = set.match(situs("1405", "BRIDGEWAY", "DR APT 2"));
    expect(m.status).toBe("unique");
    if (m.status === "unique") expect(m.unit_ignored).toBe("2");
  });

  it("suffix spelling and case do not matter", () => {
    expect(set.match(situs("610", "davis", "St")).status).toBe("unique");
    expect(set.match(situs("610", "DAVIS", "STREET")).status).toBe("unique");
  });

  it("ambiguous: two distinct points on the same key stay unmatched", () => {
    expect(set.match(situs("100", "MAIN", "ST"))).toEqual({ status: "ambiguous", candidates: 2 });
  });

  it("the same point twice is still unique", () => {
    expect(set.match(situs("200", "OAK", "LN")).status).toBe("unique");
  });

  it("outside the Travis County box: no point, with its own status", () => {
    const m = set.match(situs("300", "ELM", "ST"));
    expect(m.status).toBe("outside_county");
  });

  it("no match: a number that is not in the layer, and a non-Address record", () => {
    expect(set.match(situs("999", "BRIDGEWAY", "DR"))).toEqual({ status: "no_match" });
    expect(set.match(situs("400", "PINE", "CT"))).toEqual({ status: "no_match" });
  });

  it("no address: a situs without a number or without a street", () => {
    expect(set.match(null)).toEqual({ status: "no_address" });
    expect(set.match({ street_number: null, street_name: "MAIN", street_suffix: "ST" })).toEqual({
      status: "no_address",
    });
    expect(set.match({ street_number: "12", street_name: null, street_suffix: null })).toEqual({
      status: "no_address",
    });
  });

  it("never picks a nearest or a similar address", () => {
    expect(set.match(situs("1406", "BRIDGEWAY", "DR")).status).toBe("no_match");
    expect(set.match(situs("1405", "BRIDGEWAY", "CT")).status).toBe("no_match");
  });
});

describe("county box", () => {
  it("inside and outside", () => {
    expect(insideTravis(30.27, -97.74)).toBe(true);
    expect(insideTravis(TRAVIS_BBOX.minLat - 0.01, -97.74)).toBe(false);
    expect(insideTravis(30.27, TRAVIS_BBOX.maxLon + 0.01)).toBe(false);
    expect(insideTravis(0, 0)).toBe(false);
  });
});

describe("distance distribution", () => {
  it("percentiles by nearest rank", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });

  it("metres between pairs", () => {
    const d = distanceDistribution([
      { a: { lat: 30.0, lon: -97.0 }, b: { lat: 30.0, lon: -97.0 } },
      { a: { lat: 30.0, lon: -97.0 }, b: { lat: 30.001, lon: -97.0 } },
    ]);
    expect(d.n).toBe(2);
    expect(d.median).toBe(0);
    expect(d.max).toBeGreaterThan(100);
    expect(d.max).toBeLessThan(120);
    expect(distanceDistribution([]).median).toBeNull();
  });
});
