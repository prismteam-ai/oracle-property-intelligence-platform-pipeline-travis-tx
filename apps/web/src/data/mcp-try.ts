// Browser client of `mcpProxy.callTool` (A-14 T034). The proxy runs on the existing query API and
// calls the six read-only MCP tools in process, so the browser sends only a tool name and its
// arguments: no MCP token is read, held or sent here (the token guards the `/mcp` route only). The
// tRPC mutation wire format (POST, JSON input, `{ result: { data } }` back) is used directly, like
// data/agent-ask.ts. The response is Zod-checked, so a malformed body is an error, never a
// half-shown result.
import { z } from "zod";

export const MCP_TRY_PATH = "/api/trpc/mcpProxy.callTool";

export const MCP_TRY_TOOLS = [
  "search_properties",
  "list_permits",
  "get_property",
  "get_coverage",
  "list_runs",
  "get_schema",
] as const;
export type McpTryTool = (typeof MCP_TRY_TOOLS)[number];

export const McpTryResponse = z.object({
  tool: z.enum(MCP_TRY_TOOLS),
  result: z.record(z.string(), z.unknown()),
  maxRows: z.number().int().positive(),
});
export type McpTryResponse = z.infer<typeof McpTryResponse>;

export class McpTryError extends Error {
  readonly code: "bad_request" | "rate_limited" | "failed" | "unreachable";
  constructor(code: McpTryError["code"], message: string) {
    super(message);
    this.name = "McpTryError";
    this.code = code;
  }
}

const Envelope = z.object({ result: z.object({ data: z.unknown() }) });
const ErrorEnvelope = z.object({
  error: z.object({
    message: z.string(),
    data: z.object({ httpStatus: z.number() }).partial().optional(),
  }),
});

/** Calls one tool; throws `McpTryError` (the server's plain sentence for a bad request). */
export async function tryMcpTool(
  tool: McpTryTool,
  args: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<McpTryResponse> {
  let response: Response;
  try {
    response = await fetchImpl(MCP_TRY_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool, arguments: args }),
    });
  } catch {
    throw new McpTryError("unreachable", "unreachable");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new McpTryError(
      "failed",
      `the server answered HTTP ${response.status} with a non-JSON body`,
    );
  }
  const ok = Envelope.safeParse(body);
  if (!ok.success) {
    const failure = ErrorEnvelope.safeParse(body);
    const message = failure.success
      ? failure.data.error.message
      : `the server answered HTTP ${response.status}`;
    const status = failure.success ? failure.data.error.data?.httpStatus : response.status;
    throw new McpTryError(
      status === 429 ? "rate_limited" : status === 400 ? "bad_request" : "failed",
      message,
    );
  }
  const data = McpTryResponse.safeParse(ok.data.result.data);
  if (!data.success)
    throw new McpTryError("failed", "the server answered with an unexpected shape");
  return data.data;
}
