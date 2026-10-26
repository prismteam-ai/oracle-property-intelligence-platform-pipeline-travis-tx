// A-03 T073 (G-C2b): the Lambda entry point the CDK Api stack bundles (infra T074). One
// function, two event shapes:
//   - an API Gateway HTTP API (v2) request → the tRPC AWS Lambda adapter over `appRouter`;
//   - a direct-invoke bench event `{ kind: "bench", … }` → handlers/bench.ts.
// An API Gateway event that carries `kind` is answered 400 and never reaches the bench; an
// event that is neither shape is rejected. middy wires Powertools: `injectLambdaContext`
// (correlation ID = the HTTP API request ID via `correlationPaths.API_GATEWAY_HTTP`, else the
// Lambda request ID for a direct invoke), `captureLambdaHandler` with `captureResponse: false`
// (row values never become trace metadata) and `logMetrics({ captureColdStartMetric: true })`.
// `observeQuery` (src/observability.ts) emits the one log line, the `duckdb.query` subsegment
// and the three business metrics per request; every response carries `x-correlation-id` and
// `x-trace-id` (contracts/api.md). Only identifiers and counts are read from the request and the
// response for that purpose: the procedure name from the path, `manifestCid` from the input (only
// when it is a CIDv1), `queryDurationMs` and the row count from the result envelope.
import { correlationPaths } from "@aws-lambda-powertools/logger/correlationId";
import { injectLambdaContext } from "@aws-lambda-powertools/logger/middleware";
import { logMetrics } from "@aws-lambda-powertools/metrics/middleware";
import { captureLambdaHandler } from "@aws-lambda-powertools/tracer/middleware";
import { isCidV1 } from "@countylens/contract";
import middy from "@middy/core";
import type { AnyRouter } from "@trpc/server";
import { awsLambdaRequestHandler } from "@trpc/server/adapters/aws-lambda";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context as LambdaContext,
} from "aws-lambda";
import { asProxyRouteEvent, createContext } from "../context.js";
import {
  HEADER_CORRELATION_ID,
  HEADER_TRACE_ID,
  createObservability,
  observeQuery,
  responseHeaders,
  type Observability,
  type QueryOutcome,
} from "../observability.js";
import { appRouter } from "../routers/index.js";
import {
  BenchEvent,
  isBenchEvent,
  runBench,
  type BenchResult,
  type BenchRunOptions,
} from "./bench.js";

export const BENCH_VIA_API_MESSAGE = "bench events are accepted by direct invocation only";

/** A bench response also names the IDs that find its log line and trace (TC-NF-05 evidence). */
export type BenchResponse = BenchResult & { correlationId: string; traceId?: string };

export type LambdaEvent = APIGatewayProxyEventV2 | BenchEvent;
export type LambdaResult = APIGatewayProxyStructuredResultV2 | BenchResponse;
export type TrpcHandler = (event: LambdaEvent, context: LambdaContext) => Promise<LambdaResult>;

export interface HandlerOptions {
  /** Defaults to `appRouter`; tests pass a fixture router. */
  readonly router?: AnyRouter;
  /** Defaults to one Powertools set per sandbox. */
  readonly observability?: Observability;
  /** Defaults to `runBench`. */
  readonly bench?: (event: BenchEvent, options: BenchRunOptions) => Promise<BenchResult>;
}

/** An HTTP API v2 payload: a request context plus a raw path (or the version marker). */
export function isApiGatewayEvent(event: unknown): event is APIGatewayProxyEventV2 {
  if (typeof event !== "object" || event === null) return false;
  const candidate = event as Record<string, unknown>;
  return (
    typeof candidate.requestContext === "object" &&
    candidate.requestContext !== null &&
    (typeof candidate.rawPath === "string" || candidate.version === "2.0")
  );
}

const PROCEDURE_NAME = /^[A-Za-z0-9_.,]+$/;

/** The procedure name(s) of a request (`runs.summary`; a batch joins them with commas). */
export function procedureOf(event: APIGatewayProxyEventV2): string {
  const fromRoute = event.pathParameters?.proxy;
  const fromPath = event.rawPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .at(-1);
  const name = (fromRoute ?? fromPath ?? "").split("?")[0] ?? "";
  return PROCEDURE_NAME.test(name) ? name : "unknown";
}

/** True when a batched request (comma-joined procedure names) includes explore.search. */
export function isBatchedExploreSearch(procedure: string): boolean {
  const names = procedure.split(",");
  return names.length > 1 && names.includes("explore.search");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function cidField(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const cid = value.manifestCid;
  return typeof cid === "string" && isCidV1(cid) ? cid : undefined;
}

/** The request's `manifestCid` when it is a CIDv1 (plain or batched input), else undefined. */
export function manifestCidOf(event: APIGatewayProxyEventV2): string | undefined {
  const source =
    event.queryStringParameters?.input ??
    (typeof event.body === "string" && !event.isBase64Encoded ? event.body : undefined);
  if (source === undefined) return undefined;
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch {
    return undefined;
  }
  const direct = cidField(input);
  if (direct !== undefined) return direct;
  if (isRecord(input)) {
    for (const value of Object.values(input)) {
      const nested = cidField(value);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

export interface ResponseSummary {
  readonly ok: boolean;
  readonly rows: number;
  readonly queryDurationMs?: number;
  readonly statusCode: number;
  readonly errorCode?: string;
}

/**
 * Counts and durations from a tRPC response envelope (`{result:{data}}`, `{error:{…}}` or a
 * batch array of them): rows = `data.rows.length` when the procedure returns rows, else one
 * result row; `queryDurationMs` summed over the batch; the tRPC error code on failure.
 * Row values are never read.
 */
export function summariseResponse(result: APIGatewayProxyStructuredResultV2): ResponseSummary {
  const statusCode = result.statusCode ?? 200;
  let ok = statusCode < 400;
  let rows = 0;
  let queryDurationMs: number | undefined;
  let errorCode: string | undefined;

  let body: unknown;
  try {
    body = typeof result.body === "string" ? JSON.parse(result.body) : undefined;
  } catch {
    body = undefined;
  }
  for (const envelope of Array.isArray(body) ? body : [body]) {
    if (!isRecord(envelope)) continue;
    if (isRecord(envelope.error)) {
      ok = false;
      const json = isRecord(envelope.error.json) ? envelope.error.json : envelope.error;
      const data = isRecord(json.data) ? json.data : undefined;
      if (typeof data?.code === "string") errorCode = data.code;
      continue;
    }
    const data = isRecord(envelope.result) ? envelope.result.data : undefined;
    if (data === undefined) continue;
    if (isRecord(data)) {
      rows += Array.isArray(data.rows) ? data.rows.length : 1;
      if (typeof data.queryDurationMs === "number") {
        queryDurationMs = (queryDurationMs ?? 0) + data.queryDurationMs;
      }
    } else {
      rows += 1;
    }
  }

  return {
    ok,
    rows: ok ? rows : 0,
    statusCode,
    ...(queryDurationMs !== undefined ? { queryDurationMs } : {}),
    ...(errorCode !== undefined ? { errorCode } : {}),
  };
}

function benchIssues(parsed: ReturnType<typeof BenchEvent.safeParse>): string {
  if (parsed.success) return "";
  return parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "event"}: ${issue.message}`)
    .join("; ");
}

export function createHandler(options: HandlerOptions = {}): TrpcHandler {
  const router = options.router ?? appRouter;
  const obs = options.observability ?? createObservability();
  const bench = options.bench ?? runBench;
  const trpc = awsLambdaRequestHandler({ router, createContext });

  const core = async (event: LambdaEvent, context: LambdaContext): Promise<LambdaResult> => {
    const coldStart = obs.state.invocations === 0;

    if (isBenchEvent(event)) {
      if (isApiGatewayEvent(event)) {
        obs.logger.warn("bench event rejected: received through API Gateway");
        return {
          statusCode: 400,
          headers: {
            "content-type": "application/json",
            ...responseHeaders(obs, context.awsRequestId),
          },
          body: JSON.stringify({ error: BENCH_VIA_API_MESSAGE }),
        };
      }
      const parsed = BenchEvent.safeParse(event);
      if (!parsed.success) throw new Error(`Invalid bench event: ${benchIssues(parsed)}`);
      const headers = responseHeaders(obs, context.awsRequestId);
      const traceId = headers[HEADER_TRACE_ID];
      return observeQuery(
        obs,
        {
          procedure: `bench.${parsed.data.query}`,
          preset: parsed.data.preset,
          prefix: parsed.data.prefix,
        },
        async (): Promise<QueryOutcome<BenchResponse>> => {
          const result = await bench(parsed.data, { coldStart });
          return {
            value: {
              ...result,
              correlationId: headers[HEADER_CORRELATION_ID] ?? context.awsRequestId,
              ...(traceId !== undefined ? { traceId } : {}),
            },
            ok: true,
            rows: result.rows.length,
            queryDurationMs: result.queryDurationMs,
          };
        },
      );
    }

    if (!isApiGatewayEvent(event)) {
      throw new Error(
        "Unsupported event: expected an API Gateway HTTP API request or a direct-invoke bench event",
      );
    }

    const headers = responseHeaders(obs, context.awsRequestId);
    // explore.search has its own route throttle; a batch through the proxy route would skip it
    // (metagross review, Major 1), so a batch that names it is refused before any work runs.
    if (isApiGatewayEvent(event) && isBatchedExploreSearch(procedureOf(event))) {
      return {
        statusCode: 400,
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          error: { code: "BAD_REQUEST", message: "explore.search cannot be batched" },
        }),
      };
    }
    const manifestCid = manifestCidOf(event);
    const response = await observeQuery(
      obs,
      {
        procedure: procedureOf(event),
        ...(manifestCid !== undefined ? { manifestCid } : {}),
      },
      async (): Promise<QueryOutcome<APIGatewayProxyStructuredResultV2>> => {
        // A-16: `ANY /trpc/explore.search` (own throttle) answers as the proxy route would.
        const value = await trpc(asProxyRouteEvent(event), context);
        return { value, ...summariseResponse(value) };
      },
    );
    return { ...response, headers: { ...response.headers, ...headers } };
  };

  return middy<LambdaEvent, LambdaResult>(core)
    .use(
      injectLambdaContext(obs.logger, {
        correlationIdPath: correlationPaths.API_GATEWAY_HTTP,
        resetKeys: true,
      }),
    )
    .use(captureLambdaHandler(obs.tracer, { captureResponse: false }))
    .use(logMetrics(obs.metrics, { captureColdStartMetric: true }));
}

/** The deployed entry point (`handlers/trpc.handler`). */
export const handler: TrpcHandler = createHandler();
