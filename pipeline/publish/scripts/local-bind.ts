// The local binder of the bind guard (src/bind-guard.ts, CR-A-03 F-1): the real query-core
// bindManifest over an in-memory node DuckDB, reading each table part from the run directory
// (manifest artifact names are relative to it), then listRoofingPermitsSql() and
// runSummarySql(). It lives outside src/ because DuckDB is banned from pipeline/publish/src
// (ARD § 4, AD-19); src/bind-guard.ts imports it lazily. query-core is imported by package name
// (`@countylens/query-core`, a declared workspace dependency, CR-A-03 N-2). Its node DuckDB
// adapter (packages/query-core/scripts/duckdb-engine.ts) is not a package export, so the same
// small adapter is kept here over this package's own `@duckdb/node-api` dependency.
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  bindManifest,
  listRoofingPermitsSql,
  runSummarySql,
  type QueryEngine,
  type Row,
} from "@countylens/query-core";
import type { LocalBinder } from "../src/bind-guard.js";

/** JSON-shaped values, as query-core expects: DATE → YYYY-MM-DD, timestamps ISO, BIGINT → number. */
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

/** An in-memory DuckDB with TimeZone UTC and one thread (same settings as query-core's adapter). */
async function openDuckDb(): Promise<QueryEngine & { close(): void }> {
  const instance = await DuckDBInstance.create(":memory:", { threads: "1" });
  const connection = await instance.connect();
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

export const localBind: LocalBinder = async ({ manifestBytes, runDir }) => {
  const db = await openDuckDb();
  try {
    const bound = await bindManifest(manifestBytes, join(runDir, "tables"), db, {
      partUrl: ({ name }) => join(runDir, name),
    });
    const permits = await db.all(listRoofingPermitsSql());
    const [summary] = await db.all(runSummarySql());
    if (summary === undefined) throw new Error("runSummarySql returned no row");
    return {
      runId: String(summary.run_id),
      manifestCid: String(summary.manifest_cid),
      permitRows: permits.length,
      roofingPermitRows: Number(summary.roofing_permit_rows),
      tables: bound.tables.length,
    };
  } finally {
    db.close();
  }
};
