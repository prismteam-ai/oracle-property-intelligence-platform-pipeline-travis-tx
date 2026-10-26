// A-07 T049 (Track D, data-model.md § "Reconciled property/owner/contractor record", FR-018,
// P0-5): merge rules per entity type. TCAD id is the ONLY merge key, never a pair of TCAD ids.
// A candidate cluster whose source rows cite more than one TCAD id is refused and counted, not
// partially merged. Pure logic: no Query DB access here (the Wave-1 run script that reads real
// rows and writes reconcile_merges / reconcile_merge_refusals is run-merge-property-owner.ts).

export type EntityType = "property" | "owner" | "contractor";

/** One source row feeding a candidate merge cluster. */
export interface MergeSourceRecord {
  recordId: string;
  tcadId: string;
}

/** A candidate cluster of source rows proposed as one canonical entity. */
export interface MergeCluster {
  clusterId: string;
  records: MergeSourceRecord[];
}

/** One accepted merge: data-model.md's reconciled record (minus bookkeeping). */
export interface MergeResult {
  entityType: EntityType;
  tcadId: string;
  inputRecords: number;
  canonicalId: string;
}

/** A cluster refused because its source rows span two or more TCAD ids. */
export interface RefusedMerge {
  clusterId: string;
  tcadIds: string[];
  reason: "cross_tcad_id";
}

export interface MergeRunResult {
  entityType: EntityType;
  merges: MergeResult[];
  refused: RefusedMerge[];
}

function canonicalId(entityType: EntityType, tcadId: string): string {
  return `${entityType}:${tcadId}`;
}

/**
 * Merge every cluster for one entity type. A cluster's records must all cite the same TCAD id;
 * otherwise the whole cluster is refused (never split or partially merged) and recorded.
 */
export function mergeEntityClusters(
  entityType: EntityType,
  clusters: readonly MergeCluster[],
): MergeRunResult {
  const merges: MergeResult[] = [];
  const refused: RefusedMerge[] = [];
  for (const cluster of clusters) {
    const distinctTcadIds = [...new Set(cluster.records.map((r) => r.tcadId))];
    if (distinctTcadIds.length !== 1) {
      refused.push({
        clusterId: cluster.clusterId,
        tcadIds: distinctTcadIds,
        reason: "cross_tcad_id",
      });
      continue;
    }
    const tcadId = distinctTcadIds[0] as string;
    merges.push({
      entityType,
      tcadId,
      inputRecords: cluster.records.length,
      canonicalId: canonicalId(entityType, tcadId),
    });
  }
  return { entityType, merges, refused };
}
