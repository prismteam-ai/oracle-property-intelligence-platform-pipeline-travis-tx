// A-04 T024: what an export point is (Stage 0 fact: every record prints a non-empty
// `geometry` string, against `with_geometry_point 380,461` in travis-sources.yaml:68).
// `parcels.export_point_kind` (data-model.md) classifies the TCAD `"[lat, lon]"` string; only
// `real` points rank 2 in the coordinate assembler (G-GIS):
//   placeholder    no point: null, empty, not "[<number>, <number>]", "[null, null]" (how the
//                  2026 protax JSON prints a missing point), or "[0, 0]"
//   outside_county a numeric point outside TRAVIS_BBOX (the gazetteer's Travis ZCTA
//                  centroids, padded by BBOX_PAD_DEG)
//   duplicate      a point printed on more than DUPLICATE_MIN_GEOIDS distinct geoIDs (accounts
//                  that share one geoID count once): a default point, not the parcel's own
//   real           anything else
// The counts by prop_type × kind come from geometry-census.ts (one local pass). Finding
// (2026-10-21, 493,246 records): the 61,500 R accounts A-01 counted "without_geometry_point"
// print the literal string "[null, null]" (112,784 accounts in all: R 61,500, P 39,535,
// MH 11,744, MN 5); R real = 380,461 = travis-sources.yaml:68; no duplicate, no outside_county.
import zctas from "../../../../packages/query-core/gazetteer/travis-places@1.0.0/zctas.json" with { type: "json" };

export type ExportPointKind = "real" | "placeholder" | "duplicate" | "outside_county";
export const EXPORT_POINT_KINDS: readonly ExportPointKind[] = [
  "real",
  "placeholder",
  "duplicate",
  "outside_county",
];

/** Degrees added on every side of the ZCTA-centroid box (edge parcels lie past a centroid). */
export const BBOX_PAD_DEG = 0.1;

/**
 * More distinct geoIDs than this at one exact point makes the point `duplicate`. The census of
 * the 2026-07-19 export (pipeline/data/runs/geometry-census.json, 2026-10-21) found 380,422
 * distinct points for 380,462 numeric points and no point on more than 2 geoIDs, so 5 flags
 * any default point used 6+ times while every real shared point stays `real`.
 */
export const DUPLICATE_MIN_GEOIDS = 5;

export const EXPORT_POINT_RULE =
  `export_point_kind v1: placeholder = null | empty | non-numeric | "[null, null]" | [0, 0]; ` +
  `outside_county = outside the travis-places@1.0.0 ZCTA-centroid box padded ${BBOX_PAD_DEG} deg; ` +
  `duplicate = same exact point on more than ${DUPLICATE_MIN_GEOIDS} distinct geoIDs; else real`;

interface Box {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

function zctaBox(rows: ReadonlyArray<{ lat: number; lon: number }>): Box {
  const lats = rows.map((r) => r.lat);
  const lons = rows.map((r) => r.lon);
  return {
    minLat: Math.min(...lats) - BBOX_PAD_DEG,
    maxLat: Math.max(...lats) + BBOX_PAD_DEG,
    minLon: Math.min(...lons) - BBOX_PAD_DEG,
    maxLon: Math.max(...lons) + BBOX_PAD_DEG,
  };
}

export const TRAVIS_BBOX: Readonly<Box> = Object.freeze(zctaBox(zctas));

const POINT = /^\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]\s*$/;

/** The numeric `[lat, lon]` point, or null for a placeholder. */
export function parseExportPoint(
  geometry: string | null | undefined,
): { lat: number; lon: number } | null {
  if (typeof geometry !== "string") return null;
  const m = POINT.exec(geometry);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat === 0 && lon === 0) return null;
  return { lat, lon };
}

/** The exact printed point as a map key (numbers as parsed, so spacing does not matter). */
export const pointKey = (p: { lat: number; lon: number }): string => `${p.lat},${p.lon}`;

export function insideTravisBox(p: { lat: number; lon: number }, box: Box = TRAVIS_BBOX): boolean {
  return p.lat >= box.minLat && p.lat <= box.maxLat && p.lon >= box.minLon && p.lon <= box.maxLon;
}

export interface ExportPointOptions {
  /** Distinct geoIDs printed with this exact point across the export (census index). */
  geoIdsAtPoint?: (key: string) => number;
  duplicateThreshold?: number;
}

export function exportPointKind(
  geometry: string | null | undefined,
  options: ExportPointOptions = {},
): ExportPointKind {
  const p = parseExportPoint(geometry);
  if (p === null) return "placeholder";
  if (!insideTravisBox(p)) return "outside_county";
  const n = options.geoIdsAtPoint?.(pointKey(p)) ?? 0;
  if (n > (options.duplicateThreshold ?? DUPLICATE_MIN_GEOIDS)) return "duplicate";
  return "real";
}
