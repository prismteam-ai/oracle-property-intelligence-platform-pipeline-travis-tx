// A-04 T024: read-only geometry census over the TCAD export already on disk (one local stream,
// no network). Counts accounts by prop_type × export_point_kind, the point-multiplicity
// histogram the `duplicate` threshold is read from, the placeholder spellings, and the record
// key inventory (key names only). Writes pipeline/data/runs/geometry-census.json. Never reads
// or prints an owner field: only propType, geoID, stateCd and geometry are taken from a record.
//   npx tsx travis/tcad/geometry-census.ts [--zip <path>] [--out <path>]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { streamExportRecords } from "./export-stream.js";
import { createKeyInventory } from "./key-inventory.js";
import {
  DUPLICATE_MIN_GEOIDS,
  EXPORT_POINT_KINDS,
  EXPORT_POINT_RULE,
  TRAVIS_BBOX,
  exportPointKind,
  insideTravisBox,
  parseExportPoint,
  pointKey,
  type ExportPointKind,
} from "./export-point.js";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
export const DEFAULT_ZIP = join(
  REPO,
  "pipeline/data/raw/tcad/2026_20Certified_20JSON_20SUPP_200_2007182026.zip",
);
export const DEFAULT_OUT = join(REPO, "pipeline/data/runs/geometry-census.json");

/** Thresholds reported side by side so the chosen N is visible against its neighbours. */
export const CANDIDATE_THRESHOLDS = [5, 10, 25, 50, 100, 250] as const;
const BUCKETS: ReadonlyArray<[string, number, number]> = [
  ["1", 1, 1],
  ["2", 2, 2],
  ["3-5", 3, 5],
  ["6-10", 6, 10],
  ["11-25", 11, 25],
  ["26-50", 26, 50],
  ["51-100", 51, 100],
  ["101-250", 101, 250],
  ["251+", 251, Number.POSITIVE_INFINITY],
];

interface Row {
  propType: string;
  stateCd: string;
  key: string | null;
  boxKind: "placeholder" | "outside_county" | null;
}

export interface CensusRecordFields {
  propType?: unknown;
  geometry?: unknown;
  propertyIdentification?: unknown;
  propertyProfile?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const first = (v: unknown): Record<string, unknown> =>
  Array.isArray(v) && typeof v[0] === "object" && v[0] !== null
    ? (v[0] as Record<string, unknown>)
    : {};

export interface GeometryCensus {
  generated_at: string;
  zip: string;
  records: number;
  rule: string;
  duplicate_min_geoids: number;
  travis_bbox: typeof TRAVIS_BBOX;
  by_prop_type: Record<string, Record<ExportPointKind, number>>;
  by_prop_type_at_threshold: Record<string, Record<string, Record<ExportPointKind, number>>>;
  placeholder_spellings: Record<string, number>;
  multiplicity: { distinct_points: number; accounts_by_geoids_at_point: Record<string, number> };
  duplicate_by_state_cd: Record<string, number>;
  /** R accounts whose geometry is a numeric in-box point (the A-01 `with_geometry_point` reading). */
  r_numeric_in_box: number;
  key_inventory: Record<string, number>;
  key_inventory_sha256: string;
  /** Every nested key path (arrays as []), names only: how often it occurs. */
  key_paths: Record<string, number>;
  /** Top values of code-like keys (…Type, …Cd, …Code) under improvements and the profile. */
  code_values: Record<string, Record<string, number>>;
}

/** Paths whose code-like values are tallied (codes, never names or addresses). */
const CODE_PATH =
  /^(valuations\[\]\.details\.[^.]+\.improvements\[\]|propertyProfile\[\])\.[A-Za-z]*(Type|Cd|Code|Class)$/;
const MAX_DEPTH = 7;

/** Counts key paths (names only) and code-like values of one parsed record. */
export function walkPaths(
  value: unknown,
  paths: Map<string, number>,
  codes: Map<string, Map<string, number>>,
  path = "",
  depth = 0,
): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const v of value) walkPaths(v, paths, codes, `${path}[]`, depth + 1);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = path === "" ? k : `${path}.${k}`;
    paths.set(p, (paths.get(p) ?? 0) + 1);
    if (CODE_PATH.test(p) && (typeof v === "string" || typeof v === "number")) {
      const text = String(v).slice(0, 40);
      const m = codes.get(p) ?? new Map<string, number>();
      m.set(text, (m.get(text) ?? 0) + 1);
      codes.set(p, m);
    }
    walkPaths(v, paths, codes, p, depth + 1);
  }
}

export function summarize(
  rows: readonly Row[],
  placeholder: Map<string, number>,
  geoIds: Map<string, Set<string>>,
): Omit<
  GeometryCensus,
  "generated_at" | "zip" | "key_inventory" | "key_inventory_sha256" | "key_paths" | "code_values"
> {
  const empty = (): Record<ExportPointKind, number> =>
    Object.fromEntries(EXPORT_POINT_KINDS.map((k) => [k, 0])) as Record<ExportPointKind, number>;
  const kindAt = (row: Row, n: number): ExportPointKind => {
    if (row.boxKind !== null) return row.boxKind;
    return (geoIds.get(row.key as string)?.size ?? 0) > n ? "duplicate" : "real";
  };
  const byType: Record<string, Record<ExportPointKind, number>> = {};
  const atThreshold: Record<string, Record<string, Record<ExportPointKind, number>>> = {};
  const dupState: Record<string, number> = {};
  const buckets: Record<string, number> = Object.fromEntries(BUCKETS.map(([b]) => [b, 0]));
  let rNumeric = 0;
  for (const row of rows) {
    const t = (byType[row.propType] ??= empty());
    const kind = kindAt(row, DUPLICATE_MIN_GEOIDS);
    t[kind] += 1;
    if (kind === "duplicate")
      dupState[row.stateCd || "(empty)"] = (dupState[row.stateCd || "(empty)"] ?? 0) + 1;
    for (const n of CANDIDATE_THRESHOLDS) {
      const per = (atThreshold[String(n)] ??= {});
      (per[row.propType] ??= empty())[kindAt(row, n)] += 1;
    }
    if (row.key !== null) {
      const size = geoIds.get(row.key)?.size ?? 0;
      const bucket = BUCKETS.find(([, lo, hi]) => size >= lo && size <= hi);
      if (bucket) buckets[bucket[0]] = (buckets[bucket[0]] ?? 0) + 1;
      if (row.propType === "R") rNumeric += 1;
    }
  }
  return {
    records: rows.length,
    rule: EXPORT_POINT_RULE,
    duplicate_min_geoids: DUPLICATE_MIN_GEOIDS,
    travis_bbox: TRAVIS_BBOX,
    by_prop_type: byType,
    by_prop_type_at_threshold: atThreshold,
    placeholder_spellings: Object.fromEntries(
      [...placeholder.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    ),
    multiplicity: { distinct_points: geoIds.size, accounts_by_geoids_at_point: buckets },
    duplicate_by_state_cd: Object.fromEntries(Object.entries(dupState).sort((a, b) => b[1] - a[1])),
    r_numeric_in_box: rNumeric,
  };
}

/** One pass over the export; `fields` takes only the four non-owner fields from a record. */
export async function runCensus(
  zip: string,
  now: () => Date = () => new Date(),
): Promise<GeometryCensus> {
  const inventory = createKeyInventory();
  const rows: Row[] = [];
  const geoIds = new Map<string, Set<string>>();
  const placeholder = new Map<string, number>();
  const paths = new Map<string, number>();
  const codes = new Map<string, Map<string, number>>();
  for await (const rec of streamExportRecords(zip)) {
    const parsed = JSON.parse(rec.text) as Record<string, unknown>;
    inventory.add(parsed);
    walkPaths(parsed, paths, codes);
    const f = parsed as CensusRecordFields;
    const geometry = typeof f.geometry === "string" ? f.geometry : null;
    const geoId = str(first(f.propertyIdentification).geoID);
    const row: Row = {
      propType: str(f.propType),
      stateCd: str(first(f.propertyProfile).stateCd).trim(),
      key: null,
      boxKind: null,
    };
    const p = parseExportPoint(geometry);
    if (p === null) {
      row.boxKind = "placeholder";
      const spelling =
        geometry === null ? "(null)" : geometry.length > 40 ? "(long string)" : geometry;
      placeholder.set(spelling, (placeholder.get(spelling) ?? 0) + 1);
    } else if (!insideTravisBox(p) || exportPointKind(geometry) === "outside_county") {
      row.boxKind = "outside_county";
    } else {
      row.key = pointKey(p);
      const set = geoIds.get(row.key) ?? new Set<string>();
      set.add(geoId === "" ? `(no geoID ${rec.ordinal})` : geoId);
      geoIds.set(row.key, set);
    }
    rows.push(row);
  }
  return {
    generated_at: now().toISOString(),
    zip: zip.replace(REPO, ""),
    ...summarize(rows, placeholder, geoIds),
    key_inventory: inventory.counts(),
    key_inventory_sha256: inventory.sha256(),
    key_paths: Object.fromEntries([...paths.entries()].sort(([a], [b]) => a.localeCompare(b))),
    code_values: Object.fromEntries(
      [...codes.entries()].map(([p, m]) => [
        p,
        Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)),
      ]),
    ),
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const out = arg("--out") ?? DEFAULT_OUT;
  const census = await runCensus(arg("--zip") ?? DEFAULT_ZIP);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(census, null, 2)}\n`);
  process.stdout.write(`geometry_census records=${census.records} out=${out.replace(REPO, "")}\n`);
}
