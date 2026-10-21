import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { PERMIT_TEXT_FILTER_COLUMNS, readPostLoadSql } from '@travis/query';
import { Db, q } from './db.js';
import { sha256FileRaw } from './hash.js';

/**
 * The serving set (decisions.md section 30): what the Lambda functions read instead of the 4 GB file. The large tables
 * become zstd Parquet in the private deploy bucket, each sorted so the filters of the hot operations read few row groups;
 * every other `main` table, permit_text with its BM25 index rebuilt by the same PRAGMA, and the list of Parquet files go
 * into one small DuckDB file that is baked into the image. `lex.*` is not exported: the API never reads it.
 */
export const REMOTE_TABLES: Readonly<Record<string, { select: string; rowGroupSize: number }>> = {
  properties: {
    select: 'SELECT * FROM main.properties ORDER BY floor(lat * 40) NULLS LAST, lon, property_id',
    rowGroupSize: 10000,
  },
  permits: {
    select:
      'SELECT * FROM main.permits ORDER BY is_roofing DESC, status_group, floor(radius_lat * 40) NULLS LAST, radius_lon, permit_id',
    rowGroupSize: 10000,
  },
  // the text search fetches its page of rows by id: small row groups sorted by id keep that read to the matched groups
  permit_text_rows: {
    select:
      'SELECT * FROM main.permits WHERE permit_id IN (SELECT permit_id FROM main.permit_text) ORDER BY permit_id',
    rowGroupSize: 1000,
  },
  property_extras: {
    select: 'SELECT * FROM main.property_extras ORDER BY property_id',
    rowGroupSize: 10000,
  },
  roof_age_reference: {
    select: 'SELECT * FROM main.roof_age_reference ORDER BY property_id',
    rowGroupSize: 10000,
  },
  business_records: {
    select: 'SELECT * FROM main.business_records ORDER BY name_norm, source, business_record_id',
    rowGroupSize: 10000,
  },
};

/** Tables the serving file holds besides the copied ones; full-file mode has them as views (packages/query). */
const DERIVED_LOCAL: Readonly<Record<string, string>> = {
  permit_text_filters: `SELECT ${PERMIT_TEXT_FILTER_COLUMNS.join(', ')} FROM src.main.permits WHERE permit_id IN (SELECT permit_id FROM src.main.permit_text)`,
};

/** The baked file's name; its catalog name (`serving`) is the same at build time and in the image. */
export const SERVING_DB_FILE = 'serving.duckdb';

export interface ServingFile {
  table_name: string;
  /** `<table>.<first 16 hex of sha256>.parquet`: content-named, so a re-export never overwrites an object. */
  file: string;
  sha256: string;
  bytes: number;
  rows: number;
}

export interface ServingReport {
  db: { file: string; sha256: string; bytes: number };
  files: ServingFile[];
  localTables: string[];
}

/** Writes the serving set for the checkpointed `fullDb` into `outDir` (replaced). */
export async function buildServing(o: {
  fullDb: string;
  outDir: string;
  threads?: number;
  memoryLimit?: string;
  log: (m: string) => void;
}): Promise<ServingReport> {
  rmSync(o.outDir, { recursive: true, force: true });
  const work = path.join(o.outDir, 'work');
  mkdirSync(work, { recursive: true });
  const config = {
    threads: String(o.threads ?? 8),
    memory_limit: o.memoryLimit ?? '12GB',
    temp_directory: path.join(work, 'duckdb-tmp'),
  };

  const src = await Db.open(o.fullDb, { ...config, access_mode: 'READ_ONLY' });
  const tables = (
    await src.rows<{ t: string }>(
      `SELECT table_name t FROM duckdb_tables() WHERE database_name = current_database() AND schema_name = 'main' ORDER BY 1`,
    )
  ).map((r) => r.t);
  for (const t of [
    'properties',
    'permits',
    'permit_text',
    'property_extras',
    'roof_age_reference',
    'business_records',
  ])
    if (!tables.includes(t)) throw new Error(`serving: ${o.fullDb} has no table ${t}`);
  const files: ServingFile[] = [];
  for (const [t, spec] of Object.entries(REMOTE_TABLES)) {
    const tmp = path.join(work, `${t}.parquet`);
    await src.run(
      `COPY (${spec.select}) TO ${q(tmp)} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE ${spec.rowGroupSize})`,
    );
    const sha256 = await sha256FileRaw(tmp);
    const file = `${t}.${sha256.slice(0, 16)}.parquet`;
    renameSync(tmp, path.join(o.outDir, file));
    const rows = await src.scalar(
      `SELECT count(*) FROM read_parquet(${q(path.join(o.outDir, file))})`,
    );
    files.push({
      table_name: t,
      file,
      sha256,
      bytes: statSync(path.join(o.outDir, file)).size,
      rows,
    });
    o.log(`serving: ${file} ${(files.at(-1)!.bytes / 1e6).toFixed(1)} MB, ${rows} rows`);
  }
  src.close();

  const localTables = tables.filter((t) => !(t in REMOTE_TABLES));
  const dbFile = path.join(o.outDir, SERVING_DB_FILE);
  const db = await Db.open(dbFile, config);
  await db.run('LOAD fts');
  await db.run(`ATTACH ${q(o.fullDb)} AS src (READ_ONLY)`);
  for (const t of localTables) await db.run(`CREATE TABLE ${t} AS SELECT * FROM src.main.${t}`);
  for (const [t, select] of Object.entries(DERIVED_LOCAL))
    await db.run(`CREATE TABLE ${t} AS ${select}`);
  await db.run('DETACH src');
  await db.run(
    'CREATE TABLE serving_files (table_name VARCHAR PRIMARY KEY, file VARCHAR NOT NULL, sha256 VARCHAR NOT NULL, bytes BIGINT NOT NULL, rows BIGINT NOT NULL)',
  );
  for (const f of files)
    await db.run(
      `INSERT INTO serving_files VALUES (${q(f.table_name)}, ${q(f.file)}, ${q(f.sha256)}, ${f.bytes}, ${f.rows})`,
    );
  await db.run(ftsPragma());
  await db.run('CHECKPOINT');
  db.close();
  rmSync(work, { recursive: true, force: true });
  if (existsSync(`${dbFile}.wal`)) throw new Error(`serving: ${dbFile}.wal left after CHECKPOINT`);
  const report: ServingReport = {
    db: {
      file: SERVING_DB_FILE,
      sha256: await sha256FileRaw(dbFile),
      bytes: statSync(dbFile).size,
    },
    files,
    localTables: [...localTables, ...Object.keys(DERIVED_LOCAL)],
  };
  o.log(
    `serving: ${SERVING_DB_FILE} ${(report.db.bytes / 1e6).toFixed(1)} MB (${localTables.length} tables and the text index)`,
  );
  return report;
}

/** The text index statement of post_load.sql, so both files index permit_text with the same configuration. */
function ftsPragma(): string {
  const m = /PRAGMA create_fts_index\([\s\S]*?\);/.exec(readPostLoadSql());
  if (!m) throw new Error('post_load.sql has no PRAGMA create_fts_index statement');
  return m[0];
}
