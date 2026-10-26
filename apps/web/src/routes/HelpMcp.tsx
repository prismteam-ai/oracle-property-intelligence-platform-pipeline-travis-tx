// Help · MCP (`/help/mcp`; A-13 T031, FR-023, D-12; TC-042). The six fixed tools of the
// CountyLens MCP server (ARD AD-21: each ≤ 1,000 rows, no SQL tool; P0-13), each with one
// sentence on what it answers and its input. `search_properties` input lists the tool's own
// arguments (query-core SearchPropertiesInput, keyed by its type so a renamed argument fails
// tsc), with the bounds and enums query-core exports; the other five tools point to tools/list.
// Setup snippets for Claude Desktop, Claude Code and MCP Inspector carry `Authorization: Bearer <token>` (the
// token is shared privately with reviewers). One "Try a tool" control (A-14 T034) runs the chosen
// tool through the server-side proxy `mcpProxy.callTool` (data/mcp-try.ts): read-only, the same
// input schemas and result envelope as the MCP server, and no token in the browser. The result
// shows the run it read, the counts, the truncation flag, the first rows with their provenance and
// every error plainly; nothing is shown that the server did not return. A react-router lazy route module.
import {
  EXPLORE_BOUNDS,
  EXPLORE_SORTS,
  MAX_ROWS,
  PROPERTY_STATUS_CLASSES,
  type SearchPropertiesInput,
} from "@countylens/query-core";
import { MCP_TRY_TEXTS } from "@countylens/shared";
import { useState, type ReactElement } from "react";
import { CidDisplay } from "../components/CidDisplay";
import { Icon } from "../components/Icon";
import { StatusPill } from "../components/StatusPill";
import {
  MCP_TRY_TOOLS,
  McpTryError,
  tryMcpTool,
  type McpTryResponse,
  type McpTryTool,
} from "../data/mcp-try";
import runStyles from "./Runs.module.css";
import styles from "./HelpMcp.module.css";

/** AD-21 tools (docs/architecture-constitution.md § AD-21), in the ARD's order. */
const MCP_TOOLS = Object.freeze([
  {
    name: "search_properties",
    what: "Properties in a radius of a place or point, with the Explore filters.",
  },
  {
    name: "list_permits",
    what: "Roofing permits of a property or an area, open or stalled first.",
  },
  { name: "get_property", what: "One property by CID, with provenance and missing reasons." },
  { name: "get_coverage", what: "The coverage section of a run's manifest." },
  { name: "list_runs", what: "The published runs, from runs/index.json." },
  { name: "get_schema", what: "The published views and their columns." },
]);

const range = ([min, max]: readonly [number, number]): string => `${min} to ${max}`;

/** `search_properties` arguments, in SearchPropertiesInput's order; bounds as its Zod schema. */
const SEARCH_ARGS: Readonly<Record<keyof SearchPropertiesInput, string>> = Object.freeze({
  manifest_cid: "optional run manifest CID; omitted = the run the server reads",
  area: 'a place, { "place": "Austin" }, or a point, { "lat": 30.27, "lon": -97.74 }',
  radius_mi: `radius in miles, ${range(EXPLORE_BOUNDS.radiusMi)}`,
  roof_age_years_min: `roof age at least this many whole years, ${range(EXPLORE_BOUNDS.roof)}`,
  tenure_years_min: "owner tenure more than this many whole years, 1 to 100",
  owner_is_out_of_area: "true: out-of-area owners only",
  status_class: `permit status: ${PROPERTY_STATUS_CLASSES.join(", ")}`,
  open_years_min: `with status_class: open at least this many years, ${range(
    EXPLORE_BOUNDS.openYrs,
  )}`,
  sort: `sort: ${EXPLORE_SORTS.join(", ")}; default nearest`,
  limit: `rows per call, 1 to ${MAX_ROWS}, default 50`,
});
const SEARCH_PARAMS = Object.entries(SEARCH_ARGS).map(([name, text]) => ({ name, text }));

const BEARER = "Authorization: Bearer <token>";

/** HelpMcp boards: each client's snippet under the file (or place) it goes in, args one per line. */
const SNIPPETS = Object.freeze([
  {
    id: "claude-desktop",
    title: "Claude Desktop",
    file: "claude_desktop_config.json",
    code: `{\n  "mcpServers": {\n    "countylens": {\n      "command": "npx",\n      "args": [\n        "mcp-remote",\n        "<mcp-url>",\n        "--header",\n        "${BEARER}"\n      ]\n    }\n  }\n}`,
  },
  {
    id: "claude-code",
    title: "Claude Code",
    file: "Terminal",
    code: `claude mcp add --transport http countylens <mcp-url> \\\n  --header "${BEARER}"`,
  },
  {
    id: "mcp-inspector",
    title: "MCP Inspector",
    file: "Terminal, then the Inspector's connection form",
    code: `npx @modelcontextprotocol/inspector\n# Transport: Streamable HTTP\n# URL: <mcp-url>\n# Header: ${BEARER}`,
  },
]);

/** Starting arguments per tool; the visitor edits them. No invented identifiers. */
const EXAMPLES: Readonly<Record<McpTryTool, string>> = Object.freeze({
  search_properties:
    '{\n  "area": { "place": "Austin" },\n  "radius_mi": 5,\n  "roof_age_years_min": 15,\n  "limit": 5\n}',
  list_permits: '{\n  "status_class": "open_or_stalled",\n  "limit": 5\n}',
  get_property: '{\n  "property_cid": "<a property_cid from search_properties>"\n}',
  get_coverage: "{}",
  list_runs: '{\n  "limit": 5\n}',
  get_schema: '{\n  "view": "v_property"\n}',
});

/** HelpMcp1440 board "Example request (tools/call)": the JSON-RPC call for search_properties,
 *  built from the same starting arguments Try a tool uses (no invented values). */
const EXAMPLE_REQUEST = JSON.stringify(
  {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "search_properties", arguments: JSON.parse(EXAMPLES.search_properties) },
  },
  null,
  2,
);

/** Rows and characters shown on the page; the server returned (and counted) all of them. */
const SHOWN_ROWS = 5;
const SHOWN_CHARS = 6000;

type TryState =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "done"; readonly response: McpTryResponse }
  | { readonly kind: "error"; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function TryResult({ response }: { readonly response: McpTryResponse }): ReactElement {
  const { result } = response;
  const rows = Array.isArray(result["rows"]) ? (result["rows"] as unknown[]) : undefined;
  const run = isRecord(result["run"]) ? result["run"] : undefined;
  const returned = typeof result["returned"] === "number" ? result["returned"] : rows?.length;
  const total = typeof result["total"] === "number" ? result["total"] : undefined;
  const truncated = result["truncated"] === true;
  const emptyReason = typeof result["empty_reason"] === "string" ? result["empty_reason"] : null;
  const body = rows === undefined ? result : rows.slice(0, SHOWN_ROWS);
  const json = JSON.stringify(body, null, 2);
  const cut = json.length > SHOWN_CHARS;
  return (
    <div className={runStyles.card} data-try-result={response.tool}>
      <h4 className={runStyles.sectionTitle}>
        <code className={runStyles.mono}>{response.tool}</code>
      </h4>
      {run !== undefined ? (
        <p className={runStyles.itemBody} data-try-provenance="">
          Run <code className={runStyles.mono}>{String(run["run_id"] ?? "")}</code> · as of{" "}
          {String(run["as_of"] ?? "")}
          {typeof run["manifest_cid"] === "string" && run["manifest_cid"] !== "" ? (
            <>
              {" "}
              · manifest <CidDisplay cid={run["manifest_cid"]} />
            </>
          ) : null}
        </p>
      ) : null}
      {returned !== undefined && total !== undefined ? (
        <span data-try-count="">
          <StatusPill
            status={truncated ? "warning" : "verified"}
            text={
              truncated
                ? MCP_TRY_TEXTS.truncated(returned, total)
                : MCP_TRY_TEXTS.complete(returned)
            }
            data={{ truncated: String(truncated) }}
          />
        </span>
      ) : null}
      {emptyReason !== null ? (
        <span data-try-empty="">
          <StatusPill
            status={emptyReason === "run_not_found" ? "error" : "info"}
            text={MCP_TRY_TEXTS.emptyReason(emptyReason)}
            data={{ reason: emptyReason }}
          />
        </span>
      ) : null}
      {rows !== undefined && rows.length > SHOWN_ROWS ? (
        <p className={runStyles.itemBody}>{MCP_TRY_TEXTS.shownOf(SHOWN_ROWS, rows.length)}</p>
      ) : null}
      <pre data-try-json="" className={styles.snippet} tabIndex={0}>
        <code>{cut ? `${json.slice(0, SHOWN_CHARS)}\n…` : json}</code>
      </pre>
      {cut ? (
        <p className={runStyles.itemBody}>Output shortened to {SHOWN_CHARS} characters</p>
      ) : null}
    </div>
  );
}

export interface HelpMcpProps {
  /** Injected by tests; defaults to the real proxy client. */
  readonly callTool?: typeof tryMcpTool;
}

export function Component({ callTool = tryMcpTool }: HelpMcpProps = {}): ReactElement {
  const [tool, setTool] = useState<McpTryTool>("search_properties");
  const [args, setArgs] = useState<string>(EXAMPLES.search_properties);
  const [state, setState] = useState<TryState>({ kind: "idle" });
  const [client, setClient] = useState<(typeof SNIPPETS)[number]["id"]>("claude-desktop");
  const [copied, setCopied] = useState(false);
  const snippet =
    SNIPPETS.find((s) => s.id === client) ?? (SNIPPETS[0] as (typeof SNIPPETS)[number]);
  const copy = (): void => {
    void navigator.clipboard?.writeText(snippet.code).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  const run = async (): Promise<void> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args.trim() === "" ? "{}" : args);
    } catch {
      setState({ kind: "error", message: MCP_TRY_TEXTS.badJson });
      return;
    }
    if (!isRecord(parsed)) {
      setState({ kind: "error", message: MCP_TRY_TEXTS.badJson });
      return;
    }
    setState({ kind: "running" });
    try {
      setState({ kind: "done", response: await callTool(tool, parsed) });
    } catch (error) {
      const message =
        error instanceof McpTryError
          ? error.code === "unreachable"
            ? MCP_TRY_TEXTS.unreachable
            : error.code === "rate_limited"
              ? MCP_TRY_TEXTS.rateLimited
              : error.message
          : MCP_TRY_TEXTS.unreachable;
      setState({ kind: "error", message });
    }
  };
  // HelpMcp1440/768/390 boards: the path as a small crumb above the "MCP and API" headline; a top
  // row of Endpoint | Access | Connect a client, then the tools | Try a tool. The grid stacks at 390.
  return (
    <section
      aria-label="Help · MCP"
      data-route="help-mcp"
      data-state="ready"
      className={runStyles.page}
    >
      <h2 className={styles.crumb}>Help · MCP</h2>
      <p className={styles.subtitle}>MCP and API</p>
      <p className={runStyles.itemBody}>
        Ask CountyLens from Claude Desktop, MCP Inspector or any MCP client. The tools read the same
        published views as Explore; each returns at most {MAX_ROWS} rows. No tool runs free-form
        queries.
      </p>
      <div className={styles.layout}>
        <div className={runStyles.card} data-mcp-endpoint="">
          <h3 className={runStyles.sectionTitle}>Endpoint</h3>
          <dl className={styles.facts}>
            <dt>URL</dt>
            <dd>Shared privately with reviewers, together with the token</dd>
            <dt>Transport</dt>
            <dd>Streamable HTTP</dd>
            <dt>Runs on</dt>
            <dd>Its own stateless Lambda handler, sharing query-core with Explore</dd>
            <dt>Data</dt>
            <dd>The latest published run (the badge in the app bar)</dd>
          </dl>
        </div>
        <div className={runStyles.card} data-mcp-access="">
          <h3 className={runStyles.sectionTitle}>Access</h3>
          <dl className={styles.facts}>
            <dt>
              <code>tools/list</code>
            </dt>
            <dd>Bearer token</dd>
            <dt>
              <code>tools/call</code>
            </dt>
            <dd>Bearer token · read-only</dd>
          </dl>
          <p className={runStyles.itemBody}>
            Send it as <code>{BEARER}</code>. Every tool only reads published data, and calls are
            throttled. No or wrong token: 401 Unauthorized · throttled: 429 Too Many Requests.
          </p>
        </div>

        <div className={`${runStyles.card} ${styles.connect}`}>
          <h3 className={runStyles.sectionTitle}>Connect a client</h3>
          <p className={runStyles.itemBody}>
            Bearer token required, shared privately with reviewers
          </p>
          <div className={styles.tabRow}>
            <div role="tablist" aria-label="MCP client" className={styles.clientTabs}>
              {SNIPPETS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={client === s.id}
                  className={`${styles.clientTab} ${client === s.id ? styles.clientTabOn : ""}`}
                  onClick={() => {
                    setClient(s.id);
                    setCopied(false);
                  }}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.fileRow}>
            <code className={styles.fileName}>{snippet.file}</code>
            <button type="button" className={styles.copy} onClick={copy}>
              <Icon name="content_copy" size="medium" />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {SNIPPETS.map((snippet) => (
            <div key={snippet.id} className={styles.snippetBox}>
              <div role="tabpanel" aria-label={snippet.title} hidden={client !== snippet.id}>
                <pre data-snippet={snippet.id} className={styles.snippet} tabIndex={0}>
                  <code>{snippet.code}</code>
                </pre>
              </div>
            </div>
          ))}
        </div>

        <div className={`${runStyles.card} ${styles.tools}`}>
          <h3 className={styles.toolsTitle}>
            Tools <span className={styles.count}>{MCP_TOOLS.length}</span>
          </h3>
          <ul className={styles.toolList} aria-label="MCP tools">
            {MCP_TOOLS.map((tool) => (
              <li
                key={tool.name}
                className={
                  tool.name === "search_properties"
                    ? `${styles.tool} ${styles.toolWide}`
                    : styles.tool
                }
                data-tool={tool.name}
              >
                <span className={styles.toolHead}>
                  <code className={styles.toolName}>{tool.name}</code>
                  <StatusPill status="info" icon="lock" text="Read-only" />
                </span>
                <span className={runStyles.itemBody}>{tool.what}</span>
                {tool.name === "search_properties" ? (
                  <div className={styles.schemaRow}>
                    <div className={styles.schemaCol}>
                      <span className={styles.blockLabel}>Input schema</span>
                      <table
                        className={styles.schema}
                        aria-label="search_properties input"
                        data-schema=""
                      >
                        <thead>
                          <tr>
                            <th scope="col">Input</th>
                            <th scope="col">Allowed values</th>
                          </tr>
                        </thead>
                        <tbody>
                          {SEARCH_PARAMS.map((param) => (
                            <tr key={param.name} data-param={param.name}>
                              <th scope="row">
                                <code className={runStyles.mono}>{param.name}</code>
                              </th>
                              <td>{param.text}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className={styles.schemaCol}>
                      <span className={styles.blockLabel}>Example request (tools/call)</span>
                      <pre className={styles.snippet} tabIndex={0} data-example-request="">
                        <code>{EXAMPLE_REQUEST}</code>
                      </pre>
                    </div>
                  </div>
                ) : (
                  <span className={styles.pending} data-schema-pending="">
                    Input schema: listed by the MCP server's tools/list.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className={`${runStyles.card} ${styles.try}`}>
          <h3 className={styles.toolsTitle}>
            <Icon name="play_arrow" />
            Try a tool
          </h3>
          <p className={runStyles.itemBody}>{MCP_TRY_TEXTS.noToken}</p>
          <label className={runStyles.itemBody} htmlFor="mcp-try-tool">
            Tool
          </label>
          <select
            id="mcp-try-tool"
            className={styles.field}
            value={tool}
            onChange={(event) => {
              const next = event.target.value as McpTryTool;
              setTool(next);
              setArgs(EXAMPLES[next]);
              setState({ kind: "idle" });
            }}
          >
            {MCP_TRY_TOOLS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <label className={runStyles.itemBody} htmlFor="mcp-try-args">
            Arguments (JSON)
          </label>
          <textarea
            id="mcp-try-args"
            className={`${styles.field} ${styles.args}`}
            value={args}
            rows={6}
            spellCheck={false}
            onChange={(event) => setArgs(event.target.value)}
          />
          <span>
            <button
              type="button"
              className={styles.run}
              data-main-control=""
              disabled={state.kind === "running"}
              onClick={() => void run()}
            >
              Try a tool
            </button>
          </span>
          <span role="status" data-try-state={state.kind}>
            {state.kind === "running" ? (
              <StatusPill status="info" icon="schedule" text={MCP_TRY_TEXTS.running} />
            ) : null}
          </span>
          {state.kind === "error" ? (
            <div role="alert" data-try-error="">
              <StatusPill status="error" text={state.message} />
            </div>
          ) : null}
          {state.kind === "done" ? <TryResult response={state.response} /> : null}
        </div>
      </div>
    </section>
  );
}
