import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { JSONRPCMessage, Tool } from "@modelcontextprotocol/sdk/types.js";
import { createServer, type ReadOnlySql } from "@travis-oracle/mcp/server";
import type { DatasetInfo, Row } from "@travis-oracle/query-core";

export enum McpDirection {
  ToServer = "client → server",
  ToClient = "server → client",
}

export interface McpToolResult {
  rows: Row[];
  related?: Row[];
  [field: string]: unknown;
}

export interface McpSession {
  server: { name: string; version: string };
  tools: Tool[];
  call(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

type MessageListener = (direction: McpDirection, message: JSONRPCMessage) => void;

const CLIENT_INFO = { name: "travis-oracle-explorer", version: "1.0.0" };

export async function connectMcp(
  sql: ReadOnlySql,
  dataset: DatasetInfo,
  onMessage: MessageListener,
): Promise<McpSession> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  recordSent(clientSide, McpDirection.ToServer, onMessage);
  recordSent(serverSide, McpDirection.ToClient, onMessage);
  await createServer({ sql, dataset }).connect(serverSide);
  const client = new Client(CLIENT_INFO);
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  const server = client.getServerVersion();

  return {
    server: { name: server?.name ?? "", version: server?.version ?? "" },
    tools,
    call: async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as { type: string; text?: string }[];
      const text = content.find((part) => part.type === "text")?.text ?? "";
      if (result.isError) throw new Error(text);
      return JSON.parse(text) as McpToolResult;
    },
  };
}

function recordSent(
  transport: InMemoryTransport,
  direction: McpDirection,
  onMessage: MessageListener,
): void {
  const send = transport.send.bind(transport);
  transport.send = async (message, options) => {
    onMessage(direction, message);
    await send(message, options);
  };
}
