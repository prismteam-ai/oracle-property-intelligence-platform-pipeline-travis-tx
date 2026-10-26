// A-04 T040 / T044: one point per GIS feature (centroid or interior point) and the coordinate
// ranking. Offline, pure functions over SYNTHETIC TEST INPUT (test/fixtures/a04/gis/).
import { describe, expect, it } from "vitest";
import {
  chooseFeature,
  featurePoint,
  pointInPolygon,
  polygonArea,
  POINT_PRECISION_DEG,
} from "../../../travis/gis/points.js";
import {
  DEGENERATE,
  L_SHAPE,
  MULTIPART,
  SQUARE,
  SQUARE_CENTRED_HOLE,
  SQUARE_OFFSET_HOLE,
  U_SHAPE,
  at,
  squareAt,
  toGrid,
} from "../../fixtures/a04/gis/polygons.js";
import { must } from "../../helpers.js";

const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

describe("A-04 T040 point geometry (points.ts)", () => {
  it("A-04-TC-031 a convex polygon gives coordinate_rule = centroid", () => {
    const p = must(featurePoint(SQUARE), "point");
    expect(p.method).toBe("centroid");
    const [x, y] = toGrid(p.lon, p.lat);
    expect(close(x, 5, 1e-3) && close(y, 5, 1e-3)).toBe(true);
  });

  it("A-04-TC-031 L- and U-shaped lots: centroid outside → polylabel interior point, rule interior_point", () => {
    for (const shape of [L_SHAPE, U_SHAPE]) {
      const p = must(featurePoint(shape), "point");
      expect(p.method).toBe("interior_point");
      expect(pointInPolygon([p.lon, p.lat], shape.rings)).toBe(true);
      // rounded to the 1e-7° grid of geometryPrecision=7
      expect(Math.round(p.lat / POINT_PRECISION_DEG) * POINT_PRECISION_DEG).toBeCloseTo(p.lat, 9);
    }
    expect(POINT_PRECISION_DEG).toBe(1e-7);
    // the L's area centroid itself is outside the polygon
    expect(pointInPolygon(at(2.6, 2.6), L_SHAPE.rings)).toBe(false);
  });

  it("A-04-TC-031 no interior point can be computed → coordinate_rule = centroid_outside_polygon", () => {
    const p = must(featurePoint(DEGENERATE), "point");
    expect(p.method).toBe("centroid_outside_polygon");
  });

  it("holes are subtracted from the area and the centroid", () => {
    expect(polygonArea(SQUARE_CENTRED_HOLE.rings) / polygonArea(SQUARE.rings)).toBeCloseTo(0.96, 6);
    const offset = must(featurePoint(SQUARE_OFFSET_HOLE), "point");
    expect(offset.method).toBe("centroid");
    const [x, y] = toGrid(offset.lon, offset.lat);
    expect(x).toBeCloseTo(472 / 96, 2);
    expect(y).toBeCloseTo(5, 2);
    // the centred hole swallows the centroid: interior point, never inside the hole
    const centred = must(featurePoint(SQUARE_CENTRED_HOLE), "point");
    expect(centred.method).toBe("interior_point");
    expect(pointInPolygon([centred.lon, centred.lat], SQUARE_CENTRED_HOLE.rings)).toBe(true);
  });

  it("multipart: centroid between the parts → interior point of the largest outer ring", () => {
    const p = must(featurePoint(MULTIPART), "point");
    expect(p.method).toBe("interior_point");
    const [x, y] = toGrid(p.lon, p.lat);
    expect(x > 0 && x < 2 && y > 0 && y < 2).toBe(true);
  });

  it("geometry: null (or no rings) → null, which assembly reports as gis_null_geometry", () => {
    expect(featurePoint(null)).toBeNull();
    expect(featurePoint(undefined)).toBeNull();
    expect(featurePoint({ rings: [] })).toBeNull();
  });

  it("A-04-TC-029 several features for one pID → largest area, tie lowest OBJECTID, others counted", () => {
    const f = (objectId: number, side: number) => {
      const point = must(featurePoint(squareAt(objectId * 20, 0, side)), "point");
      return { objectId, area: point.area, point };
    };
    const picked = must(chooseFeature([f(7, 2), f(3, 5), f(9, 1)]), "choice");
    expect(picked.feature.objectId).toBe(3);
    expect(picked.rule).toBe("largest_area");
    expect(picked.extra).toBe(2);

    const tie = must(chooseFeature([f(8, 4), f(4, 4)]), "tie");
    expect(tie.feature.objectId).toBe(4);
    expect(tie.extra).toBe(1);

    const single = must(chooseFeature([f(5, 3)]), "single");
    expect(single.rule).toBe("centroid");
    expect(single.extra).toBe(0);

    expect(chooseFeature([{ objectId: 1, area: 0, point: null }])).toBeNull();
  });
});

// ---- T044: coordinate assembly (rank GIS → export point → condo_building_point → permit_point
// → reason). SYNTHETIC TEST INPUT only: made-up pIDs, geoIDs, permits and points. ----
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import {
  assembleCoordinates,
  FAR_PERMIT_METERS,
  type AssemblyInput,
  type FeatureIn,
  type ParcelIn,
  type PermitIn,
} from "../../../travis/gis/assemble-coordinates.js";

const PAGE =
  "https://gis.traviscountytx.gov/server1/rest/services/CIPStoryMap/Main_Location_Map2/MapServer/6/query?f=json&objectIds=1";
const SOCRATA =
  "https://data.austintexas.gov/resource/3syk-w9eu.json?$where=permit_number%3D%27X%27";
const TCAD = "https://traviscad.org/synthetic-export.zip";
const SHA = (c: string): string => c.repeat(64);

const parcel = (rid: string, over: Partial<ParcelIn> = {}): ParcelIn => ({
  request_identifier: rid,
  geo_id: `G${rid}`,
  prop_type: "R",
  export_point_lat: null,
  export_point_lon: null,
  export_point_kind: "placeholder",
  source_url: TCAD,
  captured_at: "2026-10-19T21:33:41Z",
  export_sha256: SHA("e"),
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
const permit = (rid: string, over: Partial<PermitIn> = {}): PermitIn => ({
  permit_number: `P-${rid}`,
  issuing_jurisdiction: "austin",
  request_identifier: rid,
  latitude: 30.3,
  longitude: -97.7,
  issue_date: "2020-01-01",
  source_url: SOCRATA,
  captured_at: "2026-10-22T04:00:00Z",
  payload_sha256: SHA("p"),
  ...over,
});
const input = (over: Partial<AssemblyInput>): AssemblyInput => ({
  jobId: "travis-a04-coords-202610220500",
  parcels: [],
  features: [],
  permits: [],
  ...over,
});
const rowOf = (out: ReturnType<typeof assembleCoordinates>, rid: string) =>
  must(
    out.rows.find((r) => r.request_identifier === rid),
    `row ${rid}`,
  );

/** Metres → degrees of latitude (spherical, R = 6,371,008.8 m). */
const dLat = (m: number): number => (m / 6_371_008.8) * (180 / Math.PI);

describe("A-04 T044 coordinate assembly (assemble-coordinates.ts)", () => {
  it("rank 1: the GIS feature joined by exact-string pID wins over the export point; provenance = its page", () => {
    const out = assembleCoordinates(
      input({
        parcels: [
          parcel("221829", {
            export_point_kind: "real",
            export_point_lat: 30.1,
            export_point_lon: -97.9,
          }),
        ],
        features: [feature(1, { pid_value: "221829", point_lat: 30.26, point_lon: -97.74 })],
      }),
    );
    expect(rowOf(out, "221829")).toMatchObject({
      latitude: 30.26,
      longitude: -97.74,
      coordinate_source: "gis_centroid",
      coordinate_rule: "centroid",
      coordinate_reason: null,
      coordinate_source_url: PAGE,
      coordinate_captured_at: "2026-10-22T03:00:00Z",
      coordinate_sha256: SHA("a"),
    });
    // a pID that only matches after trimming or padding is not the same key
    const strict = assembleCoordinates(
      input({ parcels: [parcel("00221829")], features: [feature(1, { pid_value: "221829" })] }),
    );
    expect(rowOf(strict, "00221829").coordinate_source).toBe("none");
  });

  it("rank 2: only a `real` export point is used (rule export_point, public gis_centroid, TCAD provenance)", () => {
    const out = assembleCoordinates(
      input({
        parcels: [
          parcel("1", {
            export_point_kind: "real",
            export_point_lat: 30.2,
            export_point_lon: -97.8,
          }),
          parcel("2", {
            export_point_kind: "placeholder",
            export_point_lat: 0,
            export_point_lon: 0,
          }),
          parcel("3", {
            export_point_kind: "duplicate",
            export_point_lat: 30.2,
            export_point_lon: -97.8,
          }),
        ],
      }),
    );
    expect(rowOf(out, "1")).toMatchObject({
      coordinate_source: "gis_centroid",
      coordinate_rule: "export_point",
      coordinate_source_url: TCAD,
      coordinate_sha256: SHA("e"),
    });
    expect(rowOf(out, "2").coordinate_source).toBe("none");
    expect(rowOf(out, "3").coordinate_source).toBe("none");
  });

  it("A-04-TC-024 no feature, no real export point, no condo point + a linked permit point → permit_point with the permit URL", () => {
    const out = assembleCoordinates(
      input({
        parcels: [parcel("7")],
        permits: [
          permit("7", {
            permit_number: "A",
            latitude: 30.31,
            longitude: -97.71,
            issue_date: "2019-01-01",
          }),
          permit("7", {
            permit_number: "B",
            latitude: 30.31,
            longitude: -97.71,
            issue_date: "2021-06-01",
          }),
          permit("7", {
            permit_number: "C",
            latitude: 30.4,
            longitude: -97.6,
            issue_date: "2023-01-01",
          }),
        ],
      }),
    );
    // mode point at 6 decimals (A and B), provenance from the latest permit at that point (B)
    expect(rowOf(out, "7")).toMatchObject({
      latitude: 30.31,
      longitude: -97.71,
      coordinate_source: "permit_point",
      coordinate_rule: "permit_point",
      coordinate_reason: null,
      coordinate_source_url: SOCRATA,
      coordinate_sha256: SHA("p"),
    });
    expect(out.stats.by_source.permit_point).toBe(1);
  });

  it("A-04-TC-025 no feature, no permit point → null lat/lon, source none, exactly one internal reason; never geocoded", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const out = assembleCoordinates(
      input({
        parcels: [parcel("10"), parcel("11"), parcel("12")],
        features: [
          feature(5, {
            pid_value: "11",
            null_geometry: true,
            point_lat: null,
            point_lon: null,
            point_method: null,
            area: null,
          }),
        ],
        permits: [permit("12", { latitude: null, longitude: null })],
      }),
    );
    expect(rowOf(out, "10")).toMatchObject({
      latitude: null,
      longitude: null,
      coordinate_source: "none",
      coordinate_reason: "no_gis_feature",
    });
    expect(rowOf(out, "11")).toMatchObject({
      latitude: null,
      coordinate_source: "none",
      coordinate_reason: "gis_null_geometry",
    });
    expect(rowOf(out, "12")).toMatchObject({
      latitude: null,
      coordinate_source: "none",
      coordinate_reason: "no_permit_point",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    // static scan: no geocoder anywhere in the runtime
    const root = fileURLToPath(new URL("../../../travis/", import.meta.url));
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => {
        const p = join(d, n);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
      });
    const hits = walk(root).filter((p) =>
      /geocod|nominatim|maps\.googleapis|findAddressCandidates/i.test(readFileSync(p, "utf8")),
    );
    expect(hits).toEqual([]);
  });

  it("non-R accounts never get a point: coordinate_reason = non_land_account", () => {
    const out = assembleCoordinates(
      input({
        parcels: [
          parcel("p1", {
            prop_type: "P",
            export_point_kind: "real",
            export_point_lat: 30.2,
            export_point_lon: -97.8,
          }),
        ],
        features: [feature(1, { pid_value: "p1" })],
      }),
    );
    expect(rowOf(out, "p1")).toMatchObject({
      coordinate_source: "none",
      latitude: null,
      coordinate_reason: "non_land_account",
    });
  });

  it("A-04-TC-030 a permit point > 0.5 mi from the GIS point keeps GIS and flags parcel and permit; 0.4 mi gives no flag", () => {
    expect(FAR_PERMIT_METERS).toBeCloseTo(804.672, 3);
    const gis = { point_lat: 30.25, point_lon: -97.75 };
    const out = assembleCoordinates(
      input({
        parcels: [parcel("far"), parcel("near")],
        features: [
          feature(1, { pid_value: "far", ...gis }),
          feature(2, { pid_value: "near", ...gis }),
        ],
        permits: [
          permit("far", {
            permit_number: "F",
            latitude: 30.25 + dLat(0.6 * 1609.344),
            longitude: -97.75,
          }),
          permit("near", {
            permit_number: "N",
            latitude: 30.25 + dLat(0.4 * 1609.344),
            longitude: -97.75,
          }),
        ],
      }),
    );
    expect(rowOf(out, "far")).toMatchObject({
      coordinate_source: "gis_centroid",
      coordinate_review_flag: "permit_far_from_gis",
      latitude: 30.25,
    });
    expect(rowOf(out, "near").coordinate_review_flag).toBeNull();
    expect(out.permitFlags).toEqual([
      {
        permit_number: "F",
        issuing_jurisdiction: "austin",
        coordinate_review_flag: "permit_far_from_gis",
      },
    ]);
    expect(out.stats.permit_far_from_gis).toBe(1);
  });

  it("A-04-TC-033 units sharing a geoID with one candidate point get the building's point; two candidates → none, never a neighbour's", () => {
    const units = ["u1", "u2", "u3"].map((rid) => parcel(rid, { geo_id: "0100000001" }));
    const others = ["v1", "v2"].map((rid) => parcel(rid, { geo_id: "0100000002" }));
    const out = assembleCoordinates(
      input({
        parcels: [...units, ...others],
        features: [
          feature(10, {
            pid_value: "B1",
            geoid_value: "0100000001",
            point_lat: 30.27,
            point_lon: -97.72,
            page_sha256: SHA("b"),
          }),
          feature(20, {
            pid_value: "B2",
            geoid_value: "0100000002",
            point_lat: 30.28,
            point_lon: -97.73,
          }),
          feature(21, {
            pid_value: "B3",
            geoid_value: "0100000002",
            point_lat: 30.29,
            point_lon: -97.74,
          }),
        ],
      }),
    );
    for (const rid of ["u1", "u2", "u3"]) {
      expect(rowOf(out, rid)).toMatchObject({
        latitude: 30.27,
        longitude: -97.72,
        coordinate_source: "gis_centroid",
        coordinate_rule: "condo_building_point",
        coordinate_source_url: PAGE,
        coordinate_captured_at: "2026-10-22T03:00:00Z",
        coordinate_sha256: SHA("b"),
      });
    }
    for (const rid of ["v1", "v2"]) {
      expect(rowOf(out, rid)).toMatchObject({
        latitude: null,
        coordinate_source: "none",
        coordinate_reason: "no_gis_feature",
      });
    }
    expect(out.stats.condo_building_point).toEqual({
      accounts: 3,
      buildings: 1,
      rule: "condo_building_point",
    });
    expect(out.stats.gis_features_without_roll_account).toBe(3);
  });

  it("A-04-TC-029 split parcels are counted: multi_feature {pids, extra_features, rule largest_area}", () => {
    const out = assembleCoordinates(
      input({
        parcels: [parcel("s")],
        features: [
          feature(3, { pid_value: "s", area: 2e-6, point_lat: 30.21 }),
          feature(1, { pid_value: "s", area: 5e-6, point_lat: 30.22 }),
          feature(2, { pid_value: "s", area: 1e-6, point_lat: 30.23 }),
        ],
      }),
    );
    expect(rowOf(out, "s")).toMatchObject({ coordinate_rule: "largest_area", latitude: 30.22 });
    expect(out.stats.multi_feature).toEqual({ pids: 1, extra_features: 2, rule: "largest_area" });
  });

  it("invariant: coordinate_source = none ⇔ latitude null ⇔ coordinate_reason not null, for every row", () => {
    const out = assembleCoordinates(
      input({
        parcels: [
          parcel("a"),
          parcel("b", { prop_type: "MH" }),
          parcel("c", {
            export_point_kind: "real",
            export_point_lat: 30.2,
            export_point_lon: -97.8,
          }),
        ],
        features: [feature(1, { pid_value: "a" })],
      }),
    );
    for (const r of out.rows) {
      expect(r.coordinate_source === "none").toBe(r.latitude === null);
      expect(r.latitude === null).toBe(r.longitude === null);
      expect(r.latitude === null).toBe(r.coordinate_reason !== null);
      expect(r.coordinate_job_id).toBe("travis-a04-coords-202610220500");
    }
  });
});

describe("DP-5 join key: exact-string PROP_ID = pID first, geo_id only for features without PROP_ID", () => {
  it("reports the join proof: matched / pid_not_r_account / unmatched / geoid fallback", () => {
    const out = assembleCoordinates(
      input({
        parcels: [
          parcel("1", { geo_id: "G1" }),
          parcel("2", { geo_id: "G2" }),
          parcel("3", { geo_id: "G3", prop_type: "P" }),
        ],
        features: [
          feature(1, { pid_value: "1", geoid_value: "G1" }), // matched by pID
          feature(2, { pid_value: "3", geoid_value: "G3" }), // pID is a non-R account
          feature(3, { pid_value: "999", geoid_value: "G2" }), // pID not on the roll: NOT rescued by geoID
          feature(4, { pid_value: null, geoid_value: "G2", point_lat: 30.31 }), // no PROP_ID: geoID fallback
          feature(5, { pid_value: null, geoid_value: "GX" }), // no PROP_ID, no account
        ],
      }),
    );
    expect(out.stats.join_proof).toEqual({
      features: 5,
      pid_matched: 1,
      pid_not_r_account: 1,
      pid_unmatched: 1,
      geoid_fallback_matched: 1,
      geoid_fallback_unmatched: 1,
    });
    // account 2 got its point from the PROP_ID-less feature only, never from feature 3
    expect(rowOf(out, "2")).toMatchObject({ latitude: 30.31, coordinate_rule: "centroid" });
    expect(rowOf(out, "1").coordinate_source).toBe("gis_centroid");
  });

  it("a feature that has a PROP_ID never falls back to its geo_id", () => {
    const out = assembleCoordinates(
      input({
        parcels: [parcel("2", { geo_id: "G2" })],
        features: [feature(3, { pid_value: "999", geoid_value: "G2" })],
      }),
    );
    expect(rowOf(out, "2")).toMatchObject({
      coordinate_source: "none",
      coordinate_reason: "no_gis_feature",
    });
  });

  it("every imported feature keeps its page provenance: layer query URL, captured_at, page sha256", () => {
    const out = assembleCoordinates(
      input({
        parcels: [parcel("1")],
        features: [feature(1, { pid_value: "1" })],
      }),
    );
    expect(rowOf(out, "1").coordinate_source_url).toMatch(/\/MapServer\/6\/query\?/);
    expect(rowOf(out, "1").coordinate_source_url).not.toMatch(/objectIds=\d{3,}/);
    expect(rowOf(out, "1").coordinate_captured_at).toBe("2026-10-22T03:00:00Z");
    expect(rowOf(out, "1").coordinate_sha256).toBe(SHA("a"));
  });
});
