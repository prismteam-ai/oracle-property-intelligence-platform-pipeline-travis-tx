import { DuckDBInstance } from "@duckdb/node-api";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TOOLS } from "@travis-oracle/query-core";
import { beforeAll, describe, expect, it } from "vitest";
import { DuckDbRunner } from "../src/duckdb-runner.js";
import { createServer } from "../src/server.js";

const CENTER = { latitude: 30.2649, longitude: -97.7472 };
const DATASET = {
  buildId: "20261027T100024Z",
  manifestCid: "bafkrei-manifest",
  rootCid: "bafybei-root",
};

let client: Client;

beforeAll(async () => {
  const connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(`
    CREATE TABLE properties AS SELECT * FROM (VALUES
      (1::BIGINT, '100 NEAR ST', '78701', ${CENTER.latitude + 1 / 69}, ${CENTER.longitude}, 1990::BIGINT, 'COMPOSITIO', 30, 'completed_replacement', '1996-05-01', '1996-1 BP', 'high', 'NEAR OWNER', 'out_of_state', 'CA', 22, 0::BIGINT, 'parcel_centroid', 'tcad-appraisal-export', 'run-a')
    ) AS t(prop_id, situs_address, situs_zip, latitude, longitude, year_built, roof_covering, roof_age_years, roof_age_anchor, roof_age_anchor_date, roof_age_anchor_permit, roof_age_confidence, owner_name, owner_locality, mailing_state, ownership_years, unfinished_roofing_permits, coordinate_source, source, source_run_id)
  `);
  const server = createServer({ sql: new DuckDbRunner(connection), dataset: DATASET });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
});

const callJson = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  const [content] = result.content as { type: string; text: string }[];
  return { isError: result.isError === true, text: content?.text ?? "" };
};

describe("Travis Oracle MCP server", () => {
  it("lists every query tool plus read-only SQL, with JSON Schemas", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      ...TOOLS.map((tool) => tool.name),
      "get_schema",
      "run_sql",
    ]);
    const aged = tools.find((tool) => tool.name === "find_aged_roofs");
    expect(aged?.inputSchema.properties).toHaveProperty("radius_miles");
    expect(aged?.annotations?.readOnlyHint).toBe(true);
  });

  it("answers a query tool with source-backed rows and the dataset CIDs", async () => {
    const { isError, text } = await callJson("find_aged_roofs", { ...CENTER, radius_miles: 5 });
    const result = JSON.parse(text);

    expect(isError).toBe(false);
    expect(result.rows[0]).toMatchObject({
      prop_id: "1",
      roof_age_anchor: "completed_replacement",
      source: "tcad-appraisal-export",
    });
    expect(result.dataset).toMatchObject({ rootCid: "bafybei-root" });
  });

  it("returns input problems as tool errors the model can act on", async () => {
    const { isError, text } = await callJson("find_aged_roofs", { place: "Atlantis" });

    expect(isError).toBe(true);
    expect(text).toMatch(/Unknown place "Atlantis"/);
  });

  it("describes the published tables so clients can write SQL without guessing", async () => {
    const { isError, text } = await callJson("get_schema", {});
    const { tables } = JSON.parse(text);

    expect(isError).toBe(false);
    expect(tables.properties).toEqual(
      expect.arrayContaining([
        { column: "prop_id", type: "BIGINT" },
        { column: "roof_age_years", type: "INTEGER" },
      ]),
    );
  });

  it("runs read-only SQL", async () => {
    const { isError, text } = await callJson("run_sql", {
      sql: "SELECT count(*) AS properties FROM properties",
    });

    expect(isError).toBe(false);
    expect(JSON.parse(text).rows).toEqual([{ properties: "1" }]);
  });

  it("refuses SQL that writes, or more than one statement", async () => {
    const writes = await callJson("run_sql", { sql: "DELETE FROM properties" });
    const smuggled = await callJson("run_sql", { sql: "SELECT 1; DROP TABLE properties" });
    const exported = await callJson("run_sql", { sql: "COPY properties TO 'leak.csv'" });

    expect([writes.isError, smuggled.isError, exported.isError]).toEqual([true, true, true]);
    expect(writes.text).toMatch(/SELECT/);
    expect(smuggled.text).toMatch(/one statement/);
    expect(
      JSON.parse((await callJson("run_sql", { sql: "SELECT count(*) AS n FROM properties" })).text)
        .rows,
    ).toEqual([{ n: "1" }]);
  });
});
