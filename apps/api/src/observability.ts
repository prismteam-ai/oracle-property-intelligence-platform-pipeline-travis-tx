// A-03 T073 (G-C2b): the API Lambda's observability (contracts/api.md "Observability", FR-007,
// AC-7, constitution VIII business metrics, engineering guideline observability-metrics).
// One Powertools Logger, Tracer and Metrics per sandbox; `observeQuery` wraps every request
// (a tRPC procedure or a direct-invoke bench run) and is the only place that logs, annotates
// or emits a metric for it:
//   - exactly one `logger.info` line per request (correlation ID, `queryDurationMs`, procedure,
//     builder name, row count); on failure one additional `logger.error` with a redacted reason;
//   - one X-Ray subsegment `duckdb.query` annotated with `manifestCid` and `query` (the
//     query-core builder's name, never SQL text);
//   - metrics `QueryDurationMs` (ms), `ItemsProcessed` (rows returned) and `ItemsFailed`
//     (failed queries, 0 on success) with the dimension `procedure`.
// IDs and counts only: no row value, presigned URL (`X-Amz-Signature`), env value or credential
// ever reaches a log field, an annotation or trace metadata. Outbound HTTPS capture is off so
// no request URL is recorded by the tracer, and error text is passed through `redact` first.
import { Logger } from "@aws-lambda-powertools/logger";
import { search } from "@aws-lambda-powertools/logger/correlationId";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { isCidV1 } from "@countylens/contract";

/** Service name of the Logger, Tracer, Metrics and the X-Ray sampling rule (infra T074). */
export const SERVICE_NAME = "countylens-api";
/** CloudWatch namespace of the business metrics (TC-050 reads it as "the API namespace"). */
export const METRICS_NAMESPACE = "CountyLens";
export const QUERY_SUBSEGMENT = "duckdb.query";
export const METRIC_QUERY_DURATION = "QueryDurationMs";
export const METRIC_ITEMS_PROCESSED = "ItemsProcessed";
export const METRIC_ITEMS_FAILED = "ItemsFailed";
export const DIMENSION_PROCEDURE = "procedure";
export const HEADER_CORRELATION_ID = "x-correlation-id";
export const HEADER_TRACE_ID = "x-trace-id";

/** Procedure → the query-core builder it runs: the `query` annotation names this, never SQL. */
export const QUERY_BUILDERS: Readonly<Record<string, string>> = {
  "runs.summary": "runSummarySql",
  "query.radius": "radiusSql",
  "query.roofAge": "roofAgeSql",
  "explore.search": "exploreSearchSql",
  "bench.count": "benchCountSql",
  "bench.radius": "benchRadiusSql",
  "bench.roofAge": "benchRoofAgeSql",
};

export interface Observability {
  readonly logger: Logger;
  readonly tracer: Tracer;
  readonly metrics: Metrics;
  /** Per-sandbox counters; `invocations === 0` before the first observed request = cold start. */
  readonly state: { invocations: number };
}

export type ObservabilityOverrides = Partial<Pick<Observability, "logger" | "tracer" | "metrics">>;

/**
 * Builds the three Powertools instances (or takes injected ones, for tests). The Logger carries
 * `correlationIdSearchFn: search` so the middy `injectLambdaContext` can read the HTTP API
 * request ID; the Tracer does not capture outbound HTTPS calls (presigned URLs stay out of
 * traces); Metrics use the service name as the default `service` dimension.
 */
export function createObservability(overrides: ObservabilityOverrides = {}): Observability {
  return {
    logger:
      overrides.logger ?? new Logger({ serviceName: SERVICE_NAME, correlationIdSearchFn: search }),
    tracer:
      overrides.tracer ?? new Tracer({ serviceName: SERVICE_NAME, captureHTTPsRequests: false }),
    metrics:
      overrides.metrics ?? new Metrics({ serviceName: SERVICE_NAME, namespace: METRICS_NAMESPACE }),
    state: { invocations: 0 },
  };
}

/** Identifiers of one request: everything here may be logged and annotated. */
export interface QueryMeta {
  /** `runs.summary`, `query.radius`, `query.roofAge` or `bench.<query>`. */
  readonly procedure: string;
  /** Annotated only when it is a CIDv1 (input junk never reaches a trace). */
  readonly manifestCid?: string;
  /** Bench preset name (`TC_NF_05`, `ADR_0001`). */
  readonly preset?: string;
  /** Bench S3 prefix (a key, not a URL). */
  readonly prefix?: string;
}

/** What the wrapped work reports back: counts and durations only. */
export interface QueryOutcome<T> {
  readonly value: T;
  readonly ok: boolean;
  /** Rows returned (0 on failure). */
  readonly rows: number;
  /** The engine's own query time; defaults to the wall time of the wrapped work. */
  readonly queryDurationMs?: number;
  readonly statusCode?: number;
  readonly errorCode?: string;
}

const SIGNED_QUERY = /X-Amz-[A-Za-z-]+=[^&\s"'<>]*/g;
const ANY_URL = /https?:\/\/[^\s"'<>]+/g;

/** Strips URLs (presigned or not) and any `X-Amz-*=` query value from free text. */
export function redact(text: string): string {
  return text.replace(ANY_URL, "<url>").replace(SIGNED_QUERY, "X-Amz-<redacted>");
}

/** A copy of `error` safe for a trace: name kept, message and stack redacted, no cause. */
export function safeError(error: unknown): Error {
  if (error instanceof Error) {
    const safe = new Error(redact(error.message));
    safe.name = error.name;
    if (error.stack) safe.stack = redact(error.stack);
    return safe;
  }
  return new Error(redact(String(error)));
}

/** Sets the Lambda request ID as correlation ID when the event carried none (direct invokes). */
export function ensureCorrelationId(obs: Observability, awsRequestId: string): string {
  const current = obs.logger.getCorrelationId();
  if (typeof current === "string" && current.length > 0) return current;
  obs.logger.setCorrelationId(awsRequestId);
  return awsRequestId;
}

/** The two response headers of contracts/api.md; the trace header is omitted without a trace. */
export function responseHeaders(obs: Observability, awsRequestId: string): Record<string, string> {
  const headers: Record<string, string> = {
    [HEADER_CORRELATION_ID]: ensureCorrelationId(obs, awsRequestId),
  };
  const traceId = obs.tracer.getRootXrayTraceId();
  if (traceId) headers[HEADER_TRACE_ID] = traceId;
  return headers;
}

const whole = (ms: number): number => Math.round(ms);

/**
 * Runs `work` as one observed query: subsegment, metrics and the single log line. Rethrows a
 * redacted copy of any failure after recording `ItemsFailed = 1`.
 */
export async function observeQuery<T>(
  obs: Observability,
  meta: QueryMeta,
  work: () => Promise<QueryOutcome<T>>,
): Promise<T> {
  const { logger, tracer, metrics } = obs;
  const coldStart = obs.state.invocations === 0;
  obs.state.invocations += 1;

  const builder = QUERY_BUILDERS[meta.procedure] ?? "unknown";
  const manifestCid =
    meta.manifestCid !== undefined && isCidV1(meta.manifestCid) ? meta.manifestCid : undefined;

  const parent = tracer.getSegment();
  const subsegment = parent?.addNewSubsegment(QUERY_SUBSEGMENT);
  if (subsegment) {
    tracer.setSegment(subsegment);
    subsegment.addAnnotation("query", builder);
    subsegment.addAnnotation(DIMENSION_PROCEDURE, meta.procedure);
    if (manifestCid !== undefined) subsegment.addAnnotation("manifestCid", manifestCid);
    if (meta.preset !== undefined) subsegment.addAnnotation("preset", meta.preset);
  }

  const started = performance.now();
  let outcome: QueryOutcome<T> | undefined;
  let failure: Error | undefined;
  try {
    outcome = await work();
  } catch (error) {
    failure = safeError(error);
  }
  const durationMs = whole(performance.now() - started);

  const ok = failure === undefined && outcome?.ok === true;
  const rows = ok && outcome ? outcome.rows : 0;
  const queryDurationMs = whole(outcome?.queryDurationMs ?? durationMs);
  const errorCode = failure?.name ?? outcome?.errorCode;

  if (subsegment) {
    if (failure) subsegment.addError(failure, false);
    subsegment.close();
    if (parent) tracer.setSegment(parent);
  }

  metrics.addDimension(DIMENSION_PROCEDURE, meta.procedure);
  metrics.addMetric(METRIC_QUERY_DURATION, MetricUnit.Milliseconds, queryDurationMs);
  metrics.addMetric(METRIC_ITEMS_PROCESSED, MetricUnit.Count, rows);
  metrics.addMetric(METRIC_ITEMS_FAILED, MetricUnit.Count, ok ? 0 : 1);

  logger.info("query", {
    procedure: meta.procedure,
    query: builder,
    ...(manifestCid !== undefined ? { manifestCid } : {}),
    ...(meta.preset !== undefined ? { preset: meta.preset } : {}),
    ...(meta.prefix !== undefined ? { prefix: meta.prefix } : {}),
    queryDurationMs,
    durationMs,
    rows,
    ok,
    coldStart,
    ...(outcome?.statusCode !== undefined ? { statusCode: outcome.statusCode } : {}),
    ...(errorCode !== undefined ? { errorCode } : {}),
  });

  if (failure) {
    logger.error("query failed", {
      procedure: meta.procedure,
      errorName: failure.name,
      error: failure.message,
    });
    throw failure;
  }
  if (!ok) {
    logger.error("query failed", {
      procedure: meta.procedure,
      ...(outcome?.statusCode !== undefined ? { statusCode: outcome.statusCode } : {}),
      ...(errorCode !== undefined ? { errorCode } : {}),
    });
  }
  return (outcome as QueryOutcome<T>).value;
}
