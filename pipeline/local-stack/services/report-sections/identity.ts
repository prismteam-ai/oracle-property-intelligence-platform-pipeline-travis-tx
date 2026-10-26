// A-07 T017 (Track A): the `identity` section of `backbone report` (contracts/report.md's
// `contractor_five_state_totals` manifest-coverage metric). Read-only (the Loader is the only
// writer): counts, a watermark and a digest only, never a contractor's raw name or a payload.
import type postgres from "postgres";
import type { ReportSection } from "../report.js";
import { COMPTROLLER_SOURCE_KEY } from "../tracks/comptroller.js";

export interface IdentitySectionData {
  registryLoaded: boolean;
  rowCount: number;
  watermark: string | null;
  snapshotDigest: string | null;
  sourceUrl: string | null;
  /** From contractor_resolution_current (T018, not yet implemented this wave); all-zero until then. */
  fiveStateTotals: { resolved: number; candidate: number; ambiguous: number; conflicting: number; unresolved: number };
  permitTotal: number;
}

export function assembleIdentitySection(d: IdentitySectionData) {
  const sum = Object.values(d.fiveStateTotals).reduce((a, b) => a + b, 0);
  return {
    registry_loaded: d.registryLoaded,
    registry_row_count: d.rowCount,
    registry_watermark: d.watermark,
    registry_snapshot_digest: d.snapshotDigest,
    registry_source_url: d.sourceUrl,
    five_state_totals: d.fiveStateTotals,
    five_state_sum: sum,
    permit_total: d.permitTotal,
    five_state_sum_matches_permit_total: sum === d.permitTotal,
    derivation: "aggregate_match" as const,
    limitation: d.registryLoaded ? null : "registry not loaded",
  };
}

const n = (v: unknown): number => Number(v ?? 0);

async function loadIdentityData(sql: postgres.Sql): Promise<IdentitySectionData> {
  const loads = await sql<{ row_count: number; watermark: string | null; snapshot_digest: string; source_url: string }[]>`
    SELECT row_count, watermark, snapshot_digest, source_url FROM comptroller_registry_loads
    ORDER BY loaded_at DESC LIMIT 1`;
  const latest = loads[0];
  const states = await sql<{ state: string; n: number }[]>`
    SELECT state, count(*)::int AS n FROM contractor_resolution_current GROUP BY 1`;
  const byState = Object.fromEntries(states.map((s) => [s.state, n(s.n)]));
  const [p] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM contractor_resolution_current`;
  return {
    registryLoaded: latest !== undefined,
    rowCount: n(latest?.row_count),
    watermark: latest?.watermark ?? null,
    snapshotDigest: latest?.snapshot_digest ?? null,
    sourceUrl: latest?.source_url ?? null,
    fiveStateTotals: {
      resolved: byState.resolved ?? 0,
      candidate: byState.candidate ?? 0,
      ambiguous: byState.ambiguous ?? 0,
      conflicting: byState.conflicting ?? 0,
      unresolved: byState.unresolved ?? 0,
    },
    permitTotal: n(p?.n),
  };
}

export const section: ReportSection = {
  key: "identity",
  build: async (sql) => assembleIdentitySection(await loadIdentityData(sql)),
};

/** Re-exported so a caller can name this track's source key without importing tracks/comptroller.ts. */
export { COMPTROLLER_SOURCE_KEY };
