// T025 (A-14/A-15 G-3, AD-21): the six MCP tool adapters, each a thin wrapper over one
// query-core function (agent-design.md § oracle "The six tool adapters"; contracts/mcp-tools.md).
// Every `inputSchema` IS the matching query-core Zod schema object, not a re-derivation: the SDK
// (`server.registerTool`) validates the call's arguments against that exact schema and hands the
// handler the parsed, defaulted value, so a client's `tools/list` sees the real AD-07-named shape
// and a client's `tools/call` is validated the same way `agent.ask`'s tools would validate the
// same input (FR-011's cross-surface agreement starts here: one schema object, two registrations).
// The output is the function's ResultEnvelope **unchanged** (no renaming, no dropping a field):
// it is both the tool's `structuredContent` and a JSON text block, so a client that only reads
// `content[0].text` still gets the full envelope.
//
// None of the six adapters import a database engine directly (ARD § 4): they take an injected
// `McpToolDeps` that resolves/binds "the run to read" (apps/api/src/handlers/mcp.ts wires the real
// one over apps/api/src/engine/duckdb-node.ts; apps/api/src/mcp/stdio.ts, tests, wire a different
// one). Resolution failure (an unknown manifest_cid, or no runs published at all when none is
// given) is this layer's job to turn into the typed `run_not_found` envelope — never a thrown 500
// and never a silently empty "success".
//
// A-16 (AC-13, A14-6, A14-8): a run that cannot be read — the runs index could not be loaded
// (`run_lookup_failed`), or the run has no Explore index / a stale one (`index_not_built` /
// `index_stale`) — answers an `isError` result whose structured content names the reason; a call
// that outlives MCP_CALL_DEADLINE_MS (below the 15 s Lambda timeout) answers `deadline_exceeded`
// and interrupts the engine, instead of a bare gateway timeout. The out-of-area owner filter on a
// run with no published owner area adds `owner_area: { status: "not_published", … }`.
import type { BoundRun, QueryEngine, Row } from "@countylens/query-core";
import {
  GetCoverageInput,
  GetPropertyInput,
  GetSchemaInput,
  ListPermitsInput,
  ListRunsInput,
  SearchPropertiesInput,
  getCoverage,
  getProperty,
  getSchema,
  listPermits,
  listRuns,
  searchProperties,
  type EmptyReason,
  type ResultEnvelope,
  type RunEcho,
} from "@countylens/query-core";
import type { RunsIndexV1 } from "@countylens/contract";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isIndexUnavailable, type IndexReason } from "../engine/explore-index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  correlationIdOf,
  createMcpObservability,
  recordToolCall,
  type McpObservability,
} from "./observability.js";

/** One bound run, ready for query-core's functions: the engine they run SQL through, and the
 *  BoundRun those functions stamp onto every row/envelope. */
export interface McpRunContext {
  readonly engine: QueryEngine;
  readonly bound: BoundRun;
  /** Whether the run publishes any owner area (default: assumed published). */
  readonly ownerAreaPublished?: () => Promise<boolean>;
}

/** The reasons a run could not be read, other than "no such run" (run_not_found). */
export type McpRunFailureReason = "run_lookup_failed" | IndexReason;

/** A run lookup that failed for a reason the caller must see (never an empty "success"). */
export interface McpRunFailure {
  readonly failure: McpRunFailureReason;
  readonly message: string;
}

export const RUN_LOOKUP_FAILED_MESSAGE =
  "The list of published runs could not be read right now; try again (run_lookup_failed)";

/** A-14 item 8: every tool call ends within this budget, below the MCP Lambda's 15 s timeout. */
export const MCP_CALL_DEADLINE_MS = 12_000;
export const MCP_LAMBDA_TIMEOUT_MS = 15_000;
export const DEADLINE_MESSAGE = "The tool call took too long and was stopped (deadline_exceeded)";

/** Reason for an out-of-area owner filter on a run that publishes no owner area. */
export const OWNER_AREA_NOTICE = {
  status: "not_published",
  reason: "owner_area_not_published",
  message: "owner area not published in this run",
} as const;

export interface McpToolDeps {
  /** Resolves and binds the run a call should read: the named `manifestCid`, or the latest
   *  published run when omitted. `undefined` means resolution failed (unknown CID, or no runs
   *  published) — the adapter's cue to answer `run_not_found` itself, never to call the
   *  query-core function against a run that was never actually bound. */
  resolveRun(manifestCid?: string): Promise<McpRunContext | McpRunFailure | undefined>;
  /** Stops the engine's running statement (the per-call deadline). Optional. */
  interrupt?(): void;
  /** The committed runs index (`runs/index.json`'s schema), for `list_runs`. */
  runsIndex(): Promise<Pick<RunsIndexV1, "runs">>;
}

const FAKE_RUN_ECHO: RunEcho = { run_id: "", manifest_cid: "", as_of: "" };

/** The `run` field every `run_not_found` shape below echoes: the requested `manifestCid` (when
 *  the caller named one) rather than an invented run identity. The one place that builds a
 *  `RunEcho` for a run that was never actually bound — every `run_not_found` shape goes through
 *  this, so there is exactly one echoing rule, not one per tool. */
function runNotFoundRunEcho(manifestCid: string | undefined): RunEcho {
  return manifestCid === undefined
    ? FAKE_RUN_ECHO
    : { ...FAKE_RUN_ECHO, manifest_cid: manifestCid };
}

/** The `run_not_found` envelope for a row-returning tool that needs a bound run but couldn't get
 *  one. */
function runNotFoundEnvelope<R>(
  manifestCid: string | undefined,
  applied: Record<string, unknown>,
): ResultEnvelope<R> {
  const reason: EmptyReason = "run_not_found";
  return {
    rows: [],
    returned: 0,
    total: 0,
    truncated: false,
    empty_reason: reason,
    unknown_excluded: {},
    run: runNotFoundRunEcho(manifestCid),
    applied,
  };
}

/** `get_coverage`'s own return shape is not a `ResultEnvelope` (no `rows`/`total`/`truncated` —
 *  coverage is a manifest field, not a table), so it needs its own `run_not_found` builder. Typed
 *  against `getCoverage`'s real return type (not a hand-written fourth shape): a future change to
 *  that function's return type fails this file to compile, instead of drifting silently. */
type GetCoverageResult = Awaited<ReturnType<typeof getCoverage>>;

function runNotFoundCoverage(manifestCid: string | undefined): GetCoverageResult {
  return { coverage: {}, run: runNotFoundRunEcho(manifestCid), empty_reason: "run_not_found" };
}

/** Every row-returning tool's output doubles as a JSON text block (for a client that only reads
 *  `content`) and `structuredContent` (the envelope/object, unchanged). */
function toolResult(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

/** Every query-core envelope/`{coverage,...}` shape handed to `toolResult` is already a plain
 *  object; this only widens the TS view to `Record<string, unknown>` so `toolResult` has one
 *  parameter type. It copies, drops, and renames nothing. */
function asRecord<T extends object>(value: T): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

/** The `isError` result for a run that could not be read, naming the reason. */
export function failureResult(
  failure: McpRunFailure,
  manifestCid: string | undefined,
): CallToolResult {
  const data = {
    error: failure.failure,
    message: failure.message,
    run: runNotFoundRunEcho(manifestCid),
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

const isFailure = (ctx: McpRunContext | McpRunFailure): ctx is McpRunFailure => "failure" in ctx;

/** Runs one query-core call, turning an index error raised mid-call into its `isError` result. */
async function guarded(
  manifestCid: string | undefined,
  run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    if (isIndexUnavailable(error))
      return failureResult({ failure: error.reason, message: error.message }, manifestCid);
    throw error;
  }
}

// ---------------------------------------------------------------------------------------
// search_properties
// ---------------------------------------------------------------------------------------

export async function searchPropertiesTool(
  deps: McpToolDeps,
  input: SearchPropertiesInput,
): Promise<CallToolResult> {
  const ctx = await deps.resolveRun(input.manifest_cid);
  if (ctx === undefined)
    return toolResult(asRecord(runNotFoundEnvelope<Row>(input.manifest_cid, { ...input })));
  if (isFailure(ctx)) return failureResult(ctx, input.manifest_cid);
  return guarded(input.manifest_cid, async () => {
    const envelope = await searchProperties(ctx.engine, ctx.bound, input);
    const notice =
      input.owner_is_out_of_area === true &&
      ctx.ownerAreaPublished !== undefined &&
      !(await ctx.ownerAreaPublished())
        ? { owner_area: OWNER_AREA_NOTICE }
        : {};
    return toolResult({ ...asRecord(envelope), ...notice });
  });
}

// ---------------------------------------------------------------------------------------
// list_permits
// ---------------------------------------------------------------------------------------

export async function listPermitsTool(
  deps: McpToolDeps,
  input: ListPermitsInput,
): Promise<CallToolResult> {
  const ctx = await deps.resolveRun(input.manifest_cid);
  if (ctx === undefined)
    return toolResult(asRecord(runNotFoundEnvelope<Row>(input.manifest_cid, { ...input })));
  if (isFailure(ctx)) return failureResult(ctx, input.manifest_cid);
  return guarded(input.manifest_cid, async () =>
    toolResult(asRecord(await listPermits(ctx.engine, ctx.bound, input))),
  );
}

// ---------------------------------------------------------------------------------------
// get_property
// ---------------------------------------------------------------------------------------

export async function getPropertyTool(
  deps: McpToolDeps,
  input: GetPropertyInput,
): Promise<CallToolResult> {
  const ctx = await deps.resolveRun(input.manifest_cid);
  if (ctx === undefined)
    return toolResult(asRecord(runNotFoundEnvelope<Row>(input.manifest_cid, { ...input })));
  if (isFailure(ctx)) return failureResult(ctx, input.manifest_cid);
  return guarded(input.manifest_cid, async () =>
    toolResult(asRecord(await getProperty(ctx.engine, ctx.bound, input))),
  );
}

// ---------------------------------------------------------------------------------------
// get_coverage
// ---------------------------------------------------------------------------------------

export async function getCoverageTool(
  deps: McpToolDeps,
  input: GetCoverageInput,
): Promise<CallToolResult> {
  const ctx = await deps.resolveRun(input.manifest_cid);
  if (ctx === undefined) return toolResult(asRecord(runNotFoundCoverage(input.manifest_cid)));
  if (isFailure(ctx)) return failureResult(ctx, input.manifest_cid);
  return guarded(input.manifest_cid, async () =>
    toolResult(asRecord(await getCoverage(ctx.engine, ctx.bound, input))),
  );
}

// ---------------------------------------------------------------------------------------
// list_runs
// ---------------------------------------------------------------------------------------

export async function listRunsTool(
  deps: McpToolDeps,
  input: ListRunsInput,
): Promise<CallToolResult> {
  let index: Pick<RunsIndexV1, "runs">;
  try {
    index = await deps.runsIndex();
  } catch {
    return failureResult(
      { failure: "run_lookup_failed", message: RUN_LOOKUP_FAILED_MESSAGE },
      undefined,
    );
  }
  const result = listRuns(index, input);
  return toolResult(asRecord(result));
}

// ---------------------------------------------------------------------------------------
// get_schema
// ---------------------------------------------------------------------------------------

export function getSchemaTool(input: GetSchemaInput): CallToolResult {
  const result = getSchema(input);
  return toolResult(asRecord(result));
}

// ---------------------------------------------------------------------------------------
// Registration (AD-21 fixed names; inputSchema is the query-core schema object, unchanged)
// ---------------------------------------------------------------------------------------

/** Wraps one tool's handler with the Stage 5 review fix (CRITICAL): one log line and one
 *  duration/count metric pair per call, via `recordToolCall`. Timed around the whole adapter
 *  call (run resolution included), so a `run_not_found` short-circuit is still timed and logged.
 *  `ok` is `result.isError !== true` on a normal return, `false` on a thrown error (re-thrown
 *  after recording — the SDK's own `CallToolRequestSchema` handler turns it into an `isError`
 *  result for the client; this wrapper never swallows it). */
export function timed(
  obs: McpObservability,
  tool: string,
  run: () => Promise<CallToolResult>,
  deadline: { ms: number; onExpire?: () => void } = { ms: MCP_CALL_DEADLINE_MS },
): () => Promise<CallToolResult> {
  return async () => {
    const started = performance.now();
    let ok = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<CallToolResult>((resolve) => {
      timer = setTimeout(() => {
        deadline.onExpire?.();
        const data = { error: "deadline_exceeded", message: DEADLINE_MESSAGE };
        resolve({
          isError: true,
          content: [{ type: "text", text: JSON.stringify(data) }],
          structuredContent: data,
        });
      }, deadline.ms);
    });
    try {
      const result = await Promise.race([run(), expired]);
      ok = result.isError !== true;
      return result;
    } catch (error) {
      ok = false;
      throw error;
    } finally {
      clearTimeout(timer);
      recordToolCall(obs, {
        tool,
        durationMs: performance.now() - started,
        ok,
        ...correlationIdOf(obs),
      });
    }
  };
}

export function registerMcpTools(
  server: McpServer,
  deps: McpToolDeps,
  obs: McpObservability = createMcpObservability(),
  deadlineMs: number = MCP_CALL_DEADLINE_MS,
): void {
  const deadline = { ms: deadlineMs, onExpire: () => deps.interrupt?.() };
  server.registerTool(
    "search_properties",
    {
      title: "Search properties",
      description:
        "Properties in or near an area, filtered by roof age, tenure, out-of-area owner, or an " +
        "open/stalled roofing permit. AD-07 column names; returns the published Provenance on " +
        "every row.",
      inputSchema: SearchPropertiesInput,
    },
    async (input) =>
      timed(obs, "search_properties", () => searchPropertiesTool(deps, input), deadline)(),
  );

  server.registerTool(
    "list_permits",
    {
      title: "List roofing permits",
      description:
        "Roofing permits, county-wide by default or inside an area/radius, filtered by status " +
        "class, minimum open years, or an exact permit number.",
      inputSchema: ListPermitsInput,
    },
    async (input) => timed(obs, "list_permits", () => listPermitsTool(deps, input), deadline)(),
  );

  server.registerTool(
    "get_property",
    {
      title: "Get property",
      description: "One property by its CID or TCAD request identifier, with its roofing permits.",
      inputSchema: GetPropertyInput,
    },
    async (input) => timed(obs, "get_property", () => getPropertyTool(deps, input), deadline)(),
  );

  server.registerTool(
    "get_coverage",
    {
      title: "Get run coverage",
      description:
        "The published run's coverage figures, unchanged, for the latest run or a named manifest_cid.",
      inputSchema: GetCoverageInput,
    },
    async (input) => timed(obs, "get_coverage", () => getCoverageTool(deps, input), deadline)(),
  );

  server.registerTool(
    "list_runs",
    {
      title: "List runs",
      description: "The committed runs index: every published run, newest first.",
      inputSchema: ListRunsInput,
    },
    async (input) => timed(obs, "list_runs", () => listRunsTool(deps, input), deadline)(),
  );

  server.registerTool(
    "get_schema",
    {
      title: "Get schema",
      description:
        "The four contract views' column catalogs (AD-07 names, enums, nullability, missing-" +
        "reason), the uncarried-field list, and the six tools' own JSON Schemas.",
      inputSchema: GetSchemaInput,
    },
    async (input) =>
      timed(obs, "get_schema", () => Promise.resolve(getSchemaTool(input)), deadline)(),
  );
}

/** Re-exported so callers (handlers/mcp.ts, stdio.ts, tests) never need a second import from
 *  @countylens/query-core just to compare "is this the same schema object" (T024). */
export {
  GetCoverageInput,
  GetPropertyInput,
  GetSchemaInput,
  ListPermitsInput,
  ListRunsInput,
  SearchPropertiesInput,
};

/** Exactly the schema object each `registerTool` call above passes as `inputSchema`, by AD-21
 *  tool name — the single source T024's "inputSchema IS the matching query-core Zod schema
 *  object" assertion compares against (`=== ` on this map's values, not a re-derivation). */
export const MCP_TOOL_SCHEMAS = {
  search_properties: SearchPropertiesInput,
  list_permits: ListPermitsInput,
  get_property: GetPropertyInput,
  get_coverage: GetCoverageInput,
  list_runs: ListRunsInput,
  get_schema: GetSchemaInput,
} as const;

/** The bound run of a `resolveRun` answer, or undefined for `run_not_found` or a failure. */
export function asRun(
  resolved: McpRunContext | McpRunFailure | undefined,
): McpRunContext | undefined {
  return resolved === undefined || "failure" in resolved ? undefined : resolved;
}
