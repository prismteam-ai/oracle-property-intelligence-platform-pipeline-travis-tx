// T029 (A-14, tasks.md Phase 5, AC-8/FR-011): cross-surface agreement over the fixture engine.
//
// Location note (deviating from tasks.md's stated `packages/query-core/test/tools.parity.test.ts`):
// this test needs apps/api's MCP adapters (src/mcp/tools.ts) and agent adapters (src/agent/tools.ts)
// alongside query-core's raw functions, so it lives in apps/api/test/ instead -- the same direction
// apps/api/test/duckdb-node.test.ts already imports a test helper from packages/contract/test/helpers
// via a deep relative path, so a cross-package test-helper import is an established pattern here.
// Putting it in packages/query-core/test/ would require that package to reach into apps/api, which
// is the wrong dependency direction (apps/api depends on @countylens/query-core, never the reverse).
//
// Two things are checked over one bound DuckDB fixture, for the same area/radius/status_class
// filter and no roof/tenure filter:
//   1. listPermits's distinct property_cids equal searchProperties's property_cids (query-core
//      functions only -- proves the two surfaces agree on "which properties match").
//   2. The MCP adapter (search_properties/list_permits) and the agent adapter (searchProperties/
//      searchRoofingPermits) each return the identical property_cid set as the raw query-core
//      function for the same input -- proves the adapters are "thin" (no extra filtering or
//      transformation that could introduce drift between surfaces).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  exploreSearchSql,
  listPermits,
  searchProperties,
  type BoundRun,
  type QueryEngine,
  type Row,
} from "@countylens/query-core";
import {
  austinRequest,
  AUSTIN_URL,
  bindFixture,
  propertyRows,
  type Fixture,
  type FixtureTables,
  type Row as FixtureRow,
} from "../../../packages/query-core/test/helpers/fixture-export.js";
import { createAgentTools } from "../src/agent/tools.js";
import { createCitationRegistry } from "../src/agent/citations.js";
import { listPermitsTool, searchPropertiesTool, type McpToolDeps } from "../src/mcp/tools.js";

const CENTRE = { lat: 30.2672, lon: -97.7431 };
const NEAR = { lat: 30.27444, lon: -97.7431 }; // ~0.5 mi north, inside the 1-mile radius
const FAR = { lat: 30.2672, lon: -97.69282 }; // ~3 mi east, outside the 1-mile radius

const P1 = `ba${"a".repeat(55)}open1`; // in radius, has an "open" permit -> should match
const P2 = `ba${"a".repeat(55)}clsd2`; // in radius, has a "closed" permit -> should not match
const P3 = `ba${"a".repeat(55)}open3`; // out of radius, has an "open" permit -> should not match
const P4 = `ba${"a".repeat(55)}none4`; // in radius, no permit at all -> should not match

const edge = (from: string, to: string): FixtureRow => ({ from_cid: from, to_cid: to });
const geometry = (cid: string, p: { lat: number; lon: number }): FixtureRow => ({
  cid,
  latitude: p.lat,
  longitude: p.lon,
});

function permit(cid: string, propertyCid: string, status: string, issueDate: string): FixtureRow {
  return {
    cid,
    request_identifier: cid,
    permit_number: `2020-${cid.slice(0, 6).padStart(6, "0")} BP`,
    improvement_type: "Roofing",
    improvement_action: "Replacement",
    improvement_status: status,
    permit_issue_date: issueDate,
    source_http_request: austinRequest(`2020-${cid.slice(0, 6).padStart(6, "0")} BP`, AUSTIN_URL),
  };
}

const TABLES: FixtureTables = {
  county: {
    property: [
      propertyRows(P1, 1985),
      propertyRows(P2, 1985),
      propertyRows(P3, 1985),
      propertyRows(P4, 1985),
    ],
    property_has_parcel: [edge(P1, "pc1"), edge(P2, "pc2"), edge(P3, "pc3"), edge(P4, "pc4")],
    parcel_has_geometry: [
      edge("pc1", "g1"),
      edge("pc2", "g2"),
      edge("pc3", "g3"),
      edge("pc4", "g4"),
    ],
    geometry: [
      geometry("g1", CENTRE),
      geometry("g2", NEAR),
      geometry("g3", FAR),
      geometry("g4", CENTRE),
    ],
  },
  property_improvement: {
    property_improvement: [
      permit("pa", P1, "Permitted", "2020-01-01"), // -> status_class 'open' (austin map)
      permit("pb", P2, "Completed", "2020-01-01"), // -> status_class 'closed'
      permit("pc", P3, "Permitted", "2020-01-01"), // -> status_class 'open', but out of radius
    ],
    property_has_property_improvement: [edge(P1, "pa"), edge(P2, "pb"), edge(P3, "pc")],
  },
};

const AREA = { area: { lat: CENTRE.lat, lon: CENTRE.lon }, radius_mi: 1, limit: 1000 } as const;

function propertyCidSet(rows: Row[]): Set<string> {
  return new Set(rows.map((r) => String(r.property_cid)));
}

// Each case runs several DuckDB queries; on a busy CI runner they took just over 5 s (CI run
// 40241307421), so this group gets 20 s instead of the 5 s default.
describe(
  "T029: searchProperties / listPermits / MCP / agent property_cid parity",
  { timeout: 20_000 },
  () => {
    let fx: Fixture;
    let engine: QueryEngine;
    let bound: BoundRun;

    beforeAll(async () => {
      fx = await bindFixture(TABLES);
      engine = fx.db;
      bound = fx.bound;
    });
    afterAll(() => fx.close());

    it("listPermits's distinct property_cids equal searchProperties's property_cids for the same filter", async () => {
      const properties = await searchProperties(engine, bound, { ...AREA, status_class: "open" });
      const permits = await listPermits(engine, bound, { ...AREA, status_class: "open" });

      const propertySet = propertyCidSet(properties.rows);
      const permitPropertySet = propertyCidSet(permits.rows);

      expect(propertySet).toEqual(new Set([P1]));
      expect(permitPropertySet).toEqual(new Set([P1]));
      expect(permitPropertySet).toEqual(propertySet);
    });

    it("the MCP adapter returns the identical property_cid set as the raw query-core functions", async () => {
      const rawProperties = await searchProperties(engine, bound, {
        ...AREA,
        status_class: "open",
      });
      const rawPermits = await listPermits(engine, bound, { ...AREA, status_class: "open" });

      const deps: McpToolDeps = {
        resolveRun: async () => ({ engine, bound }),
        runsIndex: async () => ({ runs: [] }),
      };
      const mcpProperties = await searchPropertiesTool(deps, {
        ...AREA,
        status_class: "open",
      } as never);
      const mcpPermits = await listPermitsTool(deps, { ...AREA, status_class: "open" } as never);

      const mcpPropertyData = mcpProperties.structuredContent as { rows: Row[] };
      const mcpPermitData = mcpPermits.structuredContent as { rows: Row[] };

      expect(propertyCidSet(mcpPropertyData.rows)).toEqual(propertyCidSet(rawProperties.rows));
      expect(propertyCidSet(mcpPermitData.rows)).toEqual(propertyCidSet(rawPermits.rows));
    });

    it("the agent adapter's matches[] carry the identical property_cid set as the raw query-core functions", async () => {
      const rawProperties = await searchProperties(engine, bound, {
        ...AREA,
        status_class: "open",
      });
      const rawPermits = await listPermits(engine, bound, { ...AREA, status_class: "open" });

      const tools = createAgentTools({ engine, bound, registry: createCitationRegistry() });
      const opts = { toolCallId: "t1", messages: [] } as const;

      if (!tools.searchProperties.execute || !tools.searchRoofingPermits.execute) {
        throw new Error("agent tool is missing its execute() — cannot run this parity check");
      }
      const agentProperties = (await tools.searchProperties.execute(
        { ...AREA, status_class: "open" } as never,
        opts as never,
      )) as { matches: { property_cid: string }[] };
      const agentPermits = (await tools.searchRoofingPermits.execute(
        { ...AREA, status_class: "open" } as never,
        opts as never,
      )) as { matches: { property_cid: string }[] };

      const agentPropertySet = new Set(agentProperties.matches.map((m) => m.property_cid));
      const agentPermitSet = new Set(agentPermits.matches.map((m) => m.property_cid));

      expect(agentPropertySet).toEqual(propertyCidSet(rawProperties.rows));
      expect(agentPermitSet).toEqual(propertyCidSet(rawPermits.rows));
    });
  },
);

// T030 (AC-8): the agent/MCP property search and A-13's Explore builder return the identical
// ordered property_cid list for the same area, radius and filters. The fixture has a known-old
// roof, a young roof, an unknown roof (which Explore excludes from a roof filter, so the agent
// tool must too), an open permit, and a closed one.
describe(
  "T030: searchProperties vs exploreSearchSql (the Explore page's builder)",
  // DuckDB-heavy cases; the 5 s default timed out on a busy CI runner (A-16 run on 03c0ebc).
  { timeout: 20_000 },
  () => {
    const Q = {
      old: `ba${"a".repeat(55)}qold1`, // roof 1985, open permit, at the centre
      young: `ba${"a".repeat(55)}qyng2`, // roof 2020, closed permit, ~0.5 mi north
      unknown: `ba${"a".repeat(55)}qunk3`, // no roof date, no permit, ~0.5 mi north
      far: `ba${"a".repeat(55)}qfar4`, // roof 1985, ~3 mi east
    };
    const T30: FixtureTables = {
      county: {
        property: [
          propertyRows(Q.old, 1985),
          propertyRows(Q.young, 2020),
          propertyRows(Q.unknown, null),
          propertyRows(Q.far, 1985),
        ],
        property_has_parcel: [
          edge(Q.old, "qc1"),
          edge(Q.young, "qc2"),
          edge(Q.unknown, "qc3"),
          edge(Q.far, "qc4"),
        ],
        parcel_has_geometry: [
          edge("qc1", "qg1"),
          edge("qc2", "qg2"),
          edge("qc3", "qg3"),
          edge("qc4", "qg4"),
        ],
        geometry: [
          geometry("qg1", CENTRE),
          geometry("qg2", NEAR),
          geometry("qg3", NEAR),
          geometry("qg4", FAR),
        ],
        property_has_structure: [edge(Q.old, "qs1"), edge(Q.young, "qs2"), edge(Q.far, "qs4")],
        structure: [
          { cid: "qs1", roof_date: "1985" },
          { cid: "qs2", roof_date: "2020" },
          { cid: "qs4", roof_date: "1985" },
        ],
      },
      property_improvement: {
        property_improvement: [
          permit("qa", Q.old, "Permitted", "2019-01-01"),
          permit("qb", Q.young, "Completed", "2020-01-01"),
        ],
        property_has_property_improvement: [edge(Q.old, "qa"), edge(Q.young, "qb")],
      },
    };

    let fx: Fixture;
    beforeAll(async () => {
      fx = await bindFixture(T30);
    });
    afterAll(() => fx.close());

    // [label, agent input, explore input] built from the same intent.
    const cases = [
      ["no filters", {}, {}],
      ["roof >= 15 (unknown roof is not a match)", { roof_age_years_min: 15 }, { roof: 15 }],
      ["roof >= 0", { roof_age_years_min: 0 }, { roof: 0 }],
      ["tenure > 3 (unknown tenure excluded)", { tenure_years_min: 3 }, { tenure: 3 }],
      ["tenure > 1", { tenure_years_min: 1 }, { tenure: 1 }],
      [
        "open_or_stalled permit",
        { status_class: "open_or_stalled" },
        { permit: "open_or_stalled" },
      ],
      [
        "open permit, open >= 1 year",
        { status_class: "open", open_years_min: 1 },
        { permit: "open", openYrs: 1 },
      ],
      ["stalled permit", { status_class: "stalled" }, { permit: "stalled" }],
      ["out-of-area owner", { owner_is_out_of_area: true }, { ooa: true }],
      ["sort roof_desc", { sort: "roof_desc" }, { sort: "roof_desc" }],
      ["sort open_desc", { sort: "open_desc" }, { sort: "open_desc" }],
      ["limit 1", { limit: 1 }, { limit: 1 }],
      [
        "roof + permit + limit",
        { roof_age_years_min: 10, status_class: "open_or_stalled", limit: 2 },
        { roof: 10, permit: "open_or_stalled", limit: 2 },
      ],
    ] as const;

    it.each(cases)(
      "%s: same ordered property_cid list as exploreSearchSql",
      async (_label, agent, explore) => {
        const sql = exploreSearchSql({ centre: CENTRE, radius_mi: 1, ...explore } as never);
        const exploreCids = (await fx.db.all(sql.rows)).map((r) => String(r.property_cid));
        const summary = (await fx.db.all(sql.summary))[0] as { total_within_r: number };

        const found = await searchProperties(fx.db, fx.bound, {
          area: { lat: CENTRE.lat, lon: CENTRE.lon },
          radius_mi: 1,
          ...agent,
        } as never);
        expect(found.rows.map((r) => String(r.property_cid))).toEqual(exploreCids);
        expect(found.total).toBe(Number(summary.total_within_r));

        const deps: McpToolDeps = {
          resolveRun: async () => ({ engine: fx.db, bound: fx.bound }),
          runsIndex: async () => ({ runs: [] }),
        };
        const mcp = await searchPropertiesTool(deps, {
          area: { lat: CENTRE.lat, lon: CENTRE.lon },
          radius_mi: 1,
          ...agent,
        } as never);
        const mcpRows = (mcp.structuredContent as { rows: Row[] }).rows;
        expect(mcpRows.map((r) => String(r.property_cid))).toEqual(exploreCids);
      },
    );

    it("the cases are not vacuous: the roof filter drops the unknown-roof and young properties", async () => {
      const found = await searchProperties(fx.db, fx.bound, {
        area: { lat: CENTRE.lat, lon: CENTRE.lon },
        radius_mi: 1,
        roof_age_years_min: 15,
      });
      expect(found.rows.map((r) => String(r.property_cid))).toEqual([Q.old]);
    });
  },
);

// T035 / T044: more rows than the model's 25-row projection. `matches[]` and the citation
// registry must carry every filtered row (up to the 1,000 cap), and the agent's property_cid set
// must equal the MCP adapter's and the raw query-core function's.
describe("T035: more than 25 rows are all registered and cited", () => {
  const COUNT = 40;
  const cid = (i: number) => `ba${"a".repeat(55)}m${String(i).padStart(4, "0")}`;
  const ids = Array.from({ length: COUNT }, (_, i) => cid(i));
  const BIG: FixtureTables = {
    county: {
      property: ids.map((id) => propertyRows(id, 1985)),
      property_has_parcel: ids.map((id, i) => edge(id, `bp${i}`)),
      parcel_has_geometry: ids.map((_, i) => edge(`bp${i}`, `bg${i}`)),
      geometry: ids.map((_, i) => geometry(`bg${i}`, CENTRE)),
    },
  };
  let fx: Fixture;
  beforeAll(async () => {
    fx = await bindFixture(BIG);
  });
  afterAll(() => fx.close());

  const opts = { toolCallId: "t1", messages: [] } as never;
  const run = async (tools: ReturnType<typeof createAgentTools>) => {
    if (!tools.searchProperties.execute) throw new Error("no execute");
    return (await tools.searchProperties.execute({ ...AREA } as never, opts)) as {
      matches: { n: number; property_cid: string }[];
      returned: number;
      total: number;
      truncated: boolean;
    };
  };

  it("registers all 40 rows with unique indexes; the model sees a 25-row projection; set equals raw and MCP", async () => {
    const raw = await searchProperties(fx.db, fx.bound, { ...AREA });
    expect(raw.rows).toHaveLength(COUNT);

    const registry = createCitationRegistry();
    const output = await run(createAgentTools({ engine: fx.db, bound: fx.bound, registry }));
    expect(output.matches).toHaveLength(25); // model-facing projection only
    expect(output.returned).toBe(COUNT);
    expect(output.total).toBe(COUNT);
    expect(output.truncated).toBe(false);

    const matches = registry.matches();
    expect(matches).toHaveLength(COUNT);
    expect(new Set(matches.map((m) => m.n)).size).toBe(COUNT);
    expect(matches.map((m) => m.n)).toEqual(Array.from({ length: COUNT }, (_, i) => i + 1));
    // The projected rows cite indexes that exist in matches[].
    expect(output.matches.every((m) => matches[m.n - 1]?.property_cid === m.property_cid)).toBe(
      true,
    );

    const deps: McpToolDeps = {
      resolveRun: async () => ({ engine: fx.db, bound: fx.bound }),
      runsIndex: async () => ({ runs: [] }),
    };
    const mcp = await searchPropertiesTool(deps, { ...AREA } as never);
    const mcpSet = propertyCidSet((mcp.structuredContent as { rows: Row[] }).rows);
    expect(new Set(matches.map((m) => m.property_cid))).toEqual(mcpSet);
    expect(mcpSet).toEqual(propertyCidSet(raw.rows));
  });

  it("rows beyond the registry cap are not registered and the output says truncated", async () => {
    const registry = createCitationRegistry();
    const output = await run(
      createAgentTools({ engine: fx.db, bound: fx.bound, registry, maxRegisteredRows: 30 }),
    );
    expect(registry.size()).toBe(30);
    expect(output.returned).toBe(COUNT);
    expect(output.truncated).toBe(true);
  });

  it("an aborted signal rejects a tool call instead of waiting for the engine", async () => {
    const hanging: QueryEngine = { run: async () => {}, all: () => new Promise(() => {}) };
    const tools = createAgentTools({
      engine: hanging,
      bound: fx.bound,
      registry: createCitationRegistry(),
    });
    const controller = new AbortController();
    const pending = tools.searchProperties.execute?.(
      { ...AREA } as never,
      {
        toolCallId: "t",
        messages: [],
        abortSignal: controller.signal,
      } as never,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
