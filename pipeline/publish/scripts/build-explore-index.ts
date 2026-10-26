// A-16 T011 (AC-13, ADR-0001 Amendment 1): build the per-run Explore index on the operator laptop
// from a run's PUBLISHED parts only, then (optionally) verify it and upload it privately.
//
//   pnpm tsx pipeline/publish/scripts/build-explore-index.ts \
//     --manifest runs/travis-full-run2-20261024/manifest.json [--expect-cid bafk…] \
//     --source cidcopy|local [--local-root <repo root holding pipeline/data>] \
//     --work-dir <dir> [--verify] [--upload --bucket <name> | CID_COPY_BUCKET] [--profile assess] \
//     [--prefix private/explore-index/v1.3/] [--max-fetch-gb 2] [--rebuild] [--copy-host <host>]
//
// Flow (design § 7, ported from Task B's plan/fetchPart/buildIndex, no Lambda or Step Functions:
// 160–190 objects, ~75 s, one operator at a time):
//   1. the manifest's raw-leaves CIDv1 is checked (against --expect-cid when given) and the
//      manifest is Zod-validated;
//   2. the parts the four views read (query-core boundPartNames) are planned and the cost gate
//      refuses more than --max-fetch-gb;
//   3. each part is fetched from the CID copy (`https://<copy-host>/<cid>`, 8 in parallel,
//      60 s timeout, retry 1/2/4 s on 429/5xx/network, max 4 tries; never Filebase) or read from
//      the run's local files (--source local), and accepted only when its SHA-256 equals the
//      manifest's; any mismatch, 403 or 404 is a hard stop naming the part (no partial index);
//   4. bindManifest binds the views over the verified files; batch coverage must be complete;
//   5. each view is materialised with COPY … TO parquet; DESCRIBE of every file must equal DESCRIBE
//      of its view; `index.json` (IndexDescriptor) is written LAST and the directory is renamed
//      into place, so a crashed build leaves nothing a reader or an upload could pick up;
//   6. --verify: re-binds the run directly and compares each view against its file
//      (row counts and EXCEPT ALL both ways = 0);
//   7. --upload: PutObject with If-None-Match "*" for the 4 files, then index.json last. An
//      existing identical index.json is a no-op; a different one is a conflict (never overwritten).
//
// Recovery: parts are cached under <work-dir>/parts by CID and a built index under
// <work-dir>/index/<manifestCid>/ is reused (unless --rebuild), so a re-run fetches only missing
// parts and uploads the same bytes. Exit code 1 with the failing step's message otherwise.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { RunManifestV1, isCidV1 } from "@countylens/contract";
import {
  bindManifest,
  rawCid,
  type BoundRun,
  type ContractView,
  type QueryEngine,
  type Row,
} from "@countylens/query-core";
import {
  DEFAULT_MAX_FETCH_GB,
  EXPLORE_INDEX_PREFIX,
  EXPLORE_INDEX_SCHEMA,
  EXPLORE_INDEX_VIEWS,
  INDEX_JSON,
  IndexDescriptor,
  assertBatchCoverage,
  batchCoverage,
  checkSourceParts,
  decideUpload,
  fetchBudget,
  indexKeys,
  planSourceParts,
  viewsSha256,
  type IndexFile,
  type PlannedPart,
} from "../src/explore-index.js";

export const FETCH_CONCURRENCY = 8;
export const FETCH_TIMEOUT_MS = 60_000;
export const FETCH_TRIES = 4;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/** How each view is written: sort keys (latitude first so a bbox skips row groups). */
const COPY_ORDER: Record<ContractView, string | undefined> = {
  v_property: "latitude, longitude, property_cid",
  v_roofing_permit: "property_cid, permit_cid",
  v_contractor: undefined,
  v_run: undefined,
};

export type Log = (line: string) => void;

export interface BuildOptions {
  /** A local manifest path, or a CID fetched from the CID copy. */
  readonly manifest: string;
  readonly expectCid?: string | undefined;
  readonly source: "cidcopy" | "local";
  /** --source local: the directory manifest artifact names are relative to. */
  readonly localRoot?: string | undefined;
  readonly workDir: string;
  readonly copyHost?: string | undefined;
  readonly maxFetchGb?: number | undefined;
  readonly rebuild?: boolean | undefined;
  /** The S3 prefix the index keys are written for (default `private/explore-index/v1.3/`). */
  readonly prefix?: string | undefined;
  readonly threads?: number | undefined;
  readonly memoryLimit?: string | undefined;
  readonly gitSha?: string | undefined;
  readonly now?: (() => Date) | undefined;
  readonly log?: Log | undefined;
}

export interface BuildDeps {
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface BuildResult {
  readonly descriptor: IndexDescriptor;
  /** Local directory holding index.json + the 4 Parquet files. */
  readonly dir: string;
  readonly reused: boolean;
  readonly timings: Record<string, number>;
  readonly fetchedBytes: number;
}

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const sqlStr = (s: string): string => `'${s.replace(/'/g, "''")}'`;

interface Db extends QueryEngine {
  readonly connection: DuckDBConnection;
  close(): void;
}

function plainValue(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  return value;
}

/** An in-memory DuckDB with TimeZone UTC (same settings bindManifest is tested under). */
export async function openDb(options: {
  threads?: number | undefined;
  memoryLimit?: string | undefined;
  tempDirectory: string;
}): Promise<Db> {
  const instance = await DuckDBInstance.create(":memory:", {
    threads: String(options.threads ?? 8),
    memory_limit: options.memoryLimit ?? "6GB",
    temp_directory: options.tempDirectory,
  });
  const connection = await instance.connect();
  await connection.run("SET TimeZone = 'UTC'");
  return {
    connection,
    async run(sql: string): Promise<void> {
      await connection.run(sql);
    },
    async all(sql: string): Promise<Row[]> {
      const reader = await connection.runAndReadAll(sql);
      return reader
        .getRowObjectsJS()
        .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plainValue(v)])));
    },
    close(): void {
      connection.closeSync();
      instance.closeSync();
    },
  };
}

async function count(db: QueryEngine, sql: string): Promise<number> {
  const rows = await db.all(sql);
  return Number(rows[0]?.["n"] ?? 0);
}

/** Reads the manifest (path or CID), checks its raw CID and schema. */
export async function loadManifest(
  options: Pick<BuildOptions, "manifest" | "expectCid" | "copyHost">,
  deps: BuildDeps = {},
): Promise<{ bytes: Uint8Array; cid: string; manifest: RunManifestV1 }> {
  let bytes: Uint8Array;
  if (existsSync(options.manifest)) bytes = new Uint8Array(readFileSync(options.manifest));
  else if (isCidV1(options.manifest)) {
    if (options.copyHost === undefined)
      throw new Error("--copy-host is required to fetch a manifest by CID");
    bytes = await fetchVerified(
      { name: "manifest.json", cid: options.manifest, sha256: "", size: 0 },
      options.copyHost,
      deps,
    );
  } else throw new Error(`--manifest ${options.manifest}: no such file and not a CIDv1`);
  const cid = await rawCid(bytes);
  if (isCidV1(options.manifest) && cid !== options.manifest)
    throw new Error(`manifest bytes hash to ${cid}, not ${options.manifest}`);
  if (options.expectCid !== undefined && cid !== options.expectCid)
    throw new Error(`manifest bytes hash to ${cid}, not --expect-cid ${options.expectCid}`);
  const manifest = RunManifestV1.parse(JSON.parse(new TextDecoder().decode(bytes)));
  return { bytes, cid, manifest };
}

/** One part from the CID copy, retried on 429/5xx/network, verified by SHA-256 (or, with no
 *  sha256 given, by its raw CID). 403/404 and a mismatch are hard stops. */
async function fetchVerified(
  part: PlannedPart,
  host: string,
  deps: BuildDeps,
): Promise<Uint8Array> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  if (/filebase|ipfs\.io|dweb\.link/i.test(host))
    throw new Error(
      `--copy-host ${host}: the index reads our CID copy only, never a public gateway`,
    );
  const url = `https://${host}/${part.cid}`;
  for (let attempt = 1; ; attempt += 1) {
    let failure: string;
    try {
      const response = await doFetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const status = response.status;
      if (response.ok) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        const ok =
          part.sha256 === ""
            ? (await rawCid(bytes)) === part.cid
            : sha256Hex(bytes) === part.sha256;
        if (!ok) throw new HardStop(`${part.name} (${part.cid}): bytes do not match the manifest`);
        return bytes;
      }
      await response.body?.cancel();
      if (!RETRY_STATUS.has(status))
        throw new HardStop(`${part.name} (${part.cid}): CID copy answered HTTP ${status}`);
      failure = `HTTP ${status}`;
    } catch (error) {
      if (error instanceof HardStop) throw error;
      failure = error instanceof Error ? error.message : String(error);
    }
    if (attempt >= FETCH_TRIES)
      throw new HardStop(`${part.name} (${part.cid}): ${failure} after ${attempt} tries`);
    await sleep(1000 * 2 ** (attempt - 1));
  }
}

export class HardStop extends Error {
  override readonly name = "HardStop";
}

/** Local paths of every planned part, each SHA-256-verified (fetched into the cache, or read in
 *  place for --source local). */
export async function materialiseParts(
  parts: readonly PlannedPart[],
  options: Pick<BuildOptions, "source" | "localRoot" | "workDir" | "copyHost" | "log">,
  deps: BuildDeps = {},
): Promise<{ paths: Map<string, string>; fetchedBytes: number }> {
  const paths = new Map<string, string>();
  let fetchedBytes = 0;
  if (options.source === "local") {
    const root = options.localRoot ?? process.cwd();
    for (const p of parts) {
      const file = resolve(root, p.name);
      if (!existsSync(file)) throw new HardStop(`${p.name}: not found under ${root}`);
      if (sha256Hex(readFileSync(file)) !== p.sha256)
        throw new HardStop(`${p.name}: local bytes do not match the manifest sha256`);
      paths.set(p.name, file);
    }
    return { paths, fetchedBytes };
  }
  if (options.copyHost === undefined)
    throw new Error("--copy-host (or CID_COPY_HOST) is required for --source cidcopy");
  const dir = join(options.workDir, "parts");
  mkdirSync(dir, { recursive: true });
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < parts.length) {
      const p = parts[next++] as PlannedPart;
      const file = join(dir, `${p.cid}.parquet`);
      if (
        existsSync(file) &&
        statSync(file).size === p.size &&
        sha256Hex(readFileSync(file)) === p.sha256
      ) {
        paths.set(p.name, file);
        continue;
      }
      const bytes = await fetchVerified(p, options.copyHost as string, deps);
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, file);
      fetchedBytes += bytes.length;
      paths.set(p.name, file);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, parts.length) }, worker));
  return { paths, fetchedBytes };
}

/** Binds the views over verified local part files. */
export async function bindParts(
  db: QueryEngine,
  bytes: Uint8Array,
  paths: ReadonlyMap<string, string>,
): Promise<BoundRun> {
  return bindManifest(bytes, "", db, {
    views: EXPLORE_INDEX_VIEWS,
    partUrl: ({ name }) => {
      const path = paths.get(name);
      if (path === undefined) throw new HardStop(`bind asked for unplanned part ${name}`);
      return path;
    },
  });
}

/** `DESCRIBE` as `name type` lines (the frozen-schema check). */
export async function describe(db: QueryEngine, relation: string): Promise<string[]> {
  const rows = await db.all(`DESCRIBE SELECT * FROM ${relation}`);
  return rows.map((r) => `${String(r["column_name"])} ${String(r["column_type"])}`);
}

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Steps 1–5. Returns the descriptor and the local directory (reused when already built). */
export async function buildExploreIndex(
  options: BuildOptions,
  deps: BuildDeps = {},
): Promise<BuildResult> {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const lap = (label: string): void => {
    timings[label] = Date.now() - t0;
    log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${label}`);
  };

  const { bytes, cid, manifest } = await loadManifest(options, deps);
  lap(`manifest ${cid} (${manifest.runId}) verified`);
  const finalDir = join(options.workDir, "index", cid);
  if (!options.rebuild && existsSync(join(finalDir, INDEX_JSON))) {
    const descriptor = IndexDescriptor.parse(
      JSON.parse(readFileSync(join(finalDir, INDEX_JSON), "utf8")),
    );
    const problems = checkSourceParts(descriptor.sourceParts, manifest);
    const wantKeys = indexKeys(options.prefix ?? EXPLORE_INDEX_PREFIX, cid);
    if (
      EXPLORE_INDEX_VIEWS.some((v) => descriptor.files[v].key !== wantKeys.files[v]) ||
      descriptor.manifestCid !== cid ||
      descriptor.viewsSha256 !== viewsSha256() ||
      problems.length > 0
    )
      throw new HardStop(`${finalDir} holds a different index; rerun with --rebuild`);
    for (const v of EXPLORE_INDEX_VIEWS) {
      const file = join(finalDir, `${v}.parquet`);
      if (!existsSync(file) || sha256Hex(readFileSync(file)) !== descriptor.files[v].sha256)
        throw new HardStop(`${file} does not match its index.json; rerun with --rebuild`);
    }
    lap("reused the built index");
    return { descriptor, dir: finalDir, reused: true, timings, fetchedBytes: 0 };
  }

  const parts = planSourceParts(manifest);
  const budget = fetchBudget(parts, options.maxFetchGb ?? DEFAULT_MAX_FETCH_GB);
  log(`plan: ${budget.message}`);
  if (!budget.ok) throw new HardStop(`cost gate: ${budget.message}`);

  const { paths, fetchedBytes } = await materialiseParts(parts, options, deps);
  lap(`parts verified (${(fetchedBytes / 1e6).toFixed(1)} MB fetched)`);

  const buildDir = join(options.workDir, "index", `${cid}.building`);
  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(buildDir, { recursive: true });
  const db = await openDb({
    threads: options.threads,
    memoryLimit: options.memoryLimit,
    tempDirectory: join(options.workDir, "spill"),
  });
  try {
    const bound = await bindParts(db, bytes, paths);
    lap("bound");

    const byPart = new Map(
      (await db.all("SELECT _part, count(*) AS n FROM county.property GROUP BY _part")).map((r) => [
        String(r["_part"]),
        Number(r["n"]),
      ]),
    );
    const coverage = batchCoverage({
      tableArtifactNames: manifest.artifacts.filter((a) => a.kind === "table").map((a) => a.name),
      boundTables: bound.tables,
      countyPropertyRowsByPart: byPart,
    });
    assertBatchCoverage(coverage);

    const roofingCids = await count(
      db,
      "SELECT count(DISTINCT permit_cid) AS n FROM v_roofing_permit",
    );
    const rawRoofing = await count(
      db,
      "SELECT count(DISTINCT cid) AS n FROM property_improvement.property_improvement WHERE improvement_type = 'Roofing' AND improvement_action = 'Replacement'",
    );
    const permitCounts = {
      rawPermitRows: await count(
        db,
        "SELECT count(*) AS n FROM property_improvement.property_improvement",
      ),
      rawPermitCids: await count(
        db,
        "SELECT count(DISTINCT cid) AS n FROM property_improvement.property_improvement",
      ),
      rawRoofingReplacementCids: rawRoofing,
      linkedPermitRows: await count(db, "SELECT count(*) AS n FROM meta.permit"),
      roofingPermitRows: await count(db, "SELECT count(*) AS n FROM v_roofing_permit"),
      roofingWithoutPropertyRow: rawRoofing - roofingCids,
    };
    const files = {} as Record<ContractView, IndexFile>;
    const keys = indexKeys(options.prefix ?? EXPLORE_INDEX_PREFIX, cid);
    for (const v of EXPLORE_INDEX_VIEWS) {
      const file = join(buildDir, `${v}.parquet`);
      const order = COPY_ORDER[v];
      await db.run(
        `COPY (SELECT * FROM ${v}${order ? ` ORDER BY ${order}` : ""}) TO ${sqlStr(file)} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 50000)`,
      );
      const want = await describe(db, v);
      const got = await describe(db, `read_parquet(${sqlStr(file)})`);
      if (JSON.stringify(want) !== JSON.stringify(got))
        throw new HardStop(`${v}: the Parquet schema differs from the view (${got.join(", ")})`);
      const fileBytes = readFileSync(file);
      files[v] = {
        key: keys.files[v],
        sha256: sha256Hex(fileBytes),
        bytes: fileBytes.length,
        rows: await count(db, `SELECT count(*) AS n FROM read_parquet(${sqlStr(file)})`),
      };
      lap(`${v} written (${files[v].rows} rows, ${(fileBytes.length / 1e6).toFixed(1)} MB)`);
    }
    // From the written file, not the view (re-running the view's joins costs a minute at county size).
    const knownOwnerArea = await count(
      db,
      `SELECT count(*) AS n FROM read_parquet(${sqlStr(join(buildDir, "v_property.parquet"))}) WHERE owner_area_class IS NOT NULL AND owner_area_class <> 'unknown'`,
    );
    const version = String((await db.all("SELECT version() AS v"))[0]?.["v"] ?? "unknown");
    const profile = manifest.profiles.find((p) => p.name !== "travis-places");
    const descriptor = IndexDescriptor.parse({
      schema: EXPLORE_INDEX_SCHEMA,
      manifestCid: cid,
      runId: bound.runId,
      asOf: bound.asOf,
      viewsSha256: viewsSha256(),
      profileSha256: profile?.sha256 ?? "unknown",
      builder: { gitSha: options.gitSha ?? gitSha(), duckdb: version },
      builtAt: (options.now ?? (() => new Date()))().toISOString(),
      files,
      sourceParts: parts.map((p) => ({ name: p.name, cid: p.cid, sha256: p.sha256 })),
      batchCoverage: coverage,
      permitCounts,
      ownerArea: { knownRows: knownOwnerArea, published: knownOwnerArea > 0 },
    });
    const problems = checkSourceParts(descriptor.sourceParts, manifest);
    if (problems.length > 0) throw new HardStop(`source parts: ${problems.join("; ")}`);
    writeFileSync(join(buildDir, INDEX_JSON), `${JSON.stringify(descriptor, null, 2)}\n`);
    rmSync(finalDir, { recursive: true, force: true });
    mkdirSync(join(options.workDir, "index"), { recursive: true });
    renameSync(buildDir, finalDir);
    lap("index.json written");
    return { descriptor, dir: finalDir, reused: false, timings, fetchedBytes };
  } finally {
    db.close();
  }
}

export interface ViewParity {
  readonly view: ContractView;
  readonly boundRows: number;
  readonly indexRows: number;
  /** Rows in one side and not the other (EXCEPT ALL both ways). 0 = identical multisets. */
  readonly diffRows: number;
}

/** Step 6: re-binds the run directly over the same verified parts and compares every view with
 *  its index file. The caller fails when any diffRows > 0 or the row counts differ. */
export async function verifyExploreIndex(
  options: BuildOptions,
  dir: string,
  deps: BuildDeps = {},
): Promise<ViewParity[]> {
  const { bytes, manifest } = await loadManifest(options, deps);
  const { paths } = await materialiseParts(planSourceParts(manifest), options, deps);
  const db = await openDb({
    threads: options.threads,
    memoryLimit: options.memoryLimit,
    tempDirectory: join(options.workDir, "spill"),
  });
  try {
    await bindParts(db, bytes, paths);
    const out: ViewParity[] = [];
    for (const v of EXPLORE_INDEX_VIEWS) {
      const file = `read_parquet(${sqlStr(join(dir, `${v}.parquet`))})`;
      const boundRows = await count(db, `SELECT count(*) AS n FROM ${v}`);
      const indexRows = await count(db, `SELECT count(*) AS n FROM ${file}`);
      const diffRows = await count(
        db,
        `SELECT count(*) AS n FROM ((SELECT * FROM ${v} EXCEPT ALL SELECT * FROM ${file}) UNION ALL (SELECT * FROM ${file} EXCEPT ALL SELECT * FROM ${v}))`,
      );
      out.push({ view: v, boundRows, indexRows, diffRows });
    }
    return out;
  } finally {
    db.close();
  }
}

/** The S3 calls the upload makes (injectable for tests). */
export interface IndexS3 {
  /** The object's bytes, or undefined when absent (404/NoSuchKey). */
  get(bucket: string, key: string): Promise<Uint8Array | undefined>;
  /** PutObject with If-None-Match "*"; `written: false` when the key already exists (412). */
  putIfAbsent(
    bucket: string,
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<{ written: boolean }>;
}

export function s3IndexClient(profile: string): IndexS3 {
  const client = new S3Client({ profile });
  const statusOf = (e: unknown): number | undefined =>
    (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return {
    async get(bucket, key) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return object.Body === undefined ? undefined : await object.Body.transformToByteArray();
      } catch (error) {
        if ((error as Error).name === "NoSuchKey" || statusOf(error) === 404) return undefined;
        throw error;
      }
    },
    async putIfAbsent(bucket, key, body, contentType) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            IfNoneMatch: "*",
            ChecksumAlgorithm: "SHA256",
          }),
        );
        return { written: true };
      } catch (error) {
        if ((error as Error).name === "PreconditionFailed" || statusOf(error) === 412)
          return { written: false };
        throw error;
      }
    },
  };
}

/** Step 7. index.json last; never overwrites. An existing Parquet key must hold the same bytes. */
export async function uploadExploreIndex(params: {
  readonly descriptor: IndexDescriptor;
  readonly dir: string;
  readonly bucket: string;
  readonly prefix?: string;
  readonly s3: IndexS3;
  readonly log?: Log;
}): Promise<"uploaded" | "noop"> {
  const log = params.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const { descriptor, s3, bucket } = params;
  const keys = indexKeys(params.prefix ?? EXPLORE_INDEX_PREFIX, descriptor.manifestCid);
  const existingBytes = await s3.get(bucket, keys.indexJson);
  const existing =
    existingBytes === undefined
      ? undefined
      : IndexDescriptor.parse(JSON.parse(new TextDecoder().decode(existingBytes)));
  const decision = decideUpload(existing, descriptor);
  if (decision === "noop") {
    log(`s3://${bucket}/${keys.indexJson} already holds this index: no-op`);
    return "noop";
  }
  if (decision === "conflict")
    throw new HardStop(
      `s3://${bucket}/${keys.indexJson} holds a different index; it is never overwritten`,
    );
  for (const v of EXPLORE_INDEX_VIEWS) {
    const body = new Uint8Array(readFileSync(join(params.dir, `${v}.parquet`)));
    const key = keys.files[v];
    if (key !== descriptor.files[v].key)
      throw new HardStop(`${v}: descriptor key ${descriptor.files[v].key} is not ${key}`);
    const { written } = await s3.putIfAbsent(bucket, key, body, "application/vnd.apache.parquet");
    if (!written) {
      const there = await s3.get(bucket, key);
      if (there === undefined || sha256Hex(there) !== descriptor.files[v].sha256)
        throw new HardStop(
          `s3://${bucket}/${key} exists from an earlier build with other bytes; remove the ${keys.prefix} prefix (never overwritten here) and rerun`,
        );
      log(`${key} already uploaded (same bytes)`);
    } else log(`${key} uploaded (${body.length} bytes)`);
  }
  const json = new TextEncoder().encode(`${JSON.stringify(descriptor, null, 2)}\n`);
  const { written } = await s3.putIfAbsent(bucket, keys.indexJson, json, "application/json");
  if (!written)
    throw new HardStop(`${keys.indexJson} appeared during the upload; rerun to compare`);
  log(`${keys.indexJson} uploaded last`);
  return "uploaded";
}

async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      manifest: { type: "string" },
      "expect-cid": { type: "string" },
      source: { type: "string", default: "cidcopy" },
      "local-root": { type: "string" },
      "work-dir": { type: "string" },
      "copy-host": { type: "string" },
      "max-fetch-gb": { type: "string" },
      rebuild: { type: "boolean", default: false },
      verify: { type: "boolean", default: false },
      upload: { type: "boolean", default: false },
      bucket: { type: "string" },
      prefix: { type: "string", default: EXPLORE_INDEX_PREFIX },
      profile: { type: "string", default: "assess" },
    },
  });
  if (values.manifest === undefined) throw new Error("--manifest <path|cid> is required");
  if (values.source !== "cidcopy" && values.source !== "local")
    throw new Error("--source is cidcopy or local");
  const options: BuildOptions = {
    manifest: values.manifest,
    expectCid: values["expect-cid"],
    source: values.source,
    localRoot: values["local-root"],
    workDir: resolve(values["work-dir"] ?? join(tmpdir(), "countylens-explore-index")),
    copyHost: values["copy-host"] ?? process.env.CID_COPY_HOST,
    maxFetchGb: values["max-fetch-gb"] === undefined ? undefined : Number(values["max-fetch-gb"]),
    rebuild: values.rebuild,
    prefix: values.prefix,
  };
  const built = await buildExploreIndex(options);
  const d = built.descriptor;
  process.stdout.write(
    `${JSON.stringify({ manifestCid: d.manifestCid, runId: d.runId, dir: built.dir, reused: built.reused, fetchedBytes: built.fetchedBytes, timingsMs: built.timings, files: d.files, permitCounts: d.permitCounts, ownerArea: d.ownerArea, batchCoverage: d.batchCoverage }, null, 2)}\n`,
  );
  if (values.verify) {
    const started = Date.now();
    const parity = await verifyExploreIndex(options, built.dir);
    process.stdout.write(
      `${JSON.stringify({ verifyMs: Date.now() - started, parity }, null, 2)}\n`,
    );
    const bad = parity.filter((p) => p.diffRows !== 0 || p.boundRows !== p.indexRows);
    if (bad.length > 0) throw new HardStop(`verify failed: ${bad.map((p) => p.view).join(", ")}`);
  }
  if (values.upload) {
    const bucket = values.bucket ?? process.env.CID_COPY_BUCKET;
    if (bucket === undefined || bucket === "")
      throw new Error("--upload needs --bucket or CID_COPY_BUCKET");
    const started = Date.now();
    const result = await uploadExploreIndex({
      descriptor: d,
      dir: built.dir,
      bucket,
      prefix: values.prefix,
      s3: s3IndexClient(values.profile),
    });
    process.stdout.write(`${JSON.stringify({ upload: result, uploadMs: Date.now() - started })}\n`);
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `build-explore-index: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
