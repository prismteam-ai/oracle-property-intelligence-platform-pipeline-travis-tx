// A-16 T012 (AC-13, ADR-0001 Amendment 1): the Lambda reader of the per-run Explore index built by
// pipeline/publish/scripts/build-explore-index.ts. For a manifest CID it reads
// `<EXPLORE_INDEX_PREFIX><cid>/index.json` from the CID-copy bucket, refuses an index whose schema,
// manifest CID or view-SQL hash is not this build's (`index_stale`), downloads the four view files
// to /tmp (each SHA-256-checked against index.json, atomic rename) and returns the SQL that points
// the contract views at them (`read_parquet`). One load per CID per sandbox is in flight at a time
// and a failed load is not kept. A run with no index answers `index_not_built` when it is too big
// to bind per request (duckdb-node.ts), never by attempting the whole-county join again.
//
// This mirrors (does not import) the publisher's IndexDescriptor: apps/api never depends on
// pipeline/publish. Only the fields the reader needs are checked; the rest pass through.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { CidV1 } from "@countylens/contract";
import {
  CONTRACT_VIEWS,
  VIEWS_SQL,
  type BoundRun,
  type ContractView,
} from "@countylens/query-core";

export const EXPLORE_INDEX_SCHEMA = "countylens-explore-index.v1";
/** /tmp directory holding one sub-directory per manifest CID. */
export const INDEX_CACHE_DIR = "countylens-index";

export const INDEX_REASONS = ["index_not_built", "index_stale"] as const;
export type IndexReason = (typeof INDEX_REASONS)[number];

/** Plain sentences per reason (the reason code is appended so a client can match on it). */
export const INDEX_MESSAGES: Readonly<Record<IndexReason, string>> = {
  index_not_built: "Search index for this run is not built yet (index_not_built)",
  index_stale: "Search index for this run is out of date and must be rebuilt (index_stale)",
};

/** The run cannot be served from an index: not built, or built from other view SQL / run. */
export class IndexUnavailableError extends Error {
  override readonly name = "IndexUnavailableError";
  constructor(
    readonly reason: IndexReason,
    readonly manifestCid: string,
    readonly detail?: string,
  ) {
    super(INDEX_MESSAGES[reason]);
  }
}

export function isIndexUnavailable(error: unknown): error is IndexUnavailableError {
  return error instanceof IndexUnavailableError;
}

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const IndexFileHeader = z.looseObject({
  key: z.string(),
  sha256: Sha256,
  bytes: z.number(),
  rows: z.number(),
});

export const IndexHeader = z.looseObject({
  schema: z.string(),
  manifestCid: CidV1,
  runId: z.string().min(1),
  asOf: z.string().min(1),
  viewsSha256: Sha256,
  files: z.object({
    v_property: IndexFileHeader,
    v_roofing_permit: IndexFileHeader,
    v_contractor: IndexFileHeader,
    v_run: IndexFileHeader,
  }),
  ownerArea: z.looseObject({ knownRows: z.number(), published: z.boolean() }).optional(),
  permitCounts: z.record(z.string(), z.number()).optional(),
});
export type IndexHeader = z.infer<typeof IndexHeader>;

/** SHA-256 of the view SQL this build serves; an index built from other SQL is stale. */
export const VIEWS_SHA256 = createHash("sha256").update(VIEWS_SQL, "utf8").digest("hex");

export interface LoadedIndex {
  readonly header: IndexHeader;
  /** Local directory with `<view>.parquet` for the four views. */
  readonly dir: string;
}

export interface IndexStoreDeps {
  /** `EXPLORE_INDEX_PREFIX`; undefined = no index configured. */
  readonly prefix: string | undefined;
  /** The object's bytes, or undefined when absent. */
  readonly getObject: (key: string) => Promise<Uint8Array | undefined>;
  /** Defaults to `<os tmpdir>/countylens-index`. */
  readonly cacheDir?: string;
}

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** `<prefix><cid>/<name>`. */
export function indexKey(prefix: string, manifestCid: string, name: string): string {
  return `${prefix}${CidV1.parse(manifestCid)}/${name}`;
}

/** Validates a parsed index.json against this build and the requested run. */
export function checkHeader(raw: unknown, manifestCid: string): IndexHeader {
  const parsed = IndexHeader.safeParse(raw);
  if (!parsed.success)
    throw new IndexUnavailableError("index_stale", manifestCid, "index.json does not parse");
  const h = parsed.data;
  if (h.schema !== EXPLORE_INDEX_SCHEMA)
    throw new IndexUnavailableError("index_stale", manifestCid, `schema ${h.schema}`);
  if (h.manifestCid !== manifestCid)
    throw new IndexUnavailableError(
      "index_stale",
      manifestCid,
      `index.json names ${h.manifestCid}`,
    );
  if (h.viewsSha256 !== VIEWS_SHA256)
    throw new IndexUnavailableError("index_stale", manifestCid, "built from other view SQL");
  return h;
}

async function verifiedLocal(file: string, sha256: string): Promise<boolean> {
  try {
    return sha256Hex(new Uint8Array(await readFile(file))) === sha256;
  } catch {
    return false;
  }
}

/** Loads the index of `manifestCid`, or undefined when none is configured or built. */
export async function loadIndex(
  manifestCid: string,
  deps: IndexStoreDeps,
): Promise<LoadedIndex | undefined> {
  if (deps.prefix === undefined) return undefined;
  const json = await deps.getObject(indexKey(deps.prefix, manifestCid, "index.json"));
  if (json === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new IndexUnavailableError("index_stale", manifestCid, "index.json is not JSON");
  }
  const header = checkHeader(raw, manifestCid);
  const dir = join(deps.cacheDir ?? join(tmpdir(), INDEX_CACHE_DIR), manifestCid);
  await mkdir(dir, { recursive: true });
  await Promise.all(
    CONTRACT_VIEWS.map(async (view) => {
      const file = join(dir, `${view}.parquet`);
      const want = header.files[view].sha256;
      if (await verifiedLocal(file, want)) return;
      const key = indexKey(deps.prefix as string, manifestCid, `${view}.parquet`);
      const bytes = await deps.getObject(key);
      if (bytes === undefined)
        throw new IndexUnavailableError("index_not_built", manifestCid, `${view}.parquet missing`);
      if (sha256Hex(bytes) !== want)
        throw new IndexUnavailableError(
          "index_stale",
          manifestCid,
          `${view}.parquet sha256 differs from index.json`,
        );
      const tmp = `${file}.${randomUUID()}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, file);
    }),
  );
  return { header, dir };
}

const inFlight = new Map<string, Promise<LoadedIndex | undefined>>();

/** One load per CID at a time per sandbox; a settled success is reused, a failure is not kept. */
export function loadIndexOnce(
  manifestCid: string,
  deps: IndexStoreDeps,
): Promise<LoadedIndex | undefined> {
  const known = inFlight.get(manifestCid);
  if (known !== undefined) return known;
  const load = loadIndex(manifestCid, deps).then(
    (loaded) => {
      // "Not built" is not cached for good: the operator may upload it while the sandbox lives.
      if (loaded === undefined) inFlight.delete(manifestCid);
      return loaded;
    },
    (error: unknown) => {
      inFlight.delete(manifestCid);
      throw error;
    },
  );
  inFlight.set(manifestCid, load);
  return load;
}

/** Tests only. */
export async function resetIndexCache(cacheDir?: string): Promise<void> {
  inFlight.clear();
  if (cacheDir !== undefined) await rm(cacheDir, { recursive: true, force: true });
}

const sqlStr = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** Drops whatever a previous bind left (another run's schemas and views) and points the four
 *  contract views at the index files. */
export function indexViewsSql(dir: string): string {
  return [
    ...CONTRACT_VIEWS.map((v) => `DROP VIEW IF EXISTS ${v}`),
    "DROP SCHEMA IF EXISTS meta CASCADE",
    "DROP SCHEMA IF EXISTS county CASCADE",
    "DROP SCHEMA IF EXISTS property_improvement CASCADE",
    ...CONTRACT_VIEWS.map(
      (v: ContractView) =>
        `CREATE OR REPLACE VIEW ${v} AS SELECT * FROM read_parquet(${sqlStr(join(dir, `${v}.parquet`))})`,
    ),
  ].join(";\n");
}

/** The BoundRun an index stands for: every view, no export tables (they are not read). */
export function boundFromIndex(header: IndexHeader): BoundRun {
  return {
    runId: header.runId,
    manifestCid: header.manifestCid,
    asOf: header.asOf,
    tables: [],
    views: [...CONTRACT_VIEWS],
  };
}
