// T026 (A-02, FR-006 / AC-6): Travis place gazetteer lookup.
import { describe, expect, it } from "vitest";
import { GAZETTEER, lookup } from "../gazetteer/travis-places@1.0.0/index.js";

const SHA256 = /^[0-9a-f]{64}$/;

function expectFoundWithSource(query: string) {
  const r = lookup(query);
  if (r.status !== "found") throw new Error(`${query} → ${JSON.stringify(r)}`);
  expect(r.source.url).toMatch(/^https:\/\/www2\.census\.gov\//);
  expect(r.source.file_date).toMatch(/^\d{4}-\d{2}-\d{2}/);
  expect(r.source.sha256).toMatch(SHA256);
  expect(r.gazetteer).toEqual({ version: "travis-places@1.0.0", sha256: GAZETTEER.sha256 });
  expect(Number.isFinite(r.point.lat)).toBe(true);
  expect(Number.isFinite(r.point.lon)).toBe(true);
  return r;
}

describe("travis-places@1.0.0 lookup()", () => {
  it("exposes its version and a sha256 digest", () => {
    expect(GAZETTEER.version).toBe("travis-places@1.0.0");
    expect(GAZETTEER.sha256).toMatch(SHA256);
  });

  it("returns Pflugerville city with the Census internal point and source stamp", () => {
    const r = expectFoundWithSource("Pflugerville");
    expect(r).toMatchObject({
      status: "found",
      kind: "place",
      geoid: "4857176",
      point: { lat: 30.447765, lon: -97.602116 },
    });
    expect(r.source.url).toContain("2024_Gaz_place_national.zip");
  });

  it.each(["Manor", "Lakeway"])("finds the Travis place %s", (q) => {
    const r = expectFoundWithSource(q);
    expect(r.kind).toBe("place");
  });

  it("treats a 5-digit query (and 'ZIP nnnnn') as a ZCTA", () => {
    const r = expectFoundWithSource("78753");
    expect(r).toMatchObject({ status: "found", kind: "zcta", zcta: "78753" });
    expect(r.source.url).toContain("2024_Gaz_zcta_national.zip");
    expect(lookup("ZIP 78753")).toEqual(r);
    expect(lookup(" zip 78753 ")).toEqual(r);
  });

  it.each(["Pflugerville city", "PFLUGERVILLE", "pflugerville", "  Pflugerville  City "])(
    "accepts an optional LSAD suffix and any case: %s",
    (q) => {
      expect(lookup(q)).toEqual(lookup("Pflugerville"));
    },
  );

  it.each(["99999", "Georgetown", "ZIP 10001", "Nowhereville", ""])(
    "returns out_of_scope with no point for %j",
    (q) => {
      const r = lookup(q);
      expect(r).toEqual({ status: "out_of_scope", query: q });
      expect(r).not.toHaveProperty("point");
    },
  );

  it.each(["Round Rock", "Cedar Park", "Leander"])(
    "keeps the county-line place %s with partial_in_travis and its counties",
    (q) => {
      const r = expectFoundWithSource(q);
      expect(r.partial_in_travis).toBe(true);
      expect(r.counties).toContain("48453");
      expect(r.counties.length).toBeGreaterThan(1);
    },
  );

  it("marks a wholly-Travis place as not partial", () => {
    const r = expectFoundWithSource("Manor");
    expect(r.partial_in_travis).toBe(false);
    expect(r.counties).toEqual(["48453"]);
  });
});
