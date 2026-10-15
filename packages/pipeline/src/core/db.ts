import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

export type Row = Record<string, unknown>;

export class Db {
  private constructor(
    private readonly instance: DuckDBInstance,
    readonly conn: DuckDBConnection,
  ) {}

  static async open(dbPath: string, opts: { extensions?: string[] } = {}): Promise<Db> {
    if (dbPath !== ":memory:") await mkdir(path.dirname(dbPath), { recursive: true });
    const instance = await DuckDBInstance.create(dbPath);
    const conn = await instance.connect();
    const db = new Db(instance, conn);
    for (const ext of opts.extensions ?? ["spatial", "httpfs"]) {
      await conn.run(`INSTALL ${ext}; LOAD ${ext};`);
    }
    await conn.run(`SET memory_limit = '${process.env.ORACLE_DUCKDB_MEMORY_LIMIT || "6GB"}'`);
    await conn.run(`SET threads = ${Number(process.env.ORACLE_DUCKDB_THREADS || 4)}`);
    await conn.run(`SET preserve_insertion_order = false`);
    if (dbPath !== ":memory:") {
      await conn.run(
        `SET max_temp_directory_size = '${process.env.ORACLE_DUCKDB_MAX_TEMP || "8GB"}'`,
      );
    }
    return db;
  }

  async exec(sql: string): Promise<void> {
    await this.conn.run(sql);
  }

  async all<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (params.length === 0) {
      const r = await this.conn.runAndReadAll(sql);
      return r.getRowObjectsJson() as T[];
    }
    const stmt = await this.conn.prepare(sql);
    stmt.bind(params as never);
    const r = await stmt.runAndReadAll();
    return r.getRowObjectsJson() as T[];
  }

  async one<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.all<T>(sql, params);
    return rows[0];
  }

  async scalar<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
    const row = await this.one(sql, params);
    if (!row) throw new Error(`scalar query returned no rows: ${sql}`);
    return Object.values(row)[0] as T;
  }

  close(): void {
    this.conn.closeSync();
    this.instance.closeSync();
  }
}

export function sqlString(v: string): string {
  return `'${v.replaceAll("'", "''")}'`;
}
