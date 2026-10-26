// A-03 T071 (G-C2b): the Lambda's observability contract (contracts/api.md "Observability",
// FR-007, AC-7, constitution VIII). Written before src/observability.ts and the T073 handler
// exist: the red run fails with "Cannot find module '../src/observability'".
//
// Per request: exactly one `logger.info` line carrying `correlation_id` and `queryDurationMs`
// (TC-NF-05 reads that field); one X-Ray subsegment `duckdb.query` annotated with `manifestCid`
// and `query` (the SQL builder's name, never the SQL text); the business metrics
// `QueryDurationMs` (ms), `ItemsProcessed` (rows returned) and `ItemsFailed` (0 on success)
// with the dimension `procedure`; the response headers `x-correlation-id` and `x-trace-id`.
// IDs and counts only: no log field, annotation or trace metadata may carry a presigned URL
// (`X-Amz-Signature`), a row value (the fixture rows hold a sentinel owner name and address)
// or an environment value (the four config keys). Powertools runs for real: Logger and Metrics
// write to the captured console (POWERTOOLS_DEV), the Tracer is in its no-op mode
// (POWERTOOLS_TRACE_ENABLED=false) with `getSegment` returning a recording segment. The DuckDB
// engine and the S3 reads are module mocks: nothing here reaches AWS, DuckDB files or the network.
import { Tracer } from "@aws-lambda-powertools/tracer";
import { TRPCError } from "@trpc/server";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { z } from "zod";

const H = vi.hoisted(() => {
  process.env.POWERTOOLS_DEV = "true";
  process.env.POWERTOOLS_METRICS_DISABLED = "false";
  process.env.POWERTOOLS_TRACE_ENABLED = "false";
  process.env.POWERTOOLS_LOG_LEVEL = "INFO";
  // What the Lambda runtime sets; Powertools reports a cold start only for on-demand sandboxes.
  process.env.AWS_LAMBDA_INITIALIZATION_TYPE = "on-demand";
  // Config env (plan § "Fixed texts and config keys"); in-test values, none real. Each is a
  // sentinel the log output must not contain.
  process.env.CID_COPY_BUCKET = "copy-bucket-env-sentinel-x7";
  process.env.CID_COPY_HOST = "copy-host-env-sentinel.example";
  process.env.FILEBASE_GATEWAY_HOST = "gateway-env-sentinel.example";
  process.env.READPATH_PRIVATE_PREFIX = "private/bench/";
  process.env._X_AMZN_TRACE_ID =
    "Root=1-6f1b2c3d-0123456789abcdef01234567;Parent=53995c3f42cd8ad8;Sampled=1";

  const SENTINEL_OWNER = "ZELDA OWNER-SENTINEL 7Q";
  const SENTINEL_ADDRESS = "4242 SENTINEL LANE UNIT 9Z";
  const SIGNATURE = "SENTINELSIGNATURE0123456789abcdef0123456789abcdef";
  const PREFIX = "private/bench/austin-48m/";
  const PRESIGNED = `https://${process.env.CID_COPY_BUCKET}.s3.example/${PREFIX}part-00001.parquet?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=${SIGNATURE}`;
  const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
  const rows = [
    {
      permit_number: "2026-100001",
      owner_name: SENTINEL_OWNER,
      original_address1: SENTINEL_ADDRESS,
    },
    {
      permit_number: "2026-100002",
      owner_name: SENTINEL_OWNER,
      original_address1: SENTINEL_ADDRESS,
    },
    {
      permit_number: "2026-100003",
      owner_name: SENTINEL_OWNER,
      original_address1: SENTINEL_ADDRESS,
    },
  ];
  const engine = {
    run: vi.fn(async (_sql: string): Promise<void> => undefined),
    all: vi.fn(async (_sql: string) => rows),
  };
  return { SENTINEL_OWNER, SENTINEL_ADDRESS, SIGNATURE, PREFIX, PRESIGNED, CID, rows, engine };
});

vi.mock("../src/engine/duckdb-node.js", () => ({
  DUCKDB_THREADS: 2,
  getEngine: vi.fn(async () => H.engine),
  bindOnce: vi.fn(async () => {
    throw new Error("bindOnce is not used by these tests");
  }),
  query: vi.fn(async (sql: string) => H.engine.all(sql)),
}));

vi.mock("../src/engine/s3-read.js", () => ({
  getManifest: vi.fn(async () => {
    throw new Error("getManifest is not used by these tests");
  }),
  presignPart: vi.fn(async () => H.PRESIGNED),
  presignPrefix: vi.fn(async (prefix: string) => [
    { key: `${prefix}part-00001.parquet`, url: H.PRESIGNED },
  ]),
}));

import { resetBenchBinding } from "../src/handlers/bench.js";
import { createHandler } from "../src/handlers/trpc.js";
import {
  DIMENSION_PROCEDURE,
  HEADER_CORRELATION_ID,
  HEADER_TRACE_ID,
  METRIC_ITEMS_FAILED,
  METRIC_ITEMS_PROCESSED,
  METRIC_QUERY_DURATION,
  QUERY_SUBSEGMENT,
  SERVICE_NAME,
  createObservability,
  redact,
} from "../src/observability.js";
import { publicProcedure, router } from "../src/trpc.js";

type Segment = NonNullable<ReturnType<Tracer["getSegment"]>>;

interface RecordedSubsegment {
  name: string;
  annotations: Record<string, string | number | boolean>;
  metadata: unknown[];
  errors: string[];
  closed: boolean;
  children: RecordedSubsegment[];
}

/** A segment double that records what the code under test does to the X-Ray tree. */
function recordingSegment(name = "## facade"): { record: RecordedSubsegment; segment: Segment } {
  const record: RecordedSubsegment = {
    name,
    annotations: {},
    metadata: [],
    errors: [],
    closed: false,
    children: [],
  };
  const segment = {
    name,
    addNewSubsegment(childName: string) {
      const child = recordingSegment(childName);
      record.children.push(child.record);
      return child.segment;
    },
    addAnnotation(key: string, value: string | number | boolean) {
      record.annotations[key] = value;
    },
    addMetadata(key: string, value: unknown, namespace?: string) {
      record.metadata.push({ key, value, namespace });
    },
    addError(error: Error) {
      record.errors.push(`${error.name}: ${error.message}`);
    },
    close() {
      record.closed = true;
    },
  };
  return { record, segment: segment as unknown as Segment };
}

const Input = z.object({ manifestCid: z.string() });

/** A router shaped like contracts/api.md, returning fixture rows with sentinel values. */
const testRouter = router({
  runs: router({
    summary: publicProcedure.input(Input).query(({ input }) => ({
      manifestCid: input.manifestCid,
      verified: true,
      tablesBound: 3,
      roofingPermitRows: 37,
      queryDurationMs: 42,
    })),
  }),
  query: router({
    radius: publicProcedure.input(Input).query(() => ({ rows: H.rows, queryDurationMs: 17 })),
  }),
  broken: router({
    read: publicProcedure.input(Input).query(() => {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `not in the copy: ${H.PRESIGNED} (owner ${H.SENTINEL_OWNER})`,
      });
    }),
  }),
});

function lambdaContext(awsRequestId = "lambda-req-0001"): Context {
  return {
    awsRequestId,
    functionName: "countylens-api",
    functionVersion: "$LATEST",
    invokedFunctionArn: "arn:aws:lambda:local:000000000000:function:countylens-api",
    memoryLimitInMB: "3008",
    logGroupName: "/aws/lambda/countylens-api",
    logStreamName: "2026/10/21/[$LATEST]abcdef",
    callbackWaitsForEmptyEventLoop: false,
    getRemainingTimeInMillis: () => 15_000,
    done: () => undefined,
    fail: () => undefined,
    succeed: () => undefined,
  };
}

function apiEvent(
  procedure: string,
  input: unknown,
  overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
  const encoded = JSON.stringify(input);
  return {
    version: "2.0",
    routeKey: "ANY /trpc/{proxy+}",
    rawPath: `/trpc/${procedure}`,
    rawQueryString: `input=${encodeURIComponent(encoded)}`,
    headers: { host: "api.example", accept: "application/json" },
    queryStringParameters: { input: encoded },
    pathParameters: { proxy: procedure },
    requestContext: {
      accountId: "000000000000",
      apiId: "api0000",
      domainName: "api.example",
      domainPrefix: "api",
      http: {
        method: "GET",
        path: `/trpc/${procedure}`,
        protocol: "HTTP/1.1",
        sourceIp: "203.0.113.10",
        userAgent: "vitest",
      },
      requestId: "req-abc-123",
      routeKey: "ANY /trpc/{proxy+}",
      stage: "$default",
      time: "21/Oct/2026:10:00:00 +0000",
      timeEpoch: 1_792_000_000_000,
    },
    isBase64Encoded: false,
    ...overrides,
  };
}

interface Captured {
  info: MockInstance<typeof console.info>;
  log: MockInstance<typeof console.log>;
  warn: MockInstance<typeof console.warn>;
  error: MockInstance<typeof console.error>;
  debug: MockInstance<typeof console.debug>;
}

const parseJson = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const infoLines = (c: Captured): Record<string, unknown>[] =>
  c.info.mock.calls.map((call) => parseJson(call[0])).filter((line) => line !== undefined);

/** Every EMF blob Metrics published (console.log in dev mode), in order. */
const emfBlobs = (c: Captured): Record<string, unknown>[] =>
  c.log.mock.calls
    .map((call) => parseJson(call[0]))
    .filter((blob): blob is Record<string, unknown> => blob !== undefined && "_aws" in blob);

/** Everything written to any console method, as one string, for the IDs-and-counts checks. */
const everything = (c: Captured): string =>
  [c.info, c.log, c.warn, c.error, c.debug]
    .flatMap((spy) => spy.mock.calls)
    .flatMap((call) => call.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))))
    .join("\n");

interface Harness {
  captured: Captured;
  facade: RecordedSubsegment;
  handler: ReturnType<typeof createHandler>;
  tracer: Tracer;
}

function harness(): Harness {
  const captured: Captured = {
    info: vi.spyOn(console, "info").mockImplementation(() => undefined),
    log: vi.spyOn(console, "log").mockImplementation(() => undefined),
    warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
    error: vi.spyOn(console, "error").mockImplementation(() => undefined),
    debug: vi.spyOn(console, "debug").mockImplementation(() => undefined),
  };
  const tracer = new Tracer({ serviceName: SERVICE_NAME, enabled: false });
  const { record: facade, segment } = recordingSegment();
  vi.spyOn(tracer, "getSegment").mockImplementation(() => segment);
  const observability = createObservability({ tracer });
  const handler = createHandler({ router: testRouter, observability });
  return { captured, facade, handler, tracer };
}

async function invoke(
  h: Harness,
  event: APIGatewayProxyEventV2 | Record<string, unknown>,
  context = lambdaContext(),
): Promise<APIGatewayProxyStructuredResultV2> {
  return (await h.handler(event as APIGatewayProxyEventV2, context)) as never;
}

const SENTINELS = (): string[] => [
  H.SENTINEL_OWNER,
  H.SENTINEL_ADDRESS,
  H.SIGNATURE,
  "X-Amz-Signature",
  process.env.CID_COPY_BUCKET ?? "",
  process.env.CID_COPY_HOST ?? "",
  process.env.FILEBASE_GATEWAY_HOST ?? "",
];

describe("apps/api observability (T071)", () => {
  let h: Harness;

  beforeEach(() => {
    H.engine.run.mockClear();
    H.engine.all.mockClear();
    resetBenchBinding(); // ERR-18: every test binds its own view
    h = harness();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes exactly one logger.info per request with correlation_id and queryDurationMs", async () => {
    await invoke(h, apiEvent("runs.summary", { manifestCid: H.CID }));

    const lines = infoLines(h.captured);
    expect(lines).toHaveLength(1);
    const line = lines[0] as Record<string, unknown>;
    expect(line.level).toBe("INFO");
    expect(line.service).toBe(SERVICE_NAME);
    expect(line.correlation_id).toBe("req-abc-123");
    expect(line.xray_trace_id).toBe("1-6f1b2c3d-0123456789abcdef01234567");
    expect(line.procedure).toBe("runs.summary");
    expect(line.queryDurationMs).toBe(42);
    expect(line.rows).toBe(1);
    expect(line.manifestCid).toBe(H.CID);
    expect(line.query).toBe("runSummarySql");
    expect(line.ok).toBe(true);
    expect(typeof line.durationMs).toBe("number");
  });

  it("opens one duckdb.query subsegment annotated with manifestCid and the builder name", async () => {
    await invoke(h, apiEvent("runs.summary", { manifestCid: H.CID }));

    const subsegments = h.facade.children.filter((c) => c.name === QUERY_SUBSEGMENT);
    expect(subsegments).toHaveLength(1);
    const sub = subsegments[0] as RecordedSubsegment;
    expect(sub.annotations).toMatchObject({ manifestCid: H.CID, query: "runSummarySql" });
    expect(sub.annotations.query).not.toMatch(/select/i);
    expect(sub.closed).toBe(true);
  });

  it("emits QueryDurationMs, ItemsProcessed and ItemsFailed=0 with the procedure dimension", async () => {
    await invoke(h, apiEvent("query.radius", { manifestCid: H.CID }));

    const blob = emfBlobs(h.captured).find((b) => METRIC_QUERY_DURATION in b);
    expect(blob).toBeDefined();
    const emf = blob as Record<string, unknown>;
    const aws = emf._aws as {
      CloudWatchMetrics: { Dimensions: string[][]; Metrics: { Name: string; Unit: string }[] }[];
    };
    const group = aws.CloudWatchMetrics[0];
    expect(group).toBeDefined();
    const units = Object.fromEntries((group?.Metrics ?? []).map((m) => [m.Name, m.Unit]));
    expect(units[METRIC_QUERY_DURATION]).toBe("Milliseconds");
    expect(units[METRIC_ITEMS_PROCESSED]).toBe("Count");
    expect(units[METRIC_ITEMS_FAILED]).toBe("Count");
    expect(group?.Dimensions.some((set) => set.includes(DIMENSION_PROCEDURE))).toBe(true);
    expect(emf[DIMENSION_PROCEDURE]).toBe("query.radius");
    expect(emf.service).toBe(SERVICE_NAME);
    expect(emf[METRIC_QUERY_DURATION]).toBe(17);
    expect(emf[METRIC_ITEMS_PROCESSED]).toBe(3);
    expect(emf[METRIC_ITEMS_FAILED]).toBe(0);
  });

  it("captures the cold-start metric on the first invocation only", async () => {
    await invoke(h, apiEvent("runs.summary", { manifestCid: H.CID }));
    expect(emfBlobs(h.captured).filter((b) => "ColdStart" in b)).toHaveLength(1);
    await invoke(h, apiEvent("runs.summary", { manifestCid: H.CID }));
    expect(emfBlobs(h.captured).filter((b) => "ColdStart" in b)).toHaveLength(1);
  });

  it("sets x-correlation-id and x-trace-id on the response", async () => {
    const result = await invoke(h, apiEvent("runs.summary", { manifestCid: H.CID }));

    expect(result.statusCode).toBe(200);
    expect(result.headers?.[HEADER_CORRELATION_ID]).toBe("req-abc-123");
    expect(result.headers?.[HEADER_TRACE_ID]).toBe("1-6f1b2c3d-0123456789abcdef01234567");
  });

  it("keeps the headers on an error response and counts the failure", async () => {
    const result = await invoke(h, apiEvent("broken.read", { manifestCid: H.CID }));

    expect(result.statusCode).toBe(404);
    expect(result.headers?.[HEADER_CORRELATION_ID]).toBe("req-abc-123");
    expect(result.headers?.[HEADER_TRACE_ID]).toBe("1-6f1b2c3d-0123456789abcdef01234567");

    const lines = infoLines(h.captured);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      procedure: "broken.read",
      ok: false,
      statusCode: 404,
      errorCode: "NOT_FOUND",
    });
    const emf = emfBlobs(h.captured).find((b) => METRIC_QUERY_DURATION in b);
    expect(emf?.[METRIC_ITEMS_FAILED]).toBe(1);
    expect(emf?.[METRIC_ITEMS_PROCESSED]).toBe(0);
  });

  it("never writes a row value, a presigned URL or an env value to any log, annotation or metadata (FR-007)", async () => {
    await invoke(h, apiEvent("query.radius", { manifestCid: H.CID }));
    await invoke(h, apiEvent("broken.read", { manifestCid: H.CID }));
    await invoke(h, {
      kind: "bench",
      query: "radius",
      preset: "TC_NF_05",
      prefix: H.PREFIX,
    });

    // The engine really received the presigned URL (the view over the private parts) …
    expect(H.engine.run.mock.calls.some((call) => call[0].includes(H.SIGNATURE))).toBe(true);
    // … and the fixture rows really carried the sentinels …
    expect(JSON.stringify(H.rows)).toContain(H.SENTINEL_OWNER);
    // … but none of it reached the console, the annotations or the metadata.
    const output = everything(h.captured);
    const trace = JSON.stringify(h.facade);
    for (const sentinel of SENTINELS()) {
      expect(sentinel.length).toBeGreaterThan(0);
      expect(output).not.toContain(sentinel);
      expect(trace).not.toContain(sentinel);
    }
    expect(infoLines(h.captured)).toHaveLength(3);
  });

  it("logs a direct-invoke bench run under procedure bench.<query> with the Lambda request id", async () => {
    const result = (await invoke(
      h,
      { kind: "bench", query: "roofAge", preset: "ADR_0001", prefix: H.PREFIX },
      lambdaContext("bench-req-77"),
    )) as unknown as Record<string, unknown>;

    expect(result.query).toBe("roofAge");
    expect(typeof result.queryDurationMs).toBe("number");
    expect(typeof result.initMs).toBe("number");
    expect(typeof result.coldStart).toBe("boolean");

    const lines = infoLines(h.captured);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      procedure: "bench.roofAge",
      query: "benchRoofAgeSql",
      correlation_id: "bench-req-77",
      rows: 3,
      ok: true,
    });
    expect(lines[0]?.queryDurationMs).toBe(result.queryDurationMs);

    const sub = h.facade.children.find((c) => c.name === QUERY_SUBSEGMENT);
    expect(sub?.annotations).toMatchObject({ query: "benchRoofAgeSql", preset: "ADR_0001" });
    const emf = emfBlobs(h.captured).find((b) => METRIC_QUERY_DURATION in b);
    expect(emf?.[DIMENSION_PROCEDURE]).toBe("bench.roofAge");
    expect(emf?.[METRIC_ITEMS_PROCESSED]).toBe(3);
  });

  it("does not annotate a manifestCid that is not a CIDv1 (input junk stays out of traces)", async () => {
    await invoke(h, apiEvent("runs.summary", { manifestCid: `ipfs/${H.SENTINEL_OWNER}` }));

    const sub = h.facade.children.find((c) => c.name === QUERY_SUBSEGMENT);
    expect(sub).toBeDefined();
    expect(sub?.annotations).not.toHaveProperty("manifestCid");
    expect(everything(h.captured)).not.toContain(H.SENTINEL_OWNER);
  });

  it("works with the real Tracer in no-op mode (no segment available)", async () => {
    vi.restoreAllMocks();
    const captured: Captured = {
      info: vi.spyOn(console, "info").mockImplementation(() => undefined),
      log: vi.spyOn(console, "log").mockImplementation(() => undefined),
      warn: vi.spyOn(console, "warn").mockImplementation(() => undefined),
      error: vi.spyOn(console, "error").mockImplementation(() => undefined),
      debug: vi.spyOn(console, "debug").mockImplementation(() => undefined),
    };
    const observability = createObservability({
      tracer: new Tracer({ serviceName: SERVICE_NAME, enabled: false }),
    });
    const handler = createHandler({ router: testRouter, observability });

    const result = (await handler(
      apiEvent("runs.summary", { manifestCid: H.CID }),
      lambdaContext(),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(result.headers?.[HEADER_TRACE_ID]).toBe("1-6f1b2c3d-0123456789abcdef01234567");
    expect(infoLines(captured)).toHaveLength(1);
  });

  it("redact() strips presigned URLs and signatures from error text", () => {
    const text = `read failed for ${H.PRESIGNED} and X-Amz-Signature=${H.SIGNATURE} again`;
    const safe = redact(text);
    expect(safe).not.toContain(H.SIGNATURE);
    expect(safe).not.toContain(process.env.CID_COPY_BUCKET ?? "");
    expect(safe).not.toContain("X-Amz-Signature=");
    expect(safe).toContain("read failed for");
  });
});
