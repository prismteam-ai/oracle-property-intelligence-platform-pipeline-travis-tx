// A-03 /code-review Major 4: a warm engine (the Lambda sandbox, a browser tab) rebinds to another
// manifest. bindManifest creates an emitted table as a VIEW and an absent required table as an
// empty TABLE; DuckDB refuses CREATE OR REPLACE across the two kinds, and views of the previous
// run (over presigned URLs that expire) must not outlive it. Real local DuckDB, tiny in-test
// Parquet written by the fixture helper; no network.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDuckDb, type DuckDbEngine } from "../scripts/duckdb-engine.js";
import {
  bindFixture,
  propertyRows,
  type Fixture,
  type FixtureTables,
} from "./helpers/fixture-export.js";

const P2 = "baguqeeraprop2";

/** A: structure and address emitted (VIEWs); person absent (empty TABLE). */
const A: FixtureTables = {
  county: {
    property: [propertyRows()],
    structure: [{ cid: "s1", request_identifier: "s1", roof_date: "2020-01-01" }],
    address: [{ cid: "a1", request_identifier: "a1" }],
  },
};
/** B: person emitted (VIEW); structure absent (empty TABLE); address not emitted at all. */
const B: FixtureTables = {
  county: {
    property: [propertyRows(P2)],
    person: [{ cid: "pe1", request_identifier: "pe1", first_name: "Ada", last_name: "Lovelace" }],
  },
};

let db: DuckDbEngine;
const opened: Fixture[] = [];

const kindOf = async (schema: string, name: string): Promise<string | undefined> => {
  const rows = await db.all(
    `SELECT 'VIEW' AS kind FROM duckdb_views() WHERE schema_name = '${schema}' AND view_name = '${name}'
     UNION ALL
     SELECT 'TABLE' FROM duckdb_tables() WHERE schema_name = '${schema}' AND table_name = '${name}'`,
  );
  expect(rows.length, `${schema}.${name} exists at most once`).toBeLessThanOrEqual(1);
  return rows[0]?.kind as string | undefined;
};
const count = async (relation: string): Promise<number> =>
  Number((await db.all(`SELECT count(*) AS n FROM ${relation}`))[0]?.n);
const runCid = async (): Promise<string> =>
  String((await db.all("SELECT manifest_cid FROM meta.run"))[0]?.manifest_cid);

const bind = async (tables: FixtureTables): Promise<Fixture> => {
  const f = await bindFixture(tables, undefined, db);
  opened.push(f);
  return f;
};

beforeAll(async () => {
  db = await openDuckDb();
});
afterAll(() => {
  for (const f of opened) f.close();
  db.close();
});

describe("bindManifest on a warm engine: A, then B, then A again", () => {
  it("replaces VIEW↔TABLE in both directions and drops the previous run's extra views", async () => {
    const a = await bind(A);
    expect(await kindOf("county", "structure")).toBe("VIEW");
    expect(await kindOf("county", "person")).toBe("TABLE");
    expect(await kindOf("county", "address")).toBe("VIEW");
    expect(await count("county.structure")).toBe(1);
    expect(await runCid()).toBe(a.bound.manifestCid);

    const b = await bind(B);
    expect(b.bound.manifestCid).not.toBe(a.bound.manifestCid);
    expect(await kindOf("county", "structure")).toBe("TABLE");
    expect(await kindOf("county", "person")).toBe("VIEW");
    expect(await kindOf("county", "address"), "A's extra view is gone").toBeUndefined();
    expect(await count("county.structure")).toBe(0);
    expect(await count("county.person")).toBe(1);
    expect(await runCid()).toBe(b.bound.manifestCid);
    expect(await count("v_run")).toBe(1);

    const again = await bind(A);
    expect(await kindOf("county", "structure")).toBe("VIEW");
    expect(await kindOf("county", "person")).toBe("TABLE");
    expect(await count("county.structure")).toBe(1);
    expect(await count("county.person")).toBe(0);
    expect(await runCid()).toBe(again.bound.manifestCid);
  }, 30_000); // three real binds (views, macros, Parquet) on one engine
});
