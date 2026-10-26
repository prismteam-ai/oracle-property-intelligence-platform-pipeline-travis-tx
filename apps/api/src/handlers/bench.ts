// A-03 T065 (G-C2b): the direct-invoke bench branch of the API Lambda (contracts/api.md
// "Direct-invoke bench event", ADR-0001 "Lambda fallback sizing" and D-4 "Private prefix +
// direct invoke", research R-02). Reached only through `aws lambda invoke` / `InvokeCommand`
// with `{ kind: "bench", query, preset, prefix }` (handlers/trpc.ts rejects an API Gateway event
// that carries `kind`). It lists the `*.parquet` parts under one `private/bench/<name>/` prefix
// of the CID-copy bucket (never served by CloudFront), presigns them, binds them as the spike's
// relation `t` on the same DuckDB engine, threads and memory as the procedures, and runs the
// bench-sql.ts builder for the preset. The result is `{ query, preset, prefix, rows,
// queryDurationMs, initMs, bindMs, coldStart }`: `queryDurationMs` is the query alone (what
// TC-NF-05 times), `initMs` the engine start and `bindMs` the view bind over the parts.
// Presigned URLs live only in the SQL handed to the engine; nothing here logs.
// ERR-18: the view is re-bound only when the parts' URLs change (presignPrefix reuses a part's URL
// while its ETag is unchanged) or the engine was re-opened, so a warm sandbox keeps DuckDB's
// footer and chunk caches (keyed by URL) across invocations; `bindMs` is then 0.
import {
  BENCH_PRESETS,
  benchCountSql,
  benchRadiusSql,
  benchRoofAgeSql,
  type BenchPreset,
  type QueryEngine,
  type Row,
} from "@countylens/query-core";
import { z } from "zod";
import { getConfig, type ApiConfig } from "../config.js";
import { getEngine } from "../engine/duckdb-node.js";
import { presignPrefix } from "../engine/s3-read.js";

export const BENCH_QUERIES = ["count", "radius", "roofAge"] as const;
export type BenchQuery = (typeof BENCH_QUERIES)[number];

export const BENCH_PRESET_NAMES = [
  "TC_NF_05",
  "ADR_0001",
] as const satisfies readonly BenchPreset[];
export type BenchPresetName = (typeof BENCH_PRESET_NAMES)[number];

/** `private/bench/<name>/`: lower-case name, one level, trailing slash (contracts/storage.md). */
export const BENCH_PREFIX_PATTERN = /^private\/bench\/[a-z0-9-]+\/$/;

/** The relation the parts are bound as; bench-sql.ts defaults to it (the spike's `t`). */
export const BENCH_RELATION = "t";

export const BenchEvent = z.strictObject({
  kind: z.literal("bench"),
  query: z.enum(BENCH_QUERIES),
  preset: z.enum(BENCH_PRESET_NAMES),
  prefix: z.string().regex(BENCH_PREFIX_PATTERN, "must match private/bench/<name>/"),
});
export type BenchEvent = z.infer<typeof BenchEvent>;

export interface BenchResult {
  readonly query: BenchQuery;
  readonly preset: BenchPresetName;
  readonly prefix: string;
  readonly rows: Row[];
  /** The bench query alone, in ms (TC-NF-05 reads this). */
  readonly queryDurationMs: number;
  /** DuckDB engine start, in ms (≈ 0 on a warm sandbox). */
  readonly initMs: number;
  /** Binding the view over the presigned parts, in ms. */
  readonly bindMs: number;
  readonly coldStart: boolean;
}

export interface BenchRunOptions {
  /** Defaults to the process config (`getConfig()`). */
  readonly config?: ApiConfig;
  /** Whether this is the sandbox's first request (the handler knows, the bench does not). */
  readonly coldStart: boolean;
}

/** True for any object carrying `kind`: the shape no API Gateway event has. */
export function isBenchEvent(event: unknown): event is { kind: unknown } {
  return typeof event === "object" && event !== null && "kind" in event;
}

const BUILDER_NAMES: Readonly<Record<BenchQuery, string>> = {
  count: "benchCountSql",
  radius: "benchRadiusSql",
  roofAge: "benchRoofAgeSql",
};

/** The bench-sql.ts builder a query runs; this name is what gets annotated, never the SQL. */
export function benchBuilderName(query: BenchQuery): string {
  return BUILDER_NAMES[query];
}

function benchSql(query: BenchQuery, preset: BenchPresetName): string {
  const params = BENCH_PRESETS[preset];
  switch (query) {
    case "count":
      return benchCountSql(BENCH_RELATION);
    case "radius":
      return benchRadiusSql(params, BENCH_RELATION);
    case "roofAge":
      return benchRoofAgeSql(params, BENCH_RELATION);
  }
}

const sqlString = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** `CREATE OR REPLACE TEMP VIEW t AS SELECT * FROM read_parquet([...])` over the presigned parts. */
export function bindPartsSql(urls: readonly string[]): string {
  return `CREATE OR REPLACE TEMP VIEW ${BENCH_RELATION} AS SELECT * FROM read_parquet([${urls
    .map(sqlString)
    .join(", ")}])`;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** DuckDB BIGINTs come back as bigint; the Lambda response must be JSON. */
function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value <= MAX_SAFE && value >= -MAX_SAFE ? Number(value) : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, jsonSafe(inner)]));
  }
  return value;
}

const whole = (ms: number): number => Math.round(ms);

/** The view `t` this sandbox last bound: the engine it lives on and the statement that made it. */
let bound: { readonly engine: QueryEngine; readonly sql: string } | undefined;

/** Tests only: forget the bound view so the next run binds again. */
export function resetBenchBinding(): void {
  bound = undefined;
}

/**
 * Runs one bench query over the parts under `event.prefix`. Refuses any prefix outside the
 * configured `READPATH_PRIVATE_PREFIX` before listing anything (the Zod regex already pins
 * `private/bench/`; this is the second lock, against a misconfigured deploy).
 */
export async function runBench(event: BenchEvent, options: BenchRunOptions): Promise<BenchResult> {
  const config = options.config ?? getConfig();
  if (!event.prefix.startsWith(config.readPathPrivatePrefix)) {
    throw new Error(
      `Refused prefix ${event.prefix}: the bench only reads under ${config.readPathPrivatePrefix}`,
    );
  }

  const parts = await presignPrefix(event.prefix);
  const urls = parts.filter((part) => part.key.endsWith(".parquet")).map((part) => part.url);
  if (urls.length === 0) throw new Error(`No .parquet part under ${event.prefix}`);

  const initStarted = performance.now();
  const engine = await getEngine();
  const initMs = whole(performance.now() - initStarted);

  const bindSql = bindPartsSql(urls);
  const bindStarted = performance.now();
  if (bound?.engine !== engine || bound.sql !== bindSql) {
    bound = undefined; // a failed bind is not kept
    await engine.run(bindSql);
    bound = { engine, sql: bindSql };
  }
  const bindMs = whole(performance.now() - bindStarted);

  const sql = benchSql(event.query, event.preset);
  const queryStarted = performance.now();
  const rows = await engine.all(sql);
  const queryDurationMs = whole(performance.now() - queryStarted);

  return {
    query: event.query,
    preset: event.preset,
    prefix: event.prefix,
    rows: rows.map((row) => jsonSafe(row) as Row),
    queryDurationMs,
    initMs,
    bindMs,
    coldStart: options.coldStart,
  };
}
