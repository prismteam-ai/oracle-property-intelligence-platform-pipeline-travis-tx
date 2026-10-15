import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape, ZodObject } from "zod";
import { getSnapshot } from "./snapshot.js";
import { TOOLS } from "./tools.js";

export const SERVER_NAME = "oracle-travis-property-intelligence";

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: "0.1.0" },
    {
      instructions:
        "Travis County, TX property intelligence for roofing lead discovery. Data is an immutable, CID-addressed pipeline snapshot. Start with get_run_summary; use find_aged_roof_properties / find_open_roofing_permits for radius questions (lat/lon or place name); cite permit numbers, prop_ids and source_url in answers and state missing data (e.g. BBB ratings, deed dates).",
    },
  );
  for (const tool of TOOLS) {
    const shape = (tool.input as unknown as ZodObject<ZodRawShape>).shape;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: shape,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (args: unknown) => {
        try {
          const snapshot = await getSnapshot();
          const parsed = tool.input.parse(args ?? {});
          const result = await tool.run(snapshot, parsed);
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Error: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      },
    );
  }
  return server;
}
