// A-07 T056 (Track D): `ReconcileReport`, the read-only summary of `reconcile_merges` /
// `reconcile_merge_refusals` (migration 0405). Read-only: the Loader is the only writer; this
// never opens a transaction. Not scoped by the calling job's own jobId — the `reconcile` Loader
// track's merge body for one entity type runs at most once ever (a content-independent,
// per-entity-type idempotency digest, see services/tracks/reconcile.ts), so there is exactly one
// job_id's rows per entity type in the tables at any time; reading "the current state of each
// entity type" is always correct, matching how Track A's `identity` report section reads
// `contractor_resolution_current` rather than filtering by this run's own job.
import type * as Restate from "@restatedev/restate-sdk";
import type postgres from "postgres";
import { lazyQueryDb, QueryDbConfigError } from "../loader.js";

export const RECONCILE_REPORT = "ReconcileReport";

export type EntityType = "property" | "owner" | "contractor";

export interface ReconcileEntitySummary {
  jobId: string | null;
  inputRecords: number;
  canonical: number;
  refused: number;
}

export interface ReconcileSummary {
  property: ReconcileEntitySummary;
  owner: ReconcileEntitySummary;
  contractor: ReconcileEntitySummary;
  refusedMerges: Array<{ entityType: EntityType; clusterId: string; tcadIds: string[]; reason: string }>;
}

const EMPTY: ReconcileEntitySummary = { jobId: null, inputRecords: 0, canonical: 0, refused: 0 };

export async function loadReconcileSummary(sql: postgres.Sql): Promise<ReconcileSummary> {
  const merges = await sql<
    { entity_type: EntityType; job_id: string; canonical: number; input_records: number }[]
  >`
    SELECT entity_type, min(job_id) AS job_id, count(*)::int AS canonical, sum(input_records)::int AS input_records
    FROM reconcile_merges GROUP BY entity_type`;
  const refusals = await sql<
    { entity_type: EntityType; job_id: string; cluster_id: string; tcad_ids: string[]; reason: string; n: number }[]
  >`
    SELECT entity_type, cluster_id, tcad_ids, reason, job_id, count(*)::int AS n
    FROM reconcile_merge_refusals GROUP BY entity_type, cluster_id, tcad_ids, reason, job_id`;
  const refusedCounts = new Map<EntityType, number>();
  for (const r of refusals) refusedCounts.set(r.entity_type, (refusedCounts.get(r.entity_type) ?? 0) + 1);

  const byEntity = new Map(merges.map((m) => [m.entity_type, m]));
  const summaryFor = (entityType: EntityType): ReconcileEntitySummary => {
    const m = byEntity.get(entityType);
    return {
      jobId: m?.job_id ?? null,
      inputRecords: m?.input_records ?? 0,
      canonical: m?.canonical ?? 0,
      refused: refusedCounts.get(entityType) ?? 0,
    };
  };
  return {
    property: summaryFor("property"),
    owner: summaryFor("owner"),
    contractor: summaryFor("contractor"),
    refusedMerges: refusals.map((r) => ({
      entityType: r.entity_type,
      clusterId: r.cluster_id,
      tcadIds: r.tcad_ids,
      reason: r.reason,
    })),
  };
}

export interface ReconcileReportDeps {
  sql: () => postgres.Sql;
}

function connect(deps: ReconcileReportDeps, restate: typeof Restate): postgres.Sql {
  try {
    return deps.sql();
  } catch (error) {
    if (error instanceof QueryDbConfigError) throw new restate.TerminalError(error.message);
    throw error;
  }
}

export function createReconcileReport(restate: typeof Restate, deps: ReconcileReportDeps) {
  return restate.service({
    name: RECONCILE_REPORT,
    handlers: {
      summary: async (ctx: Restate.Context): Promise<ReconcileSummary> => {
        const sql = connect(deps, restate);
        return ctx.run("reconcile-summary", () => loadReconcileSummary(sql));
      },
    },
  });
}

/** Auto-loaded by app.ts's `loadWorkflows` (every `services/workflows/*.ts` exporting this). */
export function createService(restate: typeof Restate) {
  return createReconcileReport(restate, { sql: lazyQueryDb() });
}
