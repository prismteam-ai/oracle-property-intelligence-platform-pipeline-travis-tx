// A-03 T053 (G-C4): the browser engine's configuration, without instantiating DuckDB-WASM
// (jsdom; no network). ADR-0001 Findings 1–2 and decision 4: the engine is opened with exactly
// `{ allowFullHTTPReads: true, forceFullHTTPReads: false, reliableHeadRequests: false }` (else
// every file is downloaded whole), the eh bundle is self-hosted and lazy-loaded, and the WASM is
// shipped only as duckdb-eh.wasm.gz, which the engine fetches and gunzips itself (T057, TC-028;
// 2026-10-21: Amplify rejects a Content-Encoding custom header, plan R2). The loader wiring is checked
// with fakes: the host that served the manifest is the host `partUrl` binds for the parts.
// Red run (before T054/T057): `Cannot find module '../src/engine/duckdb-wasm'`.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import type { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import { PERMITS_TEXTS, readPathUrls } from "@countylens/shared";
import type { QueryEngine, Row } from "@countylens/query-core";
import {
  DUCKDB_FILESYSTEM_FLAGS,
  DUCKDB_OPEN_CONFIG,
  SELF_HOSTED_BUNDLE,
  arrowToRows,
  compressedModuleUrl,
  fetchGzippedWasm,
  openEngine,
  type WasmFetchDeps,
  type ArrowTableLike,
  type AsyncDuckDbLike,
  type DuckDbOpenConfig,
  type DuckDbRuntime,
} from "../src/engine/duckdb-wasm";
import type { FetchByCidOptions } from "../src/data/fetch-by-cid";
import { EngineStartError } from "../src/engine/errors";
import { createPermitsLoader, type EngineModule } from "../src/engine/load-permits";
import { registeredPartName, type FetchedPart, type PartToFetch } from "../src/data/fetch-parts";
import { STAGE_TEXTS } from "../src/routes/Permits.page";
import { GZIP_LEVEL, WASM_FILE_PATTERN, compressWasm } from "../scripts/compress-wasm";

const RANGE_READ_FLAGS = {
  allowFullHTTPReads: true,
  forceFullHTTPReads: false,
  reliableHeadRequests: false,
};

interface FakeDb extends AsyncDuckDbLike {
  readonly calls: string[];
  readonly openConfigs: DuckDbOpenConfig[];
  readonly statements: string[];
  readonly registered: Map<string, Uint8Array>;
}

function fakeDb(options: { failInstantiate?: boolean } = {}): FakeDb {
  const calls: string[] = [];
  const openConfigs: DuckDbOpenConfig[] = [];
  const statements: string[] = [];
  const registered = new Map<string, Uint8Array>();
  const emptyTable: ArrowTableLike = { schema: { fields: [] }, toArray: () => [] };
  return {
    calls,
    openConfigs,
    statements,
    registered,
    async registerFileBuffer(name: string, buffer: Uint8Array) {
      calls.push(`registerFileBuffer:${name}`);
      registered.set(name, buffer);
    },
    async instantiate(mainModule: string) {
      calls.push(`instantiate:${mainModule}`);
      if (options.failInstantiate) throw new Error("WebAssembly.instantiate failed (fake)");
    },
    async open(config: DuckDbOpenConfig) {
      calls.push("open");
      openConfigs.push(config);
    },
    async connect() {
      calls.push("connect");
      return {
        async query(sql: string) {
          statements.push(sql);
          return emptyTable;
        },
        async close() {
          calls.push("connection.close");
        },
      };
    },
    async terminate() {
      calls.push("terminate");
    },
  };
}

function fakeRuntime(
  db: FakeDb,
  mainModule = "/assets/duckdb-eh-test.wasm",
  mainModuleEncoding: "gzip" | "identity" = "identity",
  extensions: DuckDbRuntime["extensions"] = [],
): DuckDbRuntime {
  return {
    extensions,
    bundle: {
      mainModule,
      mainModuleEncoding,
      mainWorker: "/assets/duckdb-browser-eh.worker-test.js",
      pthreadWorker: null,
    },
    createDb: (workerUrl) => {
      db.calls.push(`createDb:${workerUrl}`);
      return db;
    },
  };
}

describe("DuckDB-WASM open flags (ADR-0001 Finding 1, decision 4)", () => {
  it("names exactly the three range-read flags", () => {
    expect(DUCKDB_FILESYSTEM_FLAGS).toStrictEqual(RANGE_READ_FLAGS);
    expect(DUCKDB_OPEN_CONFIG).toStrictEqual({ filesystem: RANGE_READ_FLAGS });
  });

  it("instantiates the eh bundle, then opens the database with those flags, then connects", async () => {
    const db = fakeDb();
    const engine = await openEngine(() => Promise.resolve(fakeRuntime(db)));
    expect(db.openConfigs).toHaveLength(1);
    expect(db.openConfigs[0]).toStrictEqual({ filesystem: RANGE_READ_FLAGS });
    expect(db.calls.slice(0, 4)).toEqual([
      "createDb:/assets/duckdb-browser-eh.worker-test.js",
      "instantiate:/assets/duckdb-eh-test.wasm",
      "open",
      "connect",
    ]);
    // builders.ts: the engine's TimeZone must be UTC so as_of is the manifest's UTC date.
    expect(db.statements).toContain("SET TimeZone = 'UTC'");
    await engine.close();
    expect(db.calls).toContain("terminate");
  });

  it("reports an engine that cannot start with the fixed text, keeping the cause", async () => {
    const db = fakeDb({ failInstantiate: true });
    const failure = openEngine(() => Promise.resolve(fakeRuntime(db)));
    await expect(failure).rejects.toBeInstanceOf(EngineStartError);
    await expect(failure).rejects.toMatchObject({ message: PERMITS_TEXTS.engineFailure });
    await expect(failure).rejects.toHaveProperty("cause");
    expect(db.openConfigs).toHaveLength(0);
  });

  it("self-hosts the eh bundle (no CDN): the WASM and its worker by their dist file names", () => {
    expect(SELF_HOSTED_BUNDLE).toStrictEqual({
      mainModule: "duckdb-eh.wasm",
      mainWorker: "duckdb-browser-eh.worker.js",
    });
  });
});

describe("arrowToRows: JSON-shaped values (QueryEngine contract)", () => {
  // Arrow `Type` ids from the IPC format: Int 2, Utf8 5, Date 8, Timestamp 10, List 12, Struct 13.
  const table: ArrowTableLike = {
    schema: {
      fields: [
        { name: "permit_number", type: { typeId: 5 } },
        { name: "issue_date", type: { typeId: 8 } },
        { name: "captured_at", type: { typeId: 10, unit: 2 } },
        { name: "open_days", type: { typeId: 2 } },
        { name: "missing", type: { typeId: 12 } },
        { name: "as_of", type: { typeId: 10, unit: 1 } },
      ],
    },
    toArray: () => [
      {
        toJSON: () => ({
          permit_number: "TEST-0001",
          issue_date: Date.UTC(2026, 8, 3),
          captured_at: 1_792_000_000_000,
          open_days: 12n,
          missing: {
            toArray: () => [
              { toJSON: () => ({ field: "status_raw", reason: "no_lexicon_carrier" }) },
            ],
          },
          as_of: new Date("2026-10-01T00:00:00.000Z"),
        }),
      },
      {
        toJSON: () => ({
          permit_number: null,
          issue_date: null,
          captured_at: 1_792_000_000_000n,
          open_days: null,
          missing: { toArray: () => [] },
          as_of: 1_790_000_000_000,
        }),
      },
    ],
  };

  it("turns dates into YYYY-MM-DD, timestamps into ISO 8601 UTC, bigints into numbers and nested vectors into plain values", () => {
    const rows = arrowToRows(table);
    expect(rows).toEqual([
      {
        permit_number: "TEST-0001",
        issue_date: "2026-09-03",
        captured_at: new Date(1_792_000_000_000).toISOString(),
        open_days: 12,
        missing: [{ field: "status_raw", reason: "no_lexicon_carrier" }],
        as_of: "2026-10-01T00:00:00.000Z",
      },
      {
        permit_number: null,
        issue_date: null,
        captured_at: new Date(1_792_000_000_000).toISOString(),
        open_days: null,
        missing: [],
        as_of: new Date(1_790_000_000_000).toISOString(),
      },
    ]);
  });
});

/** A syntactically valid, obviously synthetic base32 CIDv1 (contract `isCidV1`). */
const cid = (tag: string): string => `bafkrei${tag}`.padEnd(59, "a");

describe("createPermitsLoader: index → manifest → engine → bind → list (partUrl wiring)", () => {
  const manifestCid = cid("manifest");
  const partCid = cid("part");
  const bytes = new TextEncoder().encode("{}");
  const urls = readPathUrls({
    cidCopyHost: "copy.test",
    filebaseGatewayHost: "gateway.test",
  });
  const index: RunsIndexV1 = {
    schema: "oracle-travis-runs-index.v1",
    runs: [{ runId: "test-run", manifestCid, finishedAt: "2026-10-01T00:00:00Z" }],
  };
  const partUrl = (artifact: { name: string; cid: string }): string =>
    `https://served.test/${artifact.cid}`;

  function deps(coverageCount: number | undefined) {
    const coverage: RunManifestV1["coverage"] =
      coverageCount === undefined
        ? {}
        : { permits_emitted: { count: coverageCount, derivation: "published_rows" } };
    const part = {
      kind: "table",
      name: "tables/county/property/part-00000.parquet",
      cid: partCid,
      size: 2,
      sha256: "0".repeat(64),
    };
    const manifest = {
      runId: "test-run",
      coverage,
      artifacts: [part, { ...part, kind: "car", name: "car/x.car", size: 10_000 }],
    } as unknown as RunManifestV1;
    const partBytes = new Uint8Array([1, 2]);
    const registered: [string, Uint8Array][] = [];
    const engine: QueryEngine & {
      closed: boolean;
      close(): Promise<void>;
      registerFile(name: string, bytes: Uint8Array): Promise<void>;
    } = {
      closed: false,
      registerFile: async (name: string, data: Uint8Array) => {
        registered.push([name, data]);
      },
      run: async () => undefined,
      all: async () => [],
      close: async () => {
        engine.closed = true;
      },
    };
    const rows: Row[] = [{ permit_number: "TEST-0001" }];
    const engineModule: EngineModule = {
      openEngine: vi.fn(async () => engine),
      permitsPartNames: (m) => m.artifacts.filter((a) => a.kind === "table").map((a) => a.name),
      bindRun: vi.fn(async () => ({
        runId: "test-run",
        manifestCid,
        asOf: "2026-10-01T00:00:00Z",
        tables: [],
        views: [],
      })),
      countPermits: vi.fn(async () => coverageCount ?? 0),
      listPermits: vi.fn(async () => rows as never),
    };
    const loadManifest = vi.fn(async (_cid: string, _options: FetchByCidOptions) => ({
      manifest,
      manifestCid,
      read: {
        cid: manifestCid,
        bytes,
        source: { kind: "fallback" as const, host: "gateway.test" },
        partUrl,
      },
    }));
    const fetchParts = vi.fn(async (parts: readonly PartToFetch[]): Promise<FetchedPart[]> =>
      parts.map((p) => ({ ...p, bytes: partBytes })),
    );
    return {
      engine,
      rows,
      engineModule,
      loadManifest,
      fetchParts,
      registered,
      partBytes,
      loader: createPermitsLoader({
        fetchParts,
        loadRunsIndex: vi.fn(async () => index),
        latestRun: (i: RunsIndexV1) => i.runs[0] as RunsIndexV1["runs"][number],
        loadManifest,
        fallbackLabel: (source) =>
          source.kind === "fallback" ? `fallback · ${source.host}` : null,
        urls,
        engine: () => Promise.resolve(engineModule),
      }),
    };
  }

  it("reads the parts from the host that served the manifest, registers them and binds them by name; stages in order", async () => {
    const d = deps(1);
    const stages: string[] = [];
    const loaded = await d.loader((stage) => stages.push(stage), new AbortController().signal);

    expect(d.loadManifest).toHaveBeenCalledTimes(1);
    expect(d.loadManifest.mock.calls[0]?.[0]).toBe(manifestCid);
    expect(d.loadManifest.mock.calls[0]?.[1]).toMatchObject({ urls });
    // ERR-15/16/17: the table parts only (not the CAR), from the read that served the manifest.
    expect(d.fetchParts).toHaveBeenCalledTimes(1);
    const [partsArg, readArg] = d.fetchParts.mock.calls[0] as unknown as [PartToFetch[], unknown];
    expect(partsArg).toEqual([
      {
        name: "tables/county/property/part-00000.parquet",
        cid: partCid,
        size: 2,
        sha256: "0".repeat(64),
      },
    ]);
    expect(readArg).toMatchObject({ source: { kind: "fallback", host: "gateway.test" }, partUrl });
    expect(d.registered).toEqual([[registeredPartName({ cid: partCid }), d.partBytes]]);
    expect(d.engineModule.bindRun).toHaveBeenCalledTimes(1);
    const bindCall = vi.mocked(d.engineModule.bindRun).mock.calls[0];
    expect(bindCall).toBeDefined();
    const [engineArg, bytesArg, partUrlArg] = bindCall as NonNullable<typeof bindCall>;
    expect(engineArg).toBe(d.engine);
    expect(bytesArg).toBe(bytes);
    expect(partUrlArg({ name: "tables/county/property/part-00000.parquet", cid: partCid })).toBe(
      registeredPartName({ cid: partCid }),
    );
    expect(stages).toEqual([
      STAGE_TEXTS.engine,
      STAGE_TEXTS.manifest,
      STAGE_TEXTS.bind,
      STAGE_TEXTS.query,
    ]);
    expect(loaded).toEqual({
      runId: "test-run",
      manifestCid,
      permitsEmitted: 1,
      rows: d.rows,
      fallbackLabel: "fallback · gateway.test",
    });
    await vi.waitFor(() => expect(d.engine.closed, "the engine is released").toBe(true));
  });

  it("refuses a manifest without coverage.permits_emitted (FR-009: counts only from the manifest)", async () => {
    const d = deps(undefined);
    await expect(d.loader(() => undefined, new AbortController().signal)).rejects.toThrow(
      /coverage\.permits_emitted/,
    );
  });
});

describe("gzip-compressed WASM (T057, TC-028; plan R2 fallback 2026-10-21)", () => {
  const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 1, 2, 3, 4, 5]);

  interface FakeWasmDeps extends WasmFetchDeps {
    readonly fetched: string[];
    readonly blobs: Blob[];
    readonly revoked: string[];
    readonly formats: string[];
  }

  function wasmDeps(
    options: {
      body?: Uint8Array;
      status?: number;
      headers?: Record<string, string>;
      noDecompressionStream?: boolean;
      log?: string[];
    } = {},
  ): FakeWasmDeps {
    const fetched: string[] = [];
    const blobs: Blob[] = [];
    const revoked: string[] = [];
    const formats: string[] = [];
    const body = options.body ?? new Uint8Array(gzipSync(WASM));
    // Records the format the engine asks for, then gunzips with the platform's own stream.
    class RecordingDecompressionStream extends DecompressionStream {
      constructor(format: CompressionFormat) {
        formats.push(format);
        super(format);
      }
    }
    return {
      fetched,
      blobs,
      revoked,
      formats,
      fetch: async (url: string) => {
        fetched.push(url);
        options.log?.push(`fetch:${url}`);
        return new Response(body as Uint8Array<ArrayBuffer>, {
          status: options.status ?? 200,
          headers: options.headers ?? { "content-type": "application/gzip" },
        });
      },
      DecompressionStream: options.noDecompressionStream ? undefined : RecordingDecompressionStream,
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return `blob:https://countylens.test/wasm-${blobs.length}`;
      },
      revokeObjectURL: (url: string) => {
        revoked.push(url);
        options.log?.push(`revoke:${url}`);
      },
    };
  }

  const bytesOf = async (blob: Blob): Promise<Uint8Array> =>
    new Uint8Array(await blob.arrayBuffer());

  it("names the .gz asset next to the Vite-emitted .wasm URL", () => {
    expect(compressedModuleUrl("/assets/duckdb-eh-Ab12cD3e.wasm")).toBe(
      "/assets/duckdb-eh-Ab12cD3e.wasm.gz",
    );
  });

  it("fetches the .gz, gunzips it through DecompressionStream and returns an application/wasm object URL", async () => {
    const deps = wasmDeps();
    const module = await fetchGzippedWasm("/assets/duckdb-eh-x.wasm.gz", deps);
    expect(deps.fetched).toEqual(["/assets/duckdb-eh-x.wasm.gz"]);
    expect(deps.formats).toEqual(["gzip"]);
    expect(module.url).toBe("blob:https://countylens.test/wasm-1");
    const blob = deps.blobs[0] as Blob;
    expect(blob.type).toBe("application/wasm");
    expect(await bytesOf(blob)).toEqual(WASM);
    module.revoke();
    expect(deps.revoked).toEqual([module.url]);
  });

  it("does not gunzip twice when the host already decoded a Content-Encoding: gzip response", async () => {
    const deps = wasmDeps({ body: WASM, headers: { "content-encoding": "gzip" } });
    const module = await fetchGzippedWasm("/assets/duckdb-eh-x.wasm.gz", deps);
    expect(deps.formats).toEqual([]);
    expect(await bytesOf(deps.blobs[0] as Blob)).toEqual(WASM);
    module.revoke();
  });

  it("fails on a non-2xx response naming the URL and status", async () => {
    const deps = wasmDeps({ status: 404 });
    await expect(fetchGzippedWasm("/assets/duckdb-eh-x.wasm.gz", deps)).rejects.toThrow(
      /duckdb-eh-x\.wasm\.gz.*404/,
    );
    expect(deps.blobs).toEqual([]);
  });

  it("fails before downloading when the browser has no DecompressionStream", async () => {
    const deps = wasmDeps({ noDecompressionStream: true });
    await expect(fetchGzippedWasm("/assets/duckdb-eh-x.wasm.gz", deps)).rejects.toThrow(
      /DecompressionStream/,
    );
    expect(deps.fetched).toEqual([]);
  });

  it("openEngine instantiates the gunzipped object URL, then revokes it, then opens with the flags", async () => {
    const db = fakeDb();
    const log = db.calls;
    const deps = wasmDeps({ log });
    const engine = await openEngine(
      () => Promise.resolve(fakeRuntime(db, "/assets/duckdb-eh-x.wasm.gz", "gzip")),
      deps,
    );
    expect(log.slice(0, 5)).toEqual([
      "createDb:/assets/duckdb-browser-eh.worker-test.js",
      "fetch:/assets/duckdb-eh-x.wasm.gz",
      "instantiate:blob:https://countylens.test/wasm-1",
      "revoke:blob:https://countylens.test/wasm-1",
      "open",
    ]);
    expect(db.openConfigs).toEqual([{ filesystem: RANGE_READ_FLAGS }]);
    expect(
      deps.fetched.some((url) => /\.wasm$/.test(url)),
      "raw .wasm never fetched",
    ).toBe(false);
    await engine.close();
  });

  it("revokes the object URL when instantiate fails, and reports the fixed engine text", async () => {
    const db = fakeDb({ failInstantiate: true });
    const deps = wasmDeps();
    const failure = openEngine(
      () => Promise.resolve(fakeRuntime(db, "/assets/duckdb-eh-x.wasm.gz", "gzip")),
      deps,
    );
    await expect(failure).rejects.toMatchObject({ message: PERMITS_TEXTS.engineFailure });
    expect(deps.revoked).toEqual(["blob:https://countylens.test/wasm-1"]);
    expect(db.calls).toContain("terminate");
  });

  it("no DecompressionStream: EngineStartError with the shared fixed text, nothing instantiated", async () => {
    const db = fakeDb();
    const deps = wasmDeps({ noDecompressionStream: true });
    const failure = openEngine(
      () => Promise.resolve(fakeRuntime(db, "/assets/duckdb-eh-x.wasm.gz", "gzip")),
      deps,
    );
    await expect(failure).rejects.toBeInstanceOf(EngineStartError);
    await expect(failure).rejects.toMatchObject({ message: PERMITS_TEXTS.engineFailure });
    expect(db.calls.filter((c) => c.startsWith("instantiate"))).toEqual([]);
    expect(deps.fetched).toEqual([]);
    expect(db.calls).toContain("terminate");
  });
});

describe("compress-wasm (T057, TC-028): gzip level 9 to duckdb-eh.wasm.gz, raw .wasm deleted", () => {
  const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  function dist(): { dir: string; wasm: string; other: string; original: Buffer } {
    const dir = mkdtempSync(join(tmpdir(), "countylens-wasm-"));
    mkdirSync(join(dir, "assets"));
    const body = Buffer.alloc(64 * 1024);
    for (let i = 0; i < body.length; i += 1) body[i] = (i * 7919) % 251;
    const original = Buffer.concat([Buffer.from(WASM_MAGIC), body]);
    const wasm = join(dir, "assets", "duckdb-eh-Ab12cD3e.wasm");
    const other = join(dir, "assets", "other-module-Xy9.wasm");
    writeFileSync(wasm, original);
    writeFileSync(other, original);
    return { dir, wasm, other, original };
  }

  it("matches the hashed Vite asset name of the eh bundle only", () => {
    expect(WASM_FILE_PATTERN.test("duckdb-eh.wasm")).toBe(true);
    expect(WASM_FILE_PATTERN.test("duckdb-eh-Ab12cD3e.wasm")).toBe(true);
    expect(WASM_FILE_PATTERN.test("duckdb-mvp.wasm")).toBe(false);
    expect(WASM_FILE_PATTERN.test("duckdb-browser-eh.worker.js")).toBe(false);
    expect(GZIP_LEVEL).toBe(9);
  });

  it("writes <name>.wasm.gz that gunzips to the original, deletes the raw .wasm, skips other files", () => {
    const { dir, wasm, other, original } = dist();
    const report = compressWasm(dir);
    expect(report.files.map((f) => f.path)).toEqual([`${wasm}.gz`]);
    expect(existsSync(wasm), "the uncompressed .wasm is never served").toBe(false);
    const compressed = readFileSync(`${wasm}.gz`);
    expect(gunzipSync(compressed).equals(original)).toBe(true);
    expect(report.files[0]).toMatchObject({
      bytes: original.length,
      compressedBytes: compressed.length,
      skipped: false,
    });
    expect(readFileSync(other).equals(original), "non-eh wasm untouched").toBe(true);
  });

  it("is idempotent: a second run keeps the .gz and reports it as already compressed", () => {
    const { dir, wasm, original } = dist();
    compressWasm(dir);
    const once = readFileSync(`${wasm}.gz`);
    const report = compressWasm(dir);
    expect(report.files).toHaveLength(1);
    expect(report.files[0]).toMatchObject({ path: `${wasm}.gz`, skipped: true });
    expect(existsSync(wasm)).toBe(false);
    expect(readFileSync(`${wasm}.gz`).equals(once)).toBe(true);
    expect(gunzipSync(readFileSync(`${wasm}.gz`)).equals(original)).toBe(true);
  });

  it("reports nothing when no eh bundle is in the output", () => {
    const dir = mkdtempSync(join(tmpdir(), "countylens-wasm-empty-"));
    expect(compressWasm(dir).files).toEqual([]);
  });
});
