// Stage 5 review fix (CRITICAL, oracle 68/100 + ash): the MCP Lambda had zero Powertools
// instrumentation on its request path — only `auth.ts`'s single `Logger` for one error line.
// This module is the MCP Lambda's own Logger/Tracer/Metrics (mirroring
// `apps/api/src/observability.ts`'s style for the tRPC Lambda, scoped to MCP's own request
// shape): one structured log line and one duration + one count metric per tool call
// (`recordToolCall`), and one log line + one count metric per auth/Origin rejection
// (`recordAuthFailure`). `handlers/mcp.ts` wires the same instances into middy's
// `injectLambdaContext`/`captureLambdaHandler`/`logMetrics`, the same middleware
// `handlers/trpc.ts` uses for the tRPC Lambda. IDs and counts only: no row value, SQL text,
// header value, or token ever reaches a log field or a metric dimension.
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { Tracer } from "@aws-lambda-powertools/tracer";

/** Matches infra/src/api-stack.ts's `MCP_FUNCTION_NAME`/`POWERTOOLS_SERVICE_NAME` env value. */
export const SERVICE_NAME = "countylens-mcp";
export const METRICS_NAMESPACE = "CountyLens";
export const METRIC_TOOL_CALL_DURATION = "ToolCallDurationMs";
export const METRIC_TOOL_CALLS_TOTAL = "ToolCallsTotal";
export const METRIC_TOOL_CALL_FAILED = "ToolCallFailed";
export const METRIC_AUTH_FAILURES_TOTAL = "AuthFailuresTotal";
export const DIMENSION_TOOL = "tool";

export interface McpObservability {
  readonly logger: Logger;
  readonly tracer: Tracer;
  readonly metrics: Metrics;
}

export type McpObservabilityOverrides = Partial<McpObservability>;

/** Builds the three Powertools instances (or takes injected ones, for tests — the same pattern
 *  `apps/api/src/observability.ts`'s `createObservability` uses). */
export function createMcpObservability(
  overrides: McpObservabilityOverrides = {},
): McpObservability {
  return {
    logger: overrides.logger ?? new Logger({ serviceName: SERVICE_NAME }),
    tracer:
      overrides.tracer ?? new Tracer({ serviceName: SERVICE_NAME, captureHTTPsRequests: false }),
    metrics:
      overrides.metrics ?? new Metrics({ serviceName: SERVICE_NAME, namespace: METRICS_NAMESPACE }),
  };
}

const whole = (ms: number): number => Math.round(ms);

/** `{correlationId}` or `{}` (never `{correlationId: undefined}`, which
 *  `exactOptionalPropertyTypes` rejects against an optional field) — shared by `tools.ts` and
 *  `server.ts` so both read the one correlation ID `handlers/mcp.ts`'s middy
 *  `injectLambdaContext` middleware sets on this same `obs.logger`. */
export function correlationIdOf(
  obs: McpObservability,
): { correlationId: string } | Record<string, never> {
  const id: unknown = obs.logger.getCorrelationId(); // Powertools types this `unknown`
  return typeof id === "string" ? { correlationId: id } : {};
}

export interface ToolCallMeta {
  /** The AD-21 tool name (`search_properties`, …), never a row value or SQL text. */
  readonly tool: string;
  readonly durationMs: number;
  readonly ok: boolean;
  readonly correlationId?: string;
}

/** One log line, one duration metric and one count-of-calls/count-of-failures metric pair per
 *  `tools/call`. Dimensioned by `tool` so CloudWatch can break both metrics down per tool. */
export function recordToolCall(obs: McpObservability, meta: ToolCallMeta): void {
  obs.metrics.addDimension(DIMENSION_TOOL, meta.tool);
  obs.metrics.addMetric(METRIC_TOOL_CALL_DURATION, MetricUnit.Milliseconds, whole(meta.durationMs));
  obs.metrics.addMetric(METRIC_TOOL_CALLS_TOTAL, MetricUnit.Count, 1);
  obs.metrics.addMetric(METRIC_TOOL_CALL_FAILED, MetricUnit.Count, meta.ok ? 0 : 1);
  obs.logger.info("mcp tool call", {
    tool: meta.tool,
    durationMs: whole(meta.durationMs),
    ok: meta.ok,
    ...(meta.correlationId !== undefined ? { correlationId: meta.correlationId } : {}),
  });
}

export interface AuthFailureMeta {
  readonly reason: "unauthorized" | "origin_not_allowed";
  readonly correlationId?: string;
}

/** One log line and one count metric per rejected request (no/wrong token, a disallowed
 *  `Origin`). Never logs the presented token, the `Authorization` header, or the `Origin` value
 *  itself — `reason` is the closed set above, nothing free-form. */
export function recordAuthFailure(obs: McpObservability, meta: AuthFailureMeta): void {
  obs.metrics.addMetric(METRIC_AUTH_FAILURES_TOTAL, MetricUnit.Count, 1);
  obs.logger.warn("mcp auth failure", {
    reason: meta.reason,
    ...(meta.correlationId !== undefined ? { correlationId: meta.correlationId } : {}),
  });
}
