// A-14 T034: `mcpProxy.callTool`, the server-side proxy behind Help · MCP "Try a tool". Asserts the
// six read-only tools are the only ones accepted, that arguments are validated by the MCP tool
// schemas (same bounds, same rejection of unknown keys), that the result is the MCP adapter's
// envelope unchanged (truncated + true total), that the row cap holds, that a token bucket of 5/s
// burst 10 protects it, that engine failures give a plain message, and that the module reads no
// secret (no auth module, no SSM). The engine is a plain fake.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { APIGatewayProxyEventV2, Context as LambdaContext } from "aws-lambda";
import {
  CONTRACT_VIEWS,
  MAX_ROWS,
  type BoundRun,
  type QueryEngine,
  type Row,
} from "@countylens/query-core";
import { describe, expect, it } from "vitest";
import {
  MCP_PROXY_ENGINE_ERROR,
  MCP_PROXY_RATE_MESSAGE,
  createMcpProxyRouter,
  createTokenBucket,
} from "../src/routers/mcp-proxy.js";
import { router } from "../src/trpc.js";
import { appRouter } from "../src/routers/index.js";
import type { McpToolDeps } from "../src/mcp/tools.js";

const CID1 = `ba${"a".repeat(60)}`;
const BOUND: BoundRun = {
  runId: "travis-fixture",
  manifestCid: CID1,
  asOf: "2026-10-20T22:00:10.663Z",
  tables: [],
  views: [...CONTRACT_VIEWS],
};
const ctx = { event: {} as APIGatewayProxyEventV2, lambda: {} as LambdaContext };

function engineOf(responder: (sql: string) => Row[]): QueryEngine {
  return {
    async run() {},
    async all(sql: string) {
      return responder(sql);
    },
  };
}
function depsOf(responder: (sql: string) => Row[]): McpToolDeps {
  return {
    resolveRun: async () => ({ engine: engineOf(responder), bound: BOUND }),
    runsIndex: async () => ({ runs: [] }),
  };
}
const searchEngine = (sql: string): Row[] =>
  sql.includes("total_within_r")
    ? [{ total_within_r: 5, tenure_unknown: 0 }]
    : [{ property_cid: "p1" }, { property_cid: "p2" }];

function callerOf(deps: McpToolDeps, bucket = createTokenBucket(1000, 1000)) {
  return router({ mcpProxy: createMcpProxyRouter({ deps, bucket }) }).createCaller(ctx);
}

describe("mcpProxy.callTool", () => {
  it("is mounted on the existing query API router", () => {
    expect(Object.keys(appRouter._def.procedures)).toContain("mcpProxy.callTool");
  });

  it("returns search_properties' envelope unchanged, with truncated and the true total", async () => {
    const caller = callerOf(depsOf(searchEngine));
    const out = await caller.mcpProxy.callTool({
      tool: "search_properties",
      arguments: { area: { lat: 30.4, lon: -97.6 }, radius_mi: 5, limit: 2 },
    });
    expect(out.tool).toBe("search_properties");
    expect(out.maxRows).toBe(MAX_ROWS);
    expect(out.result).toMatchObject({
      returned: 2,
      total: 5,
      truncated: true,
      empty_reason: null,
    });
    expect(out.result["run"]).toEqual({
      run_id: "travis-fixture",
      manifest_cid: CID1,
      as_of: BOUND.asOf,
    });
  });

  it("answers get_schema and list_runs without a run", async () => {
    const caller = callerOf(depsOf(() => []));
    const schema = await caller.mcpProxy.callTool({ tool: "get_schema", arguments: {} });
    expect(schema.result).toHaveProperty("views");
    const runs = await caller.mcpProxy.callTool({ tool: "list_runs", arguments: {} });
    expect(runs.result).toHaveProperty("runs");
  });

  it("answers run_not_found honestly when the run cannot be resolved", async () => {
    const deps: McpToolDeps = {
      resolveRun: async () => undefined,
      runsIndex: async () => ({ runs: [] }),
    };
    const out = await callerOf(deps).mcpProxy.callTool({ tool: "get_coverage", arguments: {} });
    expect(JSON.stringify(out.result)).toContain("run_not_found");
  });

  it("rejects an unknown tool, including any SQL tool, before running anything", async () => {
    const caller = callerOf(depsOf(searchEngine));
    for (const tool of ["run_sql", "query", "search_properties "]) {
      await expect(
        caller.mcpProxy.callTool({ tool, arguments: {} } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("validates arguments with the MCP schema: bounds, unknown keys, row cap", async () => {
    let queries = 0;
    const caller = callerOf(depsOf((sql) => (queries++, searchEngine(sql))));
    const base = { area: { place: "Pflugerville" }, radius_mi: 5 };
    await expect(
      caller.mcpProxy.callTool({
        tool: "search_properties",
        arguments: { ...base, limit: MAX_ROWS + 1 },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: `limit must be at most ${MAX_ROWS}` });
    await expect(
      caller.mcpProxy.callTool({
        tool: "search_properties",
        arguments: { ...base, radius_mi: 99 },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "radius_mi must be at most 25" });
    await expect(
      caller.mcpProxy.callTool({
        tool: "search_properties",
        arguments: { ...base, sql: "select 1" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.mcpProxy.callTool({ tool: "get_property", arguments: {} }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /exactly one of/ });
    expect(queries).toBe(0);
  });

  it("limits oversized arguments", async () => {
    const caller = callerOf(depsOf(searchEngine));
    await expect(
      caller.mcpProxy.callTool({ tool: "get_schema", arguments: { view: "x".repeat(5000) } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rate limits at 5/s with burst 10 and recovers as tokens refill", async () => {
    let t = 0;
    const caller = callerOf(
      depsOf(searchEngine),
      createTokenBucket(5, 10, () => t),
    );
    const call = () => caller.mcpProxy.callTool({ tool: "get_schema", arguments: {} });
    for (let i = 0; i < 10; i++) await call();
    await expect(call()).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: MCP_PROXY_RATE_MESSAGE,
    });
    t += 200; // one token at 5/s
    await call();
    await expect(call()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("turns an engine failure into a plain message with no engine text", async () => {
    const deps = depsOf(() => {
      throw new Error("Catalog Error: table v_property SELECT * FROM secret");
    });
    const err = await callerOf(deps)
      .mcpProxy.callTool({
        tool: "search_properties",
        arguments: { area: { lat: 30.4, lon: -97.6 }, radius_mi: 5 },
      })
      .catch((e: unknown) => e as Error);
    expect(err).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: MCP_PROXY_ENGINE_ERROR });
    expect(String((err as Error).message)).not.toMatch(/SELECT|secret|Catalog/);
  });

  it("never touches the MCP token: no auth module, SSM or environment secret in the source", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/routers/mcp-proxy.ts", import.meta.url)),
      "utf8",
    );
    const code = src.replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/mcp\/auth|ssm|process\.env|Authorization|Bearer|fetch\(/i);
  });
});
