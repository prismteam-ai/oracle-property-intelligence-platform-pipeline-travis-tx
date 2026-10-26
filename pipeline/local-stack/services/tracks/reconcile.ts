// A-07 T056 (Track D): the Loader `reconcile` track (migration 0405_reconcile_merge.sql).
// Merges the property/owner/contractor entities per data-model.md's "Reconciled
// property/owner/contractor record". The Loader is the only writer: this module writes only
// through the transaction it is handed (query-db-loading-matching "single writer").
//
// Property/owner: every `roll_reconciliation` row classified 'loaded' (one row per source
// capture of a TCAD id, across all ingest jobs so far) is clustered strictly by TCAD id
// (travis/reconcile/merge.ts's only key, P0-5) into one canonical record per entity per id.
// Contractor: a cluster only ever forms over `contractor_resolution_current` rows whose state
// is 'resolved' (T057, Track A's resolver, Wave 4); until that ledger has resolved rows, the
// correctly empty result here is 0 contractor merges, not a defect (Phase 6 checkpoint).
//
// Idempotency: the CLI command mints a content-independent `artifactSha256` per entity type
// (this is a full-table reconciliation sweep, not an artifact-scoped load), so the Loader's
// generic (track, artifactSha256) check means this track's body runs at most once per entity
// type ever; a second `reconcile:merge` for the same entity type is skipped before `merge()` is
// even called and reports `rowsWritten: 0` — the same "immediate re-run writes 0" shape the
// roof-age estimator's re-run requires (FR-017/SC-005), for the same reason (nothing new to do).
import type postgres from "postgres";
import { z } from "zod";
import {
  mergeEntityClusters,
  type EntityType,
  type MergeCluster,
} from "../../../oracle-runtime/travis/reconcile/merge.js";
import type { LoaderTrack, MergeOutcome } from "../loader.js";

const JobId = z.string().regex(/^travis-a07-[a-z0-9-]+$/);
const Sha = z.string().regex(/^[a-f0-9]{64}$/);

export const MergeInput = z.object({
  kind: z.literal("merge"),
  jobId: JobId,
  artifactPath: z.string().min(1),
  artifactSha256: Sha,
  entityType: z.enum(["property", "owner", "contractor"]),
});
export type ReconcileMergeInput = z.infer<typeof MergeInput>;

interface LoadedRow {
  job_id: string;
  record_ordinal: string;
  request_identifier: string;
}

/** Builds one cluster per TCAD id from every 'loaded' capture row that cites it. */
export function clustersFromLoadedRows(rows: readonly LoadedRow[]): MergeCluster[] {
  const byTcadId = new Map<string, MergeCluster>();
  for (const row of rows) {
    const record = { recordId: `${row.job_id}:${row.record_ordinal}`, tcadId: row.request_identifier };
    const existing = byTcadId.get(row.request_identifier);
    if (existing === undefined) {
      byTcadId.set(row.request_identifier, { clusterId: row.request_identifier, records: [record] });
    } else {
      existing.records.push(record);
    }
  }
  return [...byTcadId.values()];
}

const BATCH = 5_000;

async function writeMergeRows(
  tx: postgres.TransactionSql,
  jobId: string,
  entityType: EntityType,
  merges: ReturnType<typeof mergeEntityClusters>["merges"],
): Promise<void> {
  for (let i = 0; i < merges.length; i += BATCH) {
    const batch = merges.slice(i, i + BATCH).map((m) => ({
      job_id: jobId,
      entity_type: entityType,
      tcad_id: m.tcadId,
      input_records: m.inputRecords,
      canonical_id: m.canonicalId,
    }));
    await tx`
      INSERT INTO reconcile_merges ${tx(batch, "job_id", "entity_type", "tcad_id", "input_records", "canonical_id")}
      ON CONFLICT (job_id, entity_type, tcad_id) DO NOTHING`;
  }
}

async function writeRefusalRows(
  tx: postgres.TransactionSql,
  jobId: string,
  entityType: EntityType,
  refused: ReturnType<typeof mergeEntityClusters>["refused"],
): Promise<void> {
  for (const r of refused) {
    await tx`
      INSERT INTO reconcile_merge_refusals (job_id, entity_type, cluster_id, tcad_ids, reason)
      VALUES (${jobId}, ${entityType}, ${r.clusterId}, ${tx.array(r.tcadIds)}, ${r.reason})
      ON CONFLICT (job_id, entity_type, cluster_id) DO NOTHING`;
  }
}

async function clustersFor(
  tx: postgres.TransactionSql,
  entityType: EntityType,
): Promise<MergeCluster[]> {
  if (entityType === "contractor") {
    // T057 (Wave 4, Track A dependency T020) builds the resolved-contractor -> TCAD id
    // clustering; this track never re-derives it. Until then there is no cluster source to
    // read, so 0 contractor merges is the correct, expected output (Phase 6 checkpoint), not a
    // defect to paper over with a guessed join.
    return [];
  }
  const rows = await tx<LoadedRow[]>`
    SELECT job_id, record_ordinal::text, request_identifier
    FROM roll_reconciliation
    WHERE class = 'loaded' AND request_identifier IS NOT NULL`;
  return clustersFromLoadedRows(rows);
}

async function merge(tx: postgres.TransactionSql, input: ReconcileMergeInput): Promise<MergeOutcome> {
  const clusters = await clustersFor(tx, input.entityType);
  const result = mergeEntityClusters(input.entityType, clusters);
  await writeMergeRows(tx, input.jobId, input.entityType, result.merges);
  await writeRefusalRows(tx, input.jobId, input.entityType, result.refused);
  return { rowsWritten: result.merges.length };
}

export const track: LoaderTrack<ReconcileMergeInput> = {
  name: "reconcile",
  input: MergeInput as unknown as z.ZodType<ReconcileMergeInput>,
  merge,
};
