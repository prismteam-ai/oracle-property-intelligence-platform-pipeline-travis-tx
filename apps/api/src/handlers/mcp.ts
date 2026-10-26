// A-14/A-15 T026 (G-4): the MCP Lambda's real entry point (infra/src/api-stack.ts's `Mcp`
// NodejsFunction, `entry: .../handlers/mcp.ts, handler: "handler"`). Replaces the T018
// placeholder: `GET /health` and `POST /mcp` now go through `src/mcp/server.ts`'s real
// Streamable HTTP wiring (auth, Origin check, the six AD-21 tools) instead of a 501.
//
// Stage 5 review fix (CRITICAL, oracle 68/100 + ash): the MCP Lambda had zero Powertools
// instrumentation on its request path. This wraps the handler with the same middy middleware
// `handlers/trpc.ts` uses for the tRPC Lambda — `injectLambdaContext` (correlation ID from the
// HTTP API request ID), `captureLambdaHandler` (one X-Ray segment, no response captured) and
// `logMetrics` (flushes `src/mcp/observability.ts`'s per-tool-call/per-auth-failure metrics,
// `captureColdStartMetric: true`) — over the one `McpObservability` instance `src/mcp/server.ts`
// threads into every tool call and every auth/Origin rejection, so the correlation ID this
// middleware injects is the same one those log lines carry.
//
// `McpToolDeps.resolveRun` binds the hosted engine (`src/engine/duckdb-node.ts`'s `bindOnce` +
// `getEngine`, the same AD-18 binder the tRPC Lambda uses — SSM/S3/CID-copy wiring unchanged,
// nothing here reaches into it) to either the caller's `manifest_cid` or the latest entry of
// `runs/index.json`. Resolution failure (an unknown CID, a bind error, or no runs published) is
// never thrown past this module: it resolves to `undefined`, and `src/mcp/tools.ts` turns that
// into the typed `run_not_found` envelope.
//
// `runsIndex()` (src/mcp/runs-index.ts) reads the site's `/runs/index.json` over HTTPS
// (`env.RUNS_INDEX_URL`, set by the CDK Api stack) -- the same loader `src/agent/ask.ts`'s
// `defaultResolveManifestCid` uses. A read/parse failure here still
// resolves to `undefined` from `resolveRun`, never throws past this module: `src/mcp/tools.ts`
// turns that into the typed `run_not_found` envelope, not a guess and not a crash.
import { correlationPaths } from "@aws-lambda-powertools/logger/correlationId";
import { injectLambdaContext } from "@aws-lambda-powertools/logger/middleware";
import { logMetrics } from "@aws-lambda-powertools/metrics/middleware";
import { captureLambdaHandler } from "@aws-lambda-powertools/tracer/middleware";
import middy from "@middy/core";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context as LambdaContext,
} from "aws-lambda";
import { createEngineDeps } from "../mcp/deps.js";
import { createMcpObservability } from "../mcp/observability.js";
import { createMcpHandler } from "../mcp/server.js";

const deps = createEngineDeps();

const obs = createMcpObservability();
const handleMcpEvent = createMcpHandler({ deps, obs });

const core = async (
  event: APIGatewayProxyEventV2,
  _context: LambdaContext,
): Promise<APIGatewayProxyStructuredResultV2> => handleMcpEvent(event);

/** The deployed entry point (`handlers/mcp.handler`, infra/src/api-stack.ts's MCP Lambda). */
export const handler = middy<APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2>(core)
  .use(
    injectLambdaContext(obs.logger, {
      correlationIdPath: correlationPaths.API_GATEWAY_HTTP,
      resetKeys: true,
    }),
  )
  .use(captureLambdaHandler(obs.tracer, { captureResponse: false }))
  .use(logMetrics(obs.metrics, { captureColdStartMetric: true }));
