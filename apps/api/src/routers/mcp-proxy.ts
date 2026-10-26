// A-14 T034 (design-oracle.md § "website proxy"; contracts/mcp-tools.md § Auth): `mcpProxy.callTool`,
// the server-side proxy behind Help · MCP's "Try a tool" button. It runs on the existing query API
// (no new Lambda or route) and calls the six AD-21 tool adapters (src/mcp/tools.ts) in process, so
// the arguments are validated by the very Zod schemas the MCP server registers (MCP_TOOL_SCHEMAS)
// and the result is the same envelope the MCP server returns as `structuredContent`, unchanged.
//
// Why no token: the MCP bearer token guards the `/mcp` HTTP route only. This procedure never makes
// an HTTP call to `/mcp`, never imports src/mcp/auth.ts and never reads SSM or any secret, so there
// is nothing to add and nothing that can reach the browser. The tools are the six read-only ones
// (no seventh tool, no SQL tool, P0-13): an unknown tool name is rejected by the input enum.
//
// Protection, consistent with the MCP server: the row cap is the schemas' own (`limit` ≤
// MAX_ROWS = 1,000, `truncated` + true `total` in the envelope), and calls pass a token bucket of
// 5 requests per second with a burst of 10 (the MCP route's throttle, contracts/mcp-tools.md),
// held per Lambda sandbox; beyond it the answer is TOO_MANY_REQUESTS with a plain message. An
// engine failure becomes INTERNAL_SERVER_ERROR with a plain message: no stack, no SQL.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_ROWS } from "@countylens/query-core";
import { createEngineDeps } from "../mcp/deps.js";
import {
  MCP_TOOL_SCHEMAS,
  getCoverageTool,
  getPropertyTool,
  getSchemaTool,
  listPermitsTool,
  listRunsTool,
  searchPropertiesTool,
  type McpToolDeps,
} from "../mcp/tools.js";
import { publicProcedure, router } from "../trpc.js";

export const MCP_PROXY_TOOLS = Object.freeze(Object.keys(MCP_TOOL_SCHEMAS)) as readonly [
  keyof typeof MCP_TOOL_SCHEMAS,
  ...(keyof typeof MCP_TOOL_SCHEMAS)[],
];
export type McpProxyTool = (typeof MCP_PROXY_TOOLS)[number];

/** Same numbers as the `/mcp` route throttle (contracts/mcp-tools.md). */
export const MCP_PROXY_RATE = Object.freeze({ perSecond: 5, burst: 10 });
export const MCP_PROXY_RATE_MESSAGE = "Too many tool calls just now; wait a moment and try again";
export const MCP_PROXY_ENGINE_ERROR = "The tool could not run on the server; try again";
/** Cap on the JSON a visitor may send as arguments (bytes); the real schemas are far smaller. */
export const MCP_PROXY_MAX_ARGUMENT_BYTES = 4096;

export const McpProxyInput = z.object({
  tool: z.enum(MCP_PROXY_TOOLS),
  arguments: z
    .record(z.string().max(64), z.unknown())
    .default({})
    .refine((value) => JSON.stringify(value).length <= MCP_PROXY_MAX_ARGUMENT_BYTES, {
      message: "arguments are too large",
    }),
});
export type McpProxyInput = z.infer<typeof McpProxyInput>;

export interface McpProxyResult {
  readonly tool: McpProxyTool;
  /** The tool's envelope, exactly as the MCP server returns it as `structuredContent`. */
  readonly result: Record<string, unknown>;
  /** The most rows any tool returns in one call (AD-21). */
  readonly maxRows: number;
}

export interface TokenBucket {
  take(): boolean;
}

/** Token bucket: refills `perSecond` tokens each second up to `burst`; `now` is injected by tests. */
export function createTokenBucket(
  perSecond: number,
  burst: number,
  now: () => number = Date.now,
): TokenBucket {
  let tokens = burst;
  let last = now();
  return {
    take(): boolean {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - last) / 1000) * perSecond);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

/** One plain sentence for the first Zod issue: the field and its bound, never the issue list. */
function plainIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "arguments";
  switch (issue.code) {
    case "too_big":
      return `${path} must be at most ${String(issue.maximum)}`;
    case "too_small":
      return `${path} must be at least ${String(issue.minimum)}`;
    case "invalid_value":
      return `${path} must be one of ${issue.values.map(String).join(", ")}`;
    case "invalid_type":
      return `${path} is missing or has the wrong type`;
    case "unrecognized_keys":
      return `${path} has an argument this tool does not take: ${issue.keys.join(", ")}`;
    case "custom":
      return issue.message;
    default:
      return `${path} is not valid`;
  }
}

async function runTool(
  deps: McpToolDeps,
  tool: McpProxyTool,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const schema = MCP_TOOL_SCHEMAS[tool];
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: first ? plainIssue(first) : "the tool arguments are not valid",
    });
  }
  try {
    // Each branch hands the adapter the schema's parsed, defaulted value, as the MCP SDK does.
    const out = await (async () => {
      switch (tool) {
        case "search_properties":
          return searchPropertiesTool(deps, parsed.data as never);
        case "list_permits":
          return listPermitsTool(deps, parsed.data as never);
        case "get_property":
          return getPropertyTool(deps, parsed.data as never);
        case "get_coverage":
          return getCoverageTool(deps, parsed.data as never);
        case "list_runs":
          return listRunsTool(deps, parsed.data as never);
        case "get_schema":
          return getSchemaTool(parsed.data as never);
      }
    })();
    return (out.structuredContent ?? {}) as Record<string, unknown>;
  } catch {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: MCP_PROXY_ENGINE_ERROR });
  }
}

export interface McpProxyOptions {
  readonly deps?: McpToolDeps;
  readonly bucket?: TokenBucket;
}

export function createMcpProxyRouter(options: McpProxyOptions = {}) {
  const deps = options.deps ?? createEngineDeps();
  const bucket =
    options.bucket ?? createTokenBucket(MCP_PROXY_RATE.perSecond, MCP_PROXY_RATE.burst);
  return router({
    callTool: publicProcedure
      .input(McpProxyInput)
      .mutation(async ({ input }): Promise<McpProxyResult> => {
        if (!bucket.take()) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: MCP_PROXY_RATE_MESSAGE });
        }
        const result = await runTool(deps, input.tool, input.arguments);
        return { tool: input.tool, result, maxRows: MAX_ROWS };
      }),
  });
}

export const mcpProxyRouter = createMcpProxyRouter();
