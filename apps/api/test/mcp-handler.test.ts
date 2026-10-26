// The MCP Lambda's request handler (src/mcp/server.ts createMcpHandler), end to end with fake deps and a
// mocked SSM token. Found on the first hosted token run: one McpServer shared across requests answered
// the first call and failed every later one with "Already connected to a transport" (HTTP 500). Nothing
// had called createMcpHandler before, so no test could see it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const ssm = vi.hoisted(() => ({ getParameter: vi.fn() }));
vi.mock("@aws-lambda-powertools/parameters/ssm", () => ({ getParameter: ssm.getParameter }));

const TOKEN = "unit-test-token-not-a-secret";

function event(body: unknown, headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    rawPath: "/mcp",
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${TOKEN}`,
      ...headers,
    },
    requestContext: { http: { method: "POST", path: "/mcp" } },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

async function freshHandler() {
  vi.resetModules();
  const { createMcpHandler } = await import("../src/mcp/server.js");
  const deps = {
    resolveRun: async () => undefined,
    runsIndex: async () => ({ runs: [] }),
  };
  return createMcpHandler({ deps });
}

beforeEach(() => {
  ssm.getParameter.mockReset();
  ssm.getParameter.mockResolvedValue(TOKEN);
});

// Each test re-imports the module and builds a server per request; under the parallel `pnpm check` that can pass 5 s.
const SLOW_UNDER_LOAD_MS = 30_000;

describe("createMcpHandler: one warm handler answers many requests", () => {
  it(
    "tools/list answers 200 with the six tools, every time, not only the first",
    async () => {
      const handle = await freshHandler();
      for (let i = 1; i <= 5; i++) {
        const result = await handle(event({ jsonrpc: "2.0", id: i, method: "tools/list" }));
        expect(result.statusCode, `request ${i}`).toBe(200);
        const body = JSON.parse(result.body as string) as {
          result: { tools: Array<{ name: string }> };
        };
        expect(body.result.tools).toHaveLength(6);
      }
    },
    SLOW_UNDER_LOAD_MS,
  );

  it(
    "a wrong token is 401 and does not break the next authorised request",
    async () => {
      const handle = await freshHandler();
      const bad = await handle(
        event({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: "Bearer nope" }),
      );
      expect(bad.statusCode).toBe(401);
      const good = await handle(event({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
      expect(good.statusCode).toBe(200);
    },
    SLOW_UNDER_LOAD_MS,
  );

  it(
    "GET /health needs no token",
    async () => {
      const handle = await freshHandler();
      const result = await handle({
        ...event({}),
        rawPath: "/health",
        headers: {},
        requestContext: { http: { method: "GET", path: "/health" } },
      } as unknown as APIGatewayProxyEventV2);
      expect(result.statusCode).toBe(200);
    },
    SLOW_UNDER_LOAD_MS,
  );
});
