// A-04 T025: the Loader `tcad` track (contracts/seams.md LoaderTrack). The Loader is the only
// Query DB writer; this track writes only through the transaction it is handed.
//   chunk       a TcadChunk artifact (runs/<jobId>/chunks/c<N>.ndjson.gz: mapped, redacted rows)
//               → parcels (upsert), parcel_geoids + property_structures (children of written
//               parcels), roll_reconciliation (one row per export record of the job), watermark
//   finalize    export points on more than N distinct geoIDs → export_point_kind = duplicate
//   run         backbone_runs status (running / waiting_human / complete / failed)
//   receipt     one capture_receipts row (e.g. a blocked TCAD download)
//   limitations source_limitations rows (the D-7 texts)
// Upsert: ON CONFLICT (request_identifier) DO UPDATE … WHERE (record_sha256, job_id) IS DISTINCT
// FROM excluded: a re-load of the same chunk writes 0 rows; a later job re-stamps job_id (its
// derived as_of fields change). Only payload_redacted + record_sha256 are stored, never the
// original record (oracle disagreement #11).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { z } from "zod";
import { readChunkFile } from "../../../oracle-runtime/travis/tcad/process.js";
import { LoaderInputBase, MergeDataError, type LoaderTrack, type MergeOutcome } from "../loader.js";

export const WATERMARK_SOURCE_KEY = "tcad-certified";

/** parcels columns (data-model.md § 0101) with the cast each VALUES parameter gets. */
const PARCEL_TYPES = {
  request_identifier: "text",
  job_id: "text",
  geo_id: "text",
  prop_type: "text",
  state_cd: "text",
  property_type: "text",
  property_usage_type: "text",
  property_type_missing_reason: "text",
  property_type_rule: "text",
  property_type_note: "text",
  property_type_rules_version: "text",
  situs_address: "jsonb",
  owner_name: "text",
  owner_kind: "text",
  owner_missing_reason: "text",
  owner_redacted: "boolean",
  owner_redaction_rule: "text",
  owner_mailing_postal_code: "text",
  owner_mailing_country: "text",
  owner_area_class: "text",
  owner_is_out_of_area: "boolean",
  owner_area_evidence: "text",
  area_list_sha256: "text",
  property_structure_built_year: "int",
  year_built_rule: "text",
  year_built_missing_reason: "text",
  roof_age_basis: "text",
  roof_age_reason: "text",
  last_ownership_transfer_date: "date",
  tenure_years: "numeric",
  tenure_basis: "text",
  tenure_missing_reason: "text",
  is_long_tenure: "boolean",
  export_point_lat: "double precision",
  export_point_lon: "double precision",
  export_point_kind: "text",
  county_emit: "boolean",
  source_url: "text",
  captured_at: "timestamptz",
  export_sha256: "text",
  record_ordinal: "bigint",
  record_sha256: "text",
  payload_redacted: "jsonb",
} as const;
export const PARCEL_COLUMNS = Object.keys(PARCEL_TYPES) as Array<keyof typeof PARCEL_TYPES>;

const GEOID_TYPES = { geo_id: "text", request_identifier: "text", prop_type: "text" } as const;
const STRUCTURE_TYPES = {
  request_identifier: "text",
  ordinal: "int",
  imprv_type: "text",
  is_main_residential: "boolean",
  living_area: "numeric",
  actual_year_built: "int",
  effective_year_built: "int",
} as const;
const RECON_TYPES = {
  job_id: "text",
  record_ordinal: "bigint",
  request_identifier: "text",
  geo_id: "text",
  class: "text",
  detail: "text",
} as const;

const Status = z.enum(["running", "waiting_human", "blocked", "complete", "failed"]);
const Op = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chunk") }),
  z.object({
    kind: z.literal("finalize"),
    duplicateMinGeoids: z.number().int().positive(),
    /** SHA-256 of the run's observed key inventory (report roll.key_inventory_sha256). */
    keyInventorySha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  z.object({
    kind: z.literal("run"),
    track: z.literal("appraisal"),
    mode: z.enum(["pilot", "full"]),
    status: Status,
    as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    export_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    gazetteer_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    code_sha: z.string().optional(),
  }),
  z.object({
    kind: z.literal("receipt"),
    receipt: z.object({
      source_key: z.string(),
      url: z.string(),
      http_status: z.number().int().nullable(),
      bytes: z.number().int().nullable(),
      sha256: z.string().nullable(),
      captured_at: z.string(),
      outcome: z.enum(["ok", "blocked", "error", "skipped_checkpoint"]),
      attempts: z.number().int(),
      ua: z.string(),
      blocked_at: z.string().nullable(),
    }),
  }),
  z.object({
    kind: z.literal("limitations"),
    items: z.array(
      z.object({
        source_key: z.string(),
        code: z.string(),
        text: z.string(),
        count: z.number().int().nullable(),
        evidence_url: z.string().nullable(),
      }),
    ),
  }),
]);

export const TcadTrackInput = LoaderInputBase.extend({ op: Op });
export type TcadTrackInput = z.infer<typeof TcadTrackInput>;

type Row = Record<string, unknown>;

/** Multi-row INSERT text with one cast per parameter. */
function insertSql(
  table: string,
  types: Readonly<Record<string, string>>,
  rows: readonly Row[],
  tail: string,
): { text: string; params: unknown[] } {
  const cols = Object.keys(types);
  const params: unknown[] = [];
  const tuples = rows.map((row) => {
    const cells = cols.map((c) => {
      const v = row[c];
      params.push(v === undefined ? null : types[c] === "jsonb" && v !== null ? JSON.stringify(v) : v);
      // jsonb: bind JSON text as text and cast server-side. Binding a JSON string to a parameter
      // the server types as jsonb makes the driver encode it again (a jsonb string, not an object).
      return `$${params.length}::${types[c] === "jsonb" ? "text::jsonb" : types[c]}`;
    });
    return `(${cells.join(", ")})`;
  });
  return { text: `INSERT INTO ${table} (${cols.join(", ")}) VALUES ${tuples.join(", ")} ${tail}`, params };
}

function batches<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const run = (tx: postgres.TransactionSql, q: { text: string; params: unknown[] }) =>
  tx.unsafe(q.text, q.params as postgres.ParameterOrJSON<never>[]);

const PARCEL_UPSERT =
  "ON CONFLICT (request_identifier) DO UPDATE SET " +
  PARCEL_COLUMNS.filter((c) => c !== "request_identifier")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ") +
  " WHERE (parcels.record_sha256, parcels.job_id) IS DISTINCT FROM (excluded.record_sha256, excluded.job_id)" +
  " RETURNING request_identifier";

const WatermarkValue = z.object({
  prefix: z.string(),
  mergedCount: z.number().int(),
  lastMergedAt: z.string(),
  hashIndex: z.array(z.object({ path: z.string(), sha256: z.string() })),
});

async function mergeChunk(tx: postgres.TransactionSql, input: TcadTrackInput): Promise<MergeOutcome> {
  const bytes = readFileSync(input.artifactPath);
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== input.artifactSha256) {
    throw new MergeDataError(`tcad track: chunk sha256 ${sha} is not the input artifactSha256`);
  }
  const chunk = readChunkFile(input.artifactPath);
  const written = new Set<string>();
  for (const part of batches(chunk.rows, 1000)) {
    const rows = part.map((r) => r.parcel as unknown as Row);
    const out = (await run(tx, insertSql("parcels", PARCEL_TYPES, rows, PARCEL_UPSERT))) as unknown as Array<{
      request_identifier: string;
    }>;
    for (const r of out) written.add(r.request_identifier);
  }
  if (written.size > 0) {
    const ids = [...written].join(",");
    await tx.unsafe("DELETE FROM parcel_geoids WHERE request_identifier = ANY(string_to_array($1, ','))", [ids]);
    await tx.unsafe("DELETE FROM property_structures WHERE request_identifier = ANY(string_to_array($1, ','))", [ids]);
    const changed = chunk.rows.filter((r) => written.has(r.parcel.request_identifier));
    const geoids = changed.flatMap((r) => r.geoids as unknown as Row[]);
    const structures = changed.flatMap((r) => r.structures as unknown as Row[]);
    for (const part of batches(geoids, 5000)) {
      await run(tx, insertSql("parcel_geoids", GEOID_TYPES, part, "ON CONFLICT DO NOTHING"));
    }
    for (const part of batches(structures, 5000)) {
      await run(tx, insertSql("property_structures", STRUCTURE_TYPES, part, "ON CONFLICT DO NOTHING"));
    }
  }
  for (const part of batches(chunk.reconciliation as unknown as Row[], 5000)) {
    await run(tx, insertSql("roll_reconciliation", RECON_TYPES, part, "ON CONFLICT (job_id, record_ordinal) DO NOTHING RETURNING 1"));
  }
  const prior = (await tx.unsafe("SELECT value, job_id FROM watermarks WHERE track = 'tcad' AND source_key = $1", [
    WATERMARK_SOURCE_KEY,
  ])) as unknown as Array<{ value: unknown; job_id: string }>;
  const last = prior[0];
  const before = last !== undefined && last.job_id === input.jobId ? WatermarkValue.safeParse(last.value) : null;
  const previous = before?.success ? before.data : null;
  const seen = previous?.hashIndex.some((h) => h.sha256 === input.artifactSha256) ?? false;
  const loaded = chunk.reconciliation.filter((r) => r.class === "loaded").length;
  return {
    rowsWritten: written.size,
    watermark: {
      sourceKey: WATERMARK_SOURCE_KEY,
      value: {
        prefix: `runs/${input.jobId}/chunks/`,
        mergedCount: (previous?.mergedCount ?? 0) + (seen ? 0 : loaded),
        lastMergedAt: new Date().toISOString(),
        hashIndex: [
          ...(previous?.hashIndex ?? []),
          ...(seen ? [] : [{ path: input.artifactPath.replace(/^.*\/runs\//, "runs/"), sha256: input.artifactSha256 }]),
        ],
      },
    },
  };
}

async function mergeOp(tx: postgres.TransactionSql, input: TcadTrackInput): Promise<MergeOutcome> {
  const op = input.op;
  switch (op.kind) {
    case "chunk":
      return mergeChunk(tx, input);
    case "finalize": {
      const out = await tx.unsafe(
        `UPDATE parcels p SET export_point_kind = 'duplicate'
         FROM (SELECT export_point_lat, export_point_lon FROM parcels
               WHERE job_id = $1 AND export_point_kind = 'real'
               GROUP BY 1, 2 HAVING count(DISTINCT geo_id) > $2) d
         WHERE p.job_id = $1 AND p.export_point_kind = 'real'
           AND p.export_point_lat = d.export_point_lat AND p.export_point_lon = d.export_point_lon
         RETURNING 1`,
        [input.jobId, op.duplicateMinGeoids],
      );
      await tx.unsafe(
        `UPDATE watermarks SET value = value || jsonb_build_object('keyInventorySha256', $2::text)
         WHERE track = 'tcad' AND source_key = $1`,
        [WATERMARK_SOURCE_KEY, op.keyInventorySha256],
      );
      return { rowsWritten: out.length };
    }
    case "run": {
      await tx.unsafe(
        `INSERT INTO backbone_runs (job_id, track, mode, status, as_of, export_sha256, gazetteer_sha256, code_sha, finished_at)
         VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, CASE WHEN $4 IN ('complete', 'failed') THEN now() END)
         ON CONFLICT (job_id) DO UPDATE SET status = excluded.status,
           as_of = COALESCE(excluded.as_of, backbone_runs.as_of),
           export_sha256 = COALESCE(excluded.export_sha256, backbone_runs.export_sha256),
           gazetteer_sha256 = COALESCE(excluded.gazetteer_sha256, backbone_runs.gazetteer_sha256),
           code_sha = COALESCE(excluded.code_sha, backbone_runs.code_sha),
           finished_at = excluded.finished_at`,
        [
          input.jobId,
          op.track,
          op.mode,
          op.status,
          op.as_of ?? null,
          op.export_sha256 ?? null,
          op.gazetteer_sha256 ?? null,
          op.code_sha ?? null,
        ],
      );
      return { rowsWritten: 1 };
    }
    case "receipt": {
      const r = op.receipt;
      await tx.unsafe(
        `INSERT INTO capture_receipts (job_id, source_key, url, http_status, bytes, sha256, captured_at, outcome, attempts, ua, blocked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, $11::timestamptz)`,
        [input.jobId, r.source_key, r.url, r.http_status, r.bytes, r.sha256, r.captured_at, r.outcome, r.attempts, r.ua, r.blocked_at],
      );
      return { rowsWritten: 1 };
    }
    case "limitations": {
      for (const l of op.items) {
        await tx.unsafe(
          `INSERT INTO source_limitations (job_id, source_key, code, text, count, evidence_url)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (job_id, source_key, code) DO UPDATE SET text = excluded.text, count = excluded.count,
             evidence_url = excluded.evidence_url`,
          [input.jobId, l.source_key, l.code, l.text, l.count, l.evidence_url],
        );
      }
      return { rowsWritten: op.items.length };
    }
  }
}

export const track: LoaderTrack<TcadTrackInput> = {
  name: "tcad",
  input: TcadTrackInput,
  merge: mergeOp,
};
