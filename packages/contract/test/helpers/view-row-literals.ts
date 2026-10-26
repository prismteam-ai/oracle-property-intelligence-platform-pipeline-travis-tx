// ERR-10 (A-03): one SELECT of typed DuckDB literals per contract/v1 view, built from columns.ts,
// plus the JSON-shaped row a QueryEngine must return for it. The engines' row conversion is
// tested by running these SELECTs on a REAL DuckDB (DuckDB-WASM in apps/web, @duckdb/node-api in
// apps/api), so the converter sees the runtime classes the engine really returns (Arrow Vector,
// StructRow, typed arrays; node-api arrays and objects), never a hand-made stand-in. Two rows per
// view: every column filled, and every nullable column NULL with every list empty. Test-only;
// the values are fixtures, not data.
import { VIEWS, type Column, type ViewName } from "../../src/index.js";

/** A valid CIDv1 (the A-03 pilot run manifest's CID), so `cid` columns pass CidV1. */
export const FIXTURE_CID = "bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i";

export interface ViewRowFixture {
  readonly view: ViewName;
  readonly name: "filled" | "nulls";
  /** `SELECT <literal> AS "<column>", …` in column order. */
  readonly sql: string;
  /** What `QueryEngine.all(sql)` must return for it (one row). */
  readonly expected: Record<string, unknown>;
}

interface Literal {
  readonly sql: string;
  readonly value: unknown;
}

const quote = (s: string): string => `'${s.replaceAll("'", "''")}'`;

/** Struct-list columns, by name: their literal and its JSON shape. */
const STRUCT_LISTS: Readonly<Record<string, Literal>> = {
  missing: {
    sql: `[{'field': 'parcel_identifier', 'reason': 'source_missing'}, {'field': 'contractor_name', 'reason': 'not_in_export'}]`,
    value: [
      { field: "parcel_identifier", reason: "source_missing" },
      { field: "contractor_name", reason: "not_in_export" },
    ],
  },
  tables_root_cids: {
    sql: `[{'data_group': 'county', 'cid': ${quote(FIXTURE_CID)}}]`,
    value: [{ data_group: "county", cid: FIXTURE_CID }],
  },
  sources: {
    sql: `[{'name': 'austin_permits', 'watermark': 'w-1', 'captured_at': '2026-10-20T21:00:00Z', 'records': 12, 'added': 12, 'changed': 0, 'removed': 0, 'limitations': ['Comptroller baseline not loaded (A-07)']}]`,
    value: [
      {
        name: "austin_permits",
        watermark: "w-1",
        captured_at: "2026-10-20T21:00:00Z",
        records: 12,
        added: 12,
        changed: 0,
        removed: 0,
        limitations: ["Comptroller baseline not loaded (A-07)"],
      },
    ],
  },
};

function filled(column: Column): Literal {
  switch (column.kind) {
    case "cid":
      return { sql: quote(FIXTURE_CID), value: FIXTURE_CID };
    case "string":
      return { sql: quote(`${column.name}-value`), value: `${column.name}-value` };
    case "enum": {
      const value = column.enum?.[0];
      if (value === undefined) throw new Error(`${column.name}: enum column without values`);
      return { sql: quote(value), value };
    }
    case "integer":
      return { sql: "42", value: 42 };
    case "double":
      return { sql: "30.2672", value: 30.2672 };
    case "boolean":
      return { sql: "true", value: true };
    case "date":
      return { sql: "DATE '2026-09-03'", value: "2026-09-03" };
    case "timestamptz":
      return {
        sql: "TIMESTAMPTZ '2026-10-20 22:00:10.663+00'",
        value: "2026-10-20T22:00:10.663Z",
      };
    case "json":
      return {
        sql: `'{"permits_emitted":{"count":1}}'`,
        value: '{"permits_emitted":{"count":1}}',
      };
    case "missing":
    case "list": {
      if (column.type === "VARCHAR[]") {
        return {
          sql: "['first limitation', 'second limitation']",
          value: ["first limitation", "second limitation"],
        };
      }
      const literal = STRUCT_LISTS[column.name];
      if (literal === undefined) throw new Error(`${column.name}: no struct-list literal`);
      return literal;
    }
  }
}

function empty(column: Column): Literal {
  if (column.nullable) return { sql: "NULL", value: null };
  if (column.kind === "missing" || column.kind === "list") return { sql: "[]", value: [] };
  return filled(column);
}

function fixture(view: ViewName, name: ViewRowFixture["name"]): ViewRowFixture {
  const pick = name === "filled" ? filled : empty;
  const parts: string[] = [];
  const expected: Record<string, unknown> = {};
  for (const column of VIEWS[view]) {
    const literal = pick(column);
    parts.push(`CAST(${literal.sql} AS ${column.type}) AS "${column.name}"`);
    expected[column.name] = literal.value;
  }
  return { view, name, sql: `SELECT ${parts.join(",\n  ")}`, expected };
}

/** Both fixture rows of every contract/v1 view. */
export function viewRowFixtures(): ViewRowFixture[] {
  return (Object.keys(VIEWS) as ViewName[]).flatMap((view) => [
    fixture(view, "filled"),
    fixture(view, "nulls"),
  ]);
}

/** `CREATE TABLE <view> AS <filled row>`: a stand-in table the product SQL can select from. */
export function viewTableSql(view: ViewName): string {
  return `CREATE OR REPLACE TABLE ${view} AS ${fixture(view, "filled").sql}`;
}
