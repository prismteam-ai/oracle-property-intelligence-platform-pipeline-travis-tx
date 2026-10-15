import type { Db } from "./db.js";
import { sqlString } from "./db.js";

export type MergeCounts = {
  recordsSeen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deleted: number;
};

const runColumns = ["first_seen_run", "last_seen_run", "last_changed_run", "is_deleted"];

export function hashExpr(columns: string[]): string {
  return `md5(to_json(struct_pack(${columns.map((c, i) => `c${i} := ${c}`).join(", ")}))::VARCHAR)`;
}

export async function tableColumns(db: Db, table: string): Promise<string[]> {
  const rows = await db.all<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => r.column_name);
}

export async function mergeSnapshot(
  db: Db,
  opts: {
    target: string;
    staging: string;
    key: string;
    runId: string;
    fullSnapshot: boolean;
    deleteScope?: string;
  },
): Promise<MergeCounts> {
  const { target: t, staging: s, key: k, runId } = opts;
  const run = sqlString(runId);
  const cols = (await tableColumns(db, t)).filter((c) => !runColumns.includes(c));
  const colList = cols.join(", ");

  await db.exec(`CREATE OR REPLACE TEMP TABLE _dedup AS
    SELECT * FROM ${s} QUALIFY row_number() OVER (PARTITION BY ${k} ORDER BY record_hash) = 1`);

  const counts = await db.one<{ seen: string; ins: string; upd: string; same: string }>(`
    SELECT count(*) AS seen,
      count(*) FILTER (WHERE t.${k} IS NULL) AS ins,
      count(*) FILTER (WHERE t.${k} IS NOT NULL AND (t.record_hash <> s.record_hash OR t.is_deleted)) AS upd,
      count(*) FILTER (WHERE t.${k} IS NOT NULL AND t.record_hash = s.record_hash AND NOT t.is_deleted) AS same
    FROM _dedup s LEFT JOIN ${t} t ON t.${k} = s.${k}`);

  await db.exec(`CREATE OR REPLACE TEMP TABLE _merged AS
    SELECT ${cols.map((c) => `s.${c}`).join(", ")},
      coalesce(t.first_seen_run, ${run}) AS first_seen_run,
      ${run} AS last_seen_run,
      CASE WHEN t.${k} IS NULL OR t.record_hash <> s.record_hash OR t.is_deleted THEN ${run} ELSE t.last_changed_run END AS last_changed_run,
      false AS is_deleted
    FROM _dedup s LEFT JOIN ${t} t ON t.${k} = s.${k}`);

  await db.exec("BEGIN TRANSACTION");
  try {
    await db.exec(`DELETE FROM ${t} WHERE ${k} IN (SELECT ${k} FROM _merged)`);
    await db.exec(
      `INSERT INTO ${t} (${colList}, ${runColumns.join(", ")}) SELECT ${colList}, ${runColumns.join(", ")} FROM _merged`,
    );
    let deleted = 0;
    if (opts.fullSnapshot) {
      const scope = opts.deleteScope ? `AND (${opts.deleteScope})` : "";
      deleted = Number(
        await db.scalar(
          `SELECT count(*) FROM ${t} WHERE NOT is_deleted ${scope} AND ${k} NOT IN (SELECT ${k} FROM _dedup)`,
        ),
      );
      await db.exec(`UPDATE ${t} SET is_deleted = true, last_changed_run = ${run}
        WHERE NOT is_deleted ${scope} AND ${k} NOT IN (SELECT ${k} FROM _dedup)`);
    }
    await db.exec("COMMIT");
    return {
      recordsSeen: Number(counts?.seen ?? 0),
      inserted: Number(counts?.ins ?? 0),
      updated: Number(counts?.upd ?? 0),
      unchanged: Number(counts?.same ?? 0),
      deleted,
    };
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  } finally {
    await db.exec("DROP TABLE IF EXISTS _dedup; DROP TABLE IF EXISTS _merged;");
  }
}
