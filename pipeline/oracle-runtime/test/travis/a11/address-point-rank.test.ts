// A-11 Run 3 (ADR 0004): rank 4 of the coordinate assembly and the County group geometry.
// SYNTHETIC TEST INPUT only: made-up pIDs, geoIDs, addresses and points.
import { describe, expect, it } from "vitest";
import {
  assembleCoordinates,
  type AssemblyInput,
  type FeatureIn,
  type ParcelIn,
  type PermitIn,
} from "../../../travis/gis/assemble-coordinates.js";
import {
  ADDRESS_LAYER_URL,
  buildAddressPointSet,
  recordUrl,
  type AddressPointRecord,
} from "../../../travis/gis/address-points.js";
import { planCountyGroup, type GroupInput } from "../../../travis/tcad/write-group.js";
import { a04Record } from "../../fixtures/a04/tcad/export.js";
import { mapParcel } from "../../../travis/tcad/fields.js";
import { redactRecord } from "../../../travis/tcad/redact.js";
import { must } from "../../helpers.js";

const TCAD = "https://traviscad.org/synthetic-export.zip";
const PAGE = "https://gis.traviscountytx.gov/server1/rest/services/x/MapServer/6/query?f=json";
const SHA = (c: string): string => c.repeat(64);
const LAYER_SHA = SHA("d");
const RETRIEVED = "2026-10-25T00:49:51.937Z";

let oid = 0;
const rec = (
  address: number,
  full: string,
  lat: number,
  lon: number,
  type = 1,
): AddressPointRecord => ({
  object_id: (oid += 1),
  place_id: null,
  address,
  full_street_name: full,
  address_fraction: null,
  address_suffix: null,
  address_type: type,
  lat,
  lon,
});

const LAYER = [
  rec(1405, "1405 BRIDGEWAY DR", 30.31, -97.71),
  rec(610, "610 DAVIS ST", 30.2, -97.6),
  rec(100, "100 MAIN ST", 30.1, -97.8),
  rec(100, "100 MAIN ST", 30.5, -97.5),
  rec(300, "300 ELM ST", 29.0, -95.0),
  rec(2725, "2725 WOODALL DR", 30.4, -97.9),
];
const set = buildAddressPointSet(LAYER, {
  layerUrl: ADDRESS_LAYER_URL,
  retrievedAt: RETRIEVED,
  sha256: LAYER_SHA,
});
const oidOf = (full: string): number =>
  must(LAYER.find((r) => r.full_street_name === full)).object_id;

const parcel = (
  rid: string,
  number: string,
  name: string,
  suffix: string,
  unit: string | null,
  over: Partial<ParcelIn> = {},
): ParcelIn => ({
  request_identifier: rid,
  geo_id: `G${rid}`,
  prop_type: "R",
  export_point_lat: null,
  export_point_lon: null,
  export_point_kind: "placeholder",
  source_url: TCAD,
  captured_at: "2026-10-19T21:33:41Z",
  export_sha256: SHA("e"),
  situs: {
    street_number: number,
    street_prefix: null,
    street_name: name,
    street_suffix: suffix,
    street_secondary: unit,
    zip: "78701",
  },
  ...over,
});
const feature = (id: number, over: Partial<FeatureIn> = {}): FeatureIn => ({
  object_id: id,
  pid_value: null,
  geoid_value: null,
  area: 1e-6,
  point_lat: 30.25,
  point_lon: -97.75,
  point_method: "centroid",
  null_geometry: false,
  page_url: PAGE,
  page_captured_at: "2026-10-22T03:00:00Z",
  page_sha256: SHA("a"),
  ...over,
});
const permit = (rid: string): PermitIn => ({
  permit_number: `P-${rid}`,
  issuing_jurisdiction: "austin",
  request_identifier: rid,
  latitude: 30.9,
  longitude: -97.9,
  issue_date: "2020-01-01",
  source_url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
  captured_at: "2026-10-22T04:00:00Z",
  payload_sha256: SHA("p"),
});
const run = (over: Partial<AssemblyInput>): ReturnType<typeof assembleCoordinates> =>
  assembleCoordinates({
    jobId: "travis-a04-coords-202610250500",
    parcels: [],
    features: [],
    permits: [],
    addressPoints: set,
    ...over,
  });
const rowOf = (out: ReturnType<typeof assembleCoordinates>, rid: string) =>
  must(
    out.rows.find((r) => r.request_identifier === rid),
    `row ${rid}`,
  );

describe("assembleCoordinates rank 4: address_point", () => {
  it("a condo unit with no GIS feature takes the building's address point, with layer provenance", () => {
    const out = run({ parcels: [parcel("1", "1405", "BRIDGEWAY", "DR", "2")] });
    expect(rowOf(out, "1")).toMatchObject({
      latitude: 30.31,
      longitude: -97.71,
      coordinate_source: "address_point",
      coordinate_rule: "address_point",
      coordinate_reason: null,
      coordinate_source_url: recordUrl(oidOf("1405 BRIDGEWAY DR")),
      coordinate_captured_at: RETRIEVED,
      coordinate_sha256: LAYER_SHA,
    });
    expect(out.stats.by_source.address_point).toBe(1);
    expect(out.stats.by_rule.address_point).toBe(1);
    expect(out.stats.address_point).toMatchObject({ matched: 1, unit_ignored: 1 });
  });

  it("never overrides a GIS centroid (lowest priority)", () => {
    const out = run({
      parcels: [parcel("2", "1405", "BRIDGEWAY", "DR", null)],
      features: [feature(1, { pid_value: "2", point_lat: 30.26, point_lon: -97.74 })],
    });
    expect(rowOf(out, "2")).toMatchObject({
      latitude: 30.26,
      coordinate_source: "gis_centroid",
      coordinate_rule: "centroid",
    });
    expect(out.stats.address_point.matched).toBe(0);
  });

  it("never overrides a real export point", () => {
    const out = run({
      parcels: [
        parcel("3", "1405", "BRIDGEWAY", "DR", null, {
          export_point_kind: "real",
          export_point_lat: 30.33,
          export_point_lon: -97.77,
        }),
      ],
    });
    expect(rowOf(out, "3")).toMatchObject({ latitude: 30.33, coordinate_rule: "export_point" });
  });

  it("never overrides a condo building point", () => {
    const out = run({
      parcels: [
        parcel("4", "1405", "BRIDGEWAY", "DR", "1", { geo_id: "SHARED" }),
        parcel("5", "1405", "BRIDGEWAY", "DR", "2", { geo_id: "SHARED" }),
      ],
      features: [feature(9, { pid_value: "5", point_lat: 30.28, point_lon: -97.72 })],
    });
    expect(rowOf(out, "4")).toMatchObject({
      latitude: 30.28,
      coordinate_rule: "condo_building_point",
    });
  });

  it("beats a permit point: an address point is public, a permit point never is", () => {
    const out = run({
      parcels: [parcel("6", "610", "DAVIS", "ST", "3104")],
      permits: [permit("6")],
    });
    expect(rowOf(out, "6")).toMatchObject({
      latitude: 30.2,
      coordinate_source: "address_point",
      coordinate_rule: "address_point",
    });
  });

  it("ambiguous (two distinct points): unmatched with its own reason, never a neighbour's", () => {
    const out = run({ parcels: [parcel("7", "100", "MAIN", "ST", null)] });
    expect(rowOf(out, "7")).toMatchObject({
      latitude: null,
      coordinate_source: "none",
      coordinate_rule: null,
      coordinate_reason: "address_point_ambiguous",
    });
    expect(out.stats.address_point.ambiguous).toBe(1);
    expect(out.stats.gap_by_reason.address_point_ambiguous).toBe(1);
  });

  it("outside the Travis County box: unmatched with its own reason", () => {
    const out = run({ parcels: [parcel("8", "300", "ELM", "ST", null)] });
    expect(rowOf(out, "8")).toMatchObject({
      latitude: null,
      coordinate_source: "none",
      coordinate_reason: "address_point_outside_county",
    });
    expect(out.stats.address_point.outside_county).toBe(1);
  });

  it("no match keeps the usual reason (no_gis_feature, or no_permit_point with permits that have none)", () => {
    const out = run({
      parcels: [
        parcel("9", "999", "NOWHERE", "RD", null),
        parcel("10", "998", "NOWHERE", "RD", null),
      ],
      permits: [{ ...permit("10"), latitude: null, longitude: null }],
    });
    expect(rowOf(out, "9")).toMatchObject({
      coordinate_source: "none",
      coordinate_reason: "no_gis_feature",
    });
    expect(rowOf(out, "10")).toMatchObject({
      coordinate_source: "none",
      coordinate_reason: "no_permit_point",
    });
    expect(out.stats.address_point.no_match).toBe(2);
  });

  it("an ambiguous address still falls back to a permit point (internal only)", () => {
    const out = run({
      parcels: [parcel("11", "100", "MAIN", "ST", null)],
      permits: [permit("11")],
    });
    expect(rowOf(out, "11")).toMatchObject({
      coordinate_source: "permit_point",
      coordinate_reason: null,
    });
  });

  it("a situs without a number is no_address and not matched", () => {
    const out = run({
      parcels: [
        parcel("12", "", "BRIDGEWAY", "DR", null),
        { ...parcel("13", "1", "X", "ST", null), situs: null },
      ],
    });
    expect(out.stats.address_point.no_address).toBe(2);
    expect(rowOf(out, "12").coordinate_source).toBe("none");
  });

  it("non-land accounts never get a point, even with a matching address", () => {
    const out = run({
      parcels: [parcel("14", "1405", "BRIDGEWAY", "DR", null, { prop_type: "P" })],
    });
    expect(rowOf(out, "14")).toMatchObject({
      coordinate_source: "none",
      coordinate_reason: "non_land_account",
    });
  });

  it("without a loaded layer the rank is skipped and nothing changes", () => {
    const out = assembleCoordinates({
      jobId: "travis-a04-coords-202610250500",
      parcels: [parcel("15", "1405", "BRIDGEWAY", "DR", null)],
      features: [],
      permits: [],
    });
    expect(rowOf(out, "15")).toMatchObject({
      coordinate_source: "none",
      coordinate_reason: "no_gis_feature",
    });
    expect(out.stats.address_point).toMatchObject({ matched: 0, ambiguous: 0, no_match: 0 });
  });

  it("invariant: coordinate_source = none iff latitude is null iff coordinate_reason is set", () => {
    const out = run({
      parcels: [
        parcel("20", "1405", "BRIDGEWAY", "DR", null),
        parcel("21", "100", "MAIN", "ST", null),
        parcel("22", "300", "ELM", "ST", null),
        parcel("23", "999", "NOWHERE", "RD", null),
      ],
    });
    for (const r of out.rows) {
      expect(r.coordinate_source === "none").toBe(r.latitude === null);
      expect(r.latitude === null).toBe(r.coordinate_reason !== null);
    }
  });
});

describe("County group geometry for an address_point (write-group geometryFor)", () => {
  const MAP_CTX = {
    jobId: "travis-a04-20261022052658",
    asOf: "2026-10-22",
    exportSha256: "6f7a758568fd03fa200e996d2756559eb53e13241238a004cbadac09ff4c2346",
    capturedAt: "2026-10-19T21:33:41.241Z",
  };
  const CIDS = {
    seed: "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu",
    county: "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq",
    propertyImprovement: "bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu",
  };
  function input(coordinate: GroupInput["coordinate"]): GroupInput {
    const raw = a04Record({ pID: 500, geoID: "0000000500" });
    const m = mapParcel(redactRecord(raw), {
      ...MAP_CTX,
      ordinal: 0,
      recordSha256: "a".repeat(64),
    });
    return {
      pID: m.parcel.request_identifier,
      geoId: m.parcel.geo_id,
      propType: m.parcel.prop_type,
      record: redactRecord(raw).record,
      yearBuilt: m.parcel.property_structure_built_year,
      exportPoint: null,
      ...(coordinate === undefined ? {} : { coordinate }),
    };
  }
  const geometryOf = (files: Record<string, string>): Record<string, unknown> | null =>
    files["geometry.json"] === undefined
      ? null
      : (JSON.parse(files["geometry.json"]) as Record<string, unknown>);

  it("writes the point with the address layer record as source_http_request, rule address_point", () => {
    const url = recordUrl(77);
    const plan = planCountyGroup(
      [input({ latitude: 30.31, longitude: -97.71, source: "address_point", sourceUrl: url })],
      CIDS,
    );
    const g = must(plan.groups[0]);
    expect(g.geometry_rule).toBe("address_point");
    const geo = must(geometryOf(g.files));
    expect(geo).toMatchObject({ latitude: 30.31, longitude: -97.71 });
    expect(geo.source_http_request).toEqual({
      method: "GET",
      url: "https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/LOCATION_address_points/FeatureServer/0/query",
      multiValueQueryString: { objectIds: ["77"], outFields: ["*"], outSR: ["4326"], f: ["json"] },
    });
  });

  it("an address_point without a source URL is an error (no invented provenance)", () => {
    expect(() =>
      planCountyGroup(
        [input({ latitude: 30.31, longitude: -97.71, source: "address_point" })],
        CIDS,
      ),
    ).toThrow(/source URL/);
  });

  it("a gis_centroid keeps the TCAD export request; a permit point and none write no geometry", () => {
    const gis = must(
      planCountyGroup([input({ latitude: 30.3, longitude: -97.7, source: "gis_centroid" })], CIDS)
        .groups[0],
    );
    expect(gis.geometry_rule).toBe("gis_centroid");
    expect(JSON.stringify(must(geometryOf(gis.files)).source_http_request)).toContain(
      "traviscad.org",
    );

    for (const source of ["permit_point", "none"] as const) {
      const g = must(
        planCountyGroup([input({ latitude: 30.3, longitude: -97.7, source })], CIDS).groups[0],
      );
      expect(g.geometry_rule).toBe("none");
      expect(geometryOf(g.files)).toBeNull();
    }
  });

  it("an address_point with a null coordinate writes no geometry", () => {
    const g = must(
      planCountyGroup(
        [
          input({
            latitude: null,
            longitude: null,
            source: "address_point",
            sourceUrl: recordUrl(1),
          }),
        ],
        CIDS,
      ).groups[0],
    );
    expect(g.geometry_rule).toBe("none");
  });
});
