// A-04 T040 (FR-020, agent-design § 2 "Points"): one point per GIS parcel feature. Pure.
//
// - Area-weighted shoelace centroid over every ring, holes subtracted. A ring is a hole when
//   it lies inside an odd number of the other rings (orientation-free, so a source that does
//   not follow the ArcGIS clockwise-exterior rule is still read right).
// - Centroid inside the polygon (even-odd over all rings) → `centroid`.
// - Otherwise the pole of inaccessibility (polylabel, precision 1e-7°) of the largest outer
//   ring with its holes → `interior_point`; when none can be computed (zero-area sliver) the
//   centroid is kept as `centroid_outside_polygon`.
// - `geometry: null` or no ring → null (assembly reports `gis_null_geometry`).
// Planar maths in EPSG:4326 is fine at parcel scale. Every method publishes as `gis_centroid`
// (frozen contract/v1); the rule stays internal. Points are rounded to 1e-7° (geometryPrecision 7).
import { z } from "zod";

export const POINT_PRECISION_DEG = 1e-7;
const MAX_POLYLABEL_CELLS = 200_000;

export type PointMethod = "centroid" | "interior_point" | "centroid_outside_polygon";

/** [x = longitude, y = latitude] (extra z/m ordinates ignored). */
export type Position = readonly [number, number];
export type Ring = readonly Position[];

export interface FeaturePoint {
  lat: number;
  lon: number;
  method: PointMethod;
  /** Planar area in square degrees, holes subtracted (used only to compare features). */
  area: number;
}

const Coordinate = z.array(z.number().finite()).min(2);
const PolygonGeometry = z.object({ rings: z.array(z.array(Coordinate)) }).loose();

const round = (v: number): number => Math.round(v / POINT_PRECISION_DEG) * POINT_PRECISION_DEG;

function toRings(raw: readonly (readonly number[])[][]): Ring[] {
  return raw
    .map((r) => r.map((c) => [c[0] as number, c[1] as number] as const))
    .filter((r) => r.length >= 3);
}

/**
 * The rings shifted so the first vertex is the origin: shoelace sums over raw degrees
 * (x ≈ -97.7, y ≈ 30.3) lose the parcel-scale digits to cancellation.
 */
function localFrame(rings: readonly Ring[]): { rings: Ring[]; ox: number; oy: number } {
  const first = rings[0]?.[0];
  const ox = first?.[0] ?? 0;
  const oy = first?.[1] ?? 0;
  return { rings: rings.map((r) => r.map(([x, y]) => [x - ox, y - oy] as const)), ox, oy };
}

/** Signed shoelace area of a ring (positive counter-clockwise). */
function signedArea(ring: Ring): { area: number; cx: number; cy: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] as Position;
    const [xj, yj] = ring[j] as Position;
    const cross = xj * yi - xi * yj;
    a += cross;
    cx += (xj + xi) * cross;
    cy += (yj + yi) * cross;
  }
  a /= 2;
  return a === 0 ? { area: 0, cx: 0, cy: 0 } : { area: a, cx: cx / (6 * a), cy: cy / (6 * a) };
}

function inRing(p: Position, ring: Ring): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] as Position;
    const [xj, yj] = ring[j] as Position;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd point-in-polygon over every ring (holes and parts handled together). */
export function pointInPolygon(
  p: Position,
  rings: readonly (readonly (readonly number[])[])[],
): boolean {
  let inside = false;
  for (const ring of toRings(rings.map((r) => [...r]))) if (inRing(p, ring)) inside = !inside;
  return inside;
}

interface Classified {
  ring: Ring;
  hole: boolean;
  area: number;
  cx: number;
  cy: number;
}

function classify(rings: readonly Ring[]): Classified[] {
  return rings.map((ring, i) => {
    const first = ring[0] as Position;
    const depth = rings.filter((other, j) => j !== i && inRing(first, other)).length;
    const s = signedArea(ring);
    return { ring, hole: depth % 2 === 1, area: Math.abs(s.area), cx: s.cx, cy: s.cy };
  });
}

/** Planar area in square degrees, holes subtracted. */
export function polygonArea(rings: readonly (readonly (readonly number[])[])[]): number {
  return classify(localFrame(toRings(rings.map((r) => [...r]))).rings).reduce(
    (sum, r) => sum + (r.hole ? -r.area : r.area),
    0,
  );
}

function segmentDistSq(p: Position, a: Position, b: Position): number {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Signed distance from p to the polygon outline: positive inside, negative outside. */
function signedDistance(p: Position, rings: readonly Ring[]): number {
  let inside = false;
  let min = Infinity;
  for (const ring of rings) {
    if (inRing(p, ring)) inside = !inside;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      min = Math.min(min, segmentDistSq(p, ring[i] as Position, ring[j] as Position));
    }
  }
  return min === 0 ? 0 : (inside ? 1 : -1) * Math.sqrt(min);
}

interface Cell {
  x: number;
  y: number;
  h: number;
  d: number;
  max: number;
}

const cell = (x: number, y: number, h: number, rings: readonly Ring[]): Cell => {
  const d = signedDistance([x, y], rings);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
};

/** Max-heap on `max` (the best distance a cell could still hold). */
class CellQueue {
  private readonly items: Cell[] = [];
  get size(): number {
    return this.items.length;
  }
  push(c: Cell): void {
    const a = this.items;
    a.push(c);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((a[parent] as Cell).max >= c.max) break;
      a[i] = a[parent] as Cell;
      i = parent;
    }
    a[i] = c;
  }
  pop(): Cell | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last !== undefined) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let best = last.max;
        if (l < a.length && (a[l] as Cell).max > best) {
          m = l;
          best = (a[l] as Cell).max;
        }
        if (r < a.length && (a[r] as Cell).max > best) m = r;
        if (m === i) break;
        a[i] = a[m] as Cell;
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

/** Pole of inaccessibility of `outer` with its holes (Mapbox polylabel), or null. */
export function polylabel(
  outer: Ring,
  holes: readonly Ring[],
  precision = POINT_PRECISION_DEG,
): Position | null {
  const rings = [outer, ...holes];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of outer) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const size = Math.min(maxX - minX, maxY - minY);
  if (!(size > 0)) return null;
  const queue = new CellQueue();
  let h = size / 2;
  for (let x = minX; x < maxX; x += size) {
    for (let y = minY; y < maxY; y += size) queue.push(cell(x + h, y + h, h, rings));
  }
  const s = signedArea(outer);
  let best = cell(s.cx, s.cy, 0, rings);
  const boxCentre = cell(minX + (maxX - minX) / 2, minY + (maxY - minY) / 2, 0, rings);
  if (boxCentre.d > best.d) best = boxCentre;
  let visited = 0;
  while (queue.size > 0 && visited < MAX_POLYLABEL_CELLS) {
    const c = queue.pop() as Cell;
    visited += 1;
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    h = c.h / 2;
    queue.push(cell(c.x - h, c.y - h, h, rings));
    queue.push(cell(c.x + h, c.y - h, h, rings));
    queue.push(cell(c.x - h, c.y + h, h, rings));
    queue.push(cell(c.x + h, c.y + h, h, rings));
  }
  return best.d > 0 ? [best.x, best.y] : null;
}

/**
 * The point of one ArcGIS polygon geometry (`{rings}` in EPSG:4326), or null for a null or
 * empty geometry. Only the feature's own rings are used, never an address.
 */
export function featurePoint(geometry: unknown): FeaturePoint | null {
  if (geometry === null || geometry === undefined) return null;
  const parsed = PolygonGeometry.safeParse(geometry);
  if (!parsed.success) return null;
  const raw = toRings(parsed.data.rings);
  if (raw.length === 0) return null;
  const { rings, ox, oy } = localFrame(raw);
  const parts = classify(rings);
  let area = 0;
  let mx = 0;
  let my = 0;
  for (const r of parts) {
    const w = r.hole ? -r.area : r.area;
    area += w;
    mx += w * r.cx;
    my += w * r.cy;
  }
  let cx: number;
  let cy: number;
  if (area > 0) {
    cx = mx / area;
    cy = my / area;
  } else {
    // zero-area sliver: the vertex mean, only ever reported as centroid_outside_polygon
    const pts = rings.flat();
    cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  }
  const centroid: Position = [cx, cy];
  const done = (p: Position, method: PointMethod): FeaturePoint => ({
    lon: round(p[0] + ox),
    lat: round(p[1] + oy),
    method,
    area: Math.max(0, area),
  });
  if (area > 0 && rings.reduce((inside, r) => (inRing(centroid, r) ? !inside : inside), false)) {
    return done(centroid, "centroid");
  }
  const outers = parts.filter((r) => !r.hole).sort((a, b) => b.area - a.area);
  const largest = outers[0];
  if (largest !== undefined) {
    const holes = parts
      .filter((r) => r.hole && inRing(r.ring[0] as Position, largest.ring))
      .map((r) => r.ring);
    const pole = polylabel(largest.ring, holes);
    if (pole !== null) return done(pole, "interior_point");
  }
  return done(centroid, "centroid_outside_polygon");
}

export interface CandidateFeature {
  objectId: number;
  area: number;
  point: FeaturePoint | null;
}

export interface FeatureChoice<F extends CandidateFeature> {
  feature: F & { point: FeaturePoint };
  /** `largest_area` when several features carry the id, else the feature's point method. */
  rule: PointMethod | "largest_area";
  /** Other non-null features for the same id (counted, never used). */
  extra: number;
}

/**
 * Split parcels (FR-020): several features for one id → the largest area, tie → the lowest
 * OBJECTID; the others are counted. Null-geometry features are never chosen; null when none has
 * a point.
 */
export function chooseFeature<F extends CandidateFeature>(
  features: readonly F[],
): FeatureChoice<F> | null {
  const usable = features.filter((f): f is F & { point: FeaturePoint } => f.point !== null);
  usable.sort((a, b) => b.area - a.area || a.objectId - b.objectId);
  const chosen = usable[0];
  if (chosen === undefined) return null;
  return {
    feature: chosen,
    rule: usable.length > 1 ? "largest_area" : chosen.point.method,
    extra: usable.length - 1,
  };
}
