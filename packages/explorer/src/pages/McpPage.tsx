import type { JSONRPCMessage, Tool } from "@modelcontextprotocol/sdk/types.js";
import { useEffect, useState } from "react";
import { Badge, Card, DataTable, Disclosure, ErrorNote, Spinner } from "../components/ui.js";
import type { Dataset } from "../data/dataset.js";
import type { Database } from "../data/duckdb.js";
import {
  connectMcp,
  McpDirection,
  type McpSession,
  type McpToolResult,
} from "../mcp/mcp-session.js";
import { REPOSITORY_URL } from "../repository.js";
import { datasetInfo } from "./dataset-info.js";

const FIRST_TOOL = "find_aged_roofs";
const EXAMPLE_INPUTS: Record<string, object> = {
  find_aged_roofs: { place: "Rollingwood", radius_miles: 5, min_roof_age_years: 15, limit: 10 },
  find_open_roofing_permits: {
    place: "Rollingwood",
    radius_miles: 5,
    min_years_open: 5,
    limit: 10,
  },
  find_hail_hit_roofs: {
    place: "78704",
    radius_miles: 5,
    min_hail_inches: 1,
    within_years: 3,
    limit: 10,
  },
  find_top_leads: { place: "Rollingwood", radius_miles: 5, limit: 10 },
  property_details: { prop_id: 100036 },
  contractor_details: { name: "roof" },
  owner_details: { prop_id: 100036 },
  find_long_held_properties: {
    place: "Lakeway",
    radius_miles: 3,
    min_ownership_years: 10,
    limit: 10,
  },
  find_out_of_area_owners: { place: "Manor", radius_miles: 2, limit: 10 },
  locate_place: { name: "Bee Cave" },
  dataset_summary: {},
  get_schema: {},
  run_sql: {
    sql: "SELECT roof_age_confidence, count(*) AS properties FROM properties GROUP BY 1 ORDER BY 2 DESC",
  },
};
const MCP_SETUP = `git clone ${REPOSITORY_URL}
cd oracle-property-intelligence-platform-pipeline-travis-tx && npm ci

# Claude Code
claude mcp add travis-oracle -- npm run --silent mcp --prefix "$PWD"

# Any MCP client: stdio command
npm run --silent mcp

# Optional environment
TRAVIS_ORACLE_GATEWAY=https://ipfs.orbitor.dev   # read the Parquet tables straight from public IPFS
TRAVIS_ORACLE_ROOT_CID=<dataset root CID>        # pin any published snapshot instead of the latest`;
const MCP_CONFIG = JSON.stringify(
  {
    mcpServers: {
      "travis-oracle": {
        command: "npm",
        args: [
          "run",
          "--silent",
          "mcp",
          "--prefix",
          "/path/to/oracle-property-intelligence-platform-pipeline-travis-tx",
        ],
      },
    },
  },
  null,
  2,
);

interface LoggedMessage {
  sequence: number;
  direction: McpDirection;
  message: JSONRPCMessage;
}

export function McpPage({ dataset, database }: { dataset: Dataset; database: Database }) {
  const [session, setSession] = useState<McpSession>();
  const [messages, setMessages] = useState<LoggedMessage[]>([]);
  const [tool, setTool] = useState(FIRST_TOOL);
  const [input, setInput] = useState(JSON.stringify(EXAMPLE_INPUTS[FIRST_TOOL], null, 2));
  const [result, setResult] = useState<McpToolResult>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let active = true;
    connectMcp(database, datasetInfo(dataset), (direction, message) => {
      if (active) {
        setMessages((logged) => [...logged, { sequence: logged.length + 1, direction, message }]);
      }
    })
      .then((connected) => active && setSession(connected))
      .catch((failure: unknown) => active && setError(String(failure)));
    return () => {
      active = false;
    };
  }, [database, dataset]);

  const choose = (name: string) => {
    setTool(name);
    setInput(JSON.stringify(EXAMPLE_INPUTS[name] ?? {}, null, 2));
    setResult(undefined);
    setError(undefined);
  };

  const call = async () => {
    if (!session) return;
    setRunning(true);
    setError(undefined);
    try {
      setResult(await session.call(tool, JSON.parse(input)));
    } catch (failure) {
      setResult(undefined);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRunning(false);
    }
  };

  const chosen = session?.tools.find((candidate) => candidate.name === tool);

  return (
    <div className="page">
      <Card
        title="MCP-ready: a live MCP session"
        subtitle={
          <>
            This page is an MCP client. It speaks JSON-RPC to the same MCP server that{" "}
            <code>npm run mcp</code> starts, running here in the browser over DuckDB-WASM through an
            in-memory transport, so you see exactly what an agent or the roofing CRM sees.
          </>
        }
      >
        {session ? (
          <dl className="facts">
            <dt>Server</dt>
            <dd>
              <code>
                {session.server.name} {session.server.version}
              </code>
            </dd>
            <dt>Tools (tools/list)</dt>
            <dd>{session.tools.length} read-only tools</dd>
            <dt>Data model</dt>
            <dd>the published Parquet tables, unchanged</dd>
            <dt>Transport here · locally</dt>
            <dd>in-browser · stdio</dd>
          </dl>
        ) : (
          !error && <Spinner label="Connecting an MCP client to the server…" />
        )}
      </Card>

      {session && (
        <Card
          title="Tools"
          subtitle="Listed by the server over tools/list, each with its JSON Schema."
        >
          <div className="mcp-layout">
            <ul className="tool-list">
              {session.tools.map((candidate) => (
                <li key={candidate.name}>
                  <button
                    type="button"
                    className={candidate.name === tool ? "tool active" : "tool"}
                    onClick={() => choose(candidate.name)}
                  >
                    <code>{candidate.name}</code>
                    <span>{candidate.description}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div>
              <h3>
                Call <code>{tool}</code>
              </h3>
              <textarea
                aria-label="Tool input"
                className="json-input"
                value={input}
                spellCheck={false}
                onChange={(event) => setInput(event.target.value)}
              />
              <button type="button" className="button" onClick={call} disabled={running}>
                Call tool
              </button>
              {running && <Spinner label="tools/call…" />}
              {error && <ErrorNote message={error} />}
              {result && (
                <>
                  <DataTable rows={result.rows} />
                  {result.related && result.related.length > 0 && (
                    <DataTable rows={result.related} />
                  )}
                </>
              )}
              {chosen && <ToolSchema tool={chosen} />}
              <h3>JSON-RPC messages</h3>
              <ol className="rpc-log">
                {messages.map((logged) => (
                  <li key={logged.sequence}>
                    <Badge tone={logged.direction === McpDirection.ToServer ? "info" : "good"}>
                      {logged.direction}
                    </Badge>{" "}
                    <code>{messageLabel(logged.message)}</code>
                    <Disclosure summary="message">
                      <pre className="code-block">{JSON.stringify(logged.message, null, 2)}</pre>
                    </Disclosure>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Card>
      )}

      <Card
        title="Connect an MCP client"
        subtitle="The stdio MCP server runs the same tools with DuckDB over the published Parquet tables; it resolves the latest publication by CID. The roofing CRM's assistant calls these same tool definitions."
      >
        <pre className="code-block">{MCP_SETUP}</pre>
        <Disclosure summary="Client configuration (mcpServers)">
          <pre className="code-block">{MCP_CONFIG}</pre>
        </Disclosure>
      </Card>
    </div>
  );
}

function ToolSchema({ tool }: { tool: Tool }) {
  return (
    <Disclosure summary="Input JSON Schema">
      <pre className="code-block">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
    </Disclosure>
  );
}

function messageLabel(message: JSONRPCMessage): string {
  const id = "id" in message ? ` #${message.id}` : "";
  if ("method" in message) {
    const name = (message.params as { name?: unknown } | undefined)?.name;
    return `${message.method}${typeof name === "string" ? ` ${name}` : ""}${id}`;
  }
  return `${"error" in message ? "error" : "result"}${id}`;
}
