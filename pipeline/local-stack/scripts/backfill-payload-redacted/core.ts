// A-11 fix 1c: targeted backfill of `parcels.payload_redacted` for one TCAD job, from the same
// verified export, through the loader's own functions (processRecord). Only payload_redacted is
// written; every other column is fingerprinted before the first write and after the run.
//
//   reader (streamExportRecords, main thread)
//     → bounded queue → N worker threads (processRecord: parse / redact / slim)
//     → bounded queue → M concurrent batch writers (one transaction per batch)
//
// Per batch, in one transaction: (1) every row's stored record_sha256 must equal the computed
// one (and the row must exist for the job), else the batch throws and writes nothing; (2) a
// batched UPDATE … FROM (VALUES …) guarded by `payload_redacted IS DISTINCT FROM`, so a rerun
// (or a full run after a pilot) never writes a row that is already correct. JSON is bound as
// TEXT and cast `::text::jsonb` (binding JSON text as jsonb double-encodes it, see 0104).
//
// Resume: writes commit out of order, so the checkpoint keeps the low-water mark N: every
// record with ordinal ≤ N is committed or needed no write. It is rewritten atomically (temp
// file + rename) whenever N advances. A resumed run skips records ≤ N without dispatching them.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import type postgres from "postgres";
import { z } from "zod";
import { DEFAULT_REPO_ROOT } from "../../../oracle-runtime/travis/discovery/blocked-evidence.js";
import {
  streamExportRecords,
  type ExportRecordText,
} from "../../../oracle-runtime/travis/tcad/export-stream.js";
import { verifyExport } from "../../../oracle-runtime/travis/tcad/export-verify.js";
import type { ChunkContext } from "../../../oracle-runtime/travis/tcad/process.js";
import { runAsOf } from "../../services/workflows/tcad-backbone.js";
import type { BackfillRow, ChunkIn, ChunkOut, WorkerInit, WorkerReply } from "./transform.js";

export const DEFAULT_JOB = "travis-a04-20261022052658";
const PID = /^[1-9][0-9]*$/;

export class BackfillError extends Error {
  constructor(
    readonly code:
      | "record_sha256_mismatch"
      | "duplicate_in_batch"
      | "checkpoint_mismatch"
      | "fingerprint_changed"
      | "incomplete"
      | "worker_failed"
      | "interrupted"
      | "injected_failure",
    message: string,
  ) {
    super(message);
    this.name = "BackfillError";
  }
}

// ---------- scope and pIDs ----------

/** pIDs from a comma list or a file (one per line or CSV first column; blank, `#` and a non-numeric header skipped). */
export function parsePids(arg: string): string[] {
  const raw = existsSync(arg)
    ? readFileSync(arg, "utf8")
        .split(/\r?\n/)
        .map((l) => (l.split(",")[0] ?? "").trim())
        .filter((l, i) => l !== "" && !l.startsWith("#") && !(i === 0 && !PID.test(l)))
    : arg.split(",").map((s) => s.trim());
  const pids = [...new Set(raw.filter((s) => s !== ""))].sort();
  const bad = pids.filter((p) => !PID.test(p));
  if (bad.length > 0) throw new Error(`--pids: not a pID: ${bad.slice(0, 5).join(", ")}`);
  if (pids.length === 0) throw new Error("--pids: no pIDs given");
  return pids;
}

export const pidsSha256 = (pids: readonly string[]): string =>
  createHash("sha256")
    .update([...pids].sort().join("\n"))
    .digest("hex");

/** `all`, or `pids-<12 hex of the sorted pID list>`: a pilot checkpoint never touches the full run's. */
export const scopeKey = (pids: readonly string[] | null): string =>
  pids === null ? "all" : `pids-${pidsSha256(pids).slice(0, 12)}`;

export const defaultCheckpointPath = (scope: string, repoRoot: string = DEFAULT_REPO_ROOT) =>
  join(repoRoot, "specs/011-publish-and-runs", `backfill-checkpoint-${scope}.json`);

// ---------- checkpoint ----------

const Checkpoint = z.object({
  version: z.literal(1),
  job_id: z.string(),
  scope: z.string(),
  pids_sha256: z.string().nullable(),
  export_sha256: z.string(),
  fingerprint: z.string(),
  low_water: z.number().int().min(-1),
  /** In-scope parcel rows among the records ≤ low_water. */
  rows_below_low_water: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
});
export type Checkpoint = z.infer<typeof Checkpoint>;

export function readCheckpoint(path: string): Checkpoint | null {
  if (!existsSync(path)) return null;
  return Checkpoint.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Atomic: write a temp file next to it, then rename over it. */
export function writeCheckpoint(path: string, cp: Checkpoint): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(cp, null, 2)}\n`);
  renameSync(tmp, path);
}

// ---------- low-water mark ----------

/**
 * Completed ordinal ranges [lo, hi] → the highest N with every ordinal ≤ N complete, and the
 * in-scope rows of the records ≤ N (so a resumed run can still prove full coverage).
 */
export function createLowWater(start: number, startRows = 0) {
  let mark = start;
  let rows = startRows;
  const done = new Map<number, { hi: number; rows: number }>();
  return {
    get mark(): number {
      return mark;
    },
    get rows(): number {
      return rows;
    },
    /** Marks [lo, hi] (holding `n` in-scope rows) complete; true when the mark advanced. */
    complete(lo: number, hi: number, n: number): boolean {
      done.set(lo, { hi, rows: n });
      const before = mark;
      for (let next = done.get(mark + 1); next !== undefined; next = done.get(mark + 1)) {
        done.delete(mark + 1);
        mark = next.hi;
        rows += next.rows;
      }
      return mark !== before;
    },
  };
}

/**
 * pIDs of the `--pids` list that no run has covered. A resumed run skips (does not parse) the
 * records below the checkpoint, so their pIDs were not "seen" in this run although they were done
 * earlier; those are the listed pIDs with a parcels row (the end-of-run `rows_covered ===
 * db_rows_in_scope` check proves every such row is covered). Only a pID that is neither seen
 * now nor present in the database is genuinely uncovered.
 */
export function uncoveredPids(
  listed: readonly string[],
  seenNow: ReadonlySet<string>,
  inDatabase: ReadonlySet<string>,
): string[] {
  return listed.filter((p) => !seenNow.has(p) && !inDatabase.has(p));
}

// ---------- SQL ----------

/** md5 over every parcels column except payload_redacted for the job, ordered by request_identifier. */
export async function parcelsFingerprint(sql: postgres.Sql, jobId: string): Promise<string> {
  const rows = await sql.begin(async (tx) => {
    await tx`SET LOCAL TimeZone = 'UTC'`;
    return tx<Array<{ n: number; fp: string }>>`
      SELECT count(*)::int AS n,
             md5(coalesce(string_agg(md5((to_jsonb(p) - 'payload_redacted')::text), ''
                                     ORDER BY p.request_identifier), '')) AS fp
      FROM parcels p WHERE p.job_id = ${jobId}`;
  });
  const r = rows[0];
  if (r === undefined) throw new Error("fingerprint: no result");
  return `${r.n}:${r.fp}`;
}

function valuesOf(
  jobId: string,
  rows: readonly BackfillRow[],
): { values: string; params: string[] } {
  const params: string[] = [jobId];
  const tuples = rows.map((r) => {
    params.push(r.id, r.sha, r.payload);
    const n = params.length;
    return `($${n - 2}::text, $${n - 1}::text, $${n}::text)`;
  });
  return { values: `(VALUES ${tuples.join(", ")}) v(id, sha, payload)`, params };
}

const checkSql = (values: string) =>
  `SELECT v.id, p.record_sha256 AS stored FROM ${values}
   LEFT JOIN parcels p ON p.request_identifier = v.id AND p.job_id = $1::text
   WHERE p.request_identifier IS NULL OR p.record_sha256 IS DISTINCT FROM v.sha LIMIT 5`;

const updateSql = (values: string) =>
  `UPDATE parcels p SET payload_redacted = v.payload::text::jsonb FROM ${values}
   WHERE p.request_identifier = v.id AND p.job_id = $1::text AND p.record_sha256 = v.sha
     AND p.payload_redacted IS DISTINCT FROM v.payload::text::jsonb
   RETURNING p.request_identifier`;

const wouldWriteSql = (values: string) =>
  `SELECT count(*)::int AS n FROM ${values}
   JOIN parcels p ON p.request_identifier = v.id AND p.job_id = $1::text
   WHERE p.payload_redacted IS DISTINCT FROM v.payload::text::jsonb`;

/**
 * One batch in one transaction: the record_sha256 check, then the guarded UPDATE (or, dry run,
 * the count of rows it would write). Returns the pIDs written (dry run: `wouldWrite`).
 */
export async function writeBatch(
  sql: postgres.Sql,
  jobId: string,
  rows: readonly BackfillRow[],
  dryRun: boolean,
): Promise<{ written: string[]; wouldWrite: number }> {
  const ids = new Set(rows.map((r) => r.id));
  if (ids.size !== rows.length) {
    throw new BackfillError(
      "duplicate_in_batch",
      "a batch holds the same pID twice (export has a duplicate pID)",
    );
  }
  const { values, params } = valuesOf(jobId, rows);
  return sql.begin(async (tx) => {
    const bad = await tx.unsafe<Array<{ id: string; stored: string | null }>>(
      checkSql(values),
      params,
    );
    if (bad.length > 0) {
      const which = bad.map(
        (b) => `${b.id} (${b.stored === null ? "no row for the job" : "stored differs"})`,
      );
      throw new BackfillError(
        "record_sha256_mismatch",
        `stored record_sha256 is not the computed one for pID ${which.join(", ")}; batch not written`,
      );
    }
    if (dryRun) {
      const n = await tx.unsafe<Array<{ n: number }>>(wouldWriteSql(values), params);
      return { written: [], wouldWrite: n[0]?.n ?? 0 };
    }
    const out = await tx.unsafe<Array<{ request_identifier: string }>>(updateSql(values), params);
    return { written: out.map((r) => r.request_identifier), wouldWrite: out.length };
  }) as Promise<{ written: string[]; wouldWrite: number }>;
}

// ---------- the run ----------

export interface BackfillOptions {
  sql: postgres.Sql;
  jobId: string;
  exportPath: string;
  receipt: { sha256: string; captured_at: string };
  /** null = every parcel of the job. */
  pids: string[] | null;
  checkpointPath: string;
  workers: number;
  writers: number;
  /** Rows per write batch (a batch is flushed at ≥ this many rows; whole worker chunks). */
  batch: number;
  dryRun: boolean;
  /** Records per worker message (default 200). */
  chunkRecords?: number;
  /** Progress line interval (default 10 s). */
  progressMs?: number;
  log?: (line: string) => void;
  /** Test hook: every batch after this many committed batches fails before writing. */
  failAfterBatches?: number;
  /** Test hook: the pIDs each committed batch wrote. */
  onWritten?: (ids: readonly string[]) => void;
  signal?: AbortSignal;
  records?: (path: string) => AsyncIterable<ExportRecordText>;
}

export interface BackfillResult {
  job_id: string;
  scope: string;
  dry_run: boolean;
  records_seen: number;
  skipped_below_checkpoint: number;
  dispatched: number;
  not_loaded: number;
  out_of_scope: number;
  in_scope_rows: number;
  written: number;
  skipped_already_correct: number;
  would_write: number | null;
  batches: number;
  checkpoint_low_water: number;
  computed_with_legal_key: number;
  db_rows_in_scope: number;
  db_rows_with_legal_key: number;
  /** Listed pIDs covered by no run (not seen now and not in the database); [] for a full run. */
  missing_pids: string[];
  fingerprint_before: string;
  fingerprint_after: string;
  fingerprint_equal: boolean;
  /** In-scope rows of every record ≤ the final mark, across resumes (must equal db_rows_in_scope). */
  rows_covered: number;
  seconds: number;
}

const WORKER_URL = new URL("./worker.ts", import.meta.url);

function startWorker(init: WorkerInit): Worker {
  // The worker is TypeScript: register tsx's loader in it (tsx and vitest runs alike).
  return new Worker(WORKER_URL, {
    workerData: init,
    execArgv: ["--import", import.meta.resolve("tsx")],
  });
}

export async function runBackfill(o: BackfillOptions): Promise<BackfillResult> {
  const started = Date.now();
  const log = o.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const chunkRecords = o.chunkRecords ?? 200;
  const scope = scopeKey(o.pids);
  const { sql, jobId, dryRun } = o;

  await verifyExport(o.exportPath, o.receipt.sha256);
  const ctx: ChunkContext = {
    jobId,
    asOf: await runAsOf(sql, jobId),
    exportSha256: o.receipt.sha256,
    capturedAt: o.receipt.captured_at,
  };

  // checkpoint (never read or written in a dry run) and the fingerprint before the first write
  let cp = dryRun ? null : readCheckpoint(o.checkpointPath);
  if (cp !== null) {
    const expect = {
      job_id: jobId,
      scope,
      pids_sha256: o.pids === null ? null : pidsSha256(o.pids),
      export_sha256: o.receipt.sha256,
    };
    for (const [k, v] of Object.entries(expect)) {
      if (cp[k as keyof Checkpoint] !== v) {
        throw new BackfillError(
          "checkpoint_mismatch",
          `checkpoint ${o.checkpointPath}: ${k} is not this run's`,
        );
      }
    }
    log(`[backfill] resuming from checkpoint low_water=${cp.low_water}`);
  }
  const fingerprintBefore = cp?.fingerprint ?? (await parcelsFingerprint(sql, jobId));
  if (!dryRun && cp === null) {
    const now = new Date().toISOString();
    cp = {
      version: 1,
      job_id: jobId,
      scope,
      pids_sha256: o.pids === null ? null : pidsSha256(o.pids),
      export_sha256: o.receipt.sha256,
      fingerprint: fingerprintBefore,
      low_water: -1,
      rows_below_low_water: 0,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };
    writeCheckpoint(o.checkpointPath, cp);
  }
  const startMark = cp?.low_water ?? -1;
  const mark = createLowWater(startMark, cp?.rows_below_low_water ?? 0);
  const saveMark = (): void => {
    if (cp === null) return;
    cp = {
      ...cp,
      low_water: mark.mark,
      rows_below_low_water: mark.rows,
      updated_at: new Date().toISOString(),
    };
    writeCheckpoint(o.checkpointPath, cp);
  };

  const r = {
    records_seen: 0,
    skipped_below_checkpoint: 0,
    dispatched: 0,
    not_loaded: 0,
    out_of_scope: 0,
    in_scope_rows: 0,
    written: 0,
    skipped_already_correct: 0,
    would_write: 0,
    batches: 0,
    computed_with_legal_key: 0,
  };
  const seenPids = o.pids === null ? null : new Set<string>();

  // pipeline state
  let fatal: Error | null = null;
  const fail = (e: unknown): void => {
    fatal ??= e instanceof Error ? e : new Error(String(e));
    wake();
  };
  let waiters: Array<() => void> = [];
  function wake(): void {
    const w = waiters;
    waiters = [];
    for (const f of w) f();
  }
  const until = async (cond: () => boolean): Promise<void> => {
    while (!cond()) await new Promise<void>((res) => waiters.push(res));
  };
  const onAbort = (): void => fail(new BackfillError("interrupted", "interrupted (signal)"));
  o.signal?.addEventListener("abort", onAbort);

  let inflightChunks = 0;
  let pendingBatches = 0;
  let activeWrites = 0;
  let committedBatches = 0;
  type Batch = { rows: BackfillRow[]; ranges: Array<[number, number, number]> };
  const writeQueue: Batch[] = [];
  let current: Batch = { rows: [], ranges: [] };
  const hasCapacity = (): boolean =>
    fatal !== null || (inflightChunks < o.workers * 2 && pendingBatches < o.writers * 2);

  const pump = (): void => {
    while (activeWrites < o.writers && writeQueue.length > 0) {
      const b = writeQueue.shift() as Batch;
      activeWrites += 1;
      void (async () => {
        try {
          if (fatal !== null) return; // never start a write after a failure
          if (o.failAfterBatches !== undefined && committedBatches >= o.failAfterBatches) {
            throw new BackfillError(
              "injected_failure",
              `injected failure after ${committedBatches} batches`,
            );
          }
          const out = await writeBatch(sql, jobId, b.rows, dryRun);
          committedBatches += 1;
          r.batches += 1;
          if (dryRun) {
            r.would_write += out.wouldWrite;
          } else {
            r.written += out.written.length;
            r.skipped_already_correct += b.rows.length - out.written.length;
            o.onWritten?.(out.written);
          }
          let advanced = false;
          for (const [lo, hi, n] of b.ranges) advanced = mark.complete(lo, hi, n) || advanced;
          if (advanced) saveMark();
        } catch (e) {
          fail(e);
        } finally {
          activeWrites -= 1;
          pendingBatches -= 1;
          pump();
          wake();
        }
      })();
    }
  };
  const flush = (): void => {
    if (current.rows.length === 0) return;
    writeQueue.push(current);
    current = { rows: [], ranges: [] };
    pendingBatches += 1;
    pump();
  };
  const onChunk = (out: ChunkOut): void => {
    r.not_loaded += out.notLoaded;
    r.out_of_scope += out.outOfScope;
    r.in_scope_rows += out.rows.length;
    for (const row of out.rows) {
      if (row.legal) r.computed_with_legal_key += 1;
      seenPids?.add(row.id);
    }
    if (out.rows.length === 0) {
      if (mark.complete(out.lo, out.hi, 0)) saveMark();
      return;
    }
    current.rows.push(...out.rows);
    current.ranges.push([out.lo, out.hi, out.rows.length]);
    if (current.rows.length >= o.batch) flush();
  };

  // workers
  const init: WorkerInit = { ctx, pids: o.pids };
  let terminating = false;
  const workers = Array.from({ length: o.workers }, () => {
    const w = startWorker(init);
    const state = { w, inflight: 0 };
    w.on("message", (reply: WorkerReply) => {
      state.inflight -= 1;
      inflightChunks -= 1;
      if (reply.ok) {
        if (fatal === null) onChunk(reply.out);
      } else {
        fail(new BackfillError("worker_failed", `${reply.error.name}: ${reply.error.message}`));
      }
      wake();
    });
    w.on("error", (e: unknown) =>
      fail(
        new BackfillError(
          "worker_failed",
          `worker error: ${e instanceof Error ? e.message : String(e)}`,
        ),
      ),
    );
    w.on("exit", (code) => {
      // terminate() exits a worker with code 1: only an exit we did not ask for is a failure
      if (!terminating && fatal === null) {
        fail(new BackfillError("worker_failed", `worker exited ${code}`));
      }
    });
    return state;
  });
  let seq = 0;
  const dispatch = async (records: ExportRecordText[]): Promise<void> => {
    await until(hasCapacity);
    if (fatal !== null) return;
    const target = workers.reduce((a, b) => (b.inflight < a.inflight ? b : a));
    const first = records[0] as ExportRecordText;
    const last = records[records.length - 1] as ExportRecordText;
    const msg: ChunkIn = { seq: seq++, lo: first.ordinal, hi: last.ordinal, records };
    target.inflight += 1;
    inflightChunks += 1;
    r.dispatched += records.length;
    target.w.postMessage(msg);
  };

  const progress = setInterval(() => {
    const s = (Date.now() - started) / 1000;
    log(
      `[backfill] records/s=${Math.round(r.records_seen / s)} seen=${r.records_seen} ` +
        `${dryRun ? `would_write=${r.would_write}` : `written=${r.written}`} ` +
        `skipped_already_correct=${r.skipped_already_correct} checkpoint=${mark.mark}`,
    );
  }, o.progressMs ?? 10_000);
  progress.unref();

  let lastOrdinal = -1;
  try {
    let buf: ExportRecordText[] = [];
    for await (const rec of (o.records ?? streamExportRecords)(o.exportPath)) {
      if (fatal !== null) break;
      r.records_seen += 1;
      lastOrdinal = rec.ordinal;
      if (rec.ordinal <= startMark) {
        r.skipped_below_checkpoint += 1;
        continue;
      }
      buf.push(rec);
      if (buf.length >= chunkRecords) {
        await dispatch(buf);
        buf = [];
      }
    }
    if (buf.length > 0 && fatal === null) await dispatch(buf);
    await until(() => fatal !== null || inflightChunks === 0);
    if (fatal === null) flush();
    // settle every write already started, so the checkpoint reflects what committed
    await until(() => pendingBatches === 0);
  } finally {
    clearInterval(progress);
    o.signal?.removeEventListener("abort", onAbort);
    terminating = true;
    await Promise.all(workers.map((w) => w.w.terminate()));
  }
  if (fatal !== null) throw fatal;
  if (mark.mark !== lastOrdinal) {
    throw new BackfillError(
      "incomplete",
      `low-water mark ${mark.mark} is not the last record ${lastOrdinal}`,
    );
  }
  if (cp !== null) {
    cp = { ...cp, completed_at: new Date().toISOString() };
    writeCheckpoint(o.checkpointPath, cp);
  }

  const fingerprintAfter = await parcelsFingerprint(sql, jobId);
  const scoped =
    o.pids === null
      ? await sql<Array<{ n: number; legal: number }>>`
          SELECT count(*)::int AS n, count(*) FILTER (WHERE payload_redacted ? 'propertyLegalDescription')::int AS legal
          FROM parcels WHERE job_id = ${jobId}`
      : await sql<Array<{ n: number; legal: number }>>`
          SELECT count(*)::int AS n, count(*) FILTER (WHERE payload_redacted ? 'propertyLegalDescription')::int AS legal
          FROM parcels WHERE job_id = ${jobId} AND request_identifier IN ${sql(o.pids)}`;
  let missingPids: string[] = [];
  if (o.pids !== null) {
    const unseen = o.pids.filter((p) => !(seenPids as Set<string>).has(p));
    const present =
      unseen.length === 0
        ? []
        : await sql<Array<{ id: string }>>`
            SELECT request_identifier AS id FROM parcels
            WHERE job_id = ${jobId} AND request_identifier IN ${sql(unseen)}`;
    missingPids = uncoveredPids(o.pids, seenPids as Set<string>, new Set(present.map((x) => x.id)));
  }
  const result: BackfillResult = {
    job_id: jobId,
    scope,
    dry_run: dryRun,
    ...r,
    would_write: dryRun ? r.would_write : null,
    checkpoint_low_water: mark.mark,
    db_rows_in_scope: scoped[0]?.n ?? 0,
    db_rows_with_legal_key: scoped[0]?.legal ?? 0,
    missing_pids: missingPids,
    fingerprint_before: fingerprintBefore,
    fingerprint_after: fingerprintAfter,
    fingerprint_equal: fingerprintBefore === fingerprintAfter,
    rows_covered: mark.rows,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  if (!result.fingerprint_equal) {
    throw Object.assign(
      new BackfillError(
        "fingerprint_changed",
        `parcels columns other than payload_redacted changed: ${fingerprintBefore} → ${fingerprintAfter}`,
      ),
      { result },
    );
  }
  if (result.rows_covered !== result.db_rows_in_scope) {
    throw Object.assign(
      new BackfillError(
        "incomplete",
        `the export covered ${result.rows_covered} rows but the job has ${result.db_rows_in_scope} in scope`,
      ),
      { result },
    );
  }
  return result;
}
