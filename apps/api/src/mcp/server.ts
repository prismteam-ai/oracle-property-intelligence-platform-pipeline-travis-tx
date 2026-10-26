// T026 (A-14/A-15 G-4, AD-21): the real Streamable HTTP MCP server — `POST /mcp` wired to T017's
// `auth.ts`, an Origin check, and `GET /health` with no auth (contracts/mcp-tools.md).
//
// Transport: the SDK's `WebStandardStreamableHTTPServerTransport` (not the Node-http
// `StreamableHTTPServerTransport`, which wraps it with `@hono/node-server` for an
// IncomingMessage/ServerResponse pair this Lambda never has). API Gateway's HTTP API already
// hands the handler a parsed `APIGatewayProxyEventV2`, so `eventToRequest`/`responseToResult`
// convert directly to and from the Web Standard `Request`/`Response` the transport speaks —
// one fewer dependency, one fewer translation layer.
//
// Stateless (`sessionIdGenerator: undefined`, per the contract's "stateless Streamable HTTP"):
// a fresh transport is created and connected for every request (the SDK itself throws if a
// stateless transport is reused across requests), then discarded. `enableJsonResponse: true`
// because this Lambda returns one buffered HTTP response, never an SSE stream — a `tools/call`
// is one request, one JSON response.
//
// Origin allowlist: the SDK's own `allowedOrigins` option on this version treats an *empty*
// array as "no restriction configured" (skipped, not "reject everything") — checked directly
// against `webStandardStreamableHttp.js`. That is the opposite of what "empty by default" means
// here (no legitimate browser origin should ever call `/mcp` directly), so the Origin check is
// done by this module itself, before the transport or the token check ever runs: any request
// carrying an `Origin` header at all is rejected, and a request with no `Origin` header (every
// real client here — Claude Desktop/Code, MCP Inspector, the website's own server-side tRPC
// proxy, which never forwards its own browser Origin) proceeds. `enableDnsRebindingProtection`
// is left off; it would not add anything this manual check doesn't already do, and would
// reintroduce the "empty array passes" gap for an API this module isn't using anyway.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { checkAuth, unauthorized } from "./auth.js";
import {
  correlationIdOf,
  createMcpObservability,
  recordAuthFailure,
  type McpObservability,
} from "./observability.js";
import { registerMcpTools, type McpToolDeps } from "./tools.js";

/** Must match infra/src/api-stack.ts's `MCP_ROUTE_PATH` (not imported directly: infra depends on
 *  the bundled entry, apps/api does not depend on infra — same reasoning as auth.ts's parameter
 *  name constant). */
export const MCP_ROUTE_PATH = "/mcp";
/** Must match infra/src/api-stack.ts's `MCP_HEALTH_PATH`. */
export const MCP_HEALTH_PATH = "/health";

export const SERVER_NAME = "countylens-mcp";
export const SERVER_VERSION = "1.0.0";

/** Builds one McpServer. The handler calls this once per request and closes it afterwards, with a
 *  fresh transport each time: the SDK allows one transport per server, so a server shared across
 *  requests fails every call after the first (found on the hosted site, fixed in ec9a7e7). `obs` (Stage 5
 *  review fix) is threaded into every registered tool so each call is logged and metered
 *  (observability.ts's `recordToolCall`). */
export function buildMcpServer(
  deps: McpToolDeps,
  obs: McpObservability = createMcpObservability(),
): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerMcpTools(server, deps, obs);
  return server;
}

function headerValue(event: APIGatewayProxyEventV2, name: string): string | undefined {
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (key.toLowerCase() === name && value !== undefined) return value;
  }
  return undefined;
}

function jsonResult(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const originNotAllowed = (): APIGatewayProxyStructuredResultV2 =>
  jsonResult(403, { error: "origin_not_allowed" });

function unauthorizedResult(): APIGatewayProxyStructuredResultV2 {
  const failure = unauthorized();
  return jsonResult(failure.status, failure.body);
}

/** API Gateway HTTP API (payload v2) -> Web Standard `Request`. `rawPath`/`rawQueryString` are
 *  already decoded/joined by the gateway; headers are single-valued (`cookies[]` aside, unused
 *  here) in this payload version. */
function eventToRequest(event: APIGatewayProxyEventV2): Request {
  const host = headerValue(event, "host") ?? event.requestContext.domainName ?? "mcp.invalid";
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const url = `https://${host}${event.rawPath}${query}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(key, value);
  }
  const method = event.requestContext.http.method;
  const hasBody = event.body !== undefined && method !== "GET" && method !== "HEAD";
  const body = hasBody
    ? event.isBase64Encoded
      ? Buffer.from(event.body as string, "base64")
      : (event.body as string)
    : undefined;
  return new Request(url, { method, headers, ...(body !== undefined ? { body } : {}) });
}

/** Web Standard `Response` -> an API Gateway HTTP API (payload v2) result. Streamable HTTP's
 *  `enableJsonResponse: true` path never returns a chunked/SSE body, so reading the whole body
 *  (`.text()`) is always correct here, never a stream this Lambda would need to pump. */
async function responseToResult(response: Response): Promise<APIGatewayProxyStructuredResultV2> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { statusCode: response.status, headers, body: await response.text() };
}

export interface McpHandlerOptions {
  readonly deps: McpToolDeps;
  /** Stage 5 review fix: shared with `handlers/mcp.ts`'s middy wrapper (`injectLambdaContext`/
   *  `captureLambdaHandler`/`logMetrics`) so the correlation ID that middleware injects is the
   *  same one `recordToolCall`/`recordAuthFailure` log here. Defaults to a fresh instance (tests,
   *  the local stdio build). */
  readonly obs?: McpObservability;
}

export type McpEventHandler = (
  event: APIGatewayProxyEventV2,
) => Promise<APIGatewayProxyStructuredResultV2>;

/** Builds the one handler function `apps/api/src/handlers/mcp.ts` exports as the Lambda's
 *  `handler`. Separate from that file so tests can construct it with fake `deps` and never touch
 *  DuckDB, S3, or SSM. */
export function createMcpHandler(options: McpHandlerOptions): McpEventHandler {
  const obs = options.obs ?? createMcpObservability();

  return async function handleMcpEvent(
    event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyStructuredResultV2> {
    const path = event.rawPath;

    if (path.endsWith(MCP_HEALTH_PATH)) {
      return jsonResult(200, { status: "ok" });
    }
    if (!path.endsWith(MCP_ROUTE_PATH)) {
      return jsonResult(404, { error: "not_found" });
    }

    // Origin check first (contracts/mcp-tools.md): rejected before the token check runs, so a
    // disallowed browser Origin never even reaches the auth comparison.
    if (headerValue(event, "origin") !== undefined) {
      recordAuthFailure(obs, { reason: "origin_not_allowed", ...correlationIdOf(obs) });
      return originNotAllowed();
    }

    const auth = await checkAuth(headerValue(event, "authorization"));
    if (!auth.ok) {
      recordAuthFailure(obs, { reason: "unauthorized", ...correlationIdOf(obs) });
      return unauthorizedResult();
    }

    // sessionIdGenerator omitted (not set to undefined: exactOptionalPropertyTypes treats those
    // differently) -> stateless mode, per the option's own doc: "If not provided, session
    // management is disabled."
    // One server and one transport per request: the SDK allows a single transport per server, so a
    // server shared across requests answers the first call and fails every later one on a warm
    // Lambda ("Already connected to a transport").
    const server = buildMcpServer(options.deps, obs);
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(eventToRequest(event));
      return await responseToResult(response);
    } finally {
      await server.close();
    }
  };
}
