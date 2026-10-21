import * as duckdb from '@duckdb/duckdb-wasm';
// Self-hosted, non-isolated ("eh") bundle: no SharedArrayBuffer, so no COOP/COEP headers are needed.
// The .wasm is emitted into dist/assets and must be served as application/wasm (CloudFront sets it by extension).
import wasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import workerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

export interface SqlResult {
  columns: string[];
  rows: unknown[][];
  elapsedMs: number;
}

export interface SqlEngine {
  version(): Promise<string>;
  /** Registers each table as a view over its mirrored Parquet parts (HTTP range reads). */
  registerTables(tables: { name: string; urls: string[] }[]): Promise<void>;
  query(sql: string): Promise<SqlResult>;
}

const plain = (value: unknown): unknown => (typeof value === 'bigint' ? value.toString() : value);

export async function openDuckDb(): Promise<SqlEngine> {
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(new URL(wasmUrl, location.href).href);
  const conn = await db.connect();
  let registered = 0;

  return {
    async version() {
      const result = await conn.query('select version() as v');
      return String(result.toArray()[0]?.v ?? '');
    },
    async registerTables(tables) {
      for (const table of tables) {
        const names: string[] = [];
        for (const url of table.urls) {
          const name = `part-${registered++}.parquet`;
          const absolute = new URL(url, location.href).href;
          await db.registerFileURL(name, absolute, duckdb.DuckDBDataProtocol.HTTP, false);
          names.push(`'${name}'`);
        }
        await conn.query(
          `create or replace view "${table.name}" as select * from read_parquet([${names.join(', ')}])`,
        );
      }
    },
    async query(sql) {
      const started = performance.now();
      const result = await conn.query(sql);
      const columns = result.schema.fields.map((f) => f.name);
      const rows = result.toArray().map((row) => columns.map((c) => plain(row[c])));
      return { columns, rows, elapsedMs: Math.round(performance.now() - started) };
    },
  };
}
