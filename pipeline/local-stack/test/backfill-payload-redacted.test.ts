// A-11 fix 1c: the payload_redacted backfill against a REAL Postgres in a throwaway database
// (`a04_test_<random>`, created through QDB_ADMIN_URL and dropped in afterAll; skipped when it
// is unset), never the live `elephant` parcels. The parcels are loaded through the real Loader
// tcad track from a synthetic export ZIP (the A-04 fixture builder), then their
// payload_redacted is replaced by a stale stand-in, and the backfill (worker threads, batched
// writers, checkpoint) must restore exactly what processRecord computes. Synthetic input only.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { a04Record, writeExportZip } from "../../oracle-runtime/test/fixtures/a04/tcad/export.js";
import { streamExportRecords } from "../../oracle-runtime/travis/tcad/export-stream.js";
import { createKeyInventory } from "../../oracle-runtime/travis/tcad/key-inventory.js";
import { processChunk, writeChunkFile } from "../../oracle-runtime/travis/tcad/process.js";
import { inputDigest } from "../../oracle-runtime/travis/permits/merge-input.js";
import { runMerge } from "../services/loader.js";
import {
  MIGRATIONS_DIR,
  migrate,
  postgresMigrationStore,
  readMigrations,
} from "../services/migrate.js";
import { track as tcadTrack } from "../services/tracks/tcad.js";
import {
  BackfillError,
  createLowWater,
  defaultCheckpointPath,
  parsePids,
  readCheckpoint,
  runBackfill,
  scopeKey,
  uncoveredPids,
  type BackfillOptions,
} from "../scripts/backfill-payload-redacted/core.js";

const ADMIN = process.env.QDB_ADMIN_URL;
const JOB = "travis-a04-itest-backfill-202610240100";
const AS_OF = "2026-10-22";
const CAPTURED_AT = "2026-10-19T21:33:41.241Z";

describe("backfill helpers (no database)", () => {
  it("advances the low-water mark only over contiguous completed ranges", () => {
    const m = createLowWater(-1);
    expect(m.complete(4, 7, 3)).toBe(false);
    expect(m.mark).toBe(-1);
    expect(m.complete(0, 1, 1)).toBe(true);
    expect(m.mark).toBe(1);
    expect(m.complete(2, 3, 2)).toBe(true);
    expect([m.mark, m.rows]).toEqual([7, 6]);
    const resumed = createLowWater(7, 6);
    resumed.complete(8, 9, 0);
    expect([resumed.mark, resumed.rows]).toEqual([9, 6]);
  });

  it("lists as missing only pIDs covered by no run, not those done below the checkpoint", () => {
    const listed = ["1", "2", "3", "4"];
    // resumed: 1 and 2 were done earlier (rows exist), 3 seen now, 4 is nowhere
    expect(uncoveredPids(listed, new Set(["3"]), new Set(["1", "2", "3"]))).toEqual(["4"]);
    expect(uncoveredPids(listed, new Set(listed), new Set())).toEqual([]);
    expect(uncoveredPids(listed, new Set(), new Set())).toEqual(listed);
  });

  it("parses pIDs and keeps a separate checkpoint per scope", () => {
    expect(parsePids("12, 3,12")).toEqual(["12", "3"]);
    expect(() => parsePids("12,0x1")).toThrow(/not a pID/);
    expect(scopeKey(null)).toBe("all");
    expect(scopeKey(["3", "12"])).toBe(scopeKey(["12", "3"]));
    expect(scopeKey(["3"])).not.toBe(scopeKey(["3", "4"]));
    expect(defaultCheckpointPath(scopeKey(["3"]))).not.toBe(defaultCheckpointPath("all"));
  });
});

function urlFor(admin: string, database: string): string {
  const u = new URL(admin);
  u.pathname = `/${database}`;
  return u.toString();
}

/** 24 loadable R/P records (one confidential → redacted) + one invalid propType (not loaded). */
function fixtureRecords(): Record<string, unknown>[] {
  const recs: Record<string, unknown>[] = [];
  for (let i = 0; i < 24; i += 1) {
    recs.push(
      a04Record({
        pID: 700000 + i,
        geoID: `07000000${String(i).padStart(2, "0")}`,
        propType: i % 6 === 5 ? "P" : "R",
        improvements: [{ stateCd: "A1", livingArea: 1500 + i, actualYearBuilt: 1980 + i }],
        ...(i === 3 ? { confidentialSale: 1 } : {}),
      }),
    );
    if (i === 10) recs.push(a04Record({ pID: 799999, geoID: "0799999999", propType: "X" }));
  }
  return recs;
}

describe.skipIf(ADMIN === undefined || ADMIN === "")(
  "payload_redacted backfill against a real Postgres (QDB_ADMIN_URL, throwaway database)",
  () => {
    const database = `a04_test_${randomBytes(6).toString("hex")}`;
    const dir = mkdtempSync(join(tmpdir(), "a11-backfill-"));
    let admin: postgres.Sql;
    let sql: postgres.Sql;
    let zip: string;
    let zipSha: string;
    let ids: string[];
    /** pID → the payload processRecord computes (the reference, computed in-process). */
    const expected = new Map<string, unknown>();

    const opts = (o: Partial<BackfillOptions> = {}): BackfillOptions => ({
      sql,
      jobId: JOB,
      exportPath: zip,
      receipt: { sha256: zipSha, captured_at: CAPTURED_AT },
      pids: null,
      checkpointPath: join(dir, `cp-${randomBytes(4).toString("hex")}.json`),
      workers: 2,
      writers: 2,
      batch: 3,
      chunkRecords: 2,
      dryRun: false,
      log: () => undefined,
      ...o,
    });
    const stale = async (): Promise<void> => {
      await sql`UPDATE parcels SET payload_redacted = jsonb_build_object('pID', payload_redacted->'pID', 'stale', true)`;
    };
    const payloads = async () =>
      (
        await sql<Array<{ id: string; p: string }>>`
          SELECT request_identifier AS id, payload_redacted::text AS p FROM parcels ORDER BY 1`
      ).map((r) => [r.id, r.p] as const);
    const staleIds = async () =>
      (
        await sql<
          Array<{ id: string }>
        >`SELECT request_identifier AS id FROM parcels WHERE payload_redacted ? 'stale' ORDER BY 1`
      ).map((r) => r.id);
    /** Every parcels column except payload_redacted, plus the child tables, per row. */
    const everythingElse = async () => ({
      parcels:
        await sql`SELECT request_identifier, md5((to_jsonb(p) - 'payload_redacted')::text) AS h FROM parcels p ORDER BY 1`,
      geoids:
        await sql`SELECT md5(string_agg(to_jsonb(g)::text, '' ORDER BY g.geo_id, g.request_identifier)) AS h FROM parcel_geoids g`,
      structures:
        await sql`SELECT md5(string_agg(to_jsonb(s)::text, '' ORDER BY s.request_identifier, s.ordinal)) AS h FROM property_structures s`,
      recon:
        await sql`SELECT md5(string_agg(to_jsonb(r)::text, '' ORDER BY r.record_ordinal)) AS h FROM roll_reconciliation r`,
      runs: await sql`SELECT md5(string_agg(to_jsonb(b)::text, '' ORDER BY b.job_id)) AS h FROM backbone_runs b`,
    });

    beforeAll(async () => {
      admin = postgres(ADMIN ?? "", { max: 1, onnotice: () => {} });
      await admin.unsafe(`CREATE DATABASE ${database}`);
      sql = postgres(urlFor(ADMIN ?? "", database), { max: 4, onnotice: () => {} });
      await migrate(postgresMigrationStore(sql), readMigrations(MIGRATIONS_DIR));

      zip = writeExportZip(fixtureRecords(), undefined, dir);
      zipSha = createHash("sha256").update(readFileSync(zip)).digest("hex");
      // the real load path: processChunk → chunk artifact → Loader tcad track
      const ctx = { jobId: JOB, asOf: AS_OF, exportSha256: zipSha, capturedAt: CAPTURED_AT };
      const chunk = await processChunk(streamExportRecords(zip), ctx, createKeyInventory());
      for (const l of chunk.loaded)
        expected.set(l.parcel.request_identifier, l.parcel.payload_redacted);
      const path = join(dir, "c0.ndjson.gz");
      const sha = writeChunkFile(path, {
        rows: chunk.loaded,
        reconciliation: chunk.reconciliation,
      });
      await runMerge(sql, tcadTrack, {
        jobId: JOB,
        artifactPath: path,
        artifactSha256: sha,
        op: { kind: "chunk" },
      });
      await runMerge(sql, tcadTrack, {
        jobId: JOB,
        artifactPath: `run:${JOB}:complete`,
        artifactSha256: inputDigest({ JOB, s: "complete" }),
        op: { kind: "run", track: "appraisal", mode: "full", status: "complete", as_of: AS_OF },
      });
      ids = [...expected.keys()].sort();
      expect(ids).toHaveLength(24);
      expect(chunk.summary.invalid).toBe(1);
    }, 120_000);

    afterAll(async () => {
      await sql?.end({ timeout: 5 });
      await admin?.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin?.end();
      rmSync(dir, { recursive: true, force: true });
    });

    it("rewrites only payload_redacted, to exactly what processRecord computes", async () => {
      await stale();
      const before = await everythingElse();
      const r = await runBackfill(opts());
      expect(r.written).toBe(24);
      expect(r.not_loaded).toBe(1);
      expect(r.fingerprint_equal).toBe(true);
      expect(r.rows_covered).toBe(24);
      expect(r.db_rows_with_legal_key).toBe(r.computed_with_legal_key);
      expect(await everythingElse()).toEqual(before);
      for (const [id, p] of await payloads()) {
        expect(JSON.parse(p), id).toEqual(expected.get(id));
      }
      const types = await sql`SELECT DISTINCT jsonb_typeof(payload_redacted) AS t FROM parcels`;
      expect(types.map((t) => t.t)).toEqual(["object"]); // never a double-encoded jsonb string
      // a rerun writes nothing (the DISTINCT guard)
      const again = await runBackfill(opts());
      expect([again.written, again.skipped_already_correct]).toEqual([0, 24]);
    }, 120_000);

    it("kill and resume: ends byte-identical to a clean run, fingerprint unchanged", async () => {
      await stale();
      await runBackfill(opts());
      const clean = await payloads();

      // one worker, one writer: chunks of 2 records, batches flush at ≥ 3 rows → batch 1 = ordinals
      // 0–3, batch 2 = 4–7; the third batch fails, so the checkpoint's low-water mark is exactly 7
      await stale();
      const cp = join(dir, "cp-resume.json");
      const killed = await runBackfill(
        opts({ checkpointPath: cp, workers: 1, writers: 1, failAfterBatches: 2 }),
      ).catch((e: unknown) => e);
      expect(killed).toBeInstanceOf(BackfillError);
      expect((killed as BackfillError).code).toBe("injected_failure");
      const mid = readCheckpoint(cp);
      expect([mid?.low_water, mid?.rows_below_low_water, mid?.completed_at]).toEqual([7, 8, null]);
      expect((await staleIds()).length).toBe(16);

      const resumed = await runBackfill(opts({ checkpointPath: cp }));
      expect(resumed.skipped_below_checkpoint).toBe(8); // ordinals 0..7: not parsed, not dispatched
      expect(resumed.dispatched).toBe(25 - 8);
      expect(resumed.written).toBe(16);
      expect(resumed.fingerprint_equal).toBe(true);
      expect(resumed.fingerprint_before).toBe(mid?.fingerprint);
      expect(resumed.rows_covered).toBe(24);
      expect(readCheckpoint(cp)?.completed_at).not.toBeNull();
      expect(await payloads()).toEqual(clean);
      expect(await staleIds()).toEqual([]);
    }, 120_000);

    it("kill and resume with out-of-order commits (3 workers, 3 writers) also ends identical", async () => {
      await stale();
      await runBackfill(opts());
      const clean = await payloads();
      await stale();
      const cp = join(dir, "cp-resume-ooo.json");
      const o = { checkpointPath: cp, workers: 3, writers: 3, batch: 2, chunkRecords: 1 };
      const killed = await runBackfill(opts({ ...o, failAfterBatches: 4 })).catch(
        (e: unknown) => e,
      );
      expect((killed as BackfillError).code).toBe("injected_failure");
      const lowWater = readCheckpoint(cp)?.low_water ?? -2;
      expect(lowWater).toBeGreaterThanOrEqual(-1);
      expect(lowWater).toBeLessThan(24);
      const resumed = await runBackfill(opts(o));
      expect(resumed.skipped_below_checkpoint).toBe(lowWater + 1);
      expect(resumed.fingerprint_equal).toBe(true);
      expect(resumed.rows_covered).toBe(24);
      expect(await payloads()).toEqual(clean);
    }, 120_000);

    it("a --pids pilot then a full run: the full run never writes the pilot rows again", async () => {
      await stale();
      const pilot = [ids[0], ids[7], ids[20]] as string[];
      const pilotWritten: string[] = [];
      const p = await runBackfill(opts({ pids: pilot, onWritten: (w) => pilotWritten.push(...w) }));
      expect(p.scope).toBe(scopeKey(pilot));
      expect(p.written).toBe(3);
      expect(p.out_of_scope).toBe(21);
      expect(p.missing_pids).toEqual([]);
      expect(pilotWritten.sort()).toEqual([...pilot].sort());

      const fullWritten: string[] = [];
      const f = await runBackfill(opts({ onWritten: (w) => fullWritten.push(...w) }));
      expect(f.written).toBe(21);
      expect(f.skipped_already_correct).toBe(3);
      expect(fullWritten.filter((id) => pilot.includes(id))).toEqual([]);
      expect(await staleIds()).toEqual([]);
    }, 120_000);

    it("a record_sha256 mismatch stops the run and writes nothing for that batch", async () => {
      await stale();
      const victim = ids[1] as string;
      const [orig] = await sql<
        Array<{ s: string }>
      >`SELECT record_sha256 AS s FROM parcels WHERE request_identifier = ${victim}`;
      await sql`UPDATE parcels SET record_sha256 = ${"0".repeat(64)} WHERE request_identifier = ${victim}`;
      try {
        const cp = join(dir, "cp-mismatch.json");
        const err = await runBackfill(
          opts({ checkpointPath: cp, writers: 1, batch: 1000, chunkRecords: 100 }),
        ).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(BackfillError);
        expect((err as BackfillError).code).toBe("record_sha256_mismatch");
        expect((err as Error).message).toContain(victim);
        expect(await staleIds()).toEqual(ids); // the one batch held every row: none written
        expect(readCheckpoint(cp)?.low_water).toBe(-1);
      } finally {
        await sql`UPDATE parcels SET record_sha256 = ${orig?.s ?? ""} WHERE request_identifier = ${victim}`;
      }
    }, 120_000);

    it("a dry run counts what it would write and writes nothing, not even a checkpoint", async () => {
      await stale();
      const cp = join(dir, "cp-dry.json");
      const r = await runBackfill(opts({ checkpointPath: cp, dryRun: true }));
      expect(r.would_write).toBe(24);
      expect(r.written).toBe(0);
      expect(existsSync(cp)).toBe(false);
      expect(await staleIds()).toEqual(ids);
    }, 120_000);
  },
);
