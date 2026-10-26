// A-14 T016/T019-T022 (G-2): the agent Lambda's entry point (infra/src/api-stack.ts, Agent
// block). `agent.ask` — the Vercel AI SDK tool loop (src/agent/ask.ts), the spend-cap pre-check
// (src/agent/spend.ts), the 23 s abort/timeout layering (AD-27) — is served through the tRPC AWS
// Lambda adapter over its own router (src/agent/router.ts), the same adapter handlers/trpc.ts
// uses for the query API's appRouter, just a different, independent router/Lambda pair (AD-27:
// the agent Lambda's blast radius and timeout are its own, never shared with the query API).
//
// Stage 5 review fix (Critical #2): wrapped with the same middy/Powertools middleware stack as
// handlers/trpc.ts (constitution VIII) — `injectLambdaContext` for one correlation-ID-tagged log
// line per request, `captureLambdaHandler` for the X-Ray segment, and `logMetrics` so the EMF
// metrics ask.ts adds to `agentObservability().metrics` (the `AiSpendUsd` metric
// infra/src/api-stack.ts's `SpendAlarm` watches) are actually published, not just buffered.
import { correlationPaths } from "@aws-lambda-powertools/logger/correlationId";
import { injectLambdaContext } from "@aws-lambda-powertools/logger/middleware";
import { logMetrics } from "@aws-lambda-powertools/metrics/middleware";
import { captureLambdaHandler } from "@aws-lambda-powertools/tracer/middleware";
import middy from "@middy/core";
import { awsLambdaRequestHandler } from "@trpc/server/adapters/aws-lambda";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context as LambdaContext,
} from "aws-lambda";
import { agentObservability } from "../agent/observability.js";
import { createContext } from "../context.js";
import { agentRouter } from "../agent/router.js";

const { logger, tracer, metrics } = agentObservability();
const trpc = awsLambdaRequestHandler({ router: agentRouter, createContext });

const core = async (
  event: APIGatewayProxyEventV2,
  context: LambdaContext,
): Promise<APIGatewayProxyStructuredResultV2> => trpc(event, context);

export const handler = middy<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2>(core)
  .use(
    injectLambdaContext(logger, {
      correlationIdPath: correlationPaths.API_GATEWAY_HTTP,
      resetKeys: true,
    }),
  )
  .use(captureLambdaHandler(tracer, { captureResponse: false }))
  .use(logMetrics(metrics, { captureColdStartMetric: true }));
