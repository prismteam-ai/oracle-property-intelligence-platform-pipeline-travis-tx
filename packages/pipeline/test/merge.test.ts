import { describe, expect, it } from "vitest";
import { Db } from "../src/core/db.js";
import { hashExpr, mergeSnapshot } from "../src/core/merge.js";

async function stage(db: Db, rows: [string, string][]) {
  const values = rows.map(([k, v]) => `('${k}', '${v}')`).join(", ");
  await db.exec(`CREATE OR REPLACE TEMP TABLE stg AS SELECT k, v, 'src' AS source_id, k AS source_record_id,
    NULL::VARCHAR AS source_url, NULL::VARCHAR AS raw_sha256, now() AS collected_at, ${hashExpr(["k", "v"])} AS record_hash
    FROM (VALUES ${values}) t(k, v)`);
}

describe("mergeSnapshot", () => {
  it("tracks inserts, updates, unchanged and deletes with immutable first_seen_run", async () => {
    const db = await Db.open(":memory:", { extensions: [] });
    await db.exec(`CREATE TABLE t (k VARCHAR PRIMARY KEY, v VARCHAR, source_id VARCHAR NOT NULL, source_record_id VARCHAR NOT NULL,
      source_url VARCHAR, raw_sha256 VARCHAR, collected_at TIMESTAMPTZ, record_hash VARCHAR NOT NULL,
      first_seen_run VARCHAR NOT NULL, last_seen_run VARCHAR NOT NULL, last_changed_run VARCHAR NOT NULL, is_deleted BOOLEAN NOT NULL DEFAULT false)`);
    await stage(db, [
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);
    expect(
      await mergeSnapshot(db, {
        target: "t",
        staging: "stg",
        key: "k",
        runId: "r1",
        fullSnapshot: true,
      }),
    ).toEqual({
      recordsSeen: 3,
      inserted: 3,
      updated: 0,
      unchanged: 0,
      deleted: 0,
    });
    await stage(db, [
      ["a", "1"],
      ["b", "20"],
      ["d", "4"],
    ]);
    expect(
      await mergeSnapshot(db, {
        target: "t",
        staging: "stg",
        key: "k",
        runId: "r2",
        fullSnapshot: true,
      }),
    ).toEqual({
      recordsSeen: 3,
      inserted: 1,
      updated: 1,
      unchanged: 1,
      deleted: 1,
    });
    const rows = await db.all<{
      k: string;
      first_seen_run: string;
      last_changed_run: string;
      is_deleted: boolean;
    }>(`SELECT k, first_seen_run, last_changed_run, is_deleted FROM t ORDER BY k`);
    expect(rows).toEqual([
      { k: "a", first_seen_run: "r1", last_changed_run: "r1", is_deleted: false },
      { k: "b", first_seen_run: "r1", last_changed_run: "r2", is_deleted: false },
      { k: "c", first_seen_run: "r1", last_changed_run: "r2", is_deleted: true },
      { k: "d", first_seen_run: "r2", last_changed_run: "r2", is_deleted: false },
    ]);
    await stage(db, [["a", "1"]]);
    expect(
      await mergeSnapshot(db, {
        target: "t",
        staging: "stg",
        key: "k",
        runId: "r3",
        fullSnapshot: false,
      }),
    ).toEqual({
      recordsSeen: 1,
      inserted: 0,
      updated: 0,
      unchanged: 1,
      deleted: 0,
    });
    db.close();
  });
});
