// T027 Census probe tests. Synthetic responses only (test-only): an injected fetch answers
// every request, so www2.census.gov is never called. Place names below are invented.
import { describe, expect, it } from "vitest";
import { createSourceClient, type FetchLike } from "../../travis/lib/source-client.js";
import { CensusReferenceSchema } from "../../travis/discovery/catalog.schema.js";
import {
  CENSUS_DATASET,
  CENSUS_PLACE_BY_COUNTY_URL,
  CENSUS_VINTAGE,
  TRAVIS_COUNTYFP,
  TRAVIS_STATEFP,
  parsePlaceByCounty,
  placeShortName,
  probeCensusPlaces,
} from "../../travis/discovery/probes/census.js";
import { fakeHttp, silent, text } from "../fixtures/fake-http.js";
import { must } from "../helpers.js";

const FIXED = new Date("2026-01-01T00:00:00.000Z");

function client(fetch: FetchLike) {
  return createSourceClient({
    fetch,
    sleep: async () => undefined,
    random: () => 0,
    now: () => FIXED,
    log: silent,
  });
}

const HEADER = "STATE|STATEFP|COUNTYFP|COUNTYNAME|PLACEFP|PLACENS|PLACENAME|TYPE|CLASSFP|FUNCSTAT";
const ROWS_NO_LAND = [
  HEADER,
  "TX|48|453|Travis County|00001|00000001|Alpha city|INCORPORATED PLACE|C1|A",
  "TX|48|453|Travis County|00002|00000002|Beta village|INCORPORATED PLACE|C1|A",
  "TX|48|453|Travis County|00003|00000003|Gamma CDP|CENSUS DESIGNATED PLACE|U1|S",
  "TX|48|453|Travis County|00004|00000004|Delta town|INCORPORATED PLACE|C7|A",
  "TX|48|001|Other County|00005|00000005|Epsilon city|INCORPORATED PLACE|C1|A",
  "TX|48|453|Travis County|00006|00000006|The Zeta Hills village|INCORPORATED PLACE|C1|A",
].join("\n");

const HEADER_LAND = `${HEADER}|ALAND`;
const ROWS_LAND = [
  HEADER_LAND,
  "TX|48|453|Travis County|00001|00000001|Alpha city|INCORPORATED PLACE|C1|A|1000",
  "TX|48|453|Travis County|00002|00000002|Beta village|INCORPORATED PLACE|C1|A|0",
  "TX|48|453|Travis County|00003|00000003|Gamma CDP|CENSUS DESIGNATED PLACE|U1|S|500",
  "TX|48|453|Travis County|00004|00000004|Delta town|INCORPORATED PLACE|C7|A|20",
  "TX|48|001|Other County|00005|00000005|Epsilon city|INCORPORATED PLACE|C1|A|900",
].join("\n");

describe("constants", () => {
  it("points at the official Census place-by-county file for Texas and records its vintage", () => {
    const u = new URL(CENSUS_PLACE_BY_COUNTY_URL);
    expect(u.protocol).toBe("https:");
    expect(u.host).toBe("www2.census.gov");
    expect(u.pathname).toMatch(/place_by_county2020\.txt$/);
    expect(CENSUS_VINTAGE).toBe("2020");
    expect(CENSUS_DATASET.length).toBeGreaterThan(0);
    expect(TRAVIS_STATEFP).toBe("48");
    expect(TRAVIS_COUNTYFP).toBe("453");
  });
});

describe("placeShortName", () => {
  it("drops the legal description suffix only", () => {
    expect(placeShortName("Austin city")).toBe("Austin");
    expect(placeShortName("The Hills village")).toBe("The Hills");
    expect(placeShortName("Point Venture village")).toBe("Point Venture");
    expect(placeShortName("Some town")).toBe("Some");
    expect(placeShortName("Cityview")).toBe("Cityview");
  });
});

describe("parsePlaceByCounty", () => {
  it("keeps only incorporated places (class C*) in county 48453 when no land column exists", () => {
    const parsed = parsePlaceByCounty(ROWS_NO_LAND, { statefp: "48", countyfp: "453" });
    expect(parsed.land_area_column).toBeNull();
    expect(parsed.places.map((p) => p.placefp)).toEqual(["00001", "00002", "00004", "00006"]);
    expect(parsed.places[0]).toEqual({
      placefp: "00001",
      census_name: "Alpha city",
      name: "Alpha",
      classfp: "C1",
      land_area_sqm: null,
    });
  });

  it("drops water-only parts (land area 0) when the file carries a land column", () => {
    const parsed = parsePlaceByCounty(ROWS_LAND, { statefp: "48", countyfp: "453" });
    expect(parsed.land_area_column).toBe("ALAND");
    expect(parsed.places.map((p) => p.placefp)).toEqual(["00001", "00004"]);
    expect(parsed.places.every((p) => (p.land_area_sqm ?? 0) > 0)).toBe(true);
  });

  it("rejects a body without the expected header", () => {
    expect(() =>
      parsePlaceByCounty("<html>oops</html>", { statefp: "48", countyfp: "453" }),
    ).toThrow();
  });
});

describe("probeCensusPlaces", () => {
  it("records dataset, vintage, source_url, captured_at and place_count", async () => {
    const { fetch, calls } = fakeHttp([
      { match: () => true, respond: () => text(ROWS_LAND, 200, { "content-type": "text/plain" }) },
    ]);
    const r = await probeCensusPlaces({ client: client(fetch), now: () => FIXED });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(CENSUS_PLACE_BY_COUNTY_URL);
    expect(r.status).toBe("available");
    const ref = must(r.census_reference);
    expect(CensusReferenceSchema.safeParse(ref).success).toBe(true);
    expect(ref).toMatchObject({
      dataset: CENSUS_DATASET,
      vintage: CENSUS_VINTAGE,
      source_url: CENSUS_PLACE_BY_COUNTY_URL,
      captured_at: "2026-01-01T00:00:00.000Z",
      place_count: 2,
    });
    expect(r.places.map((p) => p.name)).toEqual(["Alpha", "Delta"]);
  });

  it("without a land column it keeps every C* place and says so in the reference notes", async () => {
    const { fetch } = fakeHttp([
      {
        match: () => true,
        respond: () => text(ROWS_NO_LAND, 200, { "content-type": "text/plain" }),
      },
    ]);
    const r = await probeCensusPlaces({ client: client(fetch), now: () => FIXED });
    const ref = must(r.census_reference);
    expect(ref.place_count).toBe(4);
    expect(must(ref.notes)).toMatch(/land/i);
  });

  it("a custom URL is honoured", async () => {
    const { fetch, calls } = fakeHttp([{ match: () => true, respond: () => text(ROWS_LAND) }]);
    await probeCensusPlaces(
      { client: client(fetch), now: () => FIXED },
      { url: "https://census.test/f.txt" },
    );
    expect(calls[0]?.url).toBe("https://census.test/f.txt");
  });

  it("HTTP 403 is blocked after one request: no reference, no places, a reason", async () => {
    const { fetch, calls } = fakeHttp([
      { match: () => true, respond: () => text("Forbidden", 403) },
    ]);
    const r = await probeCensusPlaces({ client: client(fetch), now: () => FIXED });
    expect(calls).toHaveLength(1);
    expect(r.status).toBe("blocked");
    expect(r.census_reference).toBeNull();
    expect(r.places).toEqual([]);
    expect(must(r.blocked_receipt).status).toBe(403);
    expect(must(r.missing_reason)).toMatch(/403/);
  });

  it("a 200 page that is not the file (challenge or HTML) is blocked, never zero places", async () => {
    const { fetch } = fakeHttp([
      { match: () => true, respond: () => text("<html>Just a moment...</html>") },
    ]);
    const r = await probeCensusPlaces({ client: client(fetch), now: () => FIXED });
    expect(r.status).toBe("blocked");
    expect(r.census_reference).toBeNull();
  });
});
