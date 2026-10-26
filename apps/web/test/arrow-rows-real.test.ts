// @vitest-environment node
// ERR-10 (A-03, smeargle 2026-10-21): on the preview the Permits page went to `error` because
// every row failed the contract/v1 check (`missing` → "expected object, received array"). The
// older arrowToRows test fed hand-made `{ toArray, toJSON }` objects, so it never saw the real
// runtime classes: an Arrow `StructRow` has BOTH `toArray()` (its values) and `toJSON()` (the
// object), and a LIST of integers is a typed array (`BigInt64Array`). These tests run the SQL on a
// REAL DuckDB-WASM (the package's node blocking build: the same WASM engine and the same
// apache-arrow classes the browser's worker returns) and check every column of every contract/v1
// view, then the Permits list SQL through `parsePermitRows`, as the page runs it.
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  NODE_RUNTIME,
  VoidLogger,
  createDuckDB,
  type DuckDBBindings,
  type DuckDBConnection,
} from "@duckdb/duckdb-wasm/blocking";
import { rowSchema } from "@countylens/contract";
import { listRoofingPermitsSql } from "@countylens/query-core";
import {
  FIXTURE_CID,
  viewRowFixtures,
  viewTableSql,
} from "../../../packages/contract/test/helpers/view-row-literals.js";
import { arrowToRows, type ArrowTableLike } from "../src/engine/duckdb-wasm";
import { parsePermitRows } from "../src/engine/permit-list";

const require = createRequire(import.meta.url);

let db: DuckDBBindings;
let conn: DuckDBConnection;

/** The real Arrow table of one query, typed as the engine reads it. */
const query = (sql: string): ArrowTableLike => conn.query(sql) as unknown as ArrowTableLike;

beforeAll(async () => {
  db = await createDuckDB(
    {
      mvp: {
        mainModule: require.resolve("@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm"),
        mainWorker: "",
      },
      eh: {
        mainModule: require.resolve("@duckdb/duckdb-wasm/dist/duckdb-eh.wasm"),
        mainWorker: "",
      },
    },
    new VoidLogger(),
    NODE_RUNTIME,
  );
  await db.instantiate(() => undefined);
  db.open({});
  conn = db.connect();
  // As openEngine does (builders.ts: the engine's TimeZone is UTC).
  conn.query("SET TimeZone = 'UTC'");
}, 30_000);

afterAll(() => {
  conn?.close();
  db?.reset();
});

describe("ERR-10: arrowToRows over a real DuckDB-WASM Arrow table", () => {
  it("returns a LIST<STRUCT> as an array of plain objects (StructRow has toArray and toJSON)", () => {
    const [row] = arrowToRows(
      query(
        `SELECT [{'field': 'issue_date', 'reason': 'source_missing'}]::STRUCT(field VARCHAR, reason VARCHAR)[] AS missing`,
      ),
    );
    expect(row?.["missing"]).toEqual([{ field: "issue_date", reason: "source_missing" }]);
    const entry = (row?.["missing"] as unknown[])[0];
    expect(Object.getPrototypeOf(entry)).toBe(Object.prototype);
  });

  it("returns numeric lists as plain number arrays (typed arrays, BIGINT → number, null elements kept) and nested dates per contract", () => {
    const [row] = arrowToRows(
      query(`SELECT [1, 2]::BIGINT[] AS big, [3, 4]::INTEGER[] AS ints,
        {'d': DATE '2026-09-03', 't': TIMESTAMPTZ '2026-10-20 22:00:10.663+00', 'n': [5]::BIGINT[]} AS s,
        [DATE '2026-09-03'] AS dates, [1, NULL]::INTEGER[] AS with_null`),
    );
    expect(row).toEqual({
      big: [1, 2],
      ints: [3, 4],
      s: { d: "2026-09-03", t: "2026-10-20T22:00:10.663Z", n: [5] },
      dates: ["2026-09-03"],
      with_null: [1, null],
    });
    expect(Array.isArray(row?.["big"])).toBe(true);
  });

  for (const fixture of viewRowFixtures()) {
    it(`${fixture.view} (${fixture.name}): every column is JSON-shaped and passes the contract/v1 row schema`, () => {
      const rows = arrowToRows(query(fixture.sql));
      expect(rows).toEqual([fixture.expected]);
      const parsed = rowSchema(fixture.view).safeParse(rows[0]);
      expect(parsed.success ? "ok" : parsed.error.message).toBe("ok");
    });
  }

  it("the Permits list SQL over v_roofing_permit passes parsePermitRows (the page's own check)", () => {
    conn.query(viewTableSql("v_roofing_permit"));
    const permits = parsePermitRows(arrowToRows(query(listRoofingPermitsSql())));
    expect(permits).toHaveLength(1);
    expect(permits[0]).toMatchObject({
      cid: FIXTURE_CID,
      issue_date: "2026-09-03",
      captured_at: "2026-10-20T22:00:10.663Z",
      missing: [
        { field: "parcel_identifier", reason: "source_missing" },
        { field: "contractor_name", reason: "not_in_export" },
      ],
    });
  });
});
