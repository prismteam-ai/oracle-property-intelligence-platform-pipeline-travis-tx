import * as duckdb from "@duckdb/duckdb-wasm";
import type { ReadOnlySql } from "@travis-oracle/mcp/server";
import { publishedTables, type Row } from "@travis-oracle/query-core";
import { DataType, type Field, type Table } from "apache-arrow";
import type { Dataset } from "./dataset.js";


export interface Database extends ReadOnlySql {
  query(sql: string): Promise<QueryResult>;
}

export interface QueryResult {
  columns: string[];
  rows: Row[];
  elapsedMs: number;
}

const ISO_DATE_LENGTH = 10;
const TRAILING_SEMICOLONS = /;+$/;
const SETTINGS = ["SET enable_http_metadata_cache = true", "SET enable_object_cache = true"];

export async function openDatabase(dataset: Dataset): Promise<Database> {
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
  );
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(workerUrl));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);

  const connection = await db.connect();
  for (const setting of SETTINGS) await connection.query(setting).catch(() => undefined);
  for (const table of publishedTables(dataset.build.tables)) {
    await connection.query(
      `CREATE VIEW ${table} AS SELECT * FROM read_parquet('${dataset.tableUrl(table)}')`,
    );
  }

  const query = async (sql: string): Promise<QueryResult> => {
    const started = performance.now();
    const table = await connection.query(sql);
    return {
      columns: table.schema.fields.map((field) => field.name),
      rows: rowsOf(table),
      elapsedMs: Math.round(performance.now() - started),
    };
  };
  return {
    query,
    all: async (sql) => (await query(sql)).rows,
    readOnly: async (sql, maxRows) =>
      (await query(`SELECT * FROM (${sql.trim().replace(TRAILING_SEMICOLONS, "")}) LIMIT ${maxRows}`))
        .rows,
  };
}

function rowsOf(table: Table): Row[] {
  const fields = table.schema.fields;
  return table
    .toArray()
    .map((record: Record<string, unknown>) =>
      Object.fromEntries(fields.map((field) => [field.name, plain(record[field.name], field)])),
    );
}

function plain(value: unknown, field: Field): unknown {
  if (value === null || value === undefined) return null;
  if (DataType.isDate(field.type)) {
    return new Date(Number(value)).toISOString().slice(0, ISO_DATE_LENGTH);
  }
  if (DataType.isTimestamp(field.type)) return new Date(Number(value)).toISOString();
  if (typeof value === "bigint") return Number(value);
  if (DataType.isList(field.type)) {
    const child = field.type.children[0];
    const items = [...(value as Iterable<unknown>)];
    return child ? items.map((item) => plain(item, child)) : items;
  }
  return value;
}
