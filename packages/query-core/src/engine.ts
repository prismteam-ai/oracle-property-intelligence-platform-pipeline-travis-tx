// The engine boundary (ARD § 4): query-core src speaks SQL to this interface and never imports a
// database engine. Node tests use scripts/duckdb-engine.ts; the browser (A-13) supplies DuckDB WASM.

/** One result row, JSON-shaped (dates as YYYY-MM-DD, timestamps as ISO 8601 UTC). */
export type Row = Record<string, unknown>;

export interface QueryEngine {
  /** Runs one or more statements and discards any result. */
  run(sql: string): Promise<void>;
  /** Runs one query and returns its rows. */
  all(sql: string): Promise<Row[]>;
}
