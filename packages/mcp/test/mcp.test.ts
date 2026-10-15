import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { askAgent } from "../src/agent.js";
import { createApp } from "../src/app.js";
import {
  findAgedRoofProperties,
  findLongTenureOwners,
  findOpenRoofingPermits,
  geocodePlace,
  runReadOnlySql,
} from "../src/queries.js";
import { Snapshot } from "../src/snapshot.js";
import { createFixtureSnapshot } from "./fixture.js";

let snap: Snapshot;
let base: string;

beforeAll(async () => {
  base = await createFixtureSnapshot();
  process.env.ORACLE_SNAPSHOT_BASE = base;
  snap = await Snapshot.open({
    base,
    runId: "run-20261014T000000Z",
    rootCid: null,
    manifest: null,
  });
});
afterAll(() => snap.close());

describe("queries", () => {
  it("geocodes Census places", async () => {
    const hits = await geocodePlace(snap, "Pflugerville, TX");
    expect(hits[0]?.basename).toBe("Pflugerville");
  });

  it("finds aged roofs within a radius of a place and reports unevaluable properties", async () => {
    const r = await findAgedRoofProperties(snap, {
      place: "Austin",
      radiusMiles: 1,
      minRoofAgeYears: 15,
      limit: 50,
    });
    expect(r.results.map((x) => x.prop_id)).toEqual(["P1"]);
    expect(Number(r.stats?.properties_in_radius)).toBe(2);
    expect(r.center.resolvedFrom).toContain("Austin city");
  });

  it("finds long-open roofing permits with contractor identity", async () => {
    const r = await findOpenRoofingPermits(snap, {
      latitude: 30.27,
      longitude: -97.74,
      radiusMiles: 2,
      minOpenYears: 5,
      includeExpiredWithoutFinal: false,
      limit: 10,
    });
    expect(r.results).toHaveLength(1);
    expect(r.results[0]?.contractor_name).toBe("ACME ROOFING");
  });

  it("reports deed-date unavailability instead of guessing tenure", async () => {
    const r = await findLongTenureOwners(snap, {
      place: "Austin",
      radiusMiles: 5,
      minYearsSinceTransfer: 10,
      limit: 10,
    });
    expect(r.results).toHaveLength(0);
    expect(r.dataAvailability.limitation).toMatch(/Deed\/sale dates are not loaded/);
  });

  it.each([
    "DELETE FROM property_leads",
    "SELECT * FROM read_csv('/etc/passwd')",
    "SELECT 1; DROP TABLE x",
    "COPY property_leads TO '/tmp/x.csv'",
    "SELECT * FROM 'https://evil.example/x.parquet'",
  ])("rejects unsafe SQL: %s", async (sql) => {
    await expect(runReadOnlySql(snap, { sql })).rejects.toThrow(/read-only/);
  });

  it("allows read-only SQL", async () => {
    const r = await runReadOnlySql(snap, { sql: "SELECT count(*) AS n FROM property_leads" });
    expect(r.rows[0]?.n).toBe("3");
  });
});

describe("MCP over streamable HTTP", () => {
  it("initializes, lists tools and calls a tool", async () => {
    const app = createApp();
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    const call = async (body: unknown) => {
      const res = await app.request("/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as { result: Record<string, unknown> };
    };
    const init = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    });
    expect((init.result.serverInfo as { name: string }).name).toBe(
      "oracle-travis-property-intelligence",
    );
    const list = await call({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = (list.result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "find_aged_roof_properties",
        "find_open_roofing_permits",
        "get_run_summary",
        "query_sql",
      ]),
    );
    const res = await call({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "find_aged_roof_properties", arguments: { place: "Austin", radiusMiles: 1 } },
    });
    const text = (res.result.content as { text: string }[])[0]?.text ?? "";
    expect(JSON.parse(text).results[0].prop_id).toBe("P1");
  });
});

describe("agent", () => {
  it("runs a tool loop and returns the model answer with the tool trace", async () => {
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const steps: LanguageModelV4GenerateResult[] = [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "find_aged_roof_properties",
            input: JSON.stringify({ place: "Austin", radiusMiles: 1, minRoofAgeYears: 15 }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "P1 (100 MAIN ST) has a 25-year-old roof [prop_id P1]." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ];
    const model = new MockLanguageModelV4({ doGenerate: steps });
    const answer = await askAgent(
      snap,
      { question: "Aged roofs near Austin?", history: [] },
      model,
    );
    expect(answer.toolCalls[0]?.tool).toBe("find_aged_roof_properties");
    expect(answer.answer).toContain("P1");
    expect(answer.steps).toBe(2);
  });
});
