// A-04 T008 (A-04-TC-018): the Loader virtual object is the single Query DB writer. A fake
// transactional store (synthetic test input) stands in for Postgres: writes become visible
// only when the transaction callback resolves, so a thrown merge leaves nothing behind.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as restate from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { createLoader, loadTracks, runMerge, LOADER_KEY } from "../services/loader.js";

const FIXTURE_TRACKS = fileURLToPath(new URL("./fixtures/tracks/", import.meta.url));
const SERVICES = fileURLToPath(new URL("../services/", import.meta.url));

interface Fake {
  sql: postgres.Sql;
  committed: { rows: string[]; watermarks: Map<string, unknown>; merges: Set<string> };
  transactions: number;
}

/** In-memory stand-in for postgres.js: tagged-template queries inside sql.begin(). */
function fakeDb(): Fake {
  const committed = { rows: [] as string[], watermarks: new Map<string, unknown>(), merges: new Set<string>() };
  const fake: Fake = { sql: undefined as unknown as postgres.Sql, committed, transactions: 0 };
  const begin = async <T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> => {
    fake.transactions += 1;
    const pending = { rows: [] as string[], watermarks: new Map<string, unknown>(), merges: new Set<string>() };
    const tx = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?").replace(/\s+/g, " ").trim();
      if (text.startsWith("SELECT pg_advisory_xact_lock")) return [];
      if (text.startsWith("SELECT 1 FROM loader_merges")) {
        const key = `${String(values[0])}|${String(values[1])}`;
        return committed.merges.has(key) || pending.merges.has(key) ? [{ "?column?": 1 }] : [];
      }
      if (text.startsWith("INSERT INTO fixture_rows")) {
        pending.rows.push(String(values[0]));
        return [];
      }
      if (text.startsWith("INSERT INTO watermarks")) {
        pending.watermarks.set(`${String(values[0])}|${String(values[1])}`, values[2]);
        return [];
      }
      if (text.startsWith("INSERT INTO loader_merges")) {
        pending.merges.add(`${String(values[0])}|${String(values[2])}`);
        return [];
      }
      throw new Error(`fake db: unexpected query ${text}`);
    }) as unknown as postgres.TransactionSql;
    (tx as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
    const out = await fn(tx);
    committed.rows.push(...pending.rows);
    for (const [k, v] of pending.watermarks) committed.watermarks.set(k, v);
    for (const k of pending.merges) committed.merges.add(k);
    return out;
  };
  fake.sql = { begin } as unknown as postgres.Sql;
  return fake;
}

const SHA = "a".repeat(64);
const input = (rows: string[], sha = SHA) => ({
  jobId: "travis-a04-202610220100",
  artifactPath: "runs/travis-a04-202610220100/chunks/c0.ndjson.gz",
  artifactSha256: sha,
  rows,
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("A-04-TC-018 Loader: one writer into the Query DB", () => {
  it("A-04-TC-018 a repeated merge of the same (track, artifact_sha256) writes 0 rows", async () => {
    const tracks = await loadTracks(FIXTURE_TRACKS);
    const track = tracks.get("tcad");
    expect(track).toBeDefined();
    const db = fakeDb();
    const first = await runMerge(db.sql, track!, input(["r1", "r2"]));
    expect(first).toMatchObject({ skipped: false, rowsWritten: 2 });
    const again = await runMerge(db.sql, track!, input(["r1", "r2"]));
    expect(again).toMatchObject({ skipped: true, rowsWritten: 0 });
    expect(db.committed.rows).toEqual(["r1", "r2"]);
  });

  it("A-04-TC-018 no module in services other than the Loader and migrate opens a write transaction", () => {
    const offenders = walk(SERVICES)
      .map((p) => relative(SERVICES, p))
      .filter((rel) => rel !== "loader.ts" && rel !== "migrate.ts")
      .filter((rel) => {
        const src = readFileSync(join(SERVICES, rel), "utf8");
        return /\.begin\s*\(|\.reserve\s*\(|\bBEGIN\b|\bCOMMIT\b/.test(src);
      });
    expect(offenders).toEqual([]);
  });

  it("rows, watermark and loader_merges commit in ONE transaction; a thrown merge leaves none", async () => {
    const track = (await loadTracks(FIXTURE_TRACKS)).get("tcad")!;
    const db = fakeDb();
    await expect(runMerge(db.sql, track, input(["r1", "boom"], "b".repeat(64)))).rejects.toThrow(
      /synthetic merge failure/,
    );
    expect(db.committed.rows).toEqual([]);
    expect(db.committed.watermarks.size).toBe(0);
    expect(db.committed.merges.size).toBe(0);
    const ok = await runMerge(db.sql, track, input(["r3"], "c".repeat(64)));
    expect(ok.rowsWritten).toBe(1);
    expect(db.transactions).toBe(2);
    expect(db.committed.watermarks.get("tcad|tcad_export")).toEqual({ mergedCount: 1 });
    expect(db.committed.merges.has(`tcad|${"c".repeat(64)}`)).toBe(true);
  });

  it("loads every tracks/*.ts that exports `track`, and only those", async () => {
    const tracks = await loadTracks(FIXTURE_TRACKS);
    expect([...tracks.keys()]).toEqual(["tcad"]);
    expect((await loadTracks(join(FIXTURE_TRACKS, "missing"))).size).toBe(0);
  });

  it("rejects an input that fails the track schema", async () => {
    const track = (await loadTracks(FIXTURE_TRACKS)).get("tcad")!;
    await expect(runMerge(fakeDb().sql, track, { jobId: "x" })).rejects.toThrow();
  });

  it("is the virtual object Loader keyed travis with raised timeouts (≥ 30 min / ≥ 60 min)", async () => {
    const def = createLoader(restate, { tracks: await loadTracks(FIXTURE_TRACKS), sql: () => fakeDb().sql });
    expect(def.name).toBe("Loader");
    expect(LOADER_KEY).toBe("travis");
    const opts = (def as unknown as { options: { inactivityTimeout: { minutes: number }; abortTimeout: { minutes: number } } }).options;
    expect(opts.inactivityTimeout.minutes).toBeGreaterThanOrEqual(30);
    expect(opts.abortTimeout.minutes).toBeGreaterThanOrEqual(60);
  });
});
