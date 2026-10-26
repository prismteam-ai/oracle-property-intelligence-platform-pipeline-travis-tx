// Node DuckDB adapter for the QueryEngine interface (tests and scripts only; src never imports an
// engine, ARD § 4). Values come back JSON-shaped: DATE → "YYYY-MM-DD", TIMESTAMPTZ → ISO 8601 UTC,
// BIGINT → number, lists and structs as arrays and objects.
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { QueryEngine, Row } from "../src/engine.js";

function plain(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return type === "DATE" ? value.toISOString().slice(0, 10) : value.toISOString();
  }
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map((v) => plain(v, ""));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v, "")]));
  }
  return value;
}

export interface DuckDbEngine extends QueryEngine {
  close(): void;
}

/** An in-memory DuckDB with TimeZone UTC and one thread (deterministic Parquet output). */
export async function openDuckDb(): Promise<DuckDbEngine> {
  const instance = await DuckDBInstance.create(":memory:", { threads: "1" });
  const connection: DuckDBConnection = await instance.connect();
  await connection.run("SET TimeZone = 'UTC'");
  return {
    async run(sql: string): Promise<void> {
      await connection.run(sql);
    },
    async all(sql: string): Promise<Row[]> {
      const reader = await connection.runAndReadAll(sql);
      const types = reader.columnTypes().map((t) => t.toString());
      const names = reader.columnNames();
      return reader
        .getRowObjectsJS()
        .map((row) => Object.fromEntries(names.map((n, i) => [n, plain(row[n], types[i] ?? "")])));
    },
    close(): void {
      connection.closeSync();
      instance.closeSync();
    },
  };
}
