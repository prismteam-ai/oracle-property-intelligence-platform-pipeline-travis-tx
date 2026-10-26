// A-04 T027: the County data group for the coverage SQL (D-5, local only, never uploaded).
// R accounts only (P / MH / MN are listed `out_of_scope`, not emitted); one `<pID>.zip` per
// property (elephant-cli `validate` / `hash` take a directory of .zip children,
// utils/batch-input.js), each holding `data/<file>` from transformTcadCounty.
// Geometry (oracle disagreements #2, #7; plan CT-8): written only when the assembled
// `coordinate_source = gis_centroid` (GIS feature, export point or condo building point);
// a permit point is never written as geometry (it would read `gis_centroid` publicly). A
// City of Austin address point (`coordinate_source = address_point`, ADR 0004) is written with its
// own provenance URL on geometry.json, so the public source reads address_point. Before
// the coordinates are assembled (pilot), the `real` TCAD export point stands in, rule
// `unassembled_pilot_export_point`. Every input record is the redacted one (redact.ts): a
// confidential owner never reaches a zip.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { buildSeedRow } from "../pilot/build-seed.js";
import type { DataGroupCids } from "../transforms/lexicon-manifest.js";
import { parseTcadRecord, type SeedRow, type TcadRecord } from "../transforms/shared-seed.js";
import { transformTcadCounty, type RoofAgeEntry } from "../transforms/tcad-county.js";
import type { PropType } from "./account-class.js";
import type { ExportPointKind } from "./export-point.js";

export interface GroupInput {
  pID: string;
  geoId: string | null;
  propType: PropType;
  /** The redacted export record. */
  record: Record<string, unknown>;
  yearBuilt: number | null;
  /**
   * The property's roof-age ledger row (roofAgeEntryOf), or null/absent when the ledger has
   * none (the transform then warns no_roof_age_ledger_row and writes roof_date null).
   */
  roofAge?: RoofAgeEntry | null;
  exportPoint: { lat: number; lon: number; kind: ExportPointKind } | null;
  /** The assembled coordinate (parcels.coordinate_*), absent before `coords`. */
  coordinate?: {
    latitude: number | null;
    longitude: number | null;
    source: "gis_centroid" | "address_point" | "permit_point" | "none";
    /** parcels.coordinate_source_url; required (provenance) when source is address_point. */
    sourceUrl?: string | null;
  };
}

/** One row of the Query DB roof_age_estimates table (written by the roof-age run). */
export interface RoofAgeEstimateRow {
  tcad_id: string;
  roof_age_basis: "permit" | "new_construction" | "built_year" | "unknown";
  /** Whole years; null iff basis is unknown. */
  roof_age_years: number | string | null;
  /** The estimate's as-of date, YYYY-MM-DD. */
  as_of_date: string;
}

/**
 * The transform's ledger entry for one estimate. Only a built_year basis is a TCAD-sourced
 * value: its roof_date is the built year as "YYYY" (as-of year minus the estimated age, the
 * same year the estimator anchored on). A permit, new-construction or unknown basis yields no
 * TCAD date: a permit date comes from the permit join, never from a TCAD request (oracle F1).
 */
export function roofAgeEntryOf(row: RoofAgeEstimateRow): RoofAgeEntry {
  if (row.roof_age_basis !== "built_year" || row.roof_age_years === null) {
    return { pID: row.tcad_id, roof_date: null, anchor: null };
  }
  const year = Number(row.as_of_date.slice(0, 4)) - Number(row.roof_age_years);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new Error(`roof-age estimate for ${row.tcad_id} gives built year ${year}`);
  }
  return { pID: row.tcad_id, roof_date: String(year), anchor: "property_built_year" };
}

export type GeometryRule =
  "gis_centroid" | "address_point" | "unassembled_pilot_export_point" | "none";

export interface CountyGroup {
  pID: string;
  /** Directory of the property inside the group (`<pID>/data`). */
  dir: string;
  files: Record<string, string>;
  geometry_rule: GeometryRule;
  /** Mailing addresses written in the `unnormalized_address` form (tcad-county.ts). */
  mailing_address_fallback: number;
  /** Owner entries by outcome (tcad-county.ts counts), summed into the writeGroup tally. */
  owners: OwnerTally;
}

/** What the owner reader did with one property's owners[] (A-11, ERR-69). */
export interface OwnerTally {
  persons: number;
  companies: number;
  unparsed: number;
  co_owner_skipped: number;
}

export interface GroupPlan {
  groups: CountyGroup[];
  out_of_scope: Array<{ pID: string; prop_type: PropType }>;
}

const PID = /^[1-9][0-9]*$/;

/**
 * `--pids` value: a comma / whitespace separated list of pIDs, or the path of a file holding
 * one. Duplicates are dropped; a value that is not a pID is an error (nothing is guessed).
 */
export function parsePidList(
  value: string,
  readFile: (path: string) => string | null = (path) =>
    existsSync(path) ? readFileSync(path, "utf8") : null,
): string[] {
  const text = readFile(value) ?? value;
  const pids = [...new Set(text.split(/[\s,]+/).filter((t) => t !== ""))];
  const bad = pids.find((t) => !PID.test(t));
  if (bad !== undefined) throw new Error(`--pids: "${bad}" is not a pID`);
  if (pids.length === 0) throw new Error("--pids: no pIDs given");
  return pids;
}

function geometryFor(input: Pick<GroupInput, "exportPoint" | "coordinate">): {
  point: { lat: number; lon: number } | null;
  rule: GeometryRule;
  /** The GET to stamp on geometry.json when the point is not from the TCAD export. */
  sourceUrl: string | null;
} {
  const c = input.coordinate;
  if (c !== undefined) {
    if (c.source === "gis_centroid" && c.latitude !== null && c.longitude !== null) {
      return {
        point: { lat: c.latitude, lon: c.longitude },
        rule: "gis_centroid",
        sourceUrl: null,
      };
    }
    // ADR 0004: an exact, unique City of Austin address point is publishable, and only with its
    // own provenance URL (the public coordinate_source must not read as the TCAD export).
    if (c.source === "address_point" && c.latitude !== null && c.longitude !== null) {
      if (!c.sourceUrl) throw new Error("address_point coordinate has no source URL (provenance)");
      return {
        point: { lat: c.latitude, lon: c.longitude },
        rule: "address_point",
        sourceUrl: c.sourceUrl,
      };
    }
    return { point: null, rule: "none", sourceUrl: null };
  }
  if (input.exportPoint !== null && input.exportPoint.kind === "real") {
    return {
      point: { lat: input.exportPoint.lat, lon: input.exportPoint.lon },
      rule: "unassembled_pilot_export_point",
      sourceUrl: null,
    };
  }
  return { point: null, rule: "none", sourceUrl: null };
}

/** What the shared-file inputs are built from: a GroupInput without its group bookkeeping. */
export type SharedSource = Pick<
  GroupInput,
  "record" | "geoId" | "yearBuilt" | "exportPoint" | "coordinate"
>;

export interface SharedFilesSource {
  /** The record with `geometry` replaced by the chosen point (geometryFor). */
  record: TcadRecord;
  seed: SeedRow;
  yearBuilt: number | null;
  geometry_rule: GeometryRule;
  /** Set only for rule address_point: stamped on geometry.json (ADR 0004). */
  geometry_source_url: string | null;
}

/**
 * The one way to turn a stored/streamed TCAD record into buildSharedFiles' inputs (geometry
 * override → parse → seed row → year built). The County group (planCountyGroup) and the
 * Property Improvement group (permits/write-group.ts) both call it, so address.json,
 * parcel.json, the seed root and property.json come out byte-identical and `hash` derives the
 * same property CID in both archives.
 */
export function sharedFilesInputOf(input: SharedSource): SharedFilesSource {
  const { point, rule, sourceUrl } = geometryFor(input);
  const raw = {
    ...input.record,
    geometry: point === null ? null : `[${point.lat}, ${point.lon}]`,
  };
  const record = parseTcadRecord(raw);
  const seed = buildSeedRow(record, input.geoId ?? "");
  return {
    record,
    seed,
    yearBuilt: input.yearBuilt,
    geometry_rule: rule,
    geometry_source_url: sourceUrl,
  };
}

/** County files for every R input; non-R inputs are listed out_of_scope. */
export function planCountyGroup(
  inputs: readonly GroupInput[],
  cids: DataGroupCids,
  /** The run's as_of date: no transfer dated after it is written (ERR-71). */
  asOf?: string,
): GroupPlan {
  const groups: CountyGroup[] = [];
  const out: GroupPlan["out_of_scope"] = [];
  for (const input of inputs) {
    if (input.propType !== "R") {
      out.push({ pID: input.pID, prop_type: input.propType });
      continue;
    }
    const {
      record,
      seed,
      yearBuilt,
      geometry_rule: rule,
      geometry_source_url: geometrySourceUrl,
    } = sharedFilesInputOf(input);
    const t = transformTcadCounty({
      record,
      seed,
      cids,
      geometrySourceUrl,
      roofAge: input.roofAge ?? null,
      yearBuilt,
      ...(asOf !== undefined ? { asOf } : {}),
    });
    groups.push({
      pID: t.pID,
      dir: t.dir,
      files: t.files,
      geometry_rule: rule,
      mailing_address_fallback: t.counts.mailing_address_fallback,
      owners: {
        persons: t.counts.persons_written,
        companies: t.counts.companies_written,
        unparsed: t.counts.owners_unparsed,
        co_owner_skipped: t.counts.owners_co_owner_skipped,
      },
    });
  }
  return { groups, out_of_scope: out };
}

// ---------- coverage report (build-county-transform: every mapped field extracted) ----------

/** Export fields the County transform maps, and where each lands in the group files. */
export const COUNTY_FIELD_MAP: Readonly<
  Record<string, { source: string; present: (files: Record<string, string>) => boolean }>
> = {
  owner_name: {
    source: "owners[].name / firstName / lastName",
    present: (f) => Object.keys(f).some((n) => /^(person|company)_\d+\.json$/.test(n)),
  },
  mailing_address: {
    source: "owners[].addrCity / addrState / addrZip / addrCountry",
    present: (f) => Object.keys(f).some((n) => /^mailing_address_\d+\.json$/.test(n)),
  },
  situs: {
    source: "situses[] (primarySitus)",
    present: (f) => /"unnormalized_address": "/.test(f["address.json"] ?? ""),
  },
  year_built: {
    source: "propertyProfile[0].imprvActualYearBuilt, else the largest main improvement",
    present: (f) => /"property_structure_built_year": \d{4}/.test(f["property.json"] ?? ""),
  },
  improvements: {
    source: 'valuations[].details["cost-local"].improvements[]',
    present: (f) => "structure.json" in f,
  },
  sale_date: {
    source: "sales[].saleDt and transfer deeds[].deedDt",
    present: (f) => Object.keys(f).some((n) => /^sales_history_\d+\.json$/.test(n)),
  },
  geometry: {
    source: 'geometry "[lat, lon]" (or the assembled GIS point)',
    present: (f) => "geometry.json" in f,
  },
};

export const REQUIRED_COUNTY_FIELDS = [
  "owner_name",
  "mailing_address",
  "situs",
  "year_built",
  "improvements",
  "sale_date",
  "geometry",
] as const;

export interface CoverageRow {
  field: string;
  source: string;
  extracted: boolean;
  properties: number;
}

export function coverageReport(
  groups: readonly CountyGroup[],
  map: typeof COUNTY_FIELD_MAP = COUNTY_FIELD_MAP,
): CoverageRow[] {
  return REQUIRED_COUNTY_FIELDS.map((field) => {
    const entry = map[field];
    if (entry === undefined) {
      throw new Error(`coverage: mapped export field ${field} is missing from the field map`);
    }
    const properties = groups.filter((g) => entry.present(g.files)).length;
    return { field, source: entry.source, extracted: properties > 0, properties };
  });
}

/** Throws naming the first mapped field no property carries. */
export function assertCoverage(rows: readonly CoverageRow[]): void {
  const missing = rows.filter((r) => !r.extracted).map((r) => r.field);
  if (missing.length > 0)
    throw new Error(`coverage: mapped field not extracted: ${missing.join(", ")}`);
}

// ---------- one stored ZIP per property ----------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A deflated ZIP (no ZIP64; one property is far below 4 GiB) with fixed timestamps. */
export function zipFiles(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const names = Object.keys(files).sort();
  for (const n of names) {
    const name = Buffer.from(n, "utf8");
    const data = Buffer.from(files[n] as string, "utf8");
    const payload = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12); // 1980-01-01: byte-stable archives
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, payload);
    centrals.push(central, name);
    offset += 30 + name.length + payload.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Writes `<dir>/<pID>.zip` (entries `data/<file>`) for every group; returns the paths. */
export function writeCountyZips(dir: string, groups: readonly CountyGroup[]): string[] {
  mkdirSync(dir, { recursive: true });
  return groups.map((g) => {
    const files = Object.fromEntries(
      Object.entries(g.files).map(([n, body]) => [`data/${n}`, body]),
    );
    const path = join(dir, `${g.pID}.zip`);
    writeFileSync(path, zipFiles(files));
    return path;
  });
}
