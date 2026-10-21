import { writeFileSync } from 'node:fs';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';

export const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
export const qlist = (xs: readonly string[]): string => `[${xs.map(q).join(', ')}]`;

/** Thin wrapper over a DuckDB connection with JSON-friendly reads. */
export class Db {
  private constructor(
    readonly instance: DuckDBInstance,
    readonly conn: DuckDBConnection,
  ) {}
  static async open(path: string, config: Record<string, string> = {}): Promise<Db> {
    const instance = await DuckDBInstance.create(path, config);
    return new Db(instance, await instance.connect());
  }
  async run(sql: string): Promise<void> {
    await this.conn.run(sql);
  }
  async rows<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const r = await this.conn.runAndReadAll(sql);
    return r.getRowObjectsJson() as T[];
  }
  async one<T = Record<string, unknown>>(sql: string): Promise<T> {
    const r = await this.rows<T>(sql);
    if (r.length !== 1) throw new Error(`expected one row, got ${r.length}: ${sql.slice(0, 120)}`);
    return r[0] as T;
  }
  async scalar(sql: string): Promise<number> {
    const r = await this.one<Record<string, unknown>>(sql);
    return Number(Object.values(r)[0]);
  }
  /** Writes `rows` as NDJSON to `tmpFile` and inserts them into `table` by column name. */
  async insertJson(
    table: string,
    rows: readonly object[],
    tmpFile: string,
    columnsSpec?: string,
  ): Promise<void> {
    if (rows.length === 0) return;
    writeFileSync(tmpFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const src = columnsSpec
      ? `read_json(${q(tmpFile)}, format='newline_delimited', columns=${columnsSpec})`
      : `read_json(${q(tmpFile)}, format='newline_delimited', sample_size=-1)`;
    await this.run(`INSERT INTO ${table} BY NAME SELECT * FROM ${src}`);
  }
  close(): void {
    this.conn.closeSync();
    this.instance.closeSync();
  }
}
