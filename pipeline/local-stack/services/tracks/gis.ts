// A-04 T043 / T044: the Loader `gis` track (contracts/seams.md LoaderTrack). The Loader is the
// only Query DB writer; this plug-in writes only through the transaction it is handed.
//
// - kind "import": re-reads the US-runner artifact offline (oracle-runtime travis/gis/import.ts),
//   refuses it when its digest changed since GisImport inspected it, and writes gis_pages,
//   gis_features (one point each), capture_receipts, the coords backbone_runs row and, when the
//   artifact has no complete.json, the limitation `gis: blocked at {ts}; coverage not complete`.
// - kind "assemble": reads parcels, parcel_geoids, gis_features (+ gis_pages) and the linked
//   property_improvements rows in the same transaction, ranks one coordinate per account
//   (travis/gis/assemble-coordinates.ts) and writes parcels.coordinate_* plus the
//   permit_far_from_gis flags. The assembly stats go into the watermark for the report.
// Idempotency is the Loader's: a repeated (gis, artifact_sha256) merge writes nothing.
import type postgres from "postgres";
import { z } from "zod";
import {
  assembleCoordinates,
  type AssemblyInput,
  type CoordinateRow,
  type PermitFlag,
} from "../../../oracle-runtime/travis/gis/assemble-coordinates.js";
import {
  readAddressLayerCache,
  type AddressLayerReceipt,
} from "../../../oracle-runtime/travis/gis/address-point-loader.js";
import {
  buildAddressPointSet,
  type AddressPointRecord,
} from "../../../oracle-runtime/travis/gis/address-points.js";
import {
  GIS_SOURCE_KEY,
  inspectArtifact,
  readFeatures,
  type GisFeatureRow,
} from "../../../oracle-runtime/travis/gis/import.js";
import { LoaderInputBase, type LoaderTrack, type MergeOutcome } from "../loader.js";

const JobId = z.string().regex(/^travis-a04-[a-z0-9-]+$/);
const ImportInput = LoaderInputBase.extend({ kind: z.literal("import"), artifactRunId: z.string().min(1) });
const AssembleInput = LoaderInputBase.extend({ kind: z.literal("assemble"), tcadJobId: JobId.nullable() });
// A-11 Run 3 (ADR 0004): kind "address_points" loads the City of Austin address-point cache
// (artifactPath = the cache directory, artifactSha256 = the layer file's sha256 from its receipt).
const AddressPointsInput = LoaderInputBase.extend({ kind: z.literal("address_points") });
export const GisTrackInput = z.discriminatedUnion("kind", [
  ImportInput,
  AssembleInput,
  AddressPointsInput,
]);
export type GisTrackInput = z.infer<typeof GisTrackInput>;

const BATCH = 4000;

export interface RunRow {
  job_id: string;
  track: "gis";
  mode: "coords";
  status: "complete" | "blocked";
  started_at: string | null;
  finished_at: string | null;
}
export interface ReceiptRow {
  job_id: string;
  source_key: string;
  url: string;
  http_status: number | null;
  bytes: number;
  sha256: string;
  captured_at: string;
  outcome: string;
  attempts: number;
  ua: string;
  page_key: string | null;
  blocked_at: string | null;
}
export interface PageRow {
  job_id: string;
  page_key: string;
  artifact_run_id: string;
  url: string;
  sha256: string;
  captured_at: string;
  feature_count: number;
}
export type FeatureRow = GisFeatureRow & { artifact_run_id: string; layer_last_edit_date: string | null };
export interface LimitationRow {
  job_id: string;
  source_key: string;
  code: string;
  text: string;
  count: number | null;
  evidence_url: string | null;
}

/** What the track reads and writes; the Postgres store is the real one, tests use memory. */
export interface GisStore {
  upsertRun(run: RunRow): Promise<void>;
  insertReceipts(rows: ReceiptRow[]): Promise<number>;
  upsertPages(rows: PageRow[]): Promise<number>;
  upsertFeatures(rows: FeatureRow[]): Promise<number>;
  addLimitation(row: LimitationRow): Promise<void>;
  readAssembly(tcadJobId: string | null): Promise<Omit<AssemblyInput, "jobId">>;
  /** Replace the address_points table (one capture at a time) and record which capture it is. */
  replaceAddressPoints(records: AddressPointRecord[], receipt: AddressLayerReceipt): Promise<number>;
  writeCoordinates(rows: CoordinateRow[]): Promise<number>;
  flagPermits(rows: PermitFlag[]): Promise<number>;
}

export async function mergeGis(store: GisStore, input: GisTrackInput): Promise<MergeOutcome> {
  if (input.kind === "assemble") {
    const read = await store.readAssembly(input.tcadJobId);
    const out = assembleCoordinates({ jobId: input.jobId, ...read });
    const written = (await store.writeCoordinates(out.rows)) + (await store.flagPermits(out.permitFlags));
    const at = new Date().toISOString();
    await store.upsertRun({ job_id: input.jobId, track: "gis", mode: "coords", status: "complete", started_at: at, finished_at: at });
    return {
      rowsWritten: written,
      watermark: {
        sourceKey: "coords_assembly",
        value: { job_id: input.jobId, tcad_job_id: input.tcadJobId, parcels: out.rows.length, stats: out.stats },
      },
    };
  }

  if (input.kind === "address_points") {
    const cache = readAddressLayerCache(input.artifactPath);
    if (cache.receipt.sha256 !== input.artifactSha256) {
      throw new Error("gis track: address-point cache sha256 differs from the one inspected");
    }
    const written = await store.replaceAddressPoints(cache.records, cache.receipt);
    return {
      rowsWritten: written,
      watermark: {
        sourceKey: "address_points",
        value: {
          layer_url: cache.receipt.layer_url,
          retrieved_at: cache.receipt.retrieved_at,
          record_count: cache.receipt.record_count,
          sha256: cache.receipt.sha256,
          layer_last_edit_date: cache.receipt.layer_last_edit_date,
        },
      },
    };
  }

  const s = inspectArtifact(input.artifactPath);
  if (s.artifactSha256 !== input.artifactSha256) {
    throw new Error(`gis track: artifact ${s.artifactRunId} sha256 changed since it was inspected`);
  }
  const counts = new Map<string, number>();
  const features: FeatureRow[] = [];
  let written = 0;
  const pageRows: PageRow[] = s.pages.map((p) => ({
    job_id: input.jobId,
    page_key: p.pageKey,
    artifact_run_id: s.artifactRunId,
    url: p.url,
    sha256: p.sha256,
    captured_at: p.capturedAt,
    feature_count: 0,
  }));
  for (const f of readFeatures(s)) {
    counts.set(f.page_key, (counts.get(f.page_key) ?? 0) + 1);
    features.push({ ...f, artifact_run_id: s.artifactRunId, layer_last_edit_date: s.layerLastEditDate });
  }
  for (const p of pageRows) p.feature_count = counts.get(p.page_key) ?? 0;
  written += await store.upsertPages(pageRows);
  for (let i = 0; i < features.length; i += BATCH) {
    written += await store.upsertFeatures(features.slice(i, i + BATCH));
  }
  written += await store.insertReceipts(
    s.receipts.map((r) => ({
      job_id: input.jobId,
      source_key: GIS_SOURCE_KEY,
      url: r.url,
      http_status: r.http_status,
      bytes: r.bytes,
      sha256: r.sha256,
      captured_at: r.captured_at,
      outcome: r.outcome,
      attempts: r.attempts,
      ua: r.ua,
      page_key: r.page_key,
      blocked_at: r.blocked_at ?? null,
    })),
  );
  if (s.limitation !== null) {
    await store.addLimitation({
      job_id: input.jobId,
      source_key: GIS_SOURCE_KEY,
      code: "gis_blocked",
      text: s.limitation,
      count: s.pages.length,
      evidence_url: s.layerUrl,
    });
  }
  await store.upsertRun({
    job_id: input.jobId,
    track: "gis",
    mode: "coords",
    status: s.status,
    started_at: s.complete?.started_at ?? null,
    finished_at: s.complete?.finished_at ?? s.blockedAt,
  });
  return {
    rowsWritten: written,
    watermark: {
      sourceKey: GIS_SOURCE_KEY,
      value: {
        job_id: input.jobId,
        artifact_run_id: s.artifactRunId,
        artifact_sha256: s.artifactSha256,
        status: s.status,
        detail: s.detail,
        pages: s.pages.length,
        features: features.length,
        source_count: s.sourceCount,
        snapshot_sha256: s.complete?.snapshot_sha256 ?? null,
        duration_s: s.complete?.duration_s ?? null,
        features_per_s: s.complete?.features_per_s ?? null,
        started_at: s.complete?.started_at ?? null,
        finished_at: s.complete?.finished_at ?? null,
        concurrency: s.complete?.concurrency ?? null,
        layer_last_edit_date: s.layerLastEditDate,
        blocked_at: s.blockedAt,
        // DP-5: where each page came from. The query URL never holds the (up to 2,000) ids; a
        // page is identified by the sha256 of its ids (the runner's page_key).
        provenance: {
          query_url: `${new URL(s.layerUrl).origin}${new URL(s.layerUrl).pathname}/query`,
          pages: s.pages.map((p) => ({
            object_ids_sha256: p.pageKey,
            url: p.url,
            sha256: p.sha256,
            captured_at: p.capturedAt,
            receipt_path: "receipts.jsonl",
            artifact_file: p.file,
            feature_count: counts.get(p.pageKey) ?? 0,
          })),
        },
      },
    },
  };
}

const ISO = (col: string): string => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/** The real store over the Loader's transaction. */
export function postgresGisStore(tx: postgres.TransactionSql): GisStore {
  const count = (r: { count: number }): number => r.count;
  return {
    async upsertRun(run) {
      await tx`
        INSERT INTO backbone_runs (job_id, track, mode, status, started_at, finished_at, as_of)
        VALUES (${run.job_id}, ${run.track}, ${run.mode}, ${run.status},
                coalesce(${run.started_at}::timestamptz, now()), ${run.finished_at}::timestamptz,
                coalesce(${run.finished_at}::timestamptz, now())::date)
        ON CONFLICT (job_id) DO UPDATE SET status = EXCLUDED.status, finished_at = EXCLUDED.finished_at, as_of = EXCLUDED.as_of`;
    },
    async insertReceipts(rows) {
      if (rows.length === 0) return 0;
      return count(await tx`INSERT INTO capture_receipts ${tx(rows)}`);
    },
    async upsertPages(rows) {
      if (rows.length === 0) return 0;
      return count(
        await tx`
          INSERT INTO gis_pages ${tx(rows)}
          ON CONFLICT (artifact_run_id, page_key) DO UPDATE SET
            job_id = EXCLUDED.job_id, url = EXCLUDED.url, sha256 = EXCLUDED.sha256,
            captured_at = EXCLUDED.captured_at, feature_count = EXCLUDED.feature_count`,
      );
    },
    async upsertFeatures(rows) {
      if (rows.length === 0) return 0;
      return count(
        await tx`
          INSERT INTO gis_features ${tx(rows)}
          ON CONFLICT (object_id) DO UPDATE SET
            artifact_run_id = EXCLUDED.artifact_run_id, page_key = EXCLUDED.page_key,
            pid_value = EXCLUDED.pid_value, geoid_value = EXCLUDED.geoid_value, area = EXCLUDED.area,
            point_lat = EXCLUDED.point_lat, point_lon = EXCLUDED.point_lon,
            point_method = EXCLUDED.point_method, null_geometry = EXCLUDED.null_geometry,
            layer_last_edit_date = EXCLUDED.layer_last_edit_date`,
      );
    },
    async addLimitation(row) {
      await tx`
        INSERT INTO source_limitations ${tx([row])}
        ON CONFLICT (job_id, source_key, code) DO UPDATE SET text = EXCLUDED.text, count = EXCLUDED.count`;
    },
    async readAssembly(tcadJobId) {
      const parcels = await tx.unsafe<AssemblyInput["parcels"][number][]>(
        `SELECT request_identifier, geo_id, prop_type, export_point_lat, export_point_lon, export_point_kind,
                source_url, ${ISO("captured_at")} AS captured_at, export_sha256,
                situs_address AS situs
         FROM parcels ${tcadJobId === null ? "" : "WHERE job_id = $1"}`,
        tcadJobId === null ? [] : [tcadJobId],
      );
      const geoids = await tx.unsafe<NonNullable<AssemblyInput["geoids"]>[number][]>(
        `SELECT g.geo_id, g.request_identifier, g.prop_type FROM parcel_geoids g
         ${tcadJobId === null ? "" : "JOIN parcels p ON p.request_identifier = g.request_identifier WHERE p.job_id = $1"}`,
        tcadJobId === null ? [] : [tcadJobId],
      );
      const features = await tx.unsafe<AssemblyInput["features"][number][]>(
        `SELECT f.object_id::float8 AS object_id, f.pid_value, f.geoid_value, f.area, f.point_lat, f.point_lon,
                f.point_method, f.null_geometry, p.url AS page_url, ${ISO("p.captured_at")} AS page_captured_at,
                p.sha256 AS page_sha256
         FROM gis_features f JOIN gis_pages p USING (artifact_run_id, page_key)`,
      );
      const [{ present } = { present: false }] = await tx<Array<{ present: boolean }>>`
        SELECT to_regclass('property_improvements') IS NOT NULL AS present`;
      const permits = present
        ? await tx.unsafe<AssemblyInput["permits"][number][]>(
            `SELECT permit_number, issuing_jurisdiction, request_identifier, latitude, longitude,
                    issue_date::text AS issue_date, source_url, ${ISO("captured_at")} AS captured_at, payload_sha256
             FROM property_improvements
             WHERE request_identifier IS NOT NULL AND NOT coalesce(tombstoned, false)`,
          )
        : [];
      // ADR 0004: the address-point rank runs only when 0202 is applied and a layer is loaded.
      const [{ loaded } = { loaded: false }] = await tx<Array<{ loaded: boolean }>>`
        SELECT to_regclass('address_point_layer') IS NOT NULL AS loaded`;
      if (!loaded) return { parcels, geoids, features, permits };
      const [layer] = await tx<
        Array<{ layer_url: string; retrieved_at: string; sha256: string }>
      >`SELECT layer_url,
               to_char(retrieved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS retrieved_at,
               sha256
        FROM address_point_layer`;
      if (layer === undefined) return { parcels, geoids, features, permits };
      const points = await tx<AddressPointRecord[]>`
        SELECT object_id::float8 AS object_id, place_id::float8 AS place_id, address::float8 AS address,
               full_street_name, address_fraction, address_suffix, address_type::float8 AS address_type,
               lat, lon
        FROM address_points`;
      return {
        parcels,
        geoids,
        features,
        permits,
        addressPoints: buildAddressPointSet(points, {
          layerUrl: layer.layer_url,
          retrievedAt: layer.retrieved_at,
          sha256: layer.sha256,
        }),
      };
    },
    async replaceAddressPoints(records, receipt) {
      await tx`DELETE FROM address_points`;
      let n = 0;
      for (let i = 0; i < records.length; i += BATCH) {
        const r = await tx`INSERT INTO address_points ${tx(records.slice(i, i + BATCH))}`;
        n += count(r);
      }
      await tx`DELETE FROM address_point_layer`;
      await tx`
        INSERT INTO address_point_layer (layer_url, retrieved_at, record_count, source_count, sha256, layer_last_edit_date)
        VALUES (${receipt.layer_url}, ${receipt.retrieved_at}::timestamptz, ${receipt.record_count},
                ${receipt.source_count}, ${receipt.sha256}, ${receipt.layer_last_edit_date}::timestamptz)`;
      return n;
    },
    async writeCoordinates(rows) {
      let n = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const r = await tx`
          UPDATE parcels AS p SET
            latitude = v.latitude, longitude = v.longitude, coordinate_source = v.coordinate_source,
            coordinate_rule = v.coordinate_rule, coordinate_reason = v.coordinate_reason,
            coordinate_review_flag = v.coordinate_review_flag, coordinate_source_url = v.coordinate_source_url,
            coordinate_captured_at = v.coordinate_captured_at, coordinate_sha256 = v.coordinate_sha256,
            coordinate_job_id = v.coordinate_job_id
          FROM jsonb_to_recordset(${tx.json(batch as unknown as postgres.JSONValue)}) AS v(
            request_identifier text, latitude double precision, longitude double precision,
            coordinate_source text, coordinate_rule text, coordinate_reason text,
            coordinate_review_flag text, coordinate_source_url text, coordinate_captured_at timestamptz,
            coordinate_sha256 text, coordinate_job_id text)
          WHERE p.request_identifier = v.request_identifier`;
        n += count(r);
      }
      return n;
    },
    async flagPermits(rows) {
      const [{ present } = { present: false }] = await tx<Array<{ present: boolean }>>`
        SELECT to_regclass('property_improvements') IS NOT NULL AS present`;
      if (!present) return 0;
      await tx`
        UPDATE property_improvements SET coordinate_review_flag = NULL
        WHERE coordinate_review_flag = 'permit_far_from_gis'`;
      if (rows.length === 0) return 0;
      const r = await tx`
        UPDATE property_improvements AS pi SET coordinate_review_flag = v.coordinate_review_flag
        FROM jsonb_to_recordset(${tx.json(rows as unknown as postgres.JSONValue)}) AS v(
          permit_number text, issuing_jurisdiction text, coordinate_review_flag text)
        WHERE pi.permit_number = v.permit_number AND pi.issuing_jurisdiction = v.issuing_jurisdiction`;
      return count(r);
    },
  };
}

export const track: LoaderTrack<GisTrackInput> = {
  name: "gis",
  input: GisTrackInput,
  merge: (tx, input) => mergeGis(postgresGisStore(tx), input),
};
