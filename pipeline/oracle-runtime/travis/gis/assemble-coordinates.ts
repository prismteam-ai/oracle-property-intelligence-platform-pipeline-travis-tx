// A-04 T044 (FR-007…FR-010, FR-020, D-1, D-9; agent-design § 2 ranking): one coordinate per
// TCAD account. Pure: the Loader `gis` track reads `parcels`, `parcel_geoids`, `gis_features`
// (+ `gis_pages`) and the linked `property_improvements` rows inside its transaction, calls
// this, and writes the result (pipeline/local-stack/services/tracks/gis.ts). No address is turned
// into a point by a free-text lookup service, ever. ONE narrow exception (PO decision 2026-10-25, ADR 0004): rank 4
// below, an exact, unique join of the normalised situs to the City of Austin public address-point
// layer (address-points.ts), used only when ranks 1 to 3 gave no point.
//
// Rank (first that applies):
//   1. GIS feature joined by exact-string pID (PROP_ID = pID). Only a feature WITHOUT a PROP_ID
//      value falls back to its geoID, and then only when one R account holds that geoID. Split parcels: largest area, tie lowest
//      OBJECTID (`largest_area`); otherwise the feature's `centroid` / `interior_point` /
//      `centroid_outside_polygon`. Public `gis_centroid`; provenance = the GIS page.
//   2. TCAD export point, only `export_point_kind = real` (`export_point`; public
//      `gis_centroid`, frozen by A-02, CT-8); provenance = the TCAD export.
//   3. `condo_building_point`: a unit with no own point whose geoID is shared by several R
//      accounts takes the building's point when exactly ONE distinct candidate exists: GIS
//      features on that geoID (by geoID, or by the pID of another account on it) first, else
//      the real export points of the other accounts on it. Two or more distinct candidates →
//      no point (never a neighbour's).
//   4. `address_point` (PO decision 2026-10-25, ADR 0004): the situs (house number + street, unit and
//      ZIP ignored, address-normalise.ts) equals exactly ONE distinct point of the City of Austin
//      address layer and that point lies inside the Travis County box. Lowest priority of the
//      public ranks: never overrides a GIS point, an export point or a condo building point. Two or
//      more distinct points: no point, reason `address_point_ambiguous`; a point outside the
//      county: no point, reason `address_point_outside_county`; no point at all: the usual reason.
//      Public `address_point`; provenance = the layer record's URL, the retrieval time and the
//      sha256 of the cached layer file.
//   5. `permit_point` (Query DB only, D-9): the linked Austin permits' mode point at 6
//      decimals, tie → the latest issue_date; provenance = that permit's source row.
//   6. none, with exactly one internal reason: `address_point_ambiguous`,
//      `address_point_outside_county`, `gis_null_geometry` (own features all had a null
//      geometry), `no_permit_point` (linked permits, none with a point), else `no_gis_feature`.
// Non-R accounts (P, MH, MN) never get a point: `non_land_account`.
// A permit point more than 0.5 mi from a `gis_centroid` point keeps the GIS point and flags
// the parcel and that permit `permit_far_from_gis`.
import type { SitusIn } from "./address-normalise.js";
import type { AddressPointSet } from "./address-points.js";
import type { PointMethod } from "./points.js";

export const FAR_PERMIT_METERS = 0.5 * 1609.344;
const EARTH_M = 6_371_008.8;

export type CoordinateSource = "gis_centroid" | "address_point" | "permit_point" | "none";
export type CoordinateRule =
  | PointMethod
  | "largest_area"
  | "export_point"
  | "condo_building_point"
  | "address_point"
  | "permit_point";
export type CoordinateReason =
  | "no_gis_feature"
  | "gis_null_geometry"
  | "no_permit_point"
  | "non_land_account"
  | "address_point_ambiguous"
  | "address_point_outside_county";
export type ReviewFlag = "permit_far_from_gis";

export interface ParcelIn {
  request_identifier: string;
  geo_id: string | null;
  prop_type: string;
  export_point_lat: number | null;
  export_point_lon: number | null;
  export_point_kind: string | null;
  source_url: string | null;
  captured_at: string | null;
  export_sha256: string | null;
  /** parcels.situs_address (primary situs); read only by the address_point rank. */
  situs?: SitusIn | null;
}

/** parcel_geoids rows (several accounts per geoID). Defaults to each parcel's primary geoID. */
export interface GeoidAccountIn {
  geo_id: string;
  request_identifier: string;
  prop_type: string;
}

export interface FeatureIn {
  object_id: number;
  pid_value: string | null;
  geoid_value: string | null;
  area: number | null;
  point_lat: number | null;
  point_lon: number | null;
  point_method: PointMethod | null;
  null_geometry: boolean;
  page_url: string;
  page_captured_at: string;
  page_sha256: string;
}

export interface PermitIn {
  permit_number: string;
  issuing_jurisdiction: string;
  request_identifier: string;
  latitude: number | null;
  longitude: number | null;
  issue_date: string | null;
  source_url: string | null;
  captured_at: string | null;
  payload_sha256: string | null;
}

export interface AssemblyInput {
  jobId: string;
  parcels: readonly ParcelIn[];
  features: readonly FeatureIn[];
  permits: readonly PermitIn[];
  geoids?: readonly GeoidAccountIn[];
  /** The cached City of Austin address layer; absent: the address_point rank is skipped. */
  addressPoints?: AddressPointSet;
}

export interface CoordinateRow {
  request_identifier: string;
  latitude: number | null;
  longitude: number | null;
  coordinate_source: CoordinateSource;
  coordinate_rule: CoordinateRule | null;
  coordinate_reason: CoordinateReason | null;
  coordinate_review_flag: ReviewFlag | null;
  coordinate_source_url: string | null;
  coordinate_captured_at: string | null;
  coordinate_sha256: string | null;
  coordinate_job_id: string;
}

export interface PermitFlag {
  permit_number: string;
  issuing_jurisdiction: string;
  coordinate_review_flag: ReviewFlag;
}

export interface AssemblyStats {
  by_source: Record<CoordinateSource, number>;
  by_rule: Partial<Record<CoordinateRule, number>>;
  gap_by_reason: Partial<Record<CoordinateReason, number>>;
  multi_feature: { pids: number; extra_features: number; rule: "largest_area" };
  condo_building_point: { accounts: number; buildings: number; rule: "condo_building_point" };
  /** Rank 4 outcomes over the accounts that reached it (no point from ranks 1 to 3). */
  address_point: {
    matched: number;
    ambiguous: number;
    outside_county: number;
    no_match: number;
    no_address: number;
    unit_ignored: number;
    rule: "address_point";
  };
  gis_features_without_roll_account: number;
  permit_far_from_gis: number;
  interior_point: number;
  join_key: "pid" | "geoid";
  /** DP-5: how the layer's features met the roll (exact PROP_ID = pID first, geo_id only without PROP_ID). */
  join_proof: JoinProof;
}

export interface JoinProof {
  features: number;
  pid_matched: number;
  pid_not_r_account: number;
  pid_unmatched: number;
  geoid_fallback_matched: number;
  geoid_fallback_unmatched: number;
}

export interface AssemblyOutput {
  rows: CoordinateRow[];
  permitFlags: PermitFlag[];
  stats: AssemblyStats;
}

interface Point {
  lat: number;
  lon: number;
  url: string | null;
  capturedAt: string | null;
  sha256: string | null;
}

const isNum = (v: number | null): v is number => typeof v === "number" && Number.isFinite(v);
const key7 = (lat: number, lon: number): string => `${lat.toFixed(7)},${lon.toFixed(7)}`;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const group = <T>(items: readonly T[], keyOf: (t: T) => string | null): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    if (k === null) continue;
    const list = m.get(k);
    if (list === undefined) m.set(k, [it]);
    else list.push(it);
  }
  return m;
};

const featurePointOf = (f: FeatureIn): Point | null =>
  f.null_geometry || !isNum(f.point_lat) || !isNum(f.point_lon)
    ? null
    : {
        lat: f.point_lat,
        lon: f.point_lon,
        url: f.page_url,
        capturedAt: f.page_captured_at,
        sha256: f.page_sha256,
      };

const exportPointOf = (p: ParcelIn): Point | null =>
  p.export_point_kind === "real" && isNum(p.export_point_lat) && isNum(p.export_point_lon)
    ? {
        lat: p.export_point_lat,
        lon: p.export_point_lon,
        url: p.source_url,
        capturedAt: p.captured_at,
        sha256: p.export_sha256,
      }
    : null;

/** Largest area, tie → lowest OBJECTID, among features with a point. */
function pickOwn(features: readonly FeatureIn[]): { f: FeatureIn; extra: number } | null {
  const usable = features
    .filter((f) => featurePointOf(f) !== null)
    .sort((a, b) => (b.area ?? 0) - (a.area ?? 0) || a.object_id - b.object_id);
  const f = usable[0];
  return f === undefined ? null : { f, extra: usable.length - 1 };
}

/** Mode point at 6 decimals over the permits with a point; tie → latest issue_date. */
function permitPoint(permits: readonly PermitIn[]): Point | null {
  const withPoint = permits.filter((p) => isNum(p.latitude) && isNum(p.longitude));
  if (withPoint.length === 0) return null;
  const byPoint = group(
    withPoint,
    (p) => `${(p.latitude as number).toFixed(6)},${(p.longitude as number).toFixed(6)}`,
  );
  const latest = (ps: readonly PermitIn[]): string =>
    ps
      .map((p) => p.issue_date ?? "")
      .sort()
      .at(-1) ?? "";
  const best = [...byPoint.values()].sort(
    (a, b) => b.length - a.length || latest(b).localeCompare(latest(a)),
  )[0] as PermitIn[];
  const chosen = [...best].sort((a, b) =>
    (b.issue_date ?? "").localeCompare(a.issue_date ?? ""),
  )[0] as PermitIn;
  return {
    lat: Number((chosen.latitude as number).toFixed(6)),
    lon: Number((chosen.longitude as number).toFixed(6)),
    url: chosen.source_url,
    capturedAt: chosen.captured_at,
    sha256: chosen.payload_sha256,
  };
}

export function assembleCoordinates(input: AssemblyInput): AssemblyOutput {
  const joinKey: "pid" | "geoid" = input.features.some((f) => f.pid_value !== null)
    ? "pid"
    : "geoid";
  const byPid = group(input.features, (f) => f.pid_value);
  const byGeoid = group(input.features, (f) => f.geoid_value);
  const parcelsById = new Map(input.parcels.map((p) => [p.request_identifier, p]));
  const geoidRows =
    input.geoids ??
    input.parcels.flatMap((p) =>
      p.geo_id === null
        ? []
        : [{ geo_id: p.geo_id, request_identifier: p.request_identifier, prop_type: p.prop_type }],
    );
  const rAccountsByGeoid = group(
    geoidRows.filter((g) => g.prop_type === "R"),
    (g) => g.geo_id,
  );
  const permitsById = group(input.permits, (p) => p.request_identifier);

  const stats: AssemblyStats = {
    by_source: { gis_centroid: 0, address_point: 0, permit_point: 0, none: 0 },
    by_rule: {},
    gap_by_reason: {},
    multi_feature: { pids: 0, extra_features: 0, rule: "largest_area" },
    condo_building_point: { accounts: 0, buildings: 0, rule: "condo_building_point" },
    address_point: {
      matched: 0,
      ambiguous: 0,
      outside_county: 0,
      no_match: 0,
      no_address: 0,
      unit_ignored: 0,
      rule: "address_point",
    },
    gis_features_without_roll_account: 0,
    permit_far_from_gis: 0,
    interior_point: 0,
    join_key: joinKey,
    join_proof: {
      features: input.features.length,
      pid_matched: 0,
      pid_not_r_account: 0,
      pid_unmatched: 0,
      geoid_fallback_matched: 0,
      geoid_fallback_unmatched: 0,
    },
  };
  const byGeoidNoPid = group(
    input.features.filter((f) => f.pid_value === null),
    (f) => f.geoid_value,
  );
  const condoBuildings = new Set<string>();
  const rows: CoordinateRow[] = [];
  const permitFlags: PermitFlag[] = [];

  for (const p of input.parcels) {
    const rid = p.request_identifier;
    const permits = permitsById.get(rid) ?? [];
    const sharers = p.geo_id === null ? [] : (rAccountsByGeoid.get(p.geo_id) ?? []);
    const own: FeatureIn[] = [
      ...(byPid.get(rid) ?? []),
      ...(p.geo_id !== null && sharers.length <= 1 ? (byGeoidNoPid.get(p.geo_id) ?? []) : []),
    ];

    let point: Point | null = null;
    let rule: CoordinateRule | null = null;
    let source: CoordinateSource = "none";
    let reason: CoordinateReason | null = null;

    if (p.prop_type !== "R") {
      reason = "non_land_account";
    } else {
      const pick = pickOwn(own);
      if (pick !== null) {
        point = featurePointOf(pick.f);
        rule = pick.extra > 0 ? "largest_area" : (pick.f.point_method ?? "centroid");
        if (pick.extra > 0) {
          stats.multi_feature.pids += 1;
          stats.multi_feature.extra_features += pick.extra;
        }
        if (pick.f.point_method === "interior_point") stats.interior_point += 1;
      }
      if (point === null) {
        point = exportPointOf(p);
        if (point !== null) rule = "export_point";
      }
      if (point === null && p.geo_id !== null && sharers.length > 1) {
        const others = sharers.filter((s) => s.request_identifier !== rid);
        const featureCandidates = new Map<number, FeatureIn>();
        for (const f of byGeoid.get(p.geo_id) ?? []) featureCandidates.set(f.object_id, f);
        for (const s of others)
          for (const f of byPid.get(s.request_identifier) ?? [])
            featureCandidates.set(f.object_id, f);
        const distinct = (pts: Point[]): Point[] => [
          ...new Map(pts.map((x) => [key7(x.lat, x.lon), x])).values(),
        ];
        const gisPts = distinct(
          [...featureCandidates.values()].flatMap((f) => featurePointOf(f) ?? []),
        );
        const exportPts = distinct(
          others.flatMap((s) => {
            const o = parcelsById.get(s.request_identifier);
            return o === undefined ? [] : (exportPointOf(o) ?? []);
          }),
        );
        const one =
          gisPts.length === 1
            ? gisPts[0]
            : gisPts.length === 0 && exportPts.length === 1
              ? exportPts[0]
              : undefined;
        if (one !== undefined) {
          point = one;
          rule = "condo_building_point";
          stats.condo_building_point.accounts += 1;
          condoBuildings.add(p.geo_id);
        }
      }
      let addressReason: CoordinateReason | null = null;
      if (point === null && input.addressPoints !== undefined) {
        const m = input.addressPoints.match(p.situs);
        const a = stats.address_point;
        if (m.status === "unique") {
          const prov = input.addressPoints.provenance;
          point = {
            lat: m.point.lat,
            lon: m.point.lon,
            url: m.point.url,
            capturedAt: prov.retrievedAt,
            sha256: prov.sha256,
          };
          rule = "address_point";
          source = "address_point";
          a.matched += 1;
          if (m.unit_ignored !== null) a.unit_ignored += 1;
        } else if (m.status === "ambiguous") {
          a.ambiguous += 1;
          addressReason = "address_point_ambiguous";
        } else if (m.status === "outside_county") {
          a.outside_county += 1;
          addressReason = "address_point_outside_county";
        } else if (m.status === "no_match") a.no_match += 1;
        else a.no_address += 1;
      }
      if (point !== null) {
        if (source !== "address_point") source = "gis_centroid";
      } else {
        point = permitPoint(permits);
        if (point !== null) {
          source = "permit_point";
          rule = "permit_point";
        } else {
          reason =
            addressReason ??
            (own.length > 0 && own.every((f) => featurePointOf(f) === null)
              ? "gis_null_geometry"
              : permits.length > 0
                ? "no_permit_point"
                : "no_gis_feature");
        }
      }
    }

    let flag: ReviewFlag | null = null;
    if (source === "gis_centroid" && point !== null) {
      for (const pm of permits) {
        if (!isNum(pm.latitude) || !isNum(pm.longitude)) continue;
        if (distanceMeters(point.lat, point.lon, pm.latitude, pm.longitude) > FAR_PERMIT_METERS) {
          flag = "permit_far_from_gis";
          permitFlags.push({
            permit_number: pm.permit_number,
            issuing_jurisdiction: pm.issuing_jurisdiction,
            coordinate_review_flag: "permit_far_from_gis",
          });
        }
      }
      if (flag !== null) stats.permit_far_from_gis += 1;
    }

    stats.by_source[source] += 1;
    if (rule !== null) stats.by_rule[rule] = (stats.by_rule[rule] ?? 0) + 1;
    if (reason !== null) stats.gap_by_reason[reason] = (stats.gap_by_reason[reason] ?? 0) + 1;
    rows.push({
      request_identifier: rid,
      latitude: point?.lat ?? null,
      longitude: point?.lon ?? null,
      coordinate_source: source,
      coordinate_rule: rule,
      coordinate_reason: reason,
      coordinate_review_flag: flag,
      coordinate_source_url: point?.url ?? null,
      coordinate_captured_at: point?.capturedAt ?? null,
      coordinate_sha256: point?.sha256 ?? null,
      coordinate_job_id: input.jobId,
    });
  }
  stats.condo_building_point.buildings = condoBuildings.size;
  // GIS is compared with the roll, never the population (TC-032): features with no roll account
  // are counted, never loaded as properties.
  const proof = stats.join_proof;
  let withoutRoll = 0;
  for (const f of input.features) {
    if (f.pid_value !== null) {
      const acct = parcelsById.get(f.pid_value);
      if (acct === undefined) {
        proof.pid_unmatched += 1;
        withoutRoll += 1;
      } else if (acct.prop_type !== "R") proof.pid_not_r_account += 1;
      else proof.pid_matched += 1;
    } else if (f.geoid_value !== null && (rAccountsByGeoid.get(f.geoid_value)?.length ?? 0) === 1) {
      proof.geoid_fallback_matched += 1;
    } else {
      proof.geoid_fallback_unmatched += 1;
      if (f.geoid_value === null || !rAccountsByGeoid.has(f.geoid_value)) withoutRoll += 1;
    }
  }
  stats.gis_features_without_roll_account = withoutRoll;
  return { rows, permitFlags, stats };
}
