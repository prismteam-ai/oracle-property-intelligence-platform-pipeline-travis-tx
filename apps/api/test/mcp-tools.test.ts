// A-14 T024 (G-3): the six MCP tool adapters (src/mcp/tools.ts, T025). Written before tools.ts
// exists: the red run fails with "Cannot find module '../src/mcp/tools'". Per the design
// (agent-design.md § oracle "The six tool adapters"; contracts/mcp-tools.md): each `inputSchema`
// IS the matching query-core Zod schema object (reference equality, not a re-derivation), the
// output envelope is unchanged, `get_coverage` matches the manifest's `coverage` byte-for-byte,
// and the truncation flag is set correctly at a forced small `limit`. The engine here is a plain
// fake (`makeEngine`): these tests exercise the adapter layer (deps wiring, envelope passthrough,
// run-resolution failure -> run_not_found), not query-core's own SQL — that is
// packages/query-core/test/tools.functions.test.ts's job.
import { describe, expect, it } from "vitest";
import type { QueryEngine, Row } from "@countylens/query-core";
import {
  CONTRACT_VIEWS,
  GetCoverageInput as QcGetCoverageInput,
  GetPropertyInput as QcGetPropertyInput,
  GetSchemaInput as QcGetSchemaInput,
  ListPermitsInput as QcListPermitsInput,
  ListRunsInput as QcListRunsInput,
  SearchPropertiesInput as QcSearchPropertiesInput,
  type BoundRun,
} from "@countylens/query-core";
import type { RunsIndexV1 } from "@countylens/contract";
import {
  GetCoverageInput,
  GetPropertyInput,
  GetSchemaInput,
  ListPermitsInput,
  ListRunsInput,
  MCP_TOOL_SCHEMAS,
  SearchPropertiesInput,
  getCoverageTool,
  getPropertyTool,
  getSchemaTool,
  listPermitsTool,
  listRunsTool,
  searchPropertiesTool,
  type McpRunContext,
  type McpToolDeps,
} from "../src/mcp/tools.js";

const CID1 = `ba${"a".repeat(60)}`;
const CID2 = `ba${"b".repeat(60)}`;

const BOUND: BoundRun = {
  runId: "travis-fixture",
  manifestCid: CID1,
  asOf: "2026-10-20T22:00:10.663Z",
  tables: [],
  views: [...CONTRACT_VIEWS],
};

function makeEngine(responder: (sql: string) => Row[]): QueryEngine {
  return {
    async run(): Promise<void> {},
    async all(sql: string): Promise<Row[]> {
      return responder(sql);
    },
  };
}

function depsWith(
  ctx: McpRunContext | undefined,
  runsIndex: Pick<RunsIndexV1, "runs"> = { runs: [] },
): McpToolDeps {
  return {
    resolveRun: async () => ctx,
    runsIndex: async () => runsIndex,
  };
}

describe("MCP tool adapters: inputSchema identity (T024)", () => {
  it("is the exact query-core schema object for every one of the six tools, not re-derived", () => {
    expect(MCP_TOOL_SCHEMAS.search_properties).toBe(QcSearchPropertiesInput);
    expect(MCP_TOOL_SCHEMAS.list_permits).toBe(QcListPermitsInput);
    expect(MCP_TOOL_SCHEMAS.get_property).toBe(QcGetPropertyInput);
    expect(MCP_TOOL_SCHEMAS.get_coverage).toBe(QcGetCoverageInput);
    expect(MCP_TOOL_SCHEMAS.list_runs).toBe(QcListRunsInput);
    expect(MCP_TOOL_SCHEMAS.get_schema).toBe(QcGetSchemaInput);
    // tools.ts's own re-exports are the same bindings too (what server.ts's registerTool calls use).
    expect(SearchPropertiesInput).toBe(QcSearchPropertiesInput);
    expect(ListPermitsInput).toBe(QcListPermitsInput);
    expect(GetPropertyInput).toBe(QcGetPropertyInput);
    expect(GetCoverageInput).toBe(QcGetCoverageInput);
    expect(ListRunsInput).toBe(QcListRunsInput);
    expect(GetSchemaInput).toBe(QcGetSchemaInput);
  });
});

describe("search_properties", () => {
  it("passes the envelope through unchanged and sets truncated at a forced small limit", async () => {
    const engine = makeEngine((sql) =>
      sql.includes("total_within_r")
        ? [{ total_within_r: 5, tenure_unknown: 0 }]
        : [{ property_cid: "p1" }, { property_cid: "p2" }],
    );
    const deps = depsWith({ engine, bound: BOUND });
    const input = SearchPropertiesInput.parse({
      area: { lat: 30.4, lon: -97.6 },
      radius_mi: 5,
      limit: 2,
    });

    const result = await searchPropertiesTool(deps, input);
    const data = result.structuredContent as Record<string, unknown>;

    expect(data.returned).toBe(2);
    expect(data.total).toBe(5);
    expect(data.truncated).toBe(true); // total (5) > returned (2)
    expect(data.empty_reason).toBeNull();
    expect(data.run).toEqual({ run_id: "travis-fixture", manifest_cid: CID1, as_of: BOUND.asOf });
    // The text block is the same object, not a separate re-derivation.
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(data);
  });

  it("does not run any query and answers run_not_found when the run cannot be resolved", async () => {
    let called = false;
    const deps: McpToolDeps = {
      resolveRun: async () => undefined,
      runsIndex: async () => {
        called = true;
        return { runs: [] };
      },
    };
    const input = SearchPropertiesInput.parse({
      area: { lat: 30.4, lon: -97.6 },
      radius_mi: 5,
      manifest_cid: CID2,
    });

    const result = await searchPropertiesTool(deps, input);
    const data = result.structuredContent as Record<string, unknown>;

    expect(data.empty_reason).toBe("run_not_found");
    expect(data.rows).toEqual([]);
    expect((data.run as { manifest_cid: string }).manifest_cid).toBe(CID2);
    expect(called).toBe(false); // runsIndex is list_runs-only; search_properties never calls it
  });
});

describe("list_permits", () => {
  it("echoes the requested manifest_cid in a run_not_found envelope", async () => {
    const deps = depsWith(undefined);
    const input = ListPermitsInput.parse({ manifest_cid: CID2, permit_number: "1982-012866 BP" });

    const result = await listPermitsTool(deps, input);
    const data = result.structuredContent as Record<string, unknown>;

    expect(data.empty_reason).toBe("run_not_found");
    expect(data.rows).toEqual([]);
    expect((data.run as { manifest_cid: string }).manifest_cid).toBe(CID2);
  });

  it("passes a bound run's permit rows through unchanged", async () => {
    const permitRow = { permit_cid: "pc1", permit_number: "1982-012866 BP", open_days: 40 };
    const engine = makeEngine((sql) => (sql.includes("count(*) AS n") ? [{ n: 1 }] : [permitRow]));
    const deps = depsWith({ engine, bound: BOUND });
    const input = ListPermitsInput.parse({ permit_number: "1982-012866 BP" });

    const result = await listPermitsTool(deps, input);
    const data = result.structuredContent as Record<string, unknown>;

    expect(data.returned).toBe(1);
    expect(data.total).toBe(1);
    expect(data.truncated).toBe(false);
    expect((data.rows as Array<Record<string, unknown>>)[0]).toMatchObject({
      permit_cid: "pc1",
      permit_number: "1982-012866 BP",
    });
  });
});

describe("get_property", () => {
  it("answers run_not_found rather than calling the query-core function with no bound run", async () => {
    const deps = depsWith(undefined);
    const input = GetPropertyInput.parse({ property_cid: CID1 });

    const result = await getPropertyTool(deps, input);
    const data = result.structuredContent as Record<string, unknown>;

    expect(data.empty_reason).toBe("run_not_found");
    expect(data.returned).toBe(0);
  });
});

describe("get_coverage", () => {
  it("returns the manifest's coverage object byte-for-byte (DuckDB's JSON-as-text parsed, nothing else changed)", async () => {
    const coverage = {
      permits_emitted: { count: 7, derivation: "published_rows" },
      roof_unknown: { count: 1, derivation: "derived" },
    };
    const engine = makeEngine(() => [{ coverage: JSON.stringify(coverage) }]);
    const deps = depsWith({ engine, bound: BOUND });

    const result = await getCoverageTool(deps, GetCoverageInput.parse({}));
    const data = result.structuredContent as Record<string, unknown>;

    expect(data.coverage).toEqual(coverage);
    expect(data.run).toEqual({ run_id: "travis-fixture", manifest_cid: CID1, as_of: BOUND.asOf });
  });

  it("the run_not_found shape echoes the requested manifest_cid and never fabricates coverage", async () => {
    const deps = depsWith(undefined);
    const result = await getCoverageTool(deps, GetCoverageInput.parse({ manifest_cid: CID2 }));
    expect(result.structuredContent).toEqual({
      coverage: {},
      run: { run_id: "", manifest_cid: CID2, as_of: "" },
      empty_reason: "run_not_found",
    });
  });
});

describe("list_runs", () => {
  it("passes the injected runs index through, newest first", async () => {
    const index: Pick<RunsIndexV1, "runs"> = {
      runs: [
        { runId: "a", manifestCid: CID1, finishedAt: "2026-01-01T00:00:00.000Z" },
        { runId: "b", manifestCid: CID2, finishedAt: "2026-06-01T00:00:00.000Z" },
      ],
    };
    const deps = depsWith(undefined, index);

    const result = await listRunsTool(deps, ListRunsInput.parse({}));
    const data = result.structuredContent as Record<string, unknown>;

    expect(data.latest).toEqual({
      run_id: "b",
      manifest_cid: CID2,
      finished_at: "2026-06-01T00:00:00.000Z",
    });
    expect((data.runs as unknown[]).length).toBe(2);
  });
});

describe("get_schema", () => {
  it("is pure (no deps) and returns the four contract views by default", () => {
    const result = getSchemaTool(GetSchemaInput.parse({}));
    const data = result.structuredContent as { views: Array<{ name: string }> };
    expect(data.views.map((v) => v.name)).toEqual([
      "v_property",
      "v_roofing_permit",
      "v_contractor",
      "v_run",
    ]);
  });

  it("scopes to one view and carries the six tools' own JSON Schemas", () => {
    const result = getSchemaTool(GetSchemaInput.parse({ view: "v_roofing_permit" }));
    const data = result.structuredContent as {
      views: Array<{ name: string }>;
      tool_inputs: Record<string, unknown>;
    };
    expect(data.views).toHaveLength(1);
    expect(data.views[0]?.name).toBe("v_roofing_permit");
    expect(Object.keys(data.tool_inputs).sort()).toEqual(
      [
        "searchProperties",
        "listPermits",
        "getProperty",
        "getCoverage",
        "listRuns",
        "getSchema",
      ].sort(),
    );
  });
});
