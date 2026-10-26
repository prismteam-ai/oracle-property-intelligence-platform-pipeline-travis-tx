// A-11 T031 (Stage 5 S5.2): the Property Improvement data group rebuilt from the Query DB's
// already-reconciled permit rows (0301_permits.sql `property_improvements` joined to
// `permit_source_rows`, plus the owning parcel's `parcels.payload_redacted`), never from a new
// Austin/Socrata or TCAD request. Mirrors travis/tcad/write-group.ts's split (pure plan + file
// writer; the Query DB read is injected, never imported here -- oracle-runtime has no database
// dependency, same boundary the Query DB skill enforces) and reuses the real capture-time
// transform unmodified: transformAustinPropertyImprovement (travis/transforms/
// austin-property-improvement.ts) is the one function that turns a permit into Property
// Improvement files, so this module's only job is reshaping the stored DB rows into that
// function's existing input shape (AustinRow + AustinPermitReceipt, TcadRecord, SeedRow), never
// inventing a new one.
//
// Contractor identity: AC-7 (A-07) resolves 0 of 22,084 permits carrying the profile's trade
// verdict in scope for that resolution pass (`resolved=0`); AD-06
// writes a `property_improvement_has_contractor` edge only for a `resolved` match, so
// `contractorIdentity` is left at the transform's default (no registry wired) and no contractor,
// person, or license is written here -- consistent with the rest of this pass: contractor
// coverage is a run-summary rollup, never a record field (specs/011-publish-and-runs/run-log.md).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExportPointKind } from "../tcad/export-point.js";
import { sharedFilesInputOf } from "../tcad/write-group.js";
import type { DataGroupCids } from "../transforms/lexicon-manifest.js";
import type { SeedRow, TcadRecord } from "../transforms/shared-seed.js";
import {
  AUSTIN_DATASET_URL,
  transformAustinPropertyImprovement,
  type AustinPermitCapture,
  type AustinRow,
  type ProfileApi,
  type PropertyImprovementCounts,
} from "../transforms/austin-property-improvement.js";

/**
 * One `parcels` row (0101_tcad.sql) as the Query DB holds it: enough to rebuild the TcadRecord
 * and the seed row, the same two inputs the County group builds from (shared-seed.ts). The
 * record is `payload_redacted`, byte-identical to the redacted record the County group reads
 * (D-7): no owner or mailing field reaches this group for a confidential account either.
 */
export interface ParcelDbRow {
  request_identifier: string;
  geo_id: string | null;
  payload_redacted: unknown;
  /** The recorded year-built rule's year (0101_tcad.sql), the County group's `yearBuilt`. */
  property_structure_built_year: number | null;
  export_point_lat: number | null;
  export_point_lon: number | null;
  export_point_kind: ExportPointKind | null;
  /** The assembled coordinate (0201_gis.sql); the County group overrides geometry from it. */
  latitude: number | null;
  longitude: number | null;
  coordinate_source: "gis_centroid" | "address_point" | "permit_point" | "none" | null;
  /** parcels.coordinate_source_url: the address-point record URL (ADR 0004), else unused. */
  coordinate_source_url?: string | null;
}

/**
 * One `property_improvements` row (0301_permits.sql) joined to its `permit_source_rows.payload`
 * (the captured Austin 3syk-w9eu row, unmodified) -- the exact two things
 * `transformAustinPropertyImprovement` needs per permit: the row the profile classifies, and the
 * receipt fields `classifyCapture` checks (method, multiValueQueryString). A tombstoned row is
 * never read into this shape (the DB reader excludes it; see property-improvement-backbone.ts).
 */
export interface PermitDbRow {
  request_identifier: string;
  permit_number: string;
  payload: AustinRow;
  content_sha256: string;
  captured_at: string;
}

export interface PropertyImprovementGroupInput {
  parcel: ParcelDbRow;
  permits: readonly PermitDbRow[];
}

/** The per-permit GET receipt, rebuilt from the stored raw payload (never re-requested). */
export function captureOf(row: PermitDbRow): AustinPermitCapture {
  if (row.payload.permit_number !== row.permit_number) {
    throw new Error(
      `write-group: permit ${row.permit_number} payload prints permit_number ${row.payload.permit_number}`,
    );
  }
  return {
    row: row.payload,
    receipt: {
      url: AUSTIN_DATASET_URL,
      method: "GET",
      multiValueQueryString: { permit_number: [row.permit_number] },
      status: null,
      sha256: row.content_sha256,
      captured_at: row.captured_at,
    },
  };
}

/**
 * The TcadRecord + SeedRow + yearBuilt the County group builds its shared files from,
 * reconstructed from the DB row through the County group's own builder (tcad/write-group.ts
 * `sharedFilesInputOf`): same geometry override (the assembled coordinate), same parse, same
 * seed row, same year built. The County writer passes the assembled coordinate whenever
 * coordinates are assembled, so it is passed here whenever the parcel's coordinate_source is set.
 */
export function recordAndSeedOf(parcel: ParcelDbRow): {
  record: TcadRecord;
  seed: SeedRow;
  yearBuilt: number | null;
} {
  const stored: unknown = parcel.payload_redacted;
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    throw new Error(
      `write-group: parcel ${parcel.request_identifier} payload_redacted is not an object`,
    );
  }
  // A copy stored before slimPayload kept these two would silently give another property.json.
  if (!("propertyLegalDescription" in stored) || !("valuations" in stored)) {
    throw new Error(
      `write-group: parcel ${parcel.request_identifier} payload_redacted lacks propertyLegalDescription/valuations (stored before the shared-files fix): run scripts/backfill-payload-redacted.ts`,
    );
  }
  const { record, seed, yearBuilt } = sharedFilesInputOf({
    record: stored as Record<string, unknown>,
    geoId: parcel.geo_id,
    yearBuilt: parcel.property_structure_built_year,
    exportPoint:
      parcel.export_point_lat === null ||
      parcel.export_point_lon === null ||
      parcel.export_point_kind === null
        ? null
        : {
            lat: parcel.export_point_lat,
            lon: parcel.export_point_lon,
            kind: parcel.export_point_kind,
          },
    // A11-10(c): the County writer passes the coordinate only when coordinates are assembled
    // (tcad-backbone.ts `assembled`); unassembled, a real export point stands in. Here a parcel
    // is assembled once coordinate_source is set ("none" included: assembled, nothing usable).
    ...(parcel.coordinate_source === null
      ? {}
      : {
          coordinate: {
            latitude: parcel.latitude,
            longitude: parcel.longitude,
            source: parcel.coordinate_source,
            sourceUrl: parcel.coordinate_source_url ?? null,
          },
        }),
  });
  const pID = String(record.pID);
  if (pID !== parcel.request_identifier) {
    throw new Error(
      `write-group: parcel ${parcel.request_identifier} payload_redacted prints pID ${pID}`,
    );
  }
  return { record, seed, yearBuilt };
}

export interface PlannedPropertyImprovementGroup {
  pID: string;
  /** `<pID>/data` (shared-seed.ts): identical layout to the County group's directory. */
  dir: string;
  files: Record<string, string>;
  counts: PropertyImprovementCounts;
}

export interface PropertyImprovementGroupPlan {
  groups: PlannedPropertyImprovementGroup[];
  /**
   * Reconciled parcels whose permits all skip emission (status_exclude, needs_review, or
   * a profile trade sub-permit verdict -- SkipReason) and are therefore left out of the group, same semantics
   * as the County group's `out_of_scope` list (write-group.ts): a non-emitted pID still has its
   * permits in the internal ledger, never a public file.
   */
  empty: string[];
}

/**
 * Property Improvement group files for every input: each parcel's stored permits reshaped into
 * `transformAustinPropertyImprovement`'s real input and run through it unmodified. `profile` is
 * the same `travis-austin@1.0.0` module every other caller of the transform injects
 * (travis/pilot/profile-api.ts's `profileApi()`); this module never classifies a permit itself.
 */
export function planPropertyImprovementGroup(
  inputs: readonly PropertyImprovementGroupInput[],
  cids: DataGroupCids,
  profile: ProfileApi,
): PropertyImprovementGroupPlan {
  const groups: PlannedPropertyImprovementGroup[] = [];
  const empty: string[] = [];
  for (const input of inputs) {
    const { record, seed, yearBuilt } = recordAndSeedOf(input.parcel);
    const permits = [...input.permits]
      .sort((a, b) => a.permit_number.localeCompare(b.permit_number))
      .map(captureOf);
    const out = transformAustinPropertyImprovement({
      record,
      seed,
      cids,
      permits,
      profile,
      yearBuilt,
    });
    if (out.counts.emitted === 0) {
      empty.push(out.pID);
      continue;
    }
    groups.push({ pID: out.pID, dir: out.dir, files: out.files, counts: out.counts });
  }
  return { groups, empty };
}

/**
 * Writes every group's files as plain files under `<dir>/<pID>/data/<file>` (the layout
 * `elephant-cli validate`/`hash` read directly, and the same layout travis/pilot/run-pilot.ts
 * writes for both groups -- never a per-pID zip: travis/tcad/write-group.ts's `writeCountyZips`
 * is a separate, `--write-group`-only regeneration format this exporter does not use). Returns
 * every file path written.
 */
export function writePropertyImprovementGroupFiles(
  dir: string,
  groups: readonly PlannedPropertyImprovementGroup[],
): string[] {
  const written: string[] = [];
  for (const g of groups) {
    for (const [name, text] of Object.entries(g.files)) {
      const path = join(dir, g.dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      written.push(path);
    }
  }
  return written;
}
