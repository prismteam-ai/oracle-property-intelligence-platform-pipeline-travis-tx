// Stage 5 review fix (Critical #2): the agent Lambda had zero Powertools instrumentation,
// unlike apps/api/src/handlers/trpc.ts's Logger/Tracer/Metrics (constitution VIII,
// observability-logging-tracing). One Logger/Tracer/Metrics per sandbox, shared by
// handlers/agent.ts's middy middleware (which flushes `metrics` at the end of each invocation
// via `logMetrics`) and ask.ts (which calls `metrics.addMetric` for the `AiSpendUsd` EMF metric
// infra/src/api-stack.ts's `SpendAlarm` watches) -- the same instances, not two separate ones,
// so a metric added in ask.ts is actually published by the middleware wrapping the handler.
import { Logger } from "@aws-lambda-powertools/logger";
import { search } from "@aws-lambda-powertools/logger/correlationId";
import { Metrics } from "@aws-lambda-powertools/metrics";
import { Tracer } from "@aws-lambda-powertools/tracer";

/** Matches infra's `AGENT_FUNCTION_NAME`/`POWERTOOLS_SERVICE_NAME` (not imported directly: this
 *  package does not depend on infra's TypeScript source) and `SpendAlarm`'s
 *  `dimensionsMap: { service: AGENT_FUNCTION_NAME }`. */
export const AGENT_SERVICE_NAME = "countylens-agent";
/** Matches infra's `API_METRICS_NAMESPACE`/`POWERTOOLS_METRICS_NAMESPACE`. */
export const AGENT_METRICS_NAMESPACE = "CountyLens";

export interface AgentObservability {
  readonly logger: Logger;
  readonly tracer: Tracer;
  readonly metrics: Metrics;
}

let instance: AgentObservability | undefined;

/** One set of Powertools instances per sandbox (same singleton convention as spend.ts's
 *  `getSpendDocumentClient`). `reset()` is test-only. */
export function agentObservability(): AgentObservability {
  instance ??= {
    logger: new Logger({ serviceName: AGENT_SERVICE_NAME, correlationIdSearchFn: search }),
    tracer: new Tracer({ serviceName: AGENT_SERVICE_NAME, captureHTTPsRequests: false }),
    metrics: new Metrics({ serviceName: AGENT_SERVICE_NAME, namespace: AGENT_METRICS_NAMESPACE }),
  };
  return instance;
}

export function resetAgentObservabilityForTests(overrides: Partial<AgentObservability> = {}): void {
  instance = {
    logger: overrides.logger ?? new Logger({ serviceName: AGENT_SERVICE_NAME }),
    tracer: overrides.tracer ?? new Tracer({ serviceName: AGENT_SERVICE_NAME, enabled: false }),
    metrics: overrides.metrics ?? new Metrics({ serviceName: AGENT_SERVICE_NAME }),
  };
}
