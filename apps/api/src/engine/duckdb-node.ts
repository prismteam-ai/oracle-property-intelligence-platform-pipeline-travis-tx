// A-03 T072 (G-C2a): the Lambda's DuckDB engine behind the query-core QueryEngine interface
// (research R-03, ADR-0001 Lambda sizing, ERR-18). One instance per sandbox (`threads = 4`, bundled httpfs
// through `extension_directory`, remote autoinstall / autoload off). The contract views are bound
// once per manifest CID through `bindManifest`, every table part read over a presigned in-region
// `ipfs/<cid>` GET URL (s3-read.ts), and re-bound after BIND_TTL_MS so a warm sandbox never
// holds a view over an expired signature. `timedQuery` / `query` run one read-only statement and
// cap the result at MAX_ROWS (AD-21). Observability (T073) hooks in through `setQueryObserver`,
// so the `duckdb.query` subsegment wraps exactly the engine call and sees the builder name and the
// manifest CID, never the SQL text or a row (FR-007).
// ERR-19 (NFR-004 cold start < 3 s): a cold bind created a view over every emitted table (23 for
// the published run), each costing two sequential range requests (HEAD + footer) over its
// presigned URL: ≈ 46 round trips, 4.7–5.6 s in the hosted trace. A bind now covers only the
// contract views the query reads (query-core `viewsReadBy` / bindManifest `views`), and every
// part of those tables that fits one raw chunk is fetched once, in parallel, over the S3 SDK,
// verified by CID and bound as a local /tmp file (`localPart`); larger parts keep the presigned
// range reads. A later query that needs more views re-binds the same run with both view sets.
// Binds and queries take turns on the one connection (`exclusive`), so a re-bind never drops a
// view under a running query.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunManifestV1 } from "@countylens/contract";
import {
  CONTRACT_VIEWS,
  MAX_ROWS,
  bindManifest,
  boundPartNames,
  type BoundRun,
  type ContractView,
  type QueryEngine,
  type Row,
} from "@countylens/query-core";
import {
  PRESIGN_EXPIRES_S,
  getIndexObject,
  getManifest,
  localPart,
  presignPart,
} from "./s3-read.js";
import { openDuckDb, type DuckDbEngine } from "./duckdb-instance.js";
import { getEngineConfig } from "./engine-config.js";
import {
  IndexUnavailableError,
  boundFromIndex,
  indexViewsSql,
  loadIndexOnce,
  type IndexStoreDeps,
  type LoadedIndex,
} from "./explore-index.js";

/** ERR-18 (AM-06 sizing update for the PO; ADR-0001 sized 2 threads at 1,769 MB): four threads
 *  at 3,008 MB (2 vCPU). The cold read is latency-bound range GETs, which DuckDB issues per
 *  thread, so more threads mean more requests in flight; compute stays ≤ 175 ms. */
export const DUCKDB_THREADS = 4;
/** DuckDB's own cap. A-16 AC-13: queries read the per-run index (about 48 MB of Parquet), so
 *  1 GB is ample and stays under the 1,769 MB Lambda with headroom for Node and the runtime. */
export const DUCKDB_MEMORY_LIMIT = "1GB";
/** Overrides the extension directory (tests, local runs); the Lambda uses the bundled default. */
export const EXTENSION_DIRECTORY_ENV = "DUCKDB_EXTENSION_DIRECTORY";
/** Where the CDK Api stack (T074) copies httpfs: `<task root>/duckdb-extensions/<version>/<platform>/`. */
export const EXTENSION_DIRECTORY_NAME = "duckdb-extensions";
/** A bound run is reused this long: well inside PRESIGN_EXPIRES_S, so no view outlives its URLs. */
export const BIND_TTL_MS = 30 * 60 * 1000;

/** ERR-19: parts up to one raw-leaves chunk (verifiable by `rawCid`) are fetched whole into /tmp;
 *  larger ones are range-read over presigned URLs. */
export const PREFETCH_MAX_PART_BYTES = 262_144;

/** A-16 AC-13: a run with no Explore index is bound per request only while the parts its views
 *  read stay at or under this many bytes (the small permit runs); a full-county run needs its
 *  index (`index_not_built` otherwise) and never attempts the 29 s whole-county join again. */
export const SMALL_RUN_MAX_BYTES = 16 * 1024 * 1024;

if (BIND_TTL_MS >= PRESIGN_EXPIRES_S * 1000) {
  throw new Error("BIND_TTL_MS must be shorter than the presigned URL lifetime");
}

export type Env = Readonly<Record<string, string | undefined>>;

/** `DUCKDB_EXTENSION_DIRECTORY`, else the bundled directory beside the handler. */
export function extensionDirectory(env: Env = process.env): string {
  return (
    env[EXTENSION_DIRECTORY_ENV] ??
    join(env["LAMBDA_TASK_ROOT"] ?? process.cwd(), EXTENSION_DIRECTORY_NAME)
  );
}

let engine: Promise<DuckDbEngine> | undefined;

/** The query-core engine over the module-scope DuckDB instance (created on first use). */
export function getEngine(): Promise<QueryEngine> {
  engine ??= openDuckDb({
    threads: DUCKDB_THREADS,
    memoryLimit: DUCKDB_MEMORY_LIMIT,
    extensionDirectory: extensionDirectory(),
    tempDirectory: join(tmpdir(), "countylens-duckdb"),
    httpfs: true,
    cacheRemoteReads: true, // ERR-18: a warm sandbox re-reads no footer or chunk it already holds
  }).catch((error: unknown) => {
    engine = undefined; // a failed open is not kept; the next request tries again
    throw error;
  });
  return engine;
}

/** Interrupts the statement running on the sandbox engine, if any (a deadline expired). The
 *  interrupted call rejects and the next queued bind or query runs. */
export function interruptQueries(): void {
  void engine?.then((db) => db.interrupt?.()).catch(() => undefined);
}

let turn: Promise<unknown> = Promise.resolve();

/** Runs `work` after every earlier bind or query on the engine has settled (one at a time). */
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const run = turn.then(work, work);
  turn = run.catch(() => undefined);
  return run;
}

interface BoundState {
  readonly cid: string;
  readonly boundAt: number;
  readonly views: readonly ContractView[];
  readonly run: Promise<BoundRun>;
}

let bound: BoundState | undefined;

let indexDeps: IndexStoreDeps | undefined;

/** The index store over the CID-copy bucket (EXPLORE_INDEX_PREFIX); tests replace it. */
function indexStore(): IndexStoreDeps {
  if (indexDeps !== undefined) return indexDeps;
  let prefix: string | undefined;
  try {
    prefix = getEngineConfig().exploreIndexPrefix;
  } catch {
    // An invalid or missing engine env fails getManifest with the key's name just below.
    prefix = undefined;
  }
  indexDeps = { prefix, getObject: getIndexObject };
  return indexDeps;
}

/** Tests only: replace (or with `undefined`, restore) the index store. */
export function setIndexStore(next: IndexStoreDeps | undefined): void {
  indexDeps = next;
}

/** Index headers of the runs bound from an index in this sandbox (owner-area lookups). */
const indexHeaders = new Map<string, LoadedIndex["header"]>();

async function bind(manifestCid: string, views: readonly ContractView[]): Promise<BoundRun> {
  // A-16 AC-13: a run with an Explore index is served from it (all four views at once).
  const index = await loadIndexOnce(manifestCid, indexStore());
  if (index !== undefined) {
    const db = await getEngine();
    return exclusive(async () => {
      await db.run(indexViewsSql(index.dir));
      indexHeaders.set(manifestCid, index.header);
      return boundFromIndex(index.header);
    });
  }
  // NOT_FOUND and the CID mismatch are raised here, before any engine work.
  const bytes = await getManifest(manifestCid);
  const manifest = RunManifestV1.parse(JSON.parse(new TextDecoder().decode(bytes)));
  // Exactly the parts bindManifest reads for these views, by query-core's own batch rule (a
  // full-county run names parts `<run>/…/tables/<bNN>/<table>/<part>`, not `tables/<group>/…`).
  const needed = new Set(boundPartNames(manifest.artifacts, views));
  const parts = manifest.artifacts.filter((a) => a.kind === "table" && needed.has(a.name));
  // A full-county run without an index: refuse, never the whole-county join in the request.
  const neededBytes = parts.reduce((sum, p) => sum + p.size, 0);
  if (neededBytes > SMALL_RUN_MAX_BYTES)
    throw new IndexUnavailableError(
      "index_not_built",
      manifestCid,
      `${neededBytes} bytes of parts`,
    );
  // In parallel: one GetObject per small part (verified, cached in /tmp), a local presign else.
  const urls = new Map(
    await Promise.all(
      parts.map(async (p): Promise<[string, string]> => [
        p.cid,
        p.codec === "raw" && p.size <= PREFETCH_MAX_PART_BYTES
          ? await localPart(p.cid)
          : await presignPart(p.cid),
      ]),
    ),
  );
  const db = await getEngine();
  return exclusive(() =>
    bindManifest(bytes, "", db, {
      views,
      partUrl: ({ cid }) => {
        const url = urls.get(cid);
        if (url === undefined) throw new Error(`bind: no URL for part ${cid}`);
        return url;
      },
    }),
  );
}

/**
 * Binds the views `views` read (default: all four) to `manifestCid` once per sandbox. A repeat
 * call is a no-op until BIND_TTL_MS has passed, another CID is requested, or a view outside the
 * bound set is asked for; then the run is re-bound with the bound views plus the new ones.
 */
export function bindOnce(
  manifestCid: string,
  views: readonly ContractView[] = CONTRACT_VIEWS,
): Promise<BoundRun> {
  const now = Date.now();
  const current =
    bound !== undefined && bound.cid === manifestCid && now - bound.boundAt < BIND_TTL_MS
      ? bound
      : undefined;
  if (current !== undefined && views.every((v) => current.views.includes(v))) return current.run;
  const wanted = CONTRACT_VIEWS.filter(
    (v) => views.includes(v) || (current?.views.includes(v) ?? false),
  );
  const run: Promise<BoundRun> = bind(manifestCid, wanted).then(
    (result) => {
      // An index bind creates all four views at once: later calls need no re-bind.
      if (bound?.run === run) bound = { ...bound, views: result.views };
      return result;
    },
    (error: unknown) => {
      if (bound?.run === run) bound = undefined; // a failed bind is not kept
      throw error;
    },
  );
  bound = { cid: manifestCid, boundAt: now, views: wanted, run };
  return run;
}

const ownerAreaKnown = new Map<string, boolean>();

/**
 * Whether run `manifestCid` publishes the owner's area at all (any `owner_area_class` other than
 * unknown): from the index header when the run is served from an index, else one cached count.
 * Runs 2 and 3 publish none (no owner mailing ZIP in the export), so the out-of-area filter is an
 * honest "owner area not published in this run", not an empty search.
 */
export async function ownerAreaPublished(manifestCid: string): Promise<boolean> {
  const cached = ownerAreaKnown.get(manifestCid);
  if (cached !== undefined) return cached;
  await bindOnce(manifestCid, ["v_property"]);
  const fromHeader = indexHeaders.get(manifestCid)?.ownerArea?.published;
  const published =
    fromHeader ??
    Number(
      (
        await query(
          "SELECT count(*) AS n FROM v_property WHERE owner_area_class IS NOT NULL AND owner_area_class <> 'unknown'",
          { name: "ownerAreaPublished", manifestCid },
        )
      )[0]?.["n"] ?? 0,
    ) > 0;
  ownerAreaKnown.set(manifestCid, published);
  return published;
}

/** Tests only: forget the per-run owner-area answers and index headers. */
export function resetOwnerAreaCache(): void {
  ownerAreaKnown.clear();
  indexHeaders.clear();
}

export interface QueryMeta {
  /** The query-core builder name (`runSummarySql`, `radiusSql`, …), never SQL text. */
  readonly name: string;
  readonly manifestCid?: string;
}

/** Wraps every engine call (T073: the `duckdb.query` subsegment with its annotations). */
export type QueryObserver = <T>(meta: QueryMeta, run: () => Promise<T>) => Promise<T>;

let observer: QueryObserver | undefined;

export function setQueryObserver(next: QueryObserver | undefined): void {
  observer = next;
}

export interface TimedRows {
  readonly rows: Row[];
  /** Milliseconds spent in the engine call only (binding and engine init excluded). */
  readonly queryDurationMs: number;
}

const READ_ONLY = /^\s*(?:SELECT|WITH)\b/i;

/** Runs one read-only statement against the bound views, timed, ≤ MAX_ROWS rows. */
export async function timedQuery(
  sql: string,
  meta: QueryMeta = { name: "query" },
): Promise<TimedRows> {
  if (!READ_ONLY.test(sql) || /;\s*\S/.test(sql)) {
    throw new Error("timedQuery: one SELECT statement only");
  }
  const db = await getEngine();
  const run = async (): Promise<TimedRows> => {
    const started = performance.now();
    const rows = await db.all(sql);
    const queryDurationMs = Math.round((performance.now() - started) * 1000) / 1000;
    return { rows: rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows, queryDurationMs };
  };
  return exclusive(() => (observer === undefined ? run() : observer(meta, run)));
}

/** Runs one read-only statement against the bound views (≤ 1,000 rows). */
export async function query(sql: string, meta?: QueryMeta): Promise<Row[]> {
  return (await timedQuery(sql, meta)).rows;
}
