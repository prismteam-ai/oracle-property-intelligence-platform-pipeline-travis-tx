// A-03 T072 (G-C2a): the one module that imports @duckdb/node-api (ESLint allows it under
// apps/*/src/engine/** only, AD-19). `openDuckDb` returns the query-core QueryEngine over one
// in-memory DuckDB: `threads` per ADR-0001 as updated by ERR-18 (4 on the 3,008 MB Lambda), `extension_directory`
// pointing at the httpfs copy the CDK Api stack (T074) bundles beside the handler, remote
// autoinstall / autoload off so the Lambda never reaches extensions.duckdb.org, TimeZone UTC so
// the builders' as_of date is the manifest's UTC calendar date, and a writable temp directory
// (the Lambda task root is read-only). Values come back JSON-shaped, the same way as
// packages/query-core/scripts/duckdb-engine.ts (DATE → "YYYY-MM-DD", TIMESTAMPTZ → ISO 8601 UTC,
// BIGINT → number). ERR-18: `cacheRemoteReads` keeps every part's footer and fetched column chunks
// in DuckDB's memory across queries without re-validating them (http metadata cache, Parquet
// metadata cache, external file cache with NO_VALIDATION). Safe because the Lambda only reads
// immutable bytes: `ipfs/<cid>` is content-addressed, and a bench part gets a new presigned URL
// (a new cache key) whenever its ETag changes (s3-read.ts). duckdb-node.ts wraps this in the module-scope engine; the router tests
// replace this module with a recording fake so they run without a database.
import {
  ANY,
  DuckDBArrayType,
  DuckDBInstance,
  DuckDBListType,
  DuckDBStructType,
  DuckDBTypeId,
  type DuckDBConnection,
  type DuckDBType,
} from "@duckdb/node-api";
import type { QueryEngine, Row } from "@countylens/query-core";

export interface DuckDbOptions {
  /** DuckDB `threads` (ADR-0001 Lambda sizing: 2). */
  readonly threads: number;
  /** DuckDB `memory_limit`, e.g. "1GB": keeps DuckDB inside the Lambda's memory. */
  readonly memoryLimit: string;
  /** DuckDB `extension_directory`: `<dir>/<duckdb version>/<platform>/httpfs.duckdb_extension`. */
  readonly extensionDirectory: string;
  /** DuckDB `temp_directory` for spills; must be writable (under /tmp on Lambda). */
  readonly tempDirectory: string;
  /** `LOAD httpfs` after opening (the Lambda reads presigned HTTPS URLs); off over local files. */
  readonly httpfs: boolean;
  /** ERR-18: cache footers, HTTP metadata and fetched bytes across queries, never re-validated.
   *  Only for immutable reads (a URL whose bytes never change). Default off. */
  readonly cacheRemoteReads?: boolean;
}

/** ERR-18: the cache settings `cacheRemoteReads` applies (http metadata only with httpfs loaded). */
export function remoteReadCacheSql(httpfs: boolean): string[] {
  return [
    ...(httpfs ? ["SET enable_http_metadata_cache = true"] : []),
    "SET parquet_metadata_cache = true",
    "SET enable_external_file_cache = true",
    "SET validate_external_file_cache = 'NO_VALIDATION'",
  ];
}

export interface DuckDbEngine extends QueryEngine {
  close(): void;
  /** Stops the statement running on the connection (it rejects); A-16 per-call deadlines. */
  interrupt?(): void;
}

/**
 * DuckDB JS values → JSON-shaped values, led by the column's DuckDB type, recursively (ERR-10):
 * DATE → "YYYY-MM-DD" and TIMESTAMP* → ISO 8601 UTC at any depth (inside a STRUCT or a LIST too),
 * BIGINT → number, LIST / ARRAY → array, STRUCT → object by its entry names.
 */
function plain(value: unknown, type: DuckDBType): unknown {
  if (value === null || value === undefined) return null;
  if (type instanceof DuckDBListType || type instanceof DuckDBArrayType) {
    return Array.isArray(value) ? value.map((v) => plain(v, type.valueType)) : plain(value, ANY);
  }
  if (type instanceof DuckDBStructType && typeof value === "object" && !Array.isArray(value)) {
    const entries = value as Record<string, unknown>;
    return Object.fromEntries(
      type.entryNames.map((name, i) => [name, plain(entries[name], type.entryTypes[i] ?? ANY)]),
    );
  }
  if (value instanceof Date) {
    return type.typeId === DuckDBTypeId.DATE
      ? value.toISOString().slice(0, 10)
      : value.toISOString();
  }
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map((v) => plain(v, ANY));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v, ANY)]));
  }
  return value;
}

/** Opens one in-memory DuckDB with the given options; the caller owns `close()`. */
export async function openDuckDb(options: DuckDbOptions): Promise<DuckDbEngine> {
  const instance = await DuckDBInstance.create(":memory:", {
    threads: String(options.threads),
    memory_limit: options.memoryLimit,
    extension_directory: options.extensionDirectory,
    temp_directory: options.tempDirectory,
    autoinstall_known_extensions: "false",
    autoload_known_extensions: "false",
  });
  const connection: DuckDBConnection = await instance.connect();
  try {
    await connection.run("SET TimeZone = 'UTC'");
    if (options.httpfs) await connection.run("LOAD httpfs");
    if (options.cacheRemoteReads === true) {
      for (const sql of remoteReadCacheSql(options.httpfs)) await connection.run(sql);
    }
  } catch (error) {
    connection.closeSync();
    instance.closeSync();
    throw error;
  }
  return {
    async run(sql: string): Promise<void> {
      await connection.run(sql);
    },
    async all(sql: string): Promise<Row[]> {
      const reader = await connection.runAndReadAll(sql);
      const types = reader.columnTypes();
      const names = reader.columnNames();
      return reader
        .getRowObjectsJS()
        .map((row) => Object.fromEntries(names.map((n, i) => [n, plain(row[n], types[i] ?? ANY)])));
    },
    close(): void {
      connection.closeSync();
      instance.closeSync();
    },
    interrupt(): void {
      connection.interrupt();
    },
  };
}
