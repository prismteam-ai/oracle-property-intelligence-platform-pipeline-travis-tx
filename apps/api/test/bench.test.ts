// A-03 T063 (G-C2b): the direct-invoke bench branch (contracts/api.md "Direct-invoke bench
// event", ADR-0001 "Lambda proof", research R-02) and the operator script that drives it.
// Written before src/handlers/bench.ts and scripts/bench-lambda.ts exist: the red run fails
// with "Cannot find module '../src/handlers/bench'".
//
// The bench event is Zod-validated: `kind: "bench"`, `query` in {count, radius, roofAge},
// `preset` in {TC_NF_05, ADR_0001}, `prefix` matching ^private/bench/[a-z0-9-]+/$ and nothing
// else. Only a direct invocation reaches it: an API Gateway event carrying `kind` is rejected
// before any part is listed. The bench lists the parts under the prefix, presigns them, binds
// them on the same engine as the procedures and runs the bench-sql.ts builder for the preset,
// returning `{query, rows, queryDurationMs, initMs, coldStart}`. `scripts/bench-lambda.ts`
// refuses any prefix outside READPATH_PRIVATE_PREFIX, runs one warm-up plus 20 timed
// invocations per query and preset and reports p50/p95 (nearest rank) from `queryDurationMs`.
// The engine and the S3 reads are module mocks; the script's Lambda invoke is a fake.
import {
  BENCH_PRESETS,
  benchCountSql,
  benchRadiusSql,
  benchRoofAgeSql,
} from "@countylens/query-core";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => {
  process.env.POWERTOOLS_DEV = "true";
  process.env.POWERTOOLS_METRICS_DISABLED = "false";
  process.env.POWERTOOLS_TRACE_ENABLED = "false";
  process.env.CID_COPY_BUCKET = "copy-bucket";
  process.env.CID_COPY_HOST = "copy.example";
  process.env.FILEBASE_GATEWAY_HOST = "gateway.example";
  process.env.READPATH_PRIVATE_PREFIX = "private/bench/";

  const SENTINEL_ADDRESS = "4242 SENTINEL LANE UNIT 9Z";
  const PREFIX = "private/bench/austin-48m/";
  const presigned = (name: string): string =>
    `https://copy-bucket.s3.example/${PREFIX}${name}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=SIG${name}`;
  const rows = [
    { permit_number: "2026-100001", original_address1: SENTINEL_ADDRESS, d_m: 12.5 },
    { permit_number: "2026-100002", original_address1: SENTINEL_ADDRESS, d_m: 40.1 },
  ];
  const engine = {
    run: vi.fn(async (_sql: string): Promise<void> => undefined),
    all: vi.fn(async (_sql: string): Promise<Record<string, unknown>[]> => rows),
  };
  const getEngine = vi.fn(async () => engine);
  const presignPrefix = vi.fn(async (prefix: string) =>
    ["part-00001.parquet", "part-00002.parquet"].map((name) => ({
      key: `${prefix}${name}`,
      url: presigned(name),
    })),
  );
  return { SENTINEL_ADDRESS, PREFIX, presigned, rows, engine, getEngine, presignPrefix };
});

vi.mock("../src/engine/duckdb-node.js", () => ({
  DUCKDB_THREADS: 2,
  getEngine: H.getEngine,
  bindOnce: vi.fn(async () => {
    throw new Error("bindOnce is not used by these tests");
  }),
  query: vi.fn(async (sql: string) => H.engine.all(sql)),
}));

vi.mock("../src/engine/s3-read.js", () => ({
  getManifest: vi.fn(async () => {
    throw new Error("getManifest is not used by these tests");
  }),
  presignPart: vi.fn(async () => {
    throw new Error("presignPart is not used by these tests");
  }),
  presignPrefix: H.presignPrefix,
}));

import {
  BENCH_PREFIX_PATTERN,
  BENCH_PRESET_NAMES,
  BENCH_QUERIES,
  BenchEvent,
  benchBuilderName,
  isBenchEvent,
  resetBenchBinding,
  runBench,
} from "../src/handlers/bench.js";
import { BENCH_VIA_API_MESSAGE, createHandler } from "../src/handlers/trpc.js";
import { loadConfig } from "../src/config.js";
import { createObservability } from "../src/observability.js";
import {
  BENCH_PRESET_NAMES as SCRIPT_PRESET_NAMES,
  BENCH_QUERIES as SCRIPT_QUERIES,
  DEFAULT_RUNS,
  DEFAULT_WARMUP,
  assertBenchPrefix,
  formatReport,
  percentile,
  runBench as runBenchScript,
  type BenchInvoke,
} from "../../../scripts/bench-lambda.js";

const config = loadConfig({
  CID_COPY_BUCKET: "copy-bucket",
  CID_COPY_HOST: "copy.example",
  FILEBASE_GATEWAY_HOST: "gateway.example",
  READPATH_PRIVATE_PREFIX: "private/bench/",
});

const VALID = { kind: "bench", query: "radius", preset: "TC_NF_05", prefix: H.PREFIX } as const;

function lambdaContext(awsRequestId = "bench-req-1"): Context {
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

describe("bench event schema (contracts/api.md)", () => {
  it("accepts kind bench with a known query, preset and private/bench/<name>/ prefix", () => {
    expect(BenchEvent.parse(VALID)).toEqual(VALID);
    expect([...BENCH_QUERIES]).toEqual(["count", "radius", "roofAge"]);
    expect([...BENCH_PRESET_NAMES]).toEqual(["TC_NF_05", "ADR_0001"]);
    expect(Object.keys(BENCH_PRESETS).sort()).toEqual([...BENCH_PRESET_NAMES].sort());
    expect(BENCH_PREFIX_PATTERN.source).toBe("^private\\/bench\\/[a-z0-9-]+\\/$");
  });

  it.each([
    ["kind", { ...VALID, kind: "query" }],
    ["query", { ...VALID, query: "listRoofingPermits" }],
    ["preset", { ...VALID, preset: "SPIKE" }],
    ["prefix (ipfs/)", { ...VALID, prefix: "ipfs/" }],
    ["prefix (root of the bench prefix)", { ...VALID, prefix: "private/bench/" }],
    ["prefix (upper case)", { ...VALID, prefix: "private/bench/Austin/" }],
    ["prefix (nested)", { ...VALID, prefix: "private/bench/a/b/" }],
    ["prefix (no trailing slash)", { ...VALID, prefix: "private/bench/austin" }],
    ["prefix (other private tree)", { ...VALID, prefix: "private/other/austin/" }],
    ["unknown key", { ...VALID, sql: "SELECT 1" }],
    ["missing prefix", { kind: "bench", query: "count", preset: "TC_NF_05" }],
  ])("rejects an event with a bad %s", (_label, event) => {
    expect(BenchEvent.safeParse(event).success).toBe(false);
  });

  it("isBenchEvent is true only for an object carrying kind", () => {
    expect(isBenchEvent(VALID)).toBe(true);
    expect(isBenchEvent({ kind: "anything" })).toBe(true);
    expect(isBenchEvent(apiEvent("runs.summary", {}))).toBe(false);
    expect(isBenchEvent(null)).toBe(false);
    expect(isBenchEvent("bench")).toBe(false);
  });

  it("maps every query to its bench-sql.ts builder name (never SQL text)", () => {
    expect(benchBuilderName("count")).toBe("benchCountSql");
    expect(benchBuilderName("radius")).toBe("benchRadiusSql");
    expect(benchBuilderName("roofAge")).toBe("benchRoofAgeSql");
  });
});

describe("runBench (apps/api/src/handlers/bench.ts)", () => {
  beforeEach(() => {
    H.engine.run.mockClear();
    H.engine.all.mockClear();
    H.getEngine.mockClear();
    H.presignPrefix.mockClear();
    resetBenchBinding();
  });

  it("lists and presigns the parts, binds them as the spike relation t and runs the preset's builder", async () => {
    const result = await runBench(VALID, { config, coldStart: true });

    expect(H.presignPrefix).toHaveBeenCalledWith(H.PREFIX);
    expect(H.engine.run).toHaveBeenCalledTimes(1);
    const bind = H.engine.run.mock.calls[0]?.[0] ?? "";
    expect(bind).toMatch(/read_parquet/i);
    expect(bind).toContain(H.presigned("part-00001.parquet"));
    expect(bind).toContain(H.presigned("part-00002.parquet"));
    expect(bind).toMatch(/\bt\b/);
    expect(H.engine.all).toHaveBeenCalledWith(benchRadiusSql(BENCH_PRESETS.TC_NF_05));

    expect(result.query).toBe("radius");
    expect(result.preset).toBe("TC_NF_05");
    expect(result.rows).toEqual(H.rows);
    expect(result.coldStart).toBe(true);
    expect(result.queryDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.initMs).toBeGreaterThanOrEqual(0);
  });

  it("runs benchCountSql for count and benchRoofAgeSql with the ADR_0001 preset for roofAge", async () => {
    await runBench({ ...VALID, query: "count" }, { config, coldStart: false });
    expect(H.engine.all).toHaveBeenLastCalledWith(benchCountSql());
    await runBench(
      { ...VALID, query: "roofAge", preset: "ADR_0001" },
      { config, coldStart: false },
    );
    expect(H.engine.all).toHaveBeenLastCalledWith(benchRoofAgeSql(BENCH_PRESETS.ADR_0001));
  });

  it("returns JSON-safe rows (DuckDB BIGINT counts become numbers)", async () => {
    H.engine.all.mockResolvedValueOnce([{ n: 2_380_939n }]);
    const result = await runBench({ ...VALID, query: "count" }, { config, coldStart: false });
    expect(result.rows).toEqual([{ n: 2_380_939 }]);
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("refuses a prefix outside the configured READPATH_PRIVATE_PREFIX before listing anything", async () => {
    const other = { ...config, readPathPrivatePrefix: "private/other/" };
    await expect(runBench(VALID, { config: other, coldStart: false })).rejects.toThrow(
      "private/other/",
    );
    expect(H.presignPrefix).not.toHaveBeenCalled();
    expect(H.engine.all).not.toHaveBeenCalled();
  });

  // ERR-18 lever 2: re-binding the view every invocation threw away DuckDB's footer and chunk
  // caches (they are keyed by URL). A warm sandbox keeps the view while the parts' URLs are the
  // same (presignPrefix reuses them per ETag) and re-binds only when they change.
  it("ERR-18: keeps the bound view across invocations while the presigned URLs are unchanged", async () => {
    await runBench(VALID, { config, coldStart: true });
    const second = await runBench({ ...VALID, query: "roofAge" }, { config, coldStart: false });
    expect(H.presignPrefix).toHaveBeenCalledTimes(2); // listed every time (a removed part is seen)
    expect(H.engine.run).toHaveBeenCalledTimes(1); // bound once
    // No re-bind happened (engine.run was called once above); bindMs only times the skipped branch, which can read a few ms on a loaded CI runner (12 ms seen), so it is bounded, not exactly 0.
    expect(second.bindMs).toBeLessThan(250);
    expect(H.engine.all).toHaveBeenLastCalledWith(benchRoofAgeSql(BENCH_PRESETS.TC_NF_05));
  });

  it("ERR-18: re-binds when the parts' URLs change (new ETag, re-signed URL or another prefix)", async () => {
    await runBench(VALID, { config, coldStart: true });
    H.presignPrefix.mockResolvedValueOnce([
      {
        key: `${H.PREFIX}part-00001.parquet`,
        url: `${H.presigned("part-00001.parquet")}-resigned`,
      },
    ]);
    await runBench(VALID, { config, coldStart: false });
    expect(H.engine.run).toHaveBeenCalledTimes(2);
    expect(H.engine.run.mock.calls[1]?.[0]).toContain("-resigned");
    expect(H.engine.run.mock.calls[1]?.[0]).not.toContain("part-00002");
  });

  it("ERR-18: re-binds after the engine was re-opened (a failed open is not kept)", async () => {
    await runBench(VALID, { config, coldStart: true });
    const reopened = { run: vi.fn(async () => undefined), all: vi.fn(async () => H.rows) };
    H.getEngine.mockResolvedValueOnce(reopened);
    await runBench(VALID, { config, coldStart: false });
    expect(reopened.run).toHaveBeenCalledTimes(1);
  });

  it("fails when the prefix holds no parquet part", async () => {
    H.presignPrefix.mockResolvedValueOnce([]);
    await expect(runBench(VALID, { config, coldStart: false })).rejects.toThrow(/no .*parquet/i);
    expect(H.engine.all).not.toHaveBeenCalled();
  });
});

describe("handler routing of bench events (handlers/trpc.ts)", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    H.engine.all.mockClear();
    H.presignPrefix.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const handlerUnderTest = () => createHandler({ observability: createObservability() });

  it("rejects an API Gateway event carrying kind with 400 and runs no bench", async () => {
    const handler = handlerUnderTest();
    const event = { ...apiEvent("runs.summary", { manifestCid: "x" }), ...VALID };

    const result = (await handler(event, lambdaContext())) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(result.body).toContain(BENCH_VIA_API_MESSAGE);
    expect(result.headers?.["x-correlation-id"]).toBe("req-abc-123");
    expect(H.presignPrefix).not.toHaveBeenCalled();
    expect(H.engine.all).not.toHaveBeenCalled();
  });

  it("treats kind inside an API Gateway request body or input as ordinary tRPC input (no bench)", async () => {
    const handler = handlerUnderTest();
    const asInput = apiEvent("bench", VALID);
    const asBody = apiEvent(
      "bench",
      {},
      {
        body: JSON.stringify(VALID),
        requestContext: {
          ...apiEvent("bench", {}).requestContext,
          http: { ...apiEvent("bench", {}).requestContext.http, method: "POST" },
        },
      },
    );

    for (const event of [asInput, asBody]) {
      const result = (await handler(event, lambdaContext())) as APIGatewayProxyStructuredResultV2;
      expect(result.statusCode).toBeGreaterThanOrEqual(400);
      expect(result.statusCode).toBeLessThan(500);
    }
    expect(H.presignPrefix).not.toHaveBeenCalled();
    expect(H.engine.all).not.toHaveBeenCalled();
  });

  it("rejects an invalid direct-invoke bench event without listing parts", async () => {
    const handler = handlerUnderTest();
    await expect(
      handler({ ...VALID, preset: "NOPE" } as unknown as APIGatewayProxyEventV2, lambdaContext()),
    ).rejects.toThrow(/preset/);
    await expect(
      handler({ ...VALID, prefix: "ipfs/" } as unknown as APIGatewayProxyEventV2, lambdaContext()),
    ).rejects.toThrow(/prefix/);
    expect(H.presignPrefix).not.toHaveBeenCalled();
  });

  it("runs a valid direct-invoke bench event and reports the sandbox's cold start once", async () => {
    const handler = handlerUnderTest();
    const first = (await handler(
      VALID as unknown as APIGatewayProxyEventV2,
      lambdaContext("req-1"),
    )) as unknown as Record<string, unknown>;
    const second = (await handler(
      VALID as unknown as APIGatewayProxyEventV2,
      lambdaContext("req-2"),
    )) as unknown as Record<string, unknown>;

    expect(first).toMatchObject({ query: "radius", preset: "TC_NF_05", coldStart: true });
    expect(second).toMatchObject({ query: "radius", preset: "TC_NF_05", coldStart: false });
    expect(first.rows).toEqual(H.rows);
    expect(typeof first.queryDurationMs).toBe("number");
    expect(typeof first.initMs).toBe("number");
    expect(H.engine.all).toHaveBeenCalledTimes(2);
  });

  it("rejects an event that is neither an HTTP API request nor a bench event", async () => {
    const handler = handlerUnderTest();
    await expect(
      handler({ hello: "world" } as unknown as APIGatewayProxyEventV2, lambdaContext()),
    ).rejects.toThrow(/direct-invoke bench event/);
  });
});

describe("scripts/bench-lambda.ts", () => {
  const PRIVATE = "private/bench/";

  it("names the same queries and presets as the Lambda", () => {
    expect([...SCRIPT_QUERIES]).toEqual([...BENCH_QUERIES]);
    expect([...SCRIPT_PRESET_NAMES]).toEqual([...BENCH_PRESET_NAMES]);
    expect(DEFAULT_RUNS).toBe(20);
    expect(DEFAULT_WARMUP).toBe(1);
  });

  it("accepts a prefix under READPATH_PRIVATE_PREFIX and refuses every other one", () => {
    expect(() => assertBenchPrefix("private/bench/austin-48m/", PRIVATE)).not.toThrow();
    expect(() => assertBenchPrefix("ipfs/", PRIVATE)).toThrow(
      "Refused prefix ipfs/: bench-lambda only reads under private/bench/",
    );
    expect(() => assertBenchPrefix("private/bench/austin-48m/", "private/other/")).toThrow(
      "Refused prefix private/bench/austin-48m/: bench-lambda only reads under private/other/",
    );
    expect(() => assertBenchPrefix("private/bench/", PRIVATE)).toThrow(/Refused prefix/);
    expect(() => assertBenchPrefix("private/bench/Austin/", PRIVATE)).toThrow(/Refused prefix/);
    expect(() => assertBenchPrefix("private/bench/austin-48m", PRIVATE)).toThrow(/Refused prefix/);
  });

  it("computes nearest-rank percentiles as ADR-0001 does (p50 = 10th, p95 = 19th of 20)", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => 20 - i); // 20 … 1
    expect(percentile(twenty, 50)).toBe(10);
    expect(percentile(twenty, 95)).toBe(19);
    expect(percentile([7], 95)).toBe(7);
    expect(() => percentile([], 50)).toThrow();
  });

  it("refuses a prefix outside READPATH_PRIVATE_PREFIX before any invocation", async () => {
    const invoke: BenchInvoke = vi.fn(async () => {
      throw new Error("must not be called");
    });
    await expect(
      runBenchScript({ prefix: "ipfs/", privatePrefix: PRIVATE, invoke }),
    ).rejects.toThrow("Refused prefix ipfs/: bench-lambda only reads under private/bench/");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("runs one untimed warm-up then 20 timed invocations per query and preset and reports p50/p95 from queryDurationMs", async () => {
    let i = 0;
    const invoke = vi.fn<BenchInvoke>(async (event) => {
      i += 1;
      const k = ((i - 1) % 21) + 1; // 1 = the warm-up of a pair, then 20 timed runs
      return {
        query: event.query,
        preset: event.preset,
        prefix: event.prefix,
        rows: [{ original_address1: H.SENTINEL_ADDRESS }],
        queryDurationMs: k === 1 ? 999 : 22 - k, // warm-up 999, then 20 … 1
        initMs: k === 1 ? 850 : 0,
        coldStart: k === 1,
      };
    });

    const report = await runBenchScript({
      prefix: "private/bench/austin-48m/",
      privatePrefix: PRIVATE,
      invoke,
    });

    expect(invoke).toHaveBeenCalledTimes((DEFAULT_WARMUP + DEFAULT_RUNS) * 3 * 2);
    for (const call of invoke.mock.calls) {
      expect(call[0]).toMatchObject({ kind: "bench", prefix: "private/bench/austin-48m/" });
      expect(Object.keys(call[0]).sort()).toEqual(["kind", "prefix", "preset", "query"]);
    }
    expect(report.results).toHaveLength(6);
    expect(report.results.map((r) => `${r.query}/${r.preset}`)).toEqual([
      "count/TC_NF_05",
      "count/ADR_0001",
      "radius/TC_NF_05",
      "radius/ADR_0001",
      "roofAge/TC_NF_05",
      "roofAge/ADR_0001",
    ]);
    for (const r of report.results) {
      expect(r.timingsMs).toHaveLength(20);
      expect(r.timingsMs).not.toContain(999);
      expect(r.p50Ms).toBe(10);
      expect(r.p95Ms).toBe(19);
      expect(r.rows).toBe(1);
      expect(r.coldStarts).toBe(0);
    }

    const text = formatReport(report).join("\n");
    expect(text).toContain("radius");
    expect(text).toContain("p95");
    expect(text).not.toContain(H.SENTINEL_ADDRESS);
  });

  it("honours runs, warm-up, query and preset selections", async () => {
    const invoke = vi.fn<BenchInvoke>(async (event) => ({
      query: event.query,
      preset: event.preset,
      prefix: event.prefix,
      rows: [],
      queryDurationMs: 5,
      initMs: 0,
      coldStart: false,
    }));
    const report = await runBenchScript({
      prefix: "private/bench/austin-48m/",
      privatePrefix: PRIVATE,
      invoke,
      queries: ["radius"],
      presets: ["TC_NF_05"],
      runs: 3,
      warmup: 0,
    });
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(report.results).toEqual([
      expect.objectContaining({
        query: "radius",
        preset: "TC_NF_05",
        timingsMs: [5, 5, 5],
        p50Ms: 5,
        p95Ms: 5,
        rows: 0,
      }),
    ]);
  });
});
