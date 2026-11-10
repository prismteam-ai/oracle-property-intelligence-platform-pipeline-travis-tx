import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { connectMcp, McpDirection } from "../../src/mcp/mcp-session.js";

const DATASET = { buildId: "20261027T145411Z", rootCid: "bafybei-root" };
const SQL = {
  all: async () => [],
  readOnly: async () => [{ answer: 42 }],
};

function label(direction: McpDirection, message: JSONRPCMessage): string {
  return `${direction} ${"method" in message ? message.method : "result"}`;
}

describe("connectMcp", () => {
  it("connects an MCP client to the Travis Oracle MCP server and lists its tools", async () => {
    const session = await connectMcp(SQL, DATASET, () => undefined);

    expect(session.server).toMatchObject({ name: "travis-oracle" });
    expect(session.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["find_aged_roofs", "find_open_roofing_permits", "run_sql"]),
    );
  });

  it("calls tools over JSON-RPC and records every message in both directions", async () => {
    const messages: string[] = [];
    const session = await connectMcp(SQL, DATASET, (direction, message) =>
      messages.push(label(direction, message)),
    );

    const place = await session.call("locate_place", { name: "Bee Cave" });
    const sql = await session.call("run_sql", { sql: "SELECT 42 AS answer" });

    expect(place.rows[0]).toMatchObject({ name: "Bee Cave" });
    expect(sql.rows).toEqual([{ answer: 42 }]);
    expect(messages).toEqual([
      `${McpDirection.ToServer} initialize`,
      `${McpDirection.ToClient} result`,
      `${McpDirection.ToServer} notifications/initialized`,
      `${McpDirection.ToServer} tools/list`,
      `${McpDirection.ToClient} result`,
      `${McpDirection.ToServer} tools/call`,
      `${McpDirection.ToClient} result`,
      `${McpDirection.ToServer} tools/call`,
      `${McpDirection.ToClient} result`,
    ]);
  });

  it("reports a tool error with the server's message", async () => {
    const session = await connectMcp(SQL, DATASET, () => undefined);

    await expect(session.call("locate_place", { name: "Atlantis" })).rejects.toThrow(/Atlantis/);
  });
});
