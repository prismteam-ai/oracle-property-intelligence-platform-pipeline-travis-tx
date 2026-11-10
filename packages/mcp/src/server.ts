import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type DatasetInfo, type Row, runTool, TABLES, TOOLS } from "@travis-oracle/query-core";
import { z } from "zod";

const SERVER_NAME = "travis-oracle";
const SERVER_VERSION = "1.0.0";
const DEFAULT_SQL_ROWS = 200;
const MAX_SQL_ROWS = 1_000;
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

export interface ReadOnlySql {
  all(sql: string): Promise<Row[]>;
  readOnly(sql: string, maxRows: number): Promise<Row[]>;
}

export interface ServerDependencies {
  sql: ReadOnlySql;
  dataset: DatasetInfo;
}

export function createServer({ sql, dataset }: ServerDependencies): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: `Travis County, TX property intelligence for roofing leads: TCAD properties and owners, City of Austin permits, contractors with archived BBB grades, Texas Comptroller registrations and TDLR licenses, Travis County sales tax outlets as businesses, and coordinates, published on IPFS as dataset ${dataset.rootCid ?? dataset.buildId}. Tables: ${TABLES.join(", ")}. Prefer the find_* tools; use run_sql for anything else.`,
    },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input, annotations: READ_ONLY },
      (input) => answer(() => runTool(tool.name, input, { sql, dataset })),
    );
  }

  server.registerTool(
    "get_schema",
    {
      description:
        "Columns and DuckDB types of every published table. Call it before writing SQL for run_sql.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    () => answer(async () => ({ tables: await describeTables(sql), dataset })),
  );

  server.registerTool(
    "run_sql",
    {
      description: `Run one read-only DuckDB SELECT over the published tables ${TABLES.join(", ")}.`,
      inputSchema: z.object({
        sql: z.string().min(1).describe("One SELECT statement."),
        max_rows: z.number().int().positive().max(MAX_SQL_ROWS).default(DEFAULT_SQL_ROWS),
      }),
      annotations: READ_ONLY,
    },
    ({ sql: query, max_rows: maxRows }) =>
      answer(async () => ({ rows: await sql.readOnly(query, maxRows), dataset })),
  );

  return server;
}

async function describeTables(
  sql: ReadOnlySql,
): Promise<Record<string, { column: string; type: string }[]>> {
  const columns = await sql.all(`SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN (${TABLES.map((table) => `'${table}'`).join(", ")})
ORDER BY table_name, ordinal_position`);
  const tables: Record<string, { column: string; type: string }[]> = {};
  for (const { table_name: table, column_name: column, data_type: type } of columns as Row[]) {
    const described = tables[String(table)] ?? [];
    described.push({ column: String(column), type: String(type) });
    tables[String(table)] = described;
  }
  return tables;
}

async function answer(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await run()) }] };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    };
  }
}
