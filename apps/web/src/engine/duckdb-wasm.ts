// The browser query engine (A-03 T054; ARD § 4 AD-19: the only module of apps/web that imports
// DuckDB). DuckDB-WASM's eh bundle is self-hosted (the WASM and its worker are Vite assets of
// this build, no CDN) and lazy-loaded through dynamic `import()`, so it stays outside the
// 300 KB gate. The build ships the WASM only as `duckdb-eh-<hash>.wasm.gz` (scripts/compress-wasm.ts,
// ADR-0001 Finding 2; plan R2 fallback 2026-10-21, as Amplify rejects a Content-Encoding custom
// header): the engine fetches the .gz, gunzips it with DecompressionStream into an
// application/wasm Blob and instantiates DuckDB from its object URL. The database is opened with exactly `{ allowFullHTTPReads: true,
// forceFullHTTPReads: false, reliableHeadRequests: false }` (ADR-0001 Finding 1, decision 4):
// without them this build downloads every table part whole instead of range-reading it.
// Values come back JSON-shaped as the QueryEngine contract says (dates YYYY-MM-DD, timestamps
// ISO 8601 UTC, bigints as numbers, lists and structs as plain values).
// ERR-14 (TC-023): DuckDB never downloads an extension itself. Autoinstall and autoload are off;
// the three extensions the queries need (parquet, json, icu) are vendored gzip-compressed Vite
// assets of this build (vendor/duckdb-extensions, scripts/vendor-duckdb-extensions.ts), fetched
// in parallel with the engine, gunzipped like the engine and LOADed from same-origin object URLs.
// ERR-15/16/17: prefetched table parts are handed to the engine as registered file buffers
// (`registerFile`), so the engine itself makes no network request for them.
import {
  bindManifest,
  boundPartNames,
  listRoofingPermitsSql,
  viewsReadBy,
  type BoundRun,
  type ContractView,
  type QueryEngine,
  type Row,
} from "@countylens/query-core";
import type { RunManifestV1 } from "@countylens/contract";
import { EngineStartError } from "./errors";
import { parsePermitRows, type PermitListRow } from "./permit-list";
import { PERF_MARKS, PERF_MEASURES, timed } from "./timing";

export interface DuckDbFilesystemFlags {
  readonly allowFullHTTPReads: boolean;
  readonly forceFullHTTPReads: boolean;
  readonly reliableHeadRequests: boolean;
}

export interface DuckDbOpenConfig {
  readonly filesystem: DuckDbFilesystemFlags;
}

/** ADR-0001 decision 4: range reads on, no forced full reads, no HEAD probes (CloudFront answers HEAD+Range with 200). */
export const DUCKDB_FILESYSTEM_FLAGS: DuckDbFilesystemFlags = Object.freeze({
  allowFullHTTPReads: true,
  forceFullHTTPReads: false,
  reliableHeadRequests: false,
});

/** What `db.open` receives, exactly. */
export const DUCKDB_OPEN_CONFIG: DuckDbOpenConfig = Object.freeze({
  filesystem: DUCKDB_FILESYSTEM_FLAGS,
});

/**
 * ERR-14: settings sent right after `connect`, before any other statement, so a query that needs an
 * extension that is not loaded fails loudly instead of fetching it from extensions.duckdb.org.
 */
export const EXTENSION_SETTINGS_SQL: readonly string[] = Object.freeze([
  "SET autoinstall_known_extensions = false",
  "SET autoload_known_extensions = false",
]);

/** parquet: read_parquet; json: CAST(… AS JSON) in bindManifest; icu: SET TimeZone and TIMESTAMPTZ. */
export const ENGINE_EXTENSIONS = Object.freeze(["parquet", "json", "icu"] as const);
export type EngineExtension = (typeof ENGINE_EXTENSIONS)[number];

/** One vendored extension as the build serves it: the gzip-compressed `.duckdb_extension.wasm.gz`. */
export interface ExtensionAsset {
  readonly name: EngineExtension;
  /** Same-origin URL of the `.wasm.gz` Vite asset. */
  readonly url: string;
}

/**
 * The LOAD statement for an extension gunzipped into an object URL. DuckDB-WASM fetches the path
 * with an XHR (the fragment is not sent) and takes the extension name, and with it the
 * `<name>_duckdb_cpp_init` entry point, from the text after the last `/`, so the fragment carries
 * the canonical file name. Only `blob:` URLs of this page are accepted (ERR-14: no other host).
 */
export function loadExtensionSql(objectUrl: string, name: EngineExtension): string {
  if (!objectUrl.startsWith("blob:") || /['#\s]/.test(objectUrl)) {
    throw new Error(`loadExtensionSql: ${name} must come from a same-origin object URL`);
  }
  return `LOAD '${objectUrl}#/${name}.duckdb_extension.wasm'`;
}

/** The self-hosted eh bundle files (`@duckdb/duckdb-wasm/dist`), by name; the build serves the WASM as `<name>.gz` (TC-028). */
export const SELF_HOSTED_BUNDLE = Object.freeze({
  mainModule: "duckdb-eh.wasm",
  mainWorker: "duckdb-browser-eh.worker.js",
});

/** The subset of an Arrow `Table` the row conversion reads (apache-arrow 17). */
export interface ArrowFieldLike {
  readonly name: string;
  readonly type: ArrowTypeLike;
}

export interface ArrowTypeLike {
  /** Arrow `Type` id from the IPC format: Date 8, Timestamp 10, List 12, Struct 13, FixedSizeList 16. */
  readonly typeId: number;
  /** Arrow `TimeUnit`: SECOND 0, MILLISECOND 1, MICROSECOND 2, NANOSECOND 3. */
  readonly unit?: number;
  /** List: the one element field; Struct: the member fields (apache-arrow `DataType.children`). */
  readonly children?: readonly ArrowFieldLike[] | null;
}

export interface ArrowTableLike {
  readonly schema: { readonly fields: readonly ArrowFieldLike[] };
  toArray(): readonly { toJSON(): Record<string, unknown> }[];
}

export interface DuckDbConnectionLike {
  query(sql: string): Promise<ArrowTableLike>;
  close(): Promise<void>;
}

/** The subset of `AsyncDuckDB` the engine uses; a fake satisfies it in unit tests. */
export interface AsyncDuckDbLike {
  instantiate(mainModule: string, pthreadWorker?: string | null): Promise<unknown>;
  open(config: DuckDbOpenConfig): Promise<void>;
  connect(): Promise<DuckDbConnectionLike>;
  /** Makes `name` readable by `read_parquet(name)` from memory (no network). */
  registerFileBuffer(name: string, buffer: Uint8Array): Promise<void>;
  terminate(): Promise<void>;
}

export interface DuckDbRuntime {
  readonly bundle: {
    /** URL of the WASM: the `.wasm.gz` in a build (`gzip`), the raw `.wasm` under `vite dev` (`identity`). */
    readonly mainModule: string;
    readonly mainModuleEncoding: "gzip" | "identity";
    readonly mainWorker: string;
    readonly pthreadWorker: string | null;
  };
  /** The vendored extensions (ERR-14), LOADed after connect; empty for a runtime that needs none. */
  readonly extensions: readonly ExtensionAsset[];
  createDb(workerUrl: string): AsyncDuckDbLike;
}

export type LoadDuckDb = () => Promise<DuckDbRuntime>;

/** Where compress-wasm.ts puts the WASM: next to the Vite-emitted `.wasm` URL, plus `.gz`. */
export function compressedModuleUrl(wasmUrl: string): string {
  return `${wasmUrl}.gz`;
}

/** Lazy-loads the library and the self-hosted eh bundle (Vite emits both files as assets). */
export const loadSelfHostedDuckDb: LoadDuckDb = async () => {
  const [duckdb, wasm, worker, parquet, json, icu] = await Promise.all([
    import("@duckdb/duckdb-wasm"),
    import("@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url"),
    import("@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url"),
    import("../../vendor/duckdb-extensions/v1.5.4/wasm_eh/parquet.duckdb_extension.wasm.gz?url"),
    import("../../vendor/duckdb-extensions/v1.5.4/wasm_eh/json.duckdb_extension.wasm.gz?url"),
    import("../../vendor/duckdb-extensions/v1.5.4/wasm_eh/icu.duckdb_extension.wasm.gz?url"),
  ]);
  // The dev server has no compress step; every build (preview and hosted) runs it.
  const dev = import.meta.env.DEV;
  return {
    bundle: {
      mainModule: dev ? wasm.default : compressedModuleUrl(wasm.default),
      mainModuleEncoding: dev ? "identity" : "gzip",
      mainWorker: worker.default,
      pthreadWorker: null,
    },
    extensions: [
      { name: "parquet", url: parquet.default },
      { name: "json", url: json.default },
      { name: "icu", url: icu.default },
    ],
    createDb: (workerUrl) => new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(workerUrl)),
  };
};

/** The browser APIs the gzip path uses; fakes replace them in unit tests. */
export interface WasmFetchDeps {
  fetch(url: string): Promise<Response>;
  /** Missing in a browser without Compression Streams: the engine fails with the fixed text. */
  readonly DecompressionStream:
    (new (format: CompressionFormat) => DecompressionStream) | undefined;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

/** The page's own fetch, DecompressionStream and object URLs. */
export function browserWasmDeps(): WasmFetchDeps {
  return {
    fetch: (url) => globalThis.fetch(url),
    DecompressionStream: (globalThis as { DecompressionStream?: typeof DecompressionStream })
      .DecompressionStream,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}

export interface WasmModuleUrl {
  readonly url: string;
  revoke(): void;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<BlobPart[]> {
  const chunks: BlobPart[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value as Uint8Array<ArrayBuffer>);
  }
}

/**
 * Fetches the `.wasm.gz`, streams it through `DecompressionStream('gzip')` and returns an object
 * URL of an `application/wasm` Blob (so the worker can use `instantiateStreaming`). A host that
 * already decoded the body (`Content-Encoding: gzip`) is not gunzipped twice.
 */
export async function fetchGzippedWasm(url: string, deps: WasmFetchDeps): Promise<WasmModuleUrl> {
  const Decompress = deps.DecompressionStream;
  if (Decompress === undefined) {
    throw new Error(
      "DecompressionStream is not available: the gzip-compressed engine cannot be read",
    );
  }
  const response = await deps.fetch(url);
  if (!response.ok || response.body === null) {
    throw new Error(`Engine download failed: ${url} answered HTTP ${response.status}`);
  }
  const decoded = /\bgzip\b/i.test(response.headers.get("content-encoding") ?? "");
  const stream = decoded
    ? response.body
    : response.body.pipeThrough(
        new Decompress("gzip") as ReadableWritablePair<Uint8Array, Uint8Array>,
      );
  const blob = new Blob(await readAll(stream), { type: "application/wasm" });
  const objectUrl = deps.createObjectURL(blob);
  return { url: objectUrl, revoke: () => deps.revokeObjectURL(objectUrl) };
}

export interface BrowserEngine extends QueryEngine {
  /** Registers in-memory bytes under `name` (a prefetched table part); no network. */
  registerFile(name: string, bytes: Uint8Array): Promise<void>;
  /** Closes the connection and terminates the worker. */
  close(): Promise<void>;
}

const ARROW_DATE = 8;
const ARROW_TIMESTAMP = 10;
const ARROW_LIST = 12;
const ARROW_STRUCT = 13;
const ARROW_FIXED_SIZE_LIST = 16;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasFunction = <K extends string>(
  value: Record<string, unknown>,
  key: K,
): value is Record<string, unknown> & Record<K, () => unknown> => typeof value[key] === "function";

/**
 * The elements of an Arrow list value as a JS array. A list cell is an Arrow `Vector`: iterating
 * it yields each element (null where the element is null), whereas its `toArray()` is a typed
 * array for numeric children (`Int32Array`, `BigInt64Array`, …, nulls lost) and an array of
 * `StructRow`s for STRUCT children.
 */
function listElements(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<unknown>);
  if (isObject(value) && Symbol.iterator in value) return Array.from(value as Iterable<unknown>);
  if (isObject(value) && hasFunction(value, "toArray")) return listElements(value.toArray());
  throw new Error(`arrowToRows: unsupported list value ${String(value)}`);
}

/** The members of an Arrow struct value: `StructRow.toJSON()` (never `toArray()`, which drops the names). */
function structMembers(value: unknown): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`arrowToRows: unsupported struct value ${String(value)}`);
  if (hasFunction(value, "toJSON")) {
    const json = value.toJSON();
    if (isObject(json) && !Array.isArray(json)) return json;
  }
  return value;
}

/**
 * Untyped fallback (no Arrow type at hand): Arrow rows and vectors → objects and arrays, typed
 * arrays → arrays, bigint → number, Date → ISO 8601. `toJSON` comes before `toArray`: a
 * `StructRow` has both, and only `toJSON` keeps the member names (ERR-10).
 */
function plain(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (!isObject(value)) return value;
  if (Array.isArray(value)) return value.map(plain);
  if (ArrayBuffer.isView(value)) return listElements(value).map(plain);
  if (hasFunction(value, "toJSON")) {
    const json = value.toJSON();
    if (json !== value) return plain(json);
  }
  if (hasFunction(value, "toArray")) return listElements(value.toArray()).map(plain);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
}

/** Epoch milliseconds of an Arrow temporal value (apache-arrow ≥ 15 returns ms numbers). */
function epochMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`arrowToRows: unsupported temporal value ${String(value)}`);
}

/**
 * One Arrow value → its JSON shape, led by its Arrow type, recursively: DATE → YYYY-MM-DD,
 * TIMESTAMP → ISO 8601 UTC, LIST → array, STRUCT → object (by the type's member fields),
 * bigint → number. A type without children (a test double) falls back to `plain`.
 */
function convert(value: unknown, type: ArrowTypeLike): unknown {
  if (value === null || value === undefined) return null;
  if (type.typeId === ARROW_DATE) return new Date(epochMs(value)).toISOString().slice(0, 10);
  if (type.typeId === ARROW_TIMESTAMP) return new Date(epochMs(value)).toISOString();
  const children = type.children ?? [];
  if (type.typeId === ARROW_LIST || type.typeId === ARROW_FIXED_SIZE_LIST) {
    const element = children[0];
    const items = listElements(value);
    return element === undefined ? items.map(plain) : items.map((v) => convert(v, element.type));
  }
  if (type.typeId === ARROW_STRUCT && children.length > 0) {
    const members = structMembers(value);
    return Object.fromEntries(children.map((c) => [c.name, convert(members[c.name], c.type)]));
  }
  return plain(value);
}

/** An Arrow result table as JSON-shaped rows (QueryEngine `Row`). */
export function arrowToRows(table: ArrowTableLike): Row[] {
  const fields = table.schema.fields;
  return table.toArray().map((row) => {
    const json = row.toJSON();
    const out: Row = {};
    for (const field of fields) out[field.name] = convert(json[field.name], field.type);
    return out;
  });
}

async function instantiate(
  db: AsyncDuckDbLike,
  bundle: DuckDbRuntime["bundle"],
  deps: WasmFetchDeps,
): Promise<void> {
  if (bundle.mainModuleEncoding === "identity") {
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    return;
  }
  const module = await fetchGzippedWasm(bundle.mainModule, deps);
  try {
    await db.instantiate(module.url, bundle.pthreadWorker);
  } finally {
    // The worker has compiled the module once instantiate resolves; the Blob is no longer needed.
    module.revoke();
  }
}

interface LoadedExtension {
  readonly name: EngineExtension;
  readonly module: WasmModuleUrl;
}

/** Fetches and gunzips every vendored extension in parallel (ERR-14); revokes what it made on failure. */
async function fetchExtensions(
  assets: readonly ExtensionAsset[],
  deps: WasmFetchDeps,
): Promise<LoadedExtension[]> {
  const settled = await Promise.allSettled(
    assets.map(async (asset) => ({
      name: asset.name,
      module: await fetchGzippedWasm(asset.url, deps),
    })),
  );
  const loaded = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed !== undefined) {
    for (const extension of loaded) extension.module.revoke();
    throw failed.reason;
  }
  return loaded;
}

async function start(
  load: LoadDuckDb,
  deps: WasmFetchDeps,
): Promise<{ db: AsyncDuckDbLike; conn: DuckDbConnectionLike }> {
  const runtime = await load();
  const db = runtime.createDb(runtime.bundle.mainWorker);
  // The extension downloads run while the engine downloads and compiles (ERR-17).
  const extensions = fetchExtensions(runtime.extensions, deps);
  extensions.catch(() => undefined);
  try {
    await instantiate(db, runtime.bundle, deps);
    await db.open(DUCKDB_OPEN_CONFIG);
    const conn = await db.connect();
    for (const sql of EXTENSION_SETTINGS_SQL) await conn.query(sql);
    const loaded = await extensions;
    try {
      for (const extension of loaded) {
        await conn.query(loadExtensionSql(extension.module.url, extension.name));
      }
    } finally {
      for (const extension of loaded) extension.module.revoke();
    }
    // builders.ts: the engine's TimeZone must be UTC so as_of is the manifest's UTC date.
    await conn.query("SET TimeZone = 'UTC'");
    return { db, conn };
  } catch (cause) {
    // Object URLs of extensions that arrive after a failure are released too.
    extensions.then(
      (loaded) => loaded.forEach((extension) => extension.module.revoke()),
      () => undefined,
    );
    await db.terminate().catch(() => undefined);
    throw cause;
  }
}

/** Loads, instantiates and opens DuckDB-WASM with the range-read flags; EngineStartError on failure. */
export async function openEngine(
  load: LoadDuckDb = loadSelfHostedDuckDb,
  deps: WasmFetchDeps = browserWasmDeps(),
): Promise<BrowserEngine> {
  let started: { db: AsyncDuckDbLike; conn: DuckDbConnectionLike };
  try {
    started = await timed(PERF_MEASURES.init, () => start(load, deps), {
      start: PERF_MARKS.initStart,
      end: PERF_MARKS.initEnd,
    });
  } catch (cause) {
    throw new EngineStartError(cause);
  }
  const { db, conn } = started;
  return {
    async run(sql: string): Promise<void> {
      await conn.query(sql);
    },
    async all(sql: string): Promise<Row[]> {
      return arrowToRows(await conn.query(sql));
    },
    async registerFile(name: string, bytes: Uint8Array): Promise<void> {
      await db.registerFileBuffer(name, bytes);
    },
    async close(): Promise<void> {
      await conn.close().catch(() => undefined);
      await db.terminate();
    },
  };
}

/** The page's own COUNT: one row per v_roofing_permit row, as the listing selects them. */
export const COUNT_PERMITS_SQL = "SELECT count(*)::INTEGER AS n FROM v_roofing_permit";

/**
 * The contract views the Permits page reads: what its COUNT and its listing select from
 * (v_roofing_permit). bindRun binds only the export tables these read (ERR-19), so the page
 * range-reads or prefetches a few parts of a full run instead of every part.
 */
export const PERMITS_VIEWS: readonly ContractView[] = Object.freeze([
  ...new Set([...viewsReadBy(COUNT_PERMITS_SQL), ...viewsReadBy(listRoofingPermitsSql())]),
]);

/** The table part artifacts `bindRun` reads (names), so the loader can prefetch only those. */
export function permitsPartNames(manifest: {
  readonly artifacts: RunManifestV1["artifacts"];
}): string[] {
  return boundPartNames(manifest.artifacts, PERMITS_VIEWS);
}

/** Binds the Permits page's views to the manifest; `partUrl` is the read path the manifest came from (no mixed hosts). */
export function bindRun(
  engine: QueryEngine,
  manifestBytes: Uint8Array,
  partUrl: (artifact: { name: string; cid: string }) => string,
): Promise<BoundRun> {
  return bindManifest(manifestBytes, "", engine, { partUrl, views: PERMITS_VIEWS });
}

/**
 * Binds every contract view to the manifest, for the Explore SQL panel (AC-6): unlike the Permits
 * page it may query any view (v_property, v_roofing_permit, …). With the parts not prefetched
 * (a full run), DuckDB range-reads only what a query touches from `partUrl`.
 */
export function bindAllViews(
  engine: QueryEngine,
  manifestBytes: Uint8Array,
  partUrl: (artifact: { name: string; cid: string }) => string,
): Promise<BoundRun> {
  return bindManifest(manifestBytes, "", engine, { partUrl });
}

/**
 * A-16 A13-2: binds only `views` (the SQL panel's lazy binder). Lives in this chunk so the panel
 * reaches query-core's bind code through the lazy engine chunk, never the counted app chunks.
 */
export function bindViews(
  engine: QueryEngine,
  manifestBytes: Uint8Array,
  partUrl: (artifact: { name: string; cid: string }) => string,
  views: readonly ContractView[],
): Promise<BoundRun> {
  return bindManifest(manifestBytes, "", engine, { partUrl, views });
}

/** A-16 A13-2: the table part names `views` read (query-core boundPartNames). */
export function viewPartNames(
  artifacts: RunManifestV1["artifacts"],
  views: readonly ContractView[],
): string[] {
  return boundPartNames(artifacts, views);
}

/** A-16 A11-11: the first page of the listing, validated. Newest first, as the Permits page
 *  orders the full list (Permits.page newestFirst), so page 1 stays put when the rest arrives. */
export async function listFirstPage(
  engine: QueryEngine,
  pageSize: number,
): Promise<PermitListRow[]> {
  return parsePermitRows(
    await engine.all(
      `SELECT * FROM (${listRoofingPermitsSql()})\nORDER BY issue_date DESC NULLS LAST, permit_number, cid\nLIMIT ${pageSize}`,
    ),
  );
}

/** The single page of permits, ordered by permit_number (listRoofingPermitsSql), validated; measured as `countylens:query:list`. */
export async function listPermits(engine: QueryEngine): Promise<PermitListRow[]> {
  const rows = await timed(PERF_MEASURES.list, () => engine.all(listRoofingPermitsSql()));
  return parsePermitRows(rows);
}

/** COUNT over v_roofing_permit, measured as `countylens:query:count`. */
export async function countPermits(engine: QueryEngine): Promise<number> {
  const rows = await timed(PERF_MEASURES.count, () => engine.all(COUNT_PERMITS_SQL));
  const n = rows.length === 1 ? rows[0]?.["n"] : undefined;
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new Error(`Permits COUNT did not return one integer row (${rows.length} rows)`);
  }
  return n;
}
