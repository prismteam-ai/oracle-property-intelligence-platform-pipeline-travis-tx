// SYNTHETIC TEST INPUT (A-04 T040): hand-made ArcGIS polygon geometries in EPSG:4326, placed
// near Austin so they look like parcels. None of them is a real Travis County feature.
// ArcGIS rings are [x = longitude, y = latitude]; exterior rings clockwise, holes counter-clockwise.

/** A grid unit of 0.0001° (~10 m) from an origin inside Travis County. */
const LON0 = -97.75;
const LAT0 = 30.25;
const U = 0.0001;

/** Grid coordinates → [lon, lat]. */
export const at = (x: number, y: number): [number, number] => [LON0 + x * U, LAT0 + y * U];
export const toGrid = (lon: number, lat: number): [number, number] => [
  (lon - LON0) / U,
  (lat - LAT0) / U,
];

const ring = (...pts: Array<[number, number]>): number[][] => {
  const r = pts.map(([x, y]) => at(x, y));
  const first = r[0];
  if (first !== undefined) r.push([...first]);
  return r;
};

/** Convex square 0..10: its centroid (5, 5) is inside. */
export const SQUARE = { rings: [ring([0, 0], [0, 10], [10, 10], [10, 0])] };

/** L-shape: arms 1 wide; the area centroid (≈2.6, 2.6) lies outside the polygon. */
export const L_SHAPE = {
  rings: [ring([0, 0], [0, 10], [1, 10], [1, 1], [10, 1], [10, 0])],
};

/** U-shape: 3×3 with a 1×2 notch from the top; the centroid (1.5, ≈1.36) lies in the notch. */
export const U_SHAPE = {
  rings: [ring([0, 0], [0, 3], [1, 3], [1, 1], [2, 1], [2, 3], [3, 3], [3, 0])],
};

/** Square 0..10 with a centred 2×2 hole: the centroid (5, 5) falls in the hole. */
export const SQUARE_CENTRED_HOLE = {
  rings: [ring([0, 0], [0, 10], [10, 10], [10, 0]), ring([4, 4], [6, 4], [6, 6], [4, 6])],
};

/** Square 0..10 with an off-centre 2×2 hole at x 6..8, y 4..6: centroid (472/96, 5), inside. */
export const SQUARE_OFFSET_HOLE = {
  rings: [ring([0, 0], [0, 10], [10, 10], [10, 0]), ring([6, 4], [8, 4], [8, 6], [6, 6])],
};

/** Two parts: 2×2 at the origin and 1×1 at x 10..11; the joint centroid (2.9, ≈0.9) is outside both. */
export const MULTIPART = {
  rings: [ring([0, 0], [0, 2], [2, 2], [2, 0]), ring([10, 0], [10, 1], [11, 1], [11, 0])],
};

/** Zero-area sliver (all points on one line): no interior point can be computed. */
export const DEGENERATE = { rings: [ring([0, 0], [5, 0], [10, 0])] };

/** Squares of a given side at a given grid offset (split-parcel cases). */
export const squareAt = (x: number, y: number, side: number) => ({
  rings: [ring([x, y], [x, y + side], [x + side, y + side], [x + side, y])],
});
