// A-07 T020 (Track A): `IdentityReport`, the read-only summary of
// `contractor_resolution_ledger` / `comptroller_registry_loads` the `identity:resolve` CLI
// verb reads back after the Loader's `comptroller` track (`resolve_permits` kind) commits.
// Read-only: the Loader is the only writer; this never opens a transaction. Not scoped by the
// calling job's own jobId -- `contractor_resolution_current` (migration 0402's view) always
// holds the latest verdict per permit, matching how the `identity` report section and
// `ReconcileReport` both read "current state", never a single job's own rows.
import type * as Restate from "@restatedev/restate-sdk";
import type postgres from "postgres";
import { lazyQueryDb, QueryDbConfigError } from "../loader.js";

export const IDENTITY_REPORT = "IdentityReport";

export interface IdentityResolutionSummary {
  fiveStateTotals: { resolved: number; candidate: number; ambiguous: number; conflicting: number; unresolved: number };
  permitTotal: number;
  matchRule: string | null;
  resolverVersion: string | null;
  registrySnapshotDigest: string | null;
  registryRowCount: number;
}

const n = (v: unknown): number => Number(v ?? 0);

export async function loadIdentityResolutionSummary(sql: postgres.Sql): Promise<IdentityResolutionSummary> {
  const states = await sql<{ state: string; n: number; match_rule: string; resolver_version: string; registry_snapshot_digest: string }[]>`
    SELECT state, count(*)::int AS n, min(match_rule) AS match_rule, min(resolver_version) AS resolver_version,
           min(registry_snapshot_digest) AS registry_snapshot_digest
    FROM contractor_resolution_current GROUP BY state`;
  const byState = Object.fromEntries(states.map((s) => [s.state, n(s.n)]));
  const [registry] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM comptroller_registry`;
  const any = states[0];
  const total = states.reduce((a, s) => a + n(s.n), 0);
  return {
    fiveStateTotals: {
      resolved: byState.resolved ?? 0,
      candidate: byState.candidate ?? 0,
      ambiguous: byState.ambiguous ?? 0,
      conflicting: byState.conflicting ?? 0,
      unresolved: byState.unresolved ?? 0,
    },
    permitTotal: total,
    matchRule: any?.match_rule ?? null,
    resolverVersion: any?.resolver_version ?? null,
    registrySnapshotDigest: any?.registry_snapshot_digest ?? null,
    registryRowCount: n(registry?.n),
  };
}

export interface IdentityReportDeps {
  sql: () => postgres.Sql;
}

function connect(deps: IdentityReportDeps, restate: typeof Restate): postgres.Sql {
  try {
    return deps.sql();
  } catch (error) {
    if (error instanceof QueryDbConfigError) throw new restate.TerminalError(error.message);
    throw error;
  }
}

export function createIdentityReport(restate: typeof Restate, deps: IdentityReportDeps) {
  return restate.service({
    name: IDENTITY_REPORT,
    handlers: {
      summary: async (ctx: Restate.Context): Promise<IdentityResolutionSummary> => {
        const sql = connect(deps, restate);
        return ctx.run("identity-resolution-summary", () => loadIdentityResolutionSummary(sql));
      },
    },
  });
}

/** Auto-loaded by app.ts's `loadWorkflows` (every `services/workflows/*.ts` exporting this). */
export function createService(restate: typeof Restate) {
  return createIdentityReport(restate, { sql: lazyQueryDb() });
}
