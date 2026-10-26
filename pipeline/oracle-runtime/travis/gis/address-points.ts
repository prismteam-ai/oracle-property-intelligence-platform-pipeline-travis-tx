// A-11 Run 3 (ADR 0004): the address-point index and the exact, unique matcher. Pure.
//
// Source: City of Austin public layer LOCATION_address_points (ArcGIS FeatureServer 0, public
// org 0L95CJ0VTaxqcmED). A situs is matched to ONE point or to none; there is no nearest-point
// search, no fuzzy score and no lookup service. Wrong coordinates are worse than none, so:
//   - only layer records of ADDRESS_TYPE 1 ("Address") are indexed (not hydrants, towers,
//     meters, dormant records);
//   - a key (house number + canonical street, address-normalise.ts) that has two or more
//     DISTINCT points (7-decimal key) is `ambiguous` and stays unmatched;
//   - a matched point must lie inside the Travis County bounding box, else `outside_county`
//     and it stays unmatched.
import { distanceMeters } from "./assemble-coordinates.js";
import { layerKey, situsKey, type SitusIn } from "./address-normalise.js";

/** Travis County bounding box (EPSG:4326), a coarse guard against a wrong or foreign point. */
export const TRAVIS_BBOX = Object.freeze({
  minLat: 30.02,
  maxLat: 30.63,
  minLon: -98.18,
  maxLon: -97.36,
});

/** The City of Austin layer: the provenance URL root every matched point is stamped with. */
export const ADDRESS_LAYER_URL =
  "https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/LOCATION_address_points/FeatureServer/0";

/** One layer record as cached on disk (a subset of the layer's fields, geometry in EPSG:4326). */
export interface AddressPointRecord {
  object_id: number;
  place_id: number | null;
  address: number | null;
  full_street_name: string | null;
  address_fraction: string | null;
  address_suffix: string | null;
  address_type: number | null;
  lat: number;
  lon: number;
}

/** What assembleCoordinates needs from the layer: the matcher, nothing else. */
export interface AddressPointSet {
  /** Provenance of the cached layer (receipt): url, retrieval time and digest. */
  provenance: { layerUrl: string; retrievedAt: string; sha256: string };
  match(situs: SitusIn | null | undefined): AddressMatch;
}

export interface MatchedPoint {
  object_id: number;
  place_id: number | null;
  lat: number;
  lon: number;
  /** A GET that returns exactly this record (provenance for geometry.source_http_request). */
  url: string;
}

export type AddressMatch =
  | { status: "unique"; point: MatchedPoint; unit_ignored: string | null }
  | { status: "ambiguous"; candidates: number }
  | { status: "outside_county"; point: MatchedPoint }
  | { status: "no_match" }
  | { status: "no_address" };

export const insideTravis = (lat: number, lon: number): boolean =>
  lat >= TRAVIS_BBOX.minLat &&
  lat <= TRAVIS_BBOX.maxLat &&
  lon >= TRAVIS_BBOX.minLon &&
  lon <= TRAVIS_BBOX.maxLon;

const key7 = (lat: number, lon: number): string => `${lat.toFixed(7)},${lon.toFixed(7)}`;

/** The GET URL of one layer record (OBJECTID), reproducible and public. */
export function recordUrl(objectId: number): string {
  return `${ADDRESS_LAYER_URL}/query?objectIds=${objectId}&outFields=*&outSR=4326&f=json`;
}

export function buildAddressPointSet(
  records: Iterable<AddressPointRecord>,
  provenance: AddressPointSet["provenance"],
): AddressPointSet {
  const byKey = new Map<string, AddressPointRecord[]>();
  for (const r of records) {
    if (r.address_type !== 1) continue;
    const k = layerKey(r);
    if (k === null) continue;
    const list = byKey.get(k.key);
    if (list === undefined) byKey.set(k.key, [r]);
    else list.push(r);
  }
  return {
    provenance,
    match(situs) {
      const k = situsKey(situs);
      if (k === null) return { status: "no_address" };
      const hits = byKey.get(k.key);
      if (hits === undefined) return { status: "no_match" };
      const distinct = new Map(hits.map((h) => [key7(h.lat, h.lon), h]));
      if (distinct.size > 1) return { status: "ambiguous", candidates: distinct.size };
      const h = [...distinct.values()][0] as AddressPointRecord;
      const point: MatchedPoint = {
        object_id: h.object_id,
        place_id: h.place_id,
        lat: h.lat,
        lon: h.lon,
        url: recordUrl(h.object_id),
      };
      if (!insideTravis(h.lat, h.lon)) return { status: "outside_county", point };
      return { status: "unique", point, unit_ignored: k.unit };
    },
  };
}

/** Percentile (nearest rank) of a numeric list; null for an empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] as number;
}

/** Distance distribution (metres) of address points against GIS centroids, for the report. */
export function distanceDistribution(
  pairs: ReadonlyArray<{ a: { lat: number; lon: number }; b: { lat: number; lon: number } }>,
): {
  n: number;
  median: number | null;
  p75: number | null;
  p90: number | null;
  p99: number | null;
  max: number | null;
} {
  const d = pairs.map((x) => distanceMeters(x.a.lat, x.a.lon, x.b.lat, x.b.lon));
  return {
    n: d.length,
    median: percentile(d, 50),
    p75: percentile(d, 75),
    p90: percentile(d, 90),
    p99: percentile(d, 99),
    max: d.length === 0 ? null : d.reduce((m, x) => (x > m ? x : m), 0),
  };
}
