// A-14 unit coverage: the six tools as a real MCP client sees them. The SDK's in-memory transport
// connects a Client to buildMcpServer(...) (src/mcp/server.ts + tools.ts registerMcpTools), so the
// registered handlers, the `timed` wrapper and the Powertools recording run for real. Only the
// engine (a plain fake) and the Powertools sinks (recording fakes) are substituted.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { CONTRACT_VIEWS, type BoundRun, type QueryEngine, type Row } from "@countylens/query-core";
import type { RunsIndexV1 } from "@countylens/contract";
import type { Logger } from "@aws-lambda-powertools/logger";
import type { Metrics } from "@aws-lambda-powertools/metrics";
import type { Tracer } from "@aws-lambda-powertools/tracer";
import { buildMcpServer } from "../src/mcp/server.js";
import {
  METRIC_TOOL_CALL_FAILED,
  METRIC_TOOL_CALLS_TOTAL,
  correlationIdOf,
  createMcpObservability,
  recordAuthFailure,
  recordToolCall,
} from "../src/mcp/observability.js";
import type { McpToolDeps } from "../src/mcp/tools.js";

const CID1 = `ba${"a".repeat(60)}`;
const CID2 = `ba${"b".repeat(60)}`;
const BOUND: BoundRun = {
  runId: "travis-fixture",
  manifestCid: CID1,
  asOf: "2026-10-20T22:00:10.663Z",
  tables: [],
  views: [...CONTRACT_VIEWS],
};

interface Recorded {
  metrics: Array<{ name: string; value: number }>;
  dimensions: Array<[string, string]>;
  logs: Array<{ level: string; message: string; extra: Record<string, unknown> }>;
}

function recordingObs(correlationId?: string) {
  const rec: Recorded = { metrics: [], dimensions: [], logs: [] };
  const logger = {
    info: (message: string, extra: Record<string, unknown>) =>
      rec.logs.push({ level: "info", message, extra }),
    warn: (message: string, extra: Record<string, unknown>) =>
      rec.logs.push({ level: "warn", message, extra }),
    getCorrelationId: () => correlationId,
  } as unknown as Logger;
  const metrics = {
    addMetric: (name: string, _unit: string, value: number) => rec.metrics.push({ name, value }),
    addDimension: (k: string, v: string) => rec.dimensions.push([k, v]),
  } as unknown as Metrics;
  return { obs: { logger, metrics, tracer: {} as Tracer }, rec };
}

function engineOf(responder: (sql: string) => Row[] | Error): QueryEngine {
  return {
    async run(): Promise<void> {},
    async all(sql: string): Promise<Row[]> {
      const out = responder(sql);
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

const INDEX: Pick<RunsIndexV1, "runs"> = {
  runs: [
    { runId: "a", manifestCid: CID1, finishedAt: "2026-01-01T00:00:00.000Z" },
    { runId: "b", manifestCid: CID2, finishedAt: "2026-06-01T00:00:00.000Z" },
  ],
};

const clients: Client[] = [];
async function connect(deps: McpToolDeps, obs = recordingObs().obs): Promise<Client> {
  const server = buildMcpServer(deps, obs);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "unit-test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  clients.push(client);
  return client;
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

const structured = (r: unknown): Record<string, unknown> =>
  (r as { structuredContent: Record<string, unknown> }).structuredContent;

describe("registered MCP tools over an in-memory client", () => {
  it("lists exactly the six AD-21 tools", async () => {
    const client = await connect({
      resolveRun: async () => undefined,
      runsIndex: async () => INDEX,
    });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_coverage",
      "get_property",
      "get_schema",
      "list_permits",
      "list_runs",
      "search_properties",
    ]);
  });

  it("answers run_not_found for every run-bound tool and records one metered call each", async () => {
    const { obs, rec } = recordingObs("corr-1");
    const asked: Array<string | undefined> = [];
    const client = await connect(
      {
        resolveRun: async (cid) => {
          asked.push(cid);
          return undefined;
        },
        runsIndex: async () => INDEX,
      },
      obs,
    );

    const search = structured(
      await client.callTool({
        name: "search_properties",
        arguments: { area: { lat: 30.4, lon: -97.6 }, radius_mi: 5, manifest_cid: CID2 },
      }),
    );
    const permits = structured(
      await client.callTool({ name: "list_permits", arguments: { manifest_cid: CID2 } }),
    );
    const prop = structured(
      await client.callTool({ name: "get_property", arguments: { property_cid: CID1 } }),
    );
    const cov = structured(await client.callTool({ name: "get_coverage", arguments: {} }));

    for (const data of [search, permits, prop]) {
      expect(data.empty_reason).toBe("run_not_found");
      expect(data.rows).toEqual([]);
      expect(data.total).toBe(0);
      expect(data.truncated).toBe(false);
    }
    expect((search.run as { manifest_cid: string }).manifest_cid).toBe(CID2);
    expect((prop.run as { manifest_cid: string }).manifest_cid).toBe("");
    expect(cov).toEqual({
      coverage: {},
      run: { run_id: "", manifest_cid: "", as_of: "" },
      empty_reason: "run_not_found",
    });
    expect(asked).toEqual([CID2, CID2, undefined, undefined]);

    // one tool-call metric pair and one log line per call, all ok (run_not_found is an answer)
    expect(rec.metrics.filter((m) => m.name === METRIC_TOOL_CALLS_TOTAL)).toHaveLength(4);
    expect(
      rec.metrics.filter((m) => m.name === METRIC_TOOL_CALL_FAILED).every((m) => m.value === 0),
    ).toBe(true);
    expect(rec.dimensions.map(([, v]) => v)).toEqual([
      "search_properties",
      "list_permits",
      "get_property",
      "get_coverage",
    ]);
    expect(rec.logs.every((l) => l.extra.correlationId === "corr-1" && l.extra.ok === true)).toBe(
      true,
    );
  });

  it("returns truncation, total and rows through search_properties, get_property and get_coverage", async () => {
    const coverage = { permits_emitted: { count: 7, derivation: "published_rows" } };
    const engine = engineOf((sql) => {
      if (sql.includes("total_within_r")) return [{ total_within_r: 9, tenure_unknown: 0 }];
      if (sql.includes("coverage")) return [{ coverage: JSON.stringify(coverage) }];
      return [{ property_cid: "p1" }, { property_cid: "p2" }, { property_cid: "p3" }];
    });
    const client = await connect({
      resolveRun: async () => ({ engine, bound: BOUND }),
      runsIndex: async () => INDEX,
    });

    const search = structured(
      await client.callTool({
        name: "search_properties",
        arguments: { area: { lat: 30.4, lon: -97.6 }, radius_mi: 5, limit: 3 },
      }),
    );
    expect(search.returned).toBe(3);
    expect(search.total).toBe(9);
    expect(search.truncated).toBe(true);
    expect((search.run as { run_id: string }).run_id).toBe("travis-fixture");

    const cov = structured(await client.callTool({ name: "get_coverage", arguments: {} }));
    expect(cov.coverage).toEqual(coverage);

    const prop = structured(
      await client.callTool({ name: "get_property", arguments: { property_cid: CID1 } }),
    );
    expect((prop.run as { manifest_cid: string }).manifest_cid).toBe(CID1);
    expect(prop.empty_reason === null || typeof prop.empty_reason === "string").toBe(true);
  });

  it("serves list_runs from the injected index and get_schema without any run", async () => {
    let resolved = 0;
    const client = await connect({
      resolveRun: async () => {
        resolved += 1;
        return undefined;
      },
      runsIndex: async () => INDEX,
    });
    const runs = structured(await client.callTool({ name: "list_runs", arguments: {} }));
    expect((runs.latest as { manifest_cid: string }).manifest_cid).toBe(CID2);
    expect((runs.runs as unknown[]).length).toBe(2);

    const schema = structured(await client.callTool({ name: "get_schema", arguments: {} }));
    expect((schema.views as Array<{ name: string }>).map((v) => v.name)).toContain("v_run");
    expect(resolved).toBe(0);
  });

  it("maps an engine failure to an isError result and counts it as a failed call", async () => {
    const { obs, rec } = recordingObs();
    const client = await connect(
      {
        resolveRun: async () => ({
          engine: engineOf(() => new Error("engine exploded")),
          bound: BOUND,
        }),
        runsIndex: async () => INDEX,
      },
      obs,
    );
    const result = await client.callTool({
      name: "search_properties",
      arguments: { area: { lat: 30.4, lon: -97.6 }, radius_mi: 5 },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("engine exploded");
    expect(rec.metrics.find((m) => m.name === METRIC_TOOL_CALL_FAILED)?.value).toBe(1);
    expect(rec.logs[0]?.extra.ok).toBe(false);
    expect("correlationId" in (rec.logs[0]?.extra ?? {})).toBe(false);
  });

  it("rejects arguments that fail the query-core schema before any adapter runs", async () => {
    let resolved = 0;
    const client = await connect({
      resolveRun: async () => {
        resolved += 1;
        return undefined;
      },
      runsIndex: async () => INDEX,
    });
    const result = await client
      .callTool({ name: "get_property", arguments: {} })
      .catch((e: unknown) => ({ isError: true, thrown: String(e) }));
    expect(result.isError).toBe(true);
    expect(resolved).toBe(0);
  });
});

describe("mcp observability helpers", () => {
  it("createMcpObservability builds real Powertools instances by default and honours overrides", () => {
    const real = createMcpObservability();
    expect(real.logger).toBeDefined();
    expect(real.tracer).toBeDefined();
    expect(real.metrics).toBeDefined();
    const { obs } = recordingObs();
    expect(createMcpObservability({ logger: obs.logger }).logger).toBe(obs.logger);
  });

  it("recordToolCall rounds the duration, dimensions by tool and omits an absent correlation id", () => {
    const { obs, rec } = recordingObs();
    recordToolCall(obs, { tool: "get_schema", durationMs: 12.6, ok: true });
    expect(rec.dimensions).toEqual([["tool", "get_schema"]]);
    expect(rec.metrics.find((m) => m.name === "ToolCallDurationMs")?.value).toBe(13);
    expect(rec.logs[0]?.extra).toEqual({ tool: "get_schema", durationMs: 13, ok: true });
    recordToolCall(obs, { tool: "get_schema", durationMs: 1, ok: false, correlationId: "c" });
    expect(rec.logs[1]?.extra.correlationId).toBe("c");
  });

  it("recordAuthFailure counts and logs only the closed reason, never a header", () => {
    const { obs, rec } = recordingObs();
    recordAuthFailure(obs, { reason: "unauthorized" });
    recordAuthFailure(obs, { reason: "origin_not_allowed", correlationId: "c2" });
    expect(rec.metrics.map((m) => m.name)).toEqual(["AuthFailuresTotal", "AuthFailuresTotal"]);
    expect(rec.logs[0]).toMatchObject({ level: "warn", extra: { reason: "unauthorized" } });
    expect(rec.logs[0]?.extra).not.toHaveProperty("correlationId");
    expect(rec.logs[1]?.extra.correlationId).toBe("c2");
  });

  it("correlationIdOf returns {} unless the logger holds a string id", () => {
    expect(correlationIdOf(recordingObs("abc").obs)).toEqual({ correlationId: "abc" });
    expect(correlationIdOf(recordingObs().obs)).toEqual({});
  });
});
