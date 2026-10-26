#!/usr/bin/env -S npx tsx
// bench-lambda (A-03 T065; TC-NF-05, ADR-0001 "Lambda proof", PO decision D-4): the operator's
// direct-invoke harness for the read-path fallback. It is the only client of the API Lambda's
// bench branch and never goes through the public API.
//
//   npx tsx scripts/bench-lambda.ts --function-name <name> --prefix private/bench/<name>/ \
//     [--query count|radius|roofAge]... [--preset TC_NF_05|ADR_0001]... [--runs 20] [--warmup 1] \
//     [--profile assess] [--private-prefix private/bench/] [--json <file>] [--max-p95-ms <n>]
//
// For every query × preset it sends one untimed warm-up invocation, then `--runs` (20) timed
// ones, and reports p50 / p95 (nearest rank, as ADR-0001 computes them) of the responses'
// `queryDurationMs` (engine init `initMs` and the view bind `bindMs` excluded; cold starts among
// the timed runs are counted and reported). Each invocation is `aws lambda invoke` under the
// given profile; the region comes from that profile's configuration, never from a literal
// (P0-18). The prefix must lie under READPATH_PRIVATE_PREFIX (`--private-prefix` or the
// environment) and match private/bench/<name>/, or the script refuses before the first call.
// Rows come back from the Lambda but are only counted here: nothing row-level is printed.
// Exit 0 on a completed run (1 if `--max-p95-ms` is exceeded), 2 on a refused prefix or usage.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BENCH_QUERIES = ["count", "radius", "roofAge"] as const;
export type BenchQuery = (typeof BENCH_QUERIES)[number];
export const BENCH_PRESET_NAMES = ["TC_NF_05", "ADR_0001"] as const;
export type BenchPresetName = (typeof BENCH_PRESET_NAMES)[number];
/** The Lambda's own rule for a bench prefix (apps/api/src/handlers/bench.ts). */
export const BENCH_PREFIX_PATTERN = /^private\/bench\/[a-z0-9-]+\/$/;
export const DEFAULT_RUNS = 20;
export const DEFAULT_WARMUP = 1;
export const DEFAULT_PROFILE = "assess";

export interface BenchEvent {
  readonly kind: "bench";
  readonly query: BenchQuery;
  readonly preset: BenchPresetName;
  readonly prefix: string;
}

/** What the Lambda's bench branch returns (contracts/api.md; extra fields are additive). */
export interface BenchResponse {
  readonly query: string;
  readonly preset?: string;
  readonly prefix?: string;
  readonly rows: readonly unknown[];
  readonly queryDurationMs: number;
  readonly initMs: number;
  readonly bindMs?: number;
  readonly coldStart: boolean;
  readonly correlationId?: string;
  readonly traceId?: string;
}

export type BenchInvoke = (event: BenchEvent) => Promise<BenchResponse>;

export interface BenchRunOptions {
  readonly prefix: string;
  /** READPATH_PRIVATE_PREFIX: the only tree the bench may read. */
  readonly privatePrefix: string;
  readonly invoke: BenchInvoke;
  readonly queries?: readonly BenchQuery[];
  readonly presets?: readonly BenchPresetName[];
  readonly runs?: number;
  readonly warmup?: number;
  readonly onProgress?: (line: string) => void;
}

export interface BenchPairResult {
  readonly query: BenchQuery;
  readonly preset: BenchPresetName;
  /** The timed runs' `queryDurationMs`, in invocation order. */
  readonly timingsMs: number[];
  readonly p50Ms: number;
  readonly p95Ms: number;
  /** Rows the last timed run returned. */
  readonly rows: number;
  /** Timed runs that reported a cold start (0 expected after the warm-up). */
  readonly coldStarts: number;
  readonly initMsMax: number;
  readonly bindMsMax: number;
  /** `queryDurationMs` of the warm-up runs (not part of the sample). */
  readonly warmupMs: number[];
  /** Correlation IDs of the timed runs, for finding the log lines (TC-NF-05 evidence). */
  readonly correlationIds: string[];
}

export interface BenchReport {
  readonly prefix: string;
  readonly runs: number;
  readonly warmup: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly results: BenchPairResult[];
}

/** Throws unless `prefix` lies under `privatePrefix` and has the Lambda's bench shape. */
export function assertBenchPrefix(prefix: string, privatePrefix: string): void {
  if (!prefix.startsWith(privatePrefix) || !BENCH_PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Refused prefix ${prefix}: bench-lambda only reads under ${privatePrefix}`);
  }
}

/** Nearest-rank percentile: of 20 sorted values p50 is the 10th and p95 the 19th (ADR-0001). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new RangeError("percentile of an empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] as number;
}

const wholeNumber = (name: string, value: number, min: number): number => {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} must be a whole number ≥ ${min}, got ${value}`);
  }
  return value;
};

export async function runBench(options: BenchRunOptions): Promise<BenchReport> {
  assertBenchPrefix(options.prefix, options.privatePrefix);
  const queries = options.queries ?? BENCH_QUERIES;
  const presets = options.presets ?? BENCH_PRESET_NAMES;
  const runs = wholeNumber("runs", options.runs ?? DEFAULT_RUNS, 1);
  const warmup = wholeNumber("warmup", options.warmup ?? DEFAULT_WARMUP, 0);
  const progress = options.onProgress ?? (() => undefined);
  const startedAt = new Date().toISOString();
  const results: BenchPairResult[] = [];

  for (const query of queries) {
    for (const preset of presets) {
      const event: BenchEvent = { kind: "bench", query, preset, prefix: options.prefix };
      const warmupMs: number[] = [];
      for (let i = 0; i < warmup; i += 1) {
        const response = await options.invoke(event);
        warmupMs.push(response.queryDurationMs);
        progress(`${query} ${preset}: warm-up ${i + 1}/${warmup} ${response.queryDurationMs} ms`);
      }
      const timingsMs: number[] = [];
      const correlationIds: string[] = [];
      let coldStarts = 0;
      let initMsMax = 0;
      let bindMsMax = 0;
      let rows = 0;
      for (let i = 0; i < runs; i += 1) {
        const response = await options.invoke(event);
        timingsMs.push(response.queryDurationMs);
        if (response.coldStart) coldStarts += 1;
        initMsMax = Math.max(initMsMax, response.initMs);
        bindMsMax = Math.max(bindMsMax, response.bindMs ?? 0);
        rows = response.rows.length;
        if (response.correlationId !== undefined) correlationIds.push(response.correlationId);
        progress(
          `${query} ${preset}: run ${i + 1}/${runs} ${response.queryDurationMs} ms` +
            (response.coldStart ? " (cold start)" : ""),
        );
      }
      results.push({
        query,
        preset,
        timingsMs,
        p50Ms: percentile(timingsMs, 50),
        p95Ms: percentile(timingsMs, 95),
        rows,
        coldStarts,
        initMsMax,
        bindMsMax,
        warmupMs,
        correlationIds,
      });
    }
  }

  return {
    prefix: options.prefix,
    runs,
    warmup,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
  };
}

/** One line per query × preset; counts and durations only. */
export function formatReport(report: BenchReport): string[] {
  const lines = [
    `bench-lambda: prefix ${report.prefix}, ${report.runs} timed runs after ${report.warmup} warm-up per query and preset (${report.startedAt} → ${report.finishedAt})`,
  ];
  for (const r of report.results) {
    lines.push(
      `${r.query} ${r.preset}: n=${r.timingsMs.length} p50=${r.p50Ms} ms p95=${r.p95Ms} ms rows=${r.rows} coldStarts=${r.coldStarts} initMsMax=${r.initMsMax} bindMsMax=${r.bindMsMax}`,
    );
  }
  return lines;
}

interface Exec {
  code: number | null;
  stdout: string;
  stderr: string;
}

function exec(command: string, args: readonly string[]): Promise<Exec> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates the Lambda's response shape; anything else is a deploy mismatch, not data. */
export function parseBenchResponse(payload: string): BenchResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("Unexpected bench response: not JSON");
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.query !== "string" ||
    !Array.isArray(parsed.rows) ||
    typeof parsed.queryDurationMs !== "number" ||
    typeof parsed.initMs !== "number" ||
    typeof parsed.coldStart !== "boolean"
  ) {
    throw new Error(
      "Unexpected bench response: expected { query, rows, queryDurationMs, initMs, coldStart }",
    );
  }
  return parsed as unknown as BenchResponse;
}

/** The Lambda error payload, reduced to its type and message (the Lambda redacts its own). */
function describeFunctionError(payload: string): string {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (isRecord(parsed)) {
      return `${String(parsed.errorType ?? "Error")}: ${String(parsed.errorMessage ?? "")}`;
    }
  } catch {
    // not JSON: fall through
  }
  return payload.slice(0, 200);
}

export interface AwsCliInvokeOptions {
  readonly functionName: string;
  /** AWS CLI profile; its configuration supplies the region. */
  readonly profile: string;
}

/** `aws lambda invoke` as a BenchInvoke: the payload goes in, the response file comes back. */
export function awsCliInvoke(options: AwsCliInvokeOptions): BenchInvoke {
  return async (event) => {
    const dir = await mkdtemp(join(tmpdir(), "bench-lambda-"));
    const responseFile = join(dir, "response.json");
    try {
      const { code, stdout, stderr } = await exec("aws", [
        "--profile",
        options.profile,
        "lambda",
        "invoke",
        "--function-name",
        options.functionName,
        "--cli-binary-format",
        "raw-in-base64-out",
        "--payload",
        JSON.stringify(event),
        responseFile,
      ]);
      if (code !== 0) {
        throw new Error(`aws lambda invoke failed (exit ${code ?? "signal"}): ${stderr.trim()}`);
      }
      const meta: unknown = JSON.parse(stdout);
      const payload = await readFile(responseFile, "utf8");
      if (isRecord(meta) && typeof meta.FunctionError === "string") {
        throw new Error(`Lambda ${meta.FunctionError}: ${describeFunctionError(payload)}`);
      }
      return parseBenchResponse(payload);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

interface CliArgs {
  functionName: string;
  prefix: string;
  privatePrefix: string | undefined;
  profile: string;
  queries: BenchQuery[];
  presets: BenchPresetName[];
  runs: number;
  warmup: number;
  jsonPath: string | undefined;
  maxP95Ms: number | undefined;
}

const USAGE =
  "usage: npx tsx scripts/bench-lambda.ts --function-name <name> --prefix private/bench/<name>/ " +
  "[--query count|radius|roofAge]... [--preset TC_NF_05|ADR_0001]... [--runs 20] [--warmup 1] " +
  "[--profile assess] [--private-prefix private/bench/] [--json <file>] [--max-p95-ms <n>]";

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(USAGE);
  process.exit(2);
}

const isQuery = (value: string): value is BenchQuery =>
  (BENCH_QUERIES as readonly string[]).includes(value);
const isPreset = (value: string): value is BenchPresetName =>
  (BENCH_PRESET_NAMES as readonly string[]).includes(value);

export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv): CliArgs {
  let functionName: string | undefined;
  let prefix: string | undefined;
  let privatePrefix = env.READPATH_PRIVATE_PREFIX;
  let profile = env.AWS_PROFILE ?? DEFAULT_PROFILE;
  const queries: BenchQuery[] = [];
  const presets: BenchPresetName[] = [];
  let runs = DEFAULT_RUNS;
  let warmup = DEFAULT_WARMUP;
  let jsonPath: string | undefined;
  let maxP95Ms: number | undefined;

  const next = (i: number, flag: string): string => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) usage(`${flag} needs a value`);
    return value;
  };
  const integer = (flag: string, value: string, min: number): number => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min) usage(`${flag} must be a whole number ≥ ${min}`);
    return n;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    switch (arg) {
      case "--function-name":
        functionName = next(i, arg);
        i += 1;
        break;
      case "--prefix":
        prefix = next(i, arg);
        i += 1;
        break;
      case "--private-prefix":
        privatePrefix = next(i, arg);
        i += 1;
        break;
      case "--profile":
        profile = next(i, arg);
        i += 1;
        break;
      case "--query": {
        const value = next(i, arg);
        if (!isQuery(value)) usage(`--query must be one of ${BENCH_QUERIES.join(", ")}`);
        queries.push(value);
        i += 1;
        break;
      }
      case "--preset": {
        const value = next(i, arg);
        if (!isPreset(value)) usage(`--preset must be one of ${BENCH_PRESET_NAMES.join(", ")}`);
        presets.push(value);
        i += 1;
        break;
      }
      case "--runs":
        runs = integer(arg, next(i, arg), 1);
        i += 1;
        break;
      case "--warmup":
        warmup = integer(arg, next(i, arg), 0);
        i += 1;
        break;
      case "--json":
        jsonPath = next(i, arg);
        i += 1;
        break;
      case "--max-p95-ms":
        maxP95Ms = integer(arg, next(i, arg), 1);
        i += 1;
        break;
      default:
        usage(`unknown argument ${arg}`);
    }
  }
  if (functionName === undefined) usage("--function-name is required");
  if (prefix === undefined) usage("--prefix is required");
  return {
    functionName,
    prefix,
    privatePrefix,
    profile,
    queries,
    presets,
    runs,
    warmup,
    jsonPath,
    maxP95Ms,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), process.env);
  if (args.privatePrefix === undefined || args.privatePrefix.length === 0) {
    usage("READPATH_PRIVATE_PREFIX is not set; pass --private-prefix or export it from config");
  }
  try {
    assertBenchPrefix(args.prefix, args.privatePrefix);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }

  const report = await runBench({
    prefix: args.prefix,
    privatePrefix: args.privatePrefix,
    invoke: awsCliInvoke({ functionName: args.functionName, profile: args.profile }),
    ...(args.queries.length > 0 ? { queries: args.queries } : {}),
    ...(args.presets.length > 0 ? { presets: args.presets } : {}),
    runs: args.runs,
    warmup: args.warmup,
    onProgress: (line) => console.error(line),
  });

  for (const line of formatReport(report)) console.log(line);
  if (args.jsonPath !== undefined) {
    await writeFile(args.jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`report written to ${args.jsonPath}`);
  }
  if (args.maxP95Ms !== undefined) {
    const over = report.results.filter((r) => r.p95Ms >= (args.maxP95Ms as number));
    if (over.length > 0) {
      console.error(
        `p95 at or above ${args.maxP95Ms} ms: ${over.map((r) => `${r.query} ${r.preset} (${r.p95Ms} ms)`).join(", ")}`,
      );
      process.exit(1);
    }
  }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
