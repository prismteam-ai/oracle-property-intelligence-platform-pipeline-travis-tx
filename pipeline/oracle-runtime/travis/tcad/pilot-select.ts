// A-04 T027 (FR-001, D-4): the 25-parcel pilot seed, chosen in one local pass over the export
// already on disk (no network). Rows, each with its reason:
//   primary_anchor     geoID 0223120506 (→ pID 221829)
//   second_anchor      the first Austin roofing-permit tcad_id from the given list (permit_number order,
//                      T062) that resolves to exactly one R geoID; none → the selection stops
//   one account per case: prop_type P / MH / MN, a coded-confidential account, the second R
//                      account on a shared geoID, several improvements, no dated sale, no year
//                      built, an out-of-area, a regional and a foreign mailing address
//   fill_r_export_point R accounts with a real export point, in export order, up to 25
// Records go through the same parse → redact → map steps as the run, so a confidential owner
// is never read; the seed carries the county-seed-data columns + `reason`, never an owner field.
// geoID 0208011301 is not on the roll (D-4 negative) and is never a seed row.
import { buildSeedRow, pilotSeedCsv, type SeedRow } from "../pilot/build-seed.js";
import { parseTcadRecord } from "../transforms/shared-seed.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExportRecordText } from "./export-stream.js";
import { createKeyInventory } from "./key-inventory.js";
import { processRecord, type LoadedRecord } from "./process.js";

export const PILOT_SIZE = 25;
export const PRIMARY_ANCHOR_GEOID = "0223120506";
export const NEGATIVE_ANCHOR_GEOID = "0208011301";

export const PILOT_REASONS = [
  "primary_anchor",
  "second_anchor",
  "prop_type_P",
  "prop_type_MH",
  "prop_type_MN",
  "coded_confidential",
  "shared_geoid",
  "several_improvements",
  "no_dated_sale",
  "no_year_built",
  "owner_out_of_area",
  "owner_regional",
  "owner_foreign_mailing",
] as const;
export type PilotReason = (typeof PILOT_REASONS)[number] | "fill_r_export_point";

/** Case checks in priority order (a record fills the first open case it matches). */
const CASES: ReadonlyArray<[PilotReason, (l: LoadedRecord, sharedGeo: boolean) => boolean]> = [
  ["prop_type_P", (l) => l.parcel.prop_type === "P"],
  ["prop_type_MH", (l) => l.parcel.prop_type === "MH"],
  ["prop_type_MN", (l) => l.parcel.prop_type === "MN"],
  ["coded_confidential", (l) => l.parcel.owner_redacted],
  ["shared_geoid", (l, shared) => l.parcel.prop_type === "R" && shared],
  ["several_improvements", (l) => l.parcel.prop_type === "R" && l.structures.length >= 2],
  ["no_dated_sale", (l) => l.parcel.prop_type === "R" && l.parcel.tenure_basis === "unknown"],
  ["no_year_built", (l) => l.parcel.prop_type === "R" && l.parcel.year_built_rule === "none"],
  ["owner_out_of_area", (l) => l.parcel.owner_area_evidence === "us_zcta_outside"],
  ["owner_regional", (l) => l.parcel.owner_area_evidence === "regional_zcta"],
  ["owner_foreign_mailing", (l) => l.parcel.owner_area_evidence === "foreign_mailing"],
];

export interface PilotRow {
  pID: string;
  geo_id: string | null;
  prop_type: string;
  reason: PilotReason;
  seed: SeedRow;
}

export interface PilotSelection {
  rows: PilotRow[];
  anchor2: { geo_id: string; pID: string } | null;
}

export interface SelectOptions {
  /** Austin roofing-permit tcad_ids (TCAD geoIDs), in permit_number order. */
  anchorCandidates: readonly string[];
  asOf: string;
  size?: number;
}

function rowOf(l: LoadedRecord, reason: PilotReason): PilotRow {
  const record = parseTcadRecord(l.record);
  return {
    pID: l.parcel.request_identifier,
    geo_id: l.parcel.geo_id,
    prop_type: l.parcel.prop_type,
    reason,
    seed: buildSeedRow(record, l.parcel.geo_id ?? ""),
  };
}

export async function selectPilot(
  records: AsyncIterable<ExportRecordText>,
  options: SelectOptions,
): Promise<PilotSelection> {
  const size = options.size ?? PILOT_SIZE;
  const candidates = new Set(options.anchorCandidates);
  const ctx = {
    jobId: "travis-a04-pilot-select",
    asOf: options.asOf,
    exportSha256: "0".repeat(64),
    capturedAt: "1970-01-01T00:00:00.000Z",
  };
  const inventory = createKeyInventory();
  const rGeo = new Map<string, number>();
  const candidateRows = new Map<string, LoadedRecord[]>();
  let primary: PilotRow | null = null;
  const cases = new Map<PilotReason, PilotRow>();
  const fill: PilotRow[] = [];
  for await (const rec of records) {
    const out = processRecord(rec, ctx, inventory);
    const l = out.loaded;
    if (l === undefined) continue;
    const geo = l.parcel.geo_id;
    const isR = l.parcel.prop_type === "R";
    const priorR = geo !== null && isR ? (rGeo.get(geo) ?? 0) : 0;
    if (geo !== null && isR) rGeo.set(geo, priorR + 1);
    if (geo !== null && candidates.has(geo)) {
      if (isR) candidateRows.set(geo, [...(candidateRows.get(geo) ?? []), l]);
      continue;
    }
    if (geo === PRIMARY_ANCHOR_GEOID && isR && primary === null) {
      primary = rowOf(l, "primary_anchor");
      continue;
    }
    if (geo === NEGATIVE_ANCHOR_GEOID) continue;
    const open = CASES.find(([reason, test]) => !cases.has(reason) && test(l, priorR > 0));
    if (open !== undefined) {
      cases.set(open[0], rowOf(l, open[0]));
      continue;
    }
    if (
      isR &&
      l.parcel.export_point_kind === "real" &&
      !l.parcel.owner_redacted &&
      fill.length < size
    ) {
      fill.push(rowOf(l, "fill_r_export_point"));
    }
  }
  if (primary === null)
    throw new Error(
      `pilot: primary anchor geoID ${PRIMARY_ANCHOR_GEOID} is not an R account in the export`,
    );
  const anchorGeo = options.anchorCandidates.find(
    (g) => (candidateRows.get(g)?.length ?? 0) === 1 && (rGeo.get(g) ?? 0) === 1,
  );
  const anchorRecord = anchorGeo === undefined ? undefined : candidateRows.get(anchorGeo)?.[0];
  if (anchorGeo === undefined || anchorRecord === undefined) {
    throw new Error(
      "pilot: no second anchor: no listed Austin tcad_id resolves to exactly one R geoID",
    );
  }
  const missing = CASES.map(([r]) => r).filter((r) => !cases.has(r));
  if (missing.length > 0)
    throw new Error(`pilot: no account in the export for case(s) ${missing.join(", ")}`);
  const anchor = rowOf(anchorRecord, "second_anchor");
  const rows = [primary, anchor, ...CASES.map(([r]) => cases.get(r) as PilotRow)];
  for (const f of fill) {
    if (rows.length >= size) break;
    rows.push(f);
  }
  if (rows.length < size)
    throw new Error(`pilot: only ${rows.length} accounts selected, ${size} needed`);
  return { rows, anchor2: { geo_id: anchorGeo, pID: anchor.pID } };
}

/** Writes pipeline/data/seeds/travis-a04-pilot.csv (seed columns + reason). */
export function writePilotSeed(path: string, rows: readonly PilotRow[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, pilotSeedCsv(rows.map((r) => ({ ...r.seed, reason: r.reason }))));
}
