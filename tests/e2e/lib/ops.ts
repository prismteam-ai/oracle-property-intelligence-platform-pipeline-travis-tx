// Operator-side AWS helpers of the A-03 observability and Lambda-proof cases (T061, T068:
// TC-050, TC-051, TC-NF-04, TC-NF-05). CloudWatch Logs, X-Ray, CloudWatch metrics and Lambda go
// through the AWS CLI (the same tool the test plan names: `aws xray batch-get-traces`,
// `aws lambda invoke`, `aws s3api head-object`) under the `assess` profile, with the region read
// from that profile's configuration (lib/aws.ts, P0-18), never a literal. S3 writes use the SDK
// client of lib/aws.ts. Nothing here runs at import time. Command output is returned to the
// caller and never printed: environment values read for the cold-start change stay in memory
// and in a private temp file that is removed straight after use.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { PROFILES, profileRegion, s3, type Profile } from "./aws.js";
import { childEnv, run } from "./spawn.js";

/** Runs `aws <args> --output json` under a profile and its configured region; parses stdout. */
export async function awsCli(args: string[], profile: Profile = PROFILES.reader): Promise<unknown> {
  const region = await profileRegion(profile);
  const result = await run(
    "aws",
    ["--profile", profile, "--region", region, "--output", "json", ...args],
    { cwd: tmpdir(), env: childEnv({ AWS_PAGER: "" }), timeoutMs: 5 * 60_000 },
  );
  if (result.code !== 0) {
    throw new Error(
      `aws ${args.slice(0, 2).join(" ")} failed (exit ${result.code}): ${result.stderr.trim()}`,
    );
  }
  const text = result.stdout.trim();
  return text === "" ? {} : (JSON.parse(text) as unknown);
}

/** Polls `read` until `done` holds or the deadline passes; returns the last value. */
export async function poll<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  options: { timeoutMs: number; intervalMs: number },
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, options.intervalMs));
    value = await read();
  }
  return value;
}

// ---------------------------------------------------------------------------------------
// Lambda
// ---------------------------------------------------------------------------------------

const FunctionConfiguration = z
  .object({
    FunctionName: z.string(),
    LastModified: z.string().optional(),
    LastUpdateStatus: z.string().optional(),
    LoggingConfig: z.object({ LogGroup: z.string().optional() }).loose().optional(),
    Environment: z
      .object({ Variables: z.record(z.string(), z.string()).optional() })
      .loose()
      .optional(),
  })
  .loose();
type FunctionConfiguration = z.infer<typeof FunctionConfiguration>;

async function functionConfiguration(functionName: string): Promise<FunctionConfiguration> {
  return FunctionConfiguration.parse(
    await awsCli(["lambda", "get-function-configuration", "--function-name", functionName]),
  );
}

/** The function's CloudWatch log group (its LoggingConfig; the CDK output ApiFunctionLogGroupName). */
export async function functionLogGroup(functionName: string): Promise<string> {
  const config = await functionConfiguration(functionName);
  const group = config.LoggingConfig?.LogGroup;
  if (!group) throw new Error(`Lambda ${functionName} reports no LoggingConfig.LogGroup`);
  return group;
}

async function setEnvironment(
  functionName: string,
  variables: Record<string, string>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "countylens-env-"));
  const file = join(dir, "input.json");
  try {
    await writeFile(
      file,
      JSON.stringify({ FunctionName: functionName, Environment: { Variables: variables } }),
      { encoding: "utf8", mode: 0o600 },
    );
    await awsCli(["lambda", "update-function-configuration", "--cli-input-json", `file://${file}`]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  await awsCli(["lambda", "wait", "function-updated-v2", "--function-name", functionName]);
}

/** Name of the throwaway variable whose change forces every sandbox to restart (TC-NF-04). */
export const COLD_START_NONCE_KEY = "COUNTYLENS_COLD_START_NONCE";

export interface ColdStartHandle {
  nonce: string;
  /** Puts the original environment back (one more configuration change, then waits). */
  restore(): Promise<void>;
}

/**
 * Forces a cold start by an environment change: every warm sandbox is retired when the
 * configuration changes, so the next request starts a new one (node init + DuckDB init).
 * The original variables are kept in memory only and restored by `restore()`.
 */
export async function forceColdStart(functionName: string): Promise<ColdStartHandle> {
  const before = await functionConfiguration(functionName);
  const original = { ...(before.Environment?.Variables ?? {}) };
  const nonce = new Date().toISOString();
  await setEnvironment(functionName, { ...original, [COLD_START_NONCE_KEY]: nonce });
  return { nonce, restore: () => setEnvironment(functionName, original) };
}

/** `aws lambda invoke` with a JSON payload (direct invoke, never the public API); returns the parsed response. */
export async function invokeJson(functionName: string, payload: unknown): Promise<unknown> {
  const dir = await mkdtemp(join(tmpdir(), "countylens-invoke-"));
  const out = join(dir, "response.json");
  try {
    const meta = z
      .object({ StatusCode: z.number(), FunctionError: z.string().optional() })
      .loose()
      .parse(
        await awsCli([
          "lambda",
          "invoke",
          "--function-name",
          functionName,
          "--cli-binary-format",
          "raw-in-base64-out",
          "--payload",
          JSON.stringify(payload),
          out,
        ]),
      );
    const body = await readFile(out, "utf8");
    if (meta.FunctionError) throw new Error(`Lambda ${meta.FunctionError}: ${body.slice(0, 300)}`);
    return JSON.parse(body) as unknown;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------
// CloudWatch Logs, X-Ray, CloudWatch metrics
// ---------------------------------------------------------------------------------------

const FilteredEvents = z.object({
  events: z.array(z.object({ message: z.string(), timestamp: z.number() }).loose()).default([]),
});

/** Every log event in `logGroup` since `startTimeMs` whose text contains `term` (exact phrase). */
export async function findLogLines(
  logGroup: string,
  term: string,
  startTimeMs: number,
): Promise<string[]> {
  const out = FilteredEvents.parse(
    await awsCli([
      "logs",
      "filter-log-events",
      "--log-group-name",
      logGroup,
      "--start-time",
      String(startTimeMs),
      "--filter-pattern",
      JSON.stringify(term),
    ]),
  );
  return out.events.map((event) => event.message.trim());
}

/** One X-Ray segment document (only the fields the cases read). */
export interface XraySegment {
  id: string;
  name: string;
  origin?: string;
  start_time: number;
  end_time?: number;
  annotations?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  subsegments?: XraySegment[];
}

const Traces = z.object({
  Traces: z
    .array(
      z
        .object({
          Id: z.string(),
          Segments: z.array(z.object({ Document: z.string() }).loose()).default([]),
        })
        .loose(),
    )
    .default([]),
  UnprocessedTraceIds: z.array(z.string()).default([]),
});

/** `aws xray batch-get-traces`: the segments of one trace (empty until X-Ray has indexed it). */
export async function traceSegments(traceId: string): Promise<XraySegment[]> {
  const out = Traces.parse(await awsCli(["xray", "batch-get-traces", "--trace-ids", traceId]));
  return out.Traces.flatMap((trace) =>
    trace.Segments.map((segment) => JSON.parse(segment.Document) as XraySegment),
  );
}

/** Every segment and subsegment, depth first. */
export function flattenSegments(segments: readonly XraySegment[]): XraySegment[] {
  const all: XraySegment[] = [];
  const visit = (segment: XraySegment): void => {
    all.push(segment);
    for (const child of segment.subsegments ?? []) visit(child);
  };
  for (const segment of segments) visit(segment);
  return all;
}

export function durationMs(segment: XraySegment): number {
  if (segment.end_time === undefined) return Number.NaN;
  return Math.round((segment.end_time - segment.start_time) * 1000);
}

const Metrics = z.object({
  Metrics: z
    .array(
      z.object({
        Namespace: z.string(),
        MetricName: z.string(),
        Dimensions: z.array(z.object({ Name: z.string(), Value: z.string() })).default([]),
      }),
    )
    .default([]),
});
const Statistics = z.object({
  Datapoints: z.array(z.object({ SampleCount: z.number().optional() }).loose()).default([]),
});

/**
 * Datapoints of `metricName` in `namespace` for `procedure` between two instants: every
 * dimension set carrying `procedure` (Powertools adds `service`) is read with SampleCount at a
 * 60 s period. Returns the summed sample count (0 = no datapoint).
 */
export async function metricSampleCount(
  namespace: string,
  metricName: string,
  procedure: string,
  startMs: number,
  endMs: number,
): Promise<number> {
  const listed = Metrics.parse(
    await awsCli([
      "cloudwatch",
      "list-metrics",
      "--namespace",
      namespace,
      "--metric-name",
      metricName,
      "--dimensions",
      `Name=procedure,Value=${procedure}`,
    ]),
  );
  let samples = 0;
  for (const metric of listed.Metrics) {
    const stats = Statistics.parse(
      await awsCli([
        "cloudwatch",
        "get-metric-statistics",
        "--namespace",
        namespace,
        "--metric-name",
        metricName,
        "--dimensions",
        ...metric.Dimensions.map((d) => `Name=${d.Name},Value=${d.Value}`),
        "--start-time",
        new Date(startMs).toISOString(),
        "--end-time",
        new Date(endMs).toISOString(),
        "--period",
        "60",
        "--statistics",
        "SampleCount",
      ]),
    );
    for (const point of stats.Datapoints) samples += point.SampleCount ?? 0;
  }
  return samples;
}

// ---------------------------------------------------------------------------------------
// S3 (the private bench prefix only)
// ---------------------------------------------------------------------------------------

export async function putFile(
  bucket: string,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const client = await s3(PROFILES.reader);
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }),
  );
}

export async function deleteKey(bucket: string, key: string): Promise<void> {
  const client = await s3(PROFILES.reader);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** HTTP status of a HeadObject (200 when present, 404 once deleted) — never throws on 404. */
export async function headStatus(bucket: string, key: string): Promise<number> {
  const client = await s3(PROFILES.reader);
  try {
    const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return out.$metadata.httpStatusCode ?? 200;
  } catch (error: unknown) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === undefined) throw error;
    return status;
  }
}
