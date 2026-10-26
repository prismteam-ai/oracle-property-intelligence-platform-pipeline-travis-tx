---
id: CONTRACT-A-04-SEAMS
type: contract
parent: PLAN-A-04
created: 2026-10-21
---

# Contract: shared seams (G-FIX owns; the build wave codes against them)

```ts
// pipeline/local-stack/services/workflows/<name>.ts  (one per workflow; app.ts auto-registers)
export function createService(restate: typeof import("@restatedev/restate-sdk")): restate.ServiceDefinition | restate.WorkflowDefinition | restate.VirtualObjectDefinition;

// pipeline/local-stack/services/tracks/<track>.ts  (Loader plug-in; Loader is the ONLY writer)
export interface LoaderTrack<I> {
  name: "tcad" | "gis" | "permits";
  input: z.ZodType<I>;                                  // {jobId, artifactPath, artifactSha256, ...}
  merge(sql: postgres.TransactionSql, input: I): Promise<{ rowsWritten: number; watermark?: unknown; tombstones?: number }>;
}
export const track: LoaderTrack<…>;
// Loader (virtual object "Loader", key "travis") handler: merge({track, input}) — skips when (track, artifactSha256) is in loader_merges;
// writes rows, watermark and tombstones in ONE transaction; inactivityTimeout 30 min, abortTimeout 60 min.

// pipeline/local-stack/services/report-sections/<key>.ts
export interface ReportSection { key: "roll" | "confidentiality" | "coordinates" | "gis" | "permits" | "jurisdictions"; build(sql: postgres.Sql, jobId: string): Promise<unknown>; }
export const section: ReportSection;            // report.ts adds job_id, as_of, limitations[]

// pipeline/oracle-runtime/travis/backbone/commands/<verb>.ts
export interface BackboneCommand<A> { verb: string; args: z.ZodType<A>; run(ctx: RunContext, args: A): Promise<{ jobId: string; exitCode: 0 | 1 | 2 | 3 | 4 }>; }
export const command: BackboneCommand<…>;

// pipeline/oracle-runtime/travis/backbone/run-context.ts
export interface RunContext {
  jobId: string; asOf: () => string;                    // asOf = run finishedAt (ISO date), never now() inside derivations
  ingress: RestateIngressClient;                        // restate-client.ts: send(workflow, key, handler, body), get(...)
  diskGuard(minFreeBytes?: number): void;               // throws DiskGuardError below 5 GiB (exit 4)
  sourceClient(): SourceClient;                         // travis/lib/source-client.ts (UA, backoff 1 s/60 s/5/full jitter, StopOnBlocked)
}

// pipeline/oracle-runtime/travis/backbone/source-limits.ts
export function throughputRow(x: { source: string; pages: number; rows: number; startedAt: string; finishedAt: string; concurrency: number }): { pages: number; duration_s: number; rows_per_s: number; markdown: string };

// pipeline/oracle-runtime/travis/discovery/probes/arcgis.ts (CR2-9)
export function gapPercent(roll: number, gis: number): number | "unknown";   // 3 decimals, roll is the denominator; roll ≤ 0 → "unknown"
```

Migrations: `pipeline/local-stack/migrations/NNNN_<name>.sql`, applied by `services/migrate.ts` in name order (`0000_core` → `0101_tcad` → `0201_gis` → `0301_permits`), each in a transaction, recorded in `schema_migrations` with its sha256.
