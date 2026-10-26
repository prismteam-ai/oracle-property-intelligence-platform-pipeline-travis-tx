// T032 (A-14, tasks.md Phase 5, AC-8/FR-011): the three-way comparison -- query-core's
// `searchProperties`, the MCP `search_properties` tool, and `agent.ask`'s `matches[]` -- for the
// same `manifest_cid`/filters, asserting an identical `property_cid` set across all three.
//
// Location note (deviating from tasks.md's stated `tests/agent/parity-hosted.test.ts`): the
// fixture-engine leg below needs apps/api's MCP adapter (src/mcp/tools.ts) directly, which the
// existing `tests/agent/` package intentionally does not depend on (its package.json lists only
// `@countylens/query-core` + `zod`, because golden.test.ts, T020, is a pure HTTP client against a
// deployed AGENT_URL -- see that file's header comment). Pulling apps/api's adapters into that
// lightweight package would mean adding @modelcontextprotocol/sdk, `ai`, and the AWS SDKs as
// dependencies of a test package whose whole point is to stay thin and hosted-only. So the
// fixture-engine leg lives here, next to T029's tools.parity.test.ts, with the same engine/bound
// reused across both the raw function and the MCP adapter.
//
// The agent.ask leg is HTTP-only when it runs (just like golden.test.ts's askAgent()): it needs no
// apps/api source import, only a deployed endpoint. It is skipped here, now, because this
// local/CI context has no AGENT_URL (not deployed yet this wave -- TZ02). When AGENT_URL is set
// at Stage 6 (hosted re-run), this same skip-guard flips to a real call and the three-way
// assertion executes for real; the fixture-engine leg below needs no change at that point, since
// it already proves the query-core vs MCP agreement unconditionally. Per quickstart.md, a deferred
// leg is recorded as deferred here, not silently dropped -- see run-log.md.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  searchProperties,
  type BoundRun,
  type QueryEngine,
  type Row,
} from "@countylens/query-core";
import {
  bindFixture,
  propertyRows,
  type Fixture,
  type FixtureTables,
  type Row as FixtureRow,
} from "../../../packages/query-core/test/helpers/fixture-export.js";
import { searchPropertiesTool, type McpToolDeps } from "../src/mcp/tools.js";

const CENTRE = { lat: 30.2672, lon: -97.7431 };
const P1 = `ba${"a".repeat(55)}hostA`;
const P2 = `ba${"a".repeat(55)}hostB`;

const edge = (from: string, to: string): FixtureRow => ({ from_cid: from, to_cid: to });
const geometry = (cid: string, p: { lat: number; lon: number }): FixtureRow => ({
  cid,
  latitude: p.lat,
  longitude: p.lon,
});

const TABLES: FixtureTables = {
  county: {
    property: [propertyRows(P1, 1985), propertyRows(P2, 2020)],
    property_has_parcel: [edge(P1, "pc1"), edge(P2, "pc2")],
    parcel_has_geometry: [edge("pc1", "g1"), edge("pc2", "g2")],
    geometry: [geometry("g1", CENTRE), geometry("g2", CENTRE)],
  },
};

const INPUT = { area: { lat: CENTRE.lat, lon: CENTRE.lon }, radius_mi: 5, limit: 1000 } as const;

function propertyCidSet(rows: Row[]): Set<string> {
  return new Set(rows.map((r) => String(r.property_cid)));
}

/** The hosted agent.ask base URL, guarded exactly like tests/agent/golden.test.ts's agentUrl():
 *  unset or localhost both mean "not deployed", never a fallback address (constitution I). */
function agentUrl(): string | null {
  const value = process.env.AGENT_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return null;
  } catch {
    return null;
  }
  return value.replace(/\/+$/, "");
}

describe("T032: three-way property_cid parity (query-core, MCP, agent.ask)", () => {
  let fx: Fixture;
  let engine: QueryEngine;
  let bound: BoundRun;

  beforeAll(async () => {
    fx = await bindFixture(TABLES);
    engine = fx.db;
    bound = fx.bound;
  });
  afterAll(() => fx.close());

  it("fixture-engine leg (runs now): query-core searchProperties and the MCP search_properties tool agree", async () => {
    const raw = await searchProperties(engine, bound, INPUT);
    expect(propertyCidSet(raw.rows)).toEqual(new Set([P1, P2]));

    const deps: McpToolDeps = {
      resolveRun: async () => ({ engine, bound }),
      runsIndex: async () => ({ runs: [] }),
    };
    const mcp = await searchPropertiesTool(deps, {
      ...INPUT,
      manifest_cid: bound.manifestCid,
    } as never);
    const mcpData = mcp.structuredContent as { rows: Row[] };

    expect(propertyCidSet(mcpData.rows)).toEqual(propertyCidSet(raw.rows));
  });

  const baseUrl = agentUrl();
  if (!baseUrl) {
    it.skip(
      "SKIPPED: hosted-re-run leg -- AGENT_URL is not set to a hosted address. agent.ask is not " +
        "deployed in this local/CI context yet (TZ02). This is the deferred third leg of the " +
        "three-way comparison, per tasks.md T032 ('fixture-engine-now, hosted-re-run-later') and " +
        "quickstart.md's deferred-not-dropped rule -- re-run with AGENT_URL=https://<hosted-api> " +
        "at Stage 6 to compare agent.ask's matches[] property_cid set against this file's MCP leg " +
        "for the same manifest_cid/filters.",
      () => {},
    );
  } else {
    it("hosted leg: agent.ask's matches[] property_cid set equals the MCP tool's, for the bound run", async () => {
      const deps: McpToolDeps = {
        resolveRun: async () => ({ engine, bound }),
        runsIndex: async () => ({ runs: [] }),
      };
      const mcp = await searchPropertiesTool(deps, {
        ...INPUT,
        manifest_cid: bound.manifestCid,
      } as never);
      const mcpData = mcp.structuredContent as { rows: Row[] };

      // Stage 5 review fix (Critical #4): the agent Lambda's own tRPC router
      // (apps/api/src/agent/router.ts) mounts the procedure as `ask`, not `agent.ask` -- the
      // HTTP API route captures everything after `/agent/` as the tRPC path (infra/src/
      // api-stack.ts's `AGENT_ROUTE_PATH = "/agent/{proxy+}"`), so the real path is
      // `${baseUrl}/agent/ask`. `AgentAskInput` (apps/api/src/agent/ask.ts) is `.strict()` and
      // requires `prompt` (there is no `question`/`sessionQuestionCount` field -- the 10-
      // question session cap lives client-side per agent-design.md, not in this contract).
      // tRPC's AWS Lambda adapter expects the no-transformer envelope `{"json": <input>}` for a
      // mutation POST (confirmed against `@trpc/server/adapters/aws-lambda`'s request parsing).
      const res = await fetch(`${baseUrl}/agent/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          json: {
            prompt: `Properties within 5 miles of ${CENTRE.lat},${CENTRE.lon}?`,
            turns: [],
            manifest_cid: bound.manifestCid,
          },
        }),
      });
      expect(res.ok).toBe(true);
      const envelope = (await res.json()) as {
        result: { data: { json: { matches: { property_cid: string }[] } } };
      };
      const body = envelope.result.data.json;
      const agentSet = new Set(body.matches.map((m) => m.property_cid));

      expect(agentSet).toEqual(propertyCidSet(mcpData.rows));
    });
  }
});
