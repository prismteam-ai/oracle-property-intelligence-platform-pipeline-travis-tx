// A-04 T008: the Loader, the ONE writer into the internal Query DB (query-db-loading-matching
// "single writer"; durable-workflow-builder pattern 8, rule 3). Never a public source.
//
// - Virtual object `Loader`, key `travis`: Restate runs one handler per key at a time, so every
//   track's merges are serialized; a transaction-scoped advisory lock also guards a second
//   process.
// - Plug-ins: every `services/tracks/*.ts` exporting `track: LoaderTrack` (contracts/seams.md).
//   A track only writes through the transaction it is handed; it never opens its own.
// - Idempotent: a merge whose (track, artifact_sha256) is already in loader_merges writes 0
//   rows. Rows, watermark, tombstones and the loader_merges row commit in ONE transaction, so
//   a thrown merge leaves none of them.
// - Timeouts raised for multi-minute COPYs: inactivity 30 min, abort 60 min.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type * as Restate from "@restatedev/restate-sdk";
import { basename } from "node:path";
import postgres from "postgres";
import { z } from "zod";
import { RunDataError } from "../../oracle-runtime/travis/backbone/errors.js";
import { DiskGuardError } from "../../oracle-runtime/travis/backbone/disk-guard.js";
import { UnknownKeyError } from "../../oracle-runtime/travis/tcad/key-inventory.js";

export const LOADER_KEY = "travis";
export const TRACKS_DIR = fileURLToPath(new URL("./tracks/", import.meta.url));
const LOADER_LOCK = 4_040_001;

/** Fields every track input carries. Tracks extend it. */
export const LoaderInputBase = z.object({
  jobId: z.string().regex(/^travis-a04-[a-z0-9-]+$/),
  artifactPath: z.string().min(1),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type LoaderInput = z.infer<typeof LoaderInputBase>;

/** The FR-025 partial unique index: one ingest run (full, backfill, incremental) at a time. */
export const ONE_INGEST_INDEX = "backbone_runs_one_ingest_running";
/** A merge that keeps failing with a transient error is retried this many times, then fails. */
export const MERGE_MAX_RETRIES = 5;

/** A deterministic merge failure (a sha mismatch, a malformed artifact): retrying cannot help. */
export class MergeDataError extends Error {
  override name = "MergeDataError";
}

/**
 * The refusal message for an error a retry cannot fix, or null for a transient one. Covers
 * Postgres SQLSTATE class 22 (data), 23 (integrity incl. the FR-025 index) and 42 (syntax or
 * schema), zod errors, sha mismatches, missing files, unknown export keys and the disk guard.
 * Never quotes a row: Postgres messages and details can contain record values.
 */
export function deterministicFailure(error: unknown): string | null {
  if (
    error instanceof MergeDataError ||
    error instanceof RunDataError ||
    error instanceof DiskGuardError ||
    error instanceof UnknownKeyError
  ) {
    return error.message;
  }
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return `invalid input${issue === undefined ? "" : `: ${issue.path.join(".")} ${issue.message}`}`;
  }
  if (typeof error === "object" && error !== null) {
    const e = error as { code?: unknown; constraint_name?: unknown; path?: unknown };
    if (e.code === "ENOENT") {
      return `required file is missing${typeof e.path === "string" ? ` (${basename(e.path)})` : ""}`;
    }
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) {
      const constraint = typeof e.constraint_name === "string" ? e.constraint_name : null;
      if (e.code === "23505" && constraint === ONE_INGEST_INDEX) {
        return "refused: another ingest run is already running (FR-025); finish or fail it before starting this one";
      }
      if (["22", "23", "42"].includes(e.code.slice(0, 2))) {
        return `Query DB rejected the write (SQLSTATE ${e.code}${constraint === null ? "" : `, constraint ${constraint}`})`;
      }
    }
  }
  return null;
}

/**
 * The TerminalError for an error Restate would otherwise retry forever: the error itself when
 * it already is one, a new one for a deterministic failure, null for a transient error.
 */
export function asTerminal(restateSdk: typeof Restate, error: unknown): Restate.TerminalError | null {
  if (error instanceof restateSdk.TerminalError) return error;
  const message = deterministicFailure(error);
  return message === null ? null : new restateSdk.TerminalError(message);
}

/** runMerge, with a deterministic failure turned into a TerminalError (Restate stops retrying). */
export async function runMergeOrTerminal(
  restateSdk: typeof Restate,
  sql: postgres.Sql,
  track: LoaderTrack,
  raw: unknown,
): Promise<MergeResult> {
  try {
    return await runMerge(sql, track, raw);
  } catch (error) {
    const message = deterministicFailure(error);
    if (message !== null) throw new restateSdk.TerminalError(message);
    throw error;
  }
}

// A-07 T017 (Track A) adds "comptroller": the shared Comptroller registry load.
// A-07 T056 (Track D) adds "reconcile": the property/owner/contractor merge (travis/reconcile/merge.ts).
export type TrackName = "tcad" | "gis" | "permits" | "comptroller" | "reconcile";

export interface MergeOutcome {
  rowsWritten: number;
  /** Written to `watermarks` (PK track, source_key) in the same transaction as the rows. */
  watermark?: { sourceKey: string; value: Record<string, unknown> };
  /** Tombstones the track wrote in this transaction (count only). */
  tombstones?: number;
}

export interface LoaderTrack<I extends LoaderInput = LoaderInput> {
  name: TrackName;
  input: z.ZodType<I>;
  merge(tx: postgres.TransactionSql, input: I): Promise<MergeOutcome>;
}

export interface MergeResult {
  track: TrackName;
  artifactSha256: string;
  skipped: boolean;
  rowsWritten: number;
  tombstones: number;
}

function isTrack(value: unknown): value is LoaderTrack {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Partial<LoaderTrack>;
  return typeof t.name === "string" && typeof t.merge === "function" && t.input !== undefined;
}

/** Imports every `<dir>/*.ts` that exports `track`; a missing directory gives no tracks. */
export async function loadTracks(dir: string = TRACKS_DIR): Promise<Map<string, LoaderTrack>> {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".ts") && !n.endsWith(".d.ts")).sort();
  } catch {
    return new Map();
  }
  const tracks = new Map<string, LoaderTrack>();
  for (const name of names) {
    const mod = (await import(pathToFileURL(join(dir, name)).href)) as { track?: unknown };
    if (!isTrack(mod.track)) continue;
    if (tracks.has(mod.track.name)) throw new Error(`loader: duplicate track ${mod.track.name}`);
    tracks.set(mod.track.name, mod.track);
  }
  return tracks;
}

/** One idempotent merge in ONE transaction (exported for tests; the handler calls it). */
export async function runMerge(
  sql: postgres.Sql,
  track: LoaderTrack,
  raw: unknown,
): Promise<MergeResult> {
  const input = track.input.parse(raw);
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${LOADER_LOCK})`;
    const seen = await tx`
      SELECT 1 FROM loader_merges WHERE track = ${track.name} AND artifact_sha256 = ${input.artifactSha256}`;
    if (seen.length > 0) {
      return {
        track: track.name,
        artifactSha256: input.artifactSha256,
        skipped: true,
        rowsWritten: 0,
        tombstones: 0,
      };
    }
    const out = await track.merge(tx, input);
    if (out.watermark !== undefined) {
      await tx`
        INSERT INTO watermarks (track, source_key, value, job_id)
        VALUES (${track.name}, ${out.watermark.sourceKey}, ${tx.json(out.watermark.value as postgres.JSONValue)}, ${input.jobId})
        ON CONFLICT (track, source_key)
        DO UPDATE SET value = EXCLUDED.value, job_id = EXCLUDED.job_id, updated_at = now()`;
    }
    await tx`
      INSERT INTO loader_merges (track, artifact_path, artifact_sha256, job_id, rows_written)
      VALUES (${track.name}, ${input.artifactPath}, ${input.artifactSha256}, ${input.jobId}, ${out.rowsWritten})`;
    return {
      track: track.name,
      artifactSha256: input.artifactSha256,
      skipped: false,
      rowsWritten: out.rowsWritten,
      tombstones: out.tombstones ?? 0,
    };
  }) as Promise<MergeResult>;
}

/**
 * The direct Query DB connection, opened on first use from DATABASE_URL (never logged). Only
 * the Loader, the read-only report and migrate hold a client (grep gate, TC-NF-02).
 */
export function lazyQueryDb(env: Readonly<Record<string, string | undefined>> = process.env): () => postgres.Sql {
  let db: postgres.Sql | null = null;
  return () => {
    if (db !== null) return db;
    const url = env.DATABASE_URL;
    if (url === undefined || url.trim() === "") throw new QueryDbConfigError("DATABASE_URL is not set");
    db = postgres(url, { max: 4, onnotice: () => {} });
    return db;
  };
}

export class QueryDbConfigError extends Error {
  override name = "QueryDbConfigError";
}

export interface LoaderDeps {
  tracks: ReadonlyMap<string, LoaderTrack>;
  /** The direct Query DB connection (bulk writes, locks); created lazily by app.ts. */
  sql: () => postgres.Sql;
}

/**
 * Marks a still-`running` run `failed` with finished_at. waiting_human, blocked, complete and
 * failed rows are left alone, so a human wait or a refused source keeps its status.
 */
export async function failRun(sql: postgres.Sql, jobId: string): Promise<{ failed: boolean }> {
  const rows = await sql<Array<{ job_id: string }>>`
    UPDATE backbone_runs SET status = 'failed', finished_at = now()
    WHERE job_id = ${jobId} AND status = 'running'
    RETURNING job_id`;
  return { failed: rows.length > 0 };
}

const FailRunRequest = z.object({ jobId: z.string().regex(/^travis-a04-[a-z0-9-]+$/) });

/**
 * Runs a workflow body; when it ends in a terminal failure (a TerminalError, which Restate does
 * not retry) the run row is closed as failed and the error is rethrown unchanged. A transient
 * error is retried by Restate, so it is not a failure.
 *
 * With `direct` (the lazy Query DB connection) the row is closed by one bounded UPDATE in a
 * plain ctx.run, so it works even while the exclusive Loader key is busy or its merge is stuck
 * (OR-M1). Without it the Loader's failRun handler is called (it queues behind a merge).
 */
export async function failRunOnTerminal<T>(
  restateSdk: typeof Restate,
  ctx: Restate.WorkflowContext,
  jobId: string | null,
  work: () => Promise<T>,
  direct?: () => postgres.Sql,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (jobId !== null && error instanceof restateSdk.TerminalError) {
      if (direct === undefined) {
        await ctx
          .objectClient<ReturnType<typeof createLoader>>(
            { name: "Loader" } as ReturnType<typeof createLoader>,
            LOADER_KEY,
          )
          .failRun({ jobId });
      } else {
        try {
          await ctx.run(`fail-run-${jobId}`, () => failRun(direct(), jobId), {
            maxRetryAttempts: MERGE_MAX_RETRIES,
          });
        } catch {
          // The original failure is the one to report; the run row is closed by `backbone` or
          // the next start when the database is down.
        }
      }
    }
    throw error;
  }
}

export const MergeRequest = z.object({ track: z.string(), input: z.unknown() });

export function createLoader(restate: typeof Restate, deps: LoaderDeps) {
  return restate.object({
    name: "Loader",
    handlers: {
      merge: async (ctx: Restate.ObjectContext, req: unknown): Promise<MergeResult> => {
        if (ctx.key !== LOADER_KEY) {
          throw new restate.TerminalError(`Loader key must be ${LOADER_KEY}`);
        }
        const parsed = MergeRequest.safeParse(req);
        if (!parsed.success) throw new restate.TerminalError("Loader.merge: {track, input} required");
        const track = deps.tracks.get(parsed.data.track);
        if (track === undefined) {
          throw new restate.TerminalError(`Loader.merge: unknown track ${parsed.data.track}`);
        }
        const input = track.input.safeParse(parsed.data.input);
        if (!input.success) {
          throw new restate.TerminalError(`Loader.merge: invalid ${track.name} input`);
        }
        let sql: postgres.Sql;
        try {
          sql = deps.sql();
        } catch (error) {
          if (error instanceof QueryDbConfigError) throw new restate.TerminalError(error.message);
          throw error;
        }
        return ctx.run(
          `merge-${track.name}-${input.data.artifactSha256.slice(0, 12)}`,
          () => runMergeOrTerminal(restate, sql, track, input.data),
          { maxRetryAttempts: MERGE_MAX_RETRIES, initialRetryInterval: { seconds: 2 } },
        );
      },
      failRun: async (ctx: Restate.ObjectContext, req: unknown): Promise<{ failed: boolean }> => {
        if (ctx.key !== LOADER_KEY) {
          throw new restate.TerminalError(`Loader key must be ${LOADER_KEY}`);
        }
        const parsed = FailRunRequest.safeParse(req);
        if (!parsed.success) throw new restate.TerminalError("Loader.failRun: {jobId} required");
        let sql: postgres.Sql;
        try {
          sql = deps.sql();
        } catch (error) {
          if (error instanceof QueryDbConfigError) throw new restate.TerminalError(error.message);
          throw error;
        }
        return ctx.run(`fail-${parsed.data.jobId}`, () => failRun(sql, parsed.data.jobId), {
          maxRetryAttempts: MERGE_MAX_RETRIES,
        });
      },
    },
    options: {
      inactivityTimeout: { minutes: 30 },
      abortTimeout: { minutes: 60 },
    },
  });
}
