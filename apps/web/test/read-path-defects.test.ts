// A-03 hosted defects ERR-14…ERR-17 (hosted Playwright, 2026-10-21), written before the fixes:
// ERR-14 DuckDB autoloaded icu/json/parquet from extensions.duckdb.org (TC-023, TC-028);
// ERR-15 the Filebase fallback failed with net::ERR_FAILED (the gateway's HTTP 429 carries no
//        CORS headers) under DuckDB's burst of sequential part requests (TC-032…034);
// ERR-16 with 2 s per CID-copy request the page never finished (84 sequential requests, TC-024);
// ERR-17 first load p95 11.4 s > 8 s: the engine start preceded every data read (TC-NF-01).
// jsdom, no network: DuckDB is a fake, `fetch` is a fake, the vendored binaries are read from disk.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import type { RunManifestV1, RunsIndexV1 } from "@countylens/contract";
import { rawCid, type QueryEngine } from "@countylens/query-core";
import { readPathUrls } from "@countylens/shared";
import {
  ENGINE_EXTENSIONS,
  EXTENSION_SETTINGS_SQL,
  loadExtensionSql,
  loadSelfHostedDuckDb,
  openEngine,
  type ArrowTableLike,
  type AsyncDuckDbLike,
  type DuckDbRuntime,
  type WasmFetchDeps,
} from "../src/engine/duckdb-wasm";
import { EngineStartError } from "../src/engine/errors";
import { createPermitsLoader, type EngineModule } from "../src/engine/load-permits";
import {
  PART_CONCURRENCY,
  PART_PREFETCH_MAX_BYTES,
  PartReadError,
  fetchParts,
  partRangeHeader,
  partsToPrefetch,
  registeredPartName,
  type PartToFetch,
} from "../src/data/fetch-parts";
import type { FetchByCidResult } from "../src/data/fetch-by-cid";

const ORIGIN = "https://countylens.test";
const HERE = dirname(fileURLToPath(import.meta.url));

/** An absolute URL that is not on this page's origin (blob: URLs of this page are same-origin). */
function foreignHost(url: string): string | null {
  if (url.startsWith("blob:")) return new URL(url.slice(5)).origin === ORIGIN ? null : url;
  const parsed = new URL(url, ORIGIN);
  return parsed.origin === ORIGIN ? null : parsed.origin;
}

interface RecordingDb extends AsyncDuckDbLike {
  readonly log: string[];
  readonly statements: string[];
}

function recordingDb(log: string[] = []): RecordingDb {
  const statements: string[] = [];
  const empty: ArrowTableLike = { schema: { fields: [] }, toArray: () => [] };
  return {
    log,
    statements,
    async instantiate(module: string) {
      log.push(`instantiate:${module}`);
    },
    async open() {
      log.push("open");
    },
    async connect() {
      log.push("connect");
      return {
        async query(sql: string) {
          statements.push(sql);
          log.push(`query:${sql}`);
          return empty;
        },
        async close() {},
      };
    },
    async registerFileBuffer(name: string) {
      log.push(`register:${name}`);
    },
    async terminate() {
      log.push("terminate");
    },
  };
}

const EXTENSION_ASSETS: DuckDbRuntime["extensions"] = ENGINE_EXTENSIONS.map((name) => ({
  name,
  url: `/assets/${name}.duckdb_extension-h4sh.wasm.gz`,
}));

function runtimeWith(db: RecordingDb, extensions = EXTENSION_ASSETS): DuckDbRuntime {
  return {
    bundle: {
      mainModule: "/assets/duckdb-eh-h4sh.wasm.gz",
      mainModuleEncoding: "gzip",
      mainWorker: "/assets/duckdb-browser-eh.worker-h4sh.js",
      pthreadWorker: null,
    },
    extensions,
    createDb: () => db,
  };
}

function wasmDeps(
  log: string[],
  options: { failUrl?: string } = {},
): WasmFetchDeps & {
  fetched: string[];
  revoked: string[];
} {
  const fetched: string[] = [];
  const revoked: string[] = [];
  let n = 0;
  const body = new Uint8Array(gzipSync(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0])));
  return {
    fetched,
    revoked,
    fetch: async (url: string) => {
      fetched.push(url);
      log.push(`fetch:${url}`);
      if (url === options.failUrl) return new Response(null, { status: 404 });
      return new Response(body as Uint8Array<ArrayBuffer>, { status: 200 });
    },
    DecompressionStream,
    createObjectURL: () => {
      n += 1;
      return `blob:${ORIGIN}/object-${n}`;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  };
}

describe("ERR-14: no request to extensions.duckdb.org (TC-023, TC-028)", () => {
  it("turns autoinstall and autoload off before any other statement, then LOADs every extension from a same-origin object URL", async () => {
    const log: string[] = [];
    const db = recordingDb(log);
    const deps = wasmDeps(log);
    const engine = await openEngine(() => Promise.resolve(runtimeWith(db)), deps);

    expect(db.statements.slice(0, 2)).toEqual([...EXTENSION_SETTINGS_SQL]);
    expect(EXTENSION_SETTINGS_SQL).toEqual([
      "SET autoinstall_known_extensions = false",
      "SET autoload_known_extensions = false",
    ]);
    const loads = db.statements.filter((sql) => sql.startsWith("LOAD "));
    expect(loads).toHaveLength(ENGINE_EXTENSIONS.length);
    for (const [i, name] of ENGINE_EXTENSIONS.entries()) {
      expect(loads[i]).toMatch(
        new RegExp(`^LOAD 'blob:${ORIGIN}/object-\\d+#/${name}\\.duckdb_extension\\.wasm'$`),
      );
    }
    // Every LOAD precedes the first query that could need an extension.
    const timezone = db.statements.indexOf("SET TimeZone = 'UTC'");
    expect(timezone).toBeGreaterThan(db.statements.indexOf(loads.at(-1) as string));

    // Nothing the engine fetched or LOADed is on another host.
    const urls = [
      ...deps.fetched,
      ...loads.map((sql) => /'([^'#]+)/.exec(sql)?.[1] ?? sql),
      ...log.filter((l) => l.startsWith("instantiate:")).map((l) => l.slice(12)),
    ];
    expect(urls.map(foreignHost).filter((host) => host !== null)).toEqual([]);
    expect(
      deps.fetched.filter((url) => url.endsWith(".wasm")),
      "only .wasm.gz",
    ).toEqual([]);
    expect(deps.revoked).toHaveLength(ENGINE_EXTENSIONS.length + 1);
    await engine.close();
  });

  it("downloads the extensions in parallel with the engine binary (ERR-17), before instantiate", async () => {
    const log: string[] = [];
    const db = recordingDb(log);
    await openEngine(() => Promise.resolve(runtimeWith(db)), wasmDeps(log));
    const firstInstantiate = log.findIndex((l) => l.startsWith("instantiate:"));
    const extensionFetches = log
      .map((l, i) => (l.includes(".duckdb_extension") && l.startsWith("fetch:") ? i : -1))
      .filter((i) => i >= 0);
    expect(extensionFetches).toHaveLength(ENGINE_EXTENSIONS.length);
    expect(Math.max(...extensionFetches)).toBeLessThan(firstInstantiate);
  });

  it("refuses to LOAD from anything but an object URL of this page", () => {
    expect(() =>
      loadExtensionSql(
        "https://extensions.duckdb.org/v1.5.4/wasm_eh/icu.duckdb_extension.wasm",
        "icu",
      ),
    ).toThrow(/same-origin object URL/);
    expect(() => loadExtensionSql("blob:x/'; DROP", "json")).toThrow(/same-origin object URL/);
    expect(loadExtensionSql(`blob:${ORIGIN}/abc`, "parquet")).toBe(
      `LOAD 'blob:${ORIGIN}/abc#/parquet.duckdb_extension.wasm'`,
    );
  });

  it("a missing extension asset fails the engine start with the fixed text and releases every object URL", async () => {
    const log: string[] = [];
    const db = recordingDb(log);
    const deps = wasmDeps(log, { failUrl: EXTENSION_ASSETS[1]?.url as string });
    const failure = openEngine(() => Promise.resolve(runtimeWith(db)), deps);
    await expect(failure).rejects.toBeInstanceOf(EngineStartError);
    expect(db.statements.some((sql) => sql.startsWith("LOAD "))).toBe(false);
    expect(log).toContain("terminate");
    await vi.waitFor(() =>
      expect(new Set(deps.revoked).size, "engine + the two extensions that arrived").toBe(3),
    );
  });

  it("the production runtime names only same-origin build assets: the engine, its worker and the vendored .wasm.gz extensions", async () => {
    const runtime = await loadSelfHostedDuckDb();
    expect(runtime.extensions.map((e) => e.name)).toEqual([...ENGINE_EXTENSIONS]);
    const urls = [
      runtime.bundle.mainModule,
      runtime.bundle.mainWorker,
      ...runtime.extensions.map((e) => e.url),
    ];
    expect(urls.map(foreignHost).filter((host) => host !== null)).toEqual([]);
    for (const extension of runtime.extensions) {
      expect(extension.url).toMatch(
        new RegExp(`/${extension.name}\\.duckdb_extension\\.wasm\\.gz(\\?.*)?$`),
      );
    }
  });

  it("the source never names the DuckDB extension host", () => {
    const source = readFileSync(resolve(HERE, "..", "src", "engine", "duckdb-wasm.ts"), "utf8");
    expect(source).not.toMatch(/https?:\/\/[^\s"'`]*duckdb\.org/);
    expect(source).not.toMatch(/custom_extension_repository|INSTALL\s/);
  });
});

describe("ERR-14: the vendored extensions are DuckDB's own binaries for the bundled engine version", () => {
  // A plain path (Vite rewrites `new URL(…, import.meta.url)` into an asset URL).
  const vendorFile = (path: string): string =>
    resolve(HERE, "..", "vendor", "duckdb-extensions", path);
  const manifest = JSON.parse(readFileSync(vendorFile("manifest.json"), "utf8")) as {
    duckdbVersion: string;
    platform: string;
    extensions: Record<string, { path: string; rawSha256: string; rawBytes: number }>;
  };

  it("vendors exactly the engine's extensions, for the eh platform", () => {
    expect(Object.keys(manifest.extensions).sort()).toEqual([...ENGINE_EXTENSIONS].sort());
    expect(manifest.platform).toBe("wasm_eh");
  });

  it("each .wasm.gz gunzips to the recorded SHA-256 and size, and is WebAssembly", () => {
    for (const [name, entry] of Object.entries(manifest.extensions)) {
      expect(entry.path).toBe(`${manifest.duckdbVersion}/wasm_eh/${name}.duckdb_extension.wasm.gz`);
      const raw = gunzipSync(readFileSync(vendorFile(entry.path)));
      expect(raw.length, name).toBe(entry.rawBytes);
      expect(createHash("sha256").update(raw).digest("hex"), name).toBe(entry.rawSha256);
      expect([...raw.subarray(0, 4)], name).toEqual([0x00, 0x61, 0x73, 0x6d]);
    }
  });

  it("matches the newest DuckDB release named inside the bundled duckdb-eh.wasm", async () => {
    const { default: wasmUrl } = await import("@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url");
    const path = wasmUrl.startsWith("/@fs/") ? wasmUrl.slice(4) : wasmUrl;
    const text = readFileSync(path.split("?")[0] as string).toString("latin1");
    const versions = [...new Set(text.match(/\bv1\.\d+\.\d+(?=\0)/g) ?? [])];
    const newest = versions
      .map((v) => v.slice(1).split(".").map(Number) as [number, number, number])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
      .at(-1);
    expect(newest && `v${newest.join(".")}`).toBe(manifest.duckdbVersion);
  });
});

/** A small published-looking part: its CID is the real raw-leaves CID of its bytes. */
async function part(i: number): Promise<{ part: PartToFetch; bytes: Uint8Array }> {
  const bytes = new TextEncoder().encode(`PAR1 test part ${i}`);
  return {
    part: {
      name: `tables/county/t${i}/part-00000.parquet`,
      cid: await rawCid(bytes),
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    bytes,
  };
}

const URLS = readPathUrls({ cidCopyHost: "copy.test", filebaseGatewayHost: "ipfs.filebase.io" });

function readFrom(kind: "copy" | "fallback"): Pick<FetchByCidResult, "source" | "partUrl"> {
  return kind === "copy"
    ? { source: { kind, host: "copy.test" }, partUrl: (a) => URLS.copyUrl(a.cid) }
    : {
        source: { kind, host: "ipfs.filebase.io" },
        partUrl: (a) => URLS.gatewayUrl(a.cid, "filebase"),
      };
}

interface FakeHost {
  readonly fetch: typeof fetch;
  readonly requests: { url: string; range: string | null }[];
  maxInFlight: number;
}

/** Serves `bytes` by CID; `answer` may override a request (status, throw) by its index. */
function fakeHost(
  byCid: Map<string, Uint8Array>,
  options: { delayMs?: number; answer?: (n: number) => "429" | "network" | "500" | undefined } = {},
): FakeHost {
  const host: FakeHost = {
    requests: [],
    maxInFlight: 0,
    fetch: async (input, init) => {
      const url = String(input);
      const range = new Headers(init?.headers).get("range");
      const n = host.requests.push({ url, range }) - 1;
      inFlight += 1;
      host.maxInFlight = Math.max(host.maxInFlight, inFlight);
      try {
        if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
        const override = options.answer?.(n);
        if (override === "network") throw new TypeError("Failed to fetch");
        if (override === "429") return new Response("", { status: 429 });
        if (override === "500") return new Response("", { status: 500 });
        const cid = url.split("/").at(-1) as string;
        const bytes = byCid.get(cid);
        if (!bytes) return new Response("", { status: 404 });
        return new Response(bytes as Uint8Array<ArrayBuffer>, {
          status: 206,
          headers: { "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}` },
        });
      } finally {
        inFlight -= 1;
      }
    },
  };
  let inFlight = 0;
  return host;
}

const noSleep = async (): Promise<void> => undefined;

describe("ERR-15: Filebase fallback reads survive the gateway's CORS-less 429 (TC-032…034)", () => {
  it("reads from the path-style gateway URL https://ipfs.filebase.io/ipfs/<cid> (no subdomain redirect)", async () => {
    const { part: p, bytes } = await part(1);
    const host = fakeHost(new Map([[p.cid, bytes]]));
    await fetchParts([p], readFrom("fallback"), { fetch: host.fetch, sleep: noSleep });
    expect(host.requests.map((r) => r.url)).toEqual([`https://ipfs.filebase.io/ipfs/${p.cid}`]);
  });

  it("retries a dropped request (a 429 without CORS reaches the page as a TypeError) and a 429 status, then succeeds", async () => {
    const { part: p, bytes } = await part(2);
    const host = fakeHost(new Map([[p.cid, bytes]]), {
      answer: (n) => (n === 0 ? "network" : n === 1 ? "429" : undefined),
    });
    const sleeps: number[] = [];
    const [got] = await fetchParts([p], readFrom("fallback"), {
      fetch: host.fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(Array.from(got?.bytes ?? [])).toEqual(Array.from(bytes));
    expect(host.requests).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("gives up after the retries with a PartReadError naming the part and the host", async () => {
    const { part: p, bytes } = await part(3);
    const host = fakeHost(new Map([[p.cid, bytes]]), { answer: () => "500" });
    const failure = fetchParts([p], readFrom("fallback"), { fetch: host.fetch, sleep: noSleep });
    await expect(failure).rejects.toBeInstanceOf(PartReadError);
    await expect(failure).rejects.toThrow(new RegExp(`${p.cid}.*ipfs\\.filebase\\.io.*HTTP 500`));
    expect(host.requests).toHaveLength(5);
  });

  it("never sends more than PART_CONCURRENCY.fallback requests to the gateway at once", async () => {
    const parts = await Promise.all(Array.from({ length: 21 }, (_, i) => part(i)));
    const host = fakeHost(new Map(parts.map((p) => [p.part.cid, p.bytes])), { delayMs: 5 });
    await fetchParts(
      parts.map((p) => p.part),
      readFrom("fallback"),
      { fetch: host.fetch, sleep: noSleep },
    );
    expect(PART_CONCURRENCY.fallback).toBe(3);
    expect(host.maxInFlight).toBe(PART_CONCURRENCY.fallback);
  });

  it("rejects bytes whose SHA-256 differs from the manifest's, naming both hashes, without retrying", async () => {
    const { part: p } = await part(4);
    const wrong = new TextEncoder().encode("PAR1 test part 9");
    const host = fakeHost(new Map([[p.cid, wrong]]));
    const failure = fetchParts([{ ...p, size: 16 }], readFrom("copy"), {
      fetch: host.fetch,
      sleep: noSleep,
    });
    await expect(failure).rejects.toBeInstanceOf(PartReadError);
    await expect(failure).rejects.toThrow(
      `bytes hash to sha256 ${createHash("sha256").update(wrong).digest("hex")}, the manifest says ${p.sha256}`,
    );
    expect(host.requests).toHaveLength(1);
  });

  it("accepts bytes whose SHA-256 equals the manifest's, whatever the part's CID looks like", async () => {
    const { part: p, bytes } = await part(5);
    // A dag-pb (bafybei…) CID, as the manifest records for a part above one 256 KiB chunk.
    const dagPb = { ...p, cid: "bafybei".padEnd(59, "a") };
    const host = fakeHost(new Map([[dagPb.cid, bytes]]));
    const [got] = await fetchParts([dagPb], readFrom("copy"), {
      fetch: host.fetch,
      sleep: noSleep,
    });
    expect(Array.from(got?.bytes ?? [])).toEqual(Array.from(bytes));
  });

  it("accepts a part above 256 KiB (a real run's parts: rawCid cannot hash it) and rejects one flipped byte of it", async () => {
    const bytes = new Uint8Array(3_158_845).map((_, i) => (i * 31) % 251);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const big: PartToFetch = {
      name: "tables/b01/address/part-00000.parquet",
      cid: "bafybeicfyesy527ylqbv775pocfvxak7z7rgxleh5s5jaw277w5mxd4y2m",
      size: bytes.length,
      sha256,
    };
    const ok = fakeHost(new Map([[big.cid, bytes]]));
    const [got] = await fetchParts([big], readFrom("copy"), { fetch: ok.fetch, sleep: noSleep });
    expect(got?.bytes.length).toBe(3_158_845);
    const flipped = bytes.slice();
    flipped[1_000_000] = (flipped[1_000_000] ?? 0) ^ 1;
    const bad = fakeHost(new Map([[big.cid, flipped]]));
    await expect(
      fetchParts([big], readFrom("copy"), { fetch: bad.fetch, sleep: noSleep }),
    ).rejects.toThrow(/bytes hash to sha256 .*the manifest says/);
  });
});

describe("ERR-16: a slow but working CID copy still finishes (TC-024, 2 s per request)", () => {
  it("reads each part with exactly one ranged GET (206, TC-026), in parallel on the copy", async () => {
    const parts = await Promise.all(Array.from({ length: 21 }, (_, i) => part(i)));
    const host = fakeHost(new Map(parts.map((p) => [p.part.cid, p.bytes])), { delayMs: 20 });
    const started = Date.now();
    const got = await fetchParts(
      parts.map((p) => p.part),
      readFrom("copy"),
      { fetch: host.fetch, sleep: noSleep },
    );
    const elapsed = Date.now() - started;
    expect(got.map((g) => g.cid)).toEqual(parts.map((p) => p.part.cid));
    expect(host.requests).toHaveLength(21);
    for (const [i, request] of host.requests.entries()) {
      const size = parts.find((p) => request.url.endsWith(p.part.cid))?.part.size ?? -1;
      expect(request.range, `request ${i}`).toBe(`bytes=0-${size - 1}`);
    }
    expect(host.maxInFlight).toBe(PART_CONCURRENCY.copy);
    // 21 parts at 16 in flight: 2 waves of one request, not 84 sequential requests (DuckDB's XHRs).
    expect(elapsed).toBeLessThan(21 * 20);
  });

  it("asks for the whole part as one range; an empty part asks for none", () => {
    expect(partRangeHeader(2215)).toEqual({ Range: "bytes=0-2214" });
    expect(partRangeHeader(0)).toEqual({});
  });

  it("prefetches only the table parts, and nothing when they exceed PART_PREFETCH_MAX_BYTES (DuckDB range-reads them)", () => {
    const artifacts = [
      {
        kind: "table",
        name: "tables/a/b/part-0.parquet",
        cid: "c1",
        size: 10,
        sha256: "a".repeat(64),
      },
      { kind: "car", name: "car/x.car", cid: "c2", size: 99 },
      { kind: "directory", name: "tables/a", cid: "c3", size: 5 },
    ] as unknown as RunManifestV1["artifacts"];
    expect(partsToPrefetch({ artifacts })).toEqual([
      { name: "tables/a/b/part-0.parquet", cid: "c1", size: 10, sha256: "a".repeat(64) },
    ]);
    expect(partsToPrefetch({ artifacts }, 9)).toBeNull();
    expect(PART_PREFETCH_MAX_BYTES).toBe(16 * 1024 * 1024);
  });

  it("a run read from the Filebase fallback is always prefetched, even above PART_PREFETCH_MAX_BYTES (ERR-15 resurfaces otherwise)", async () => {
    // A run this large (> PART_PREFETCH_MAX_BYTES) would normally be left to DuckDB's own
    // uncontrolled range reads (ERR-16/17's intended path for the copy). Read from the fallback,
    // that path has no concurrency cap and no 429/CORS-tolerant retry, so it must not be used.
    const bigPart = {
      kind: "table",
      name: "tables/a/big.parquet",
      cid: "c-big",
      size: PART_PREFETCH_MAX_BYTES + 1,
    };
    const manifest = {
      runId: "test-run",
      coverage: { permits_emitted: { count: 0, derivation: "published_rows" } },
      artifacts: [bigPart],
    } as unknown as RunManifestV1;
    const manifestCid = "bafkreimanifest".padEnd(59, "a");
    const index: RunsIndexV1 = {
      schema: "oracle-travis-runs-index.v1",
      runs: [{ runId: "test-run", manifestCid, finishedAt: "2026-10-01T00:00:00Z" }],
    };
    const engine: QueryEngine & { registerFile(): Promise<void>; close(): Promise<void> } = {
      registerFile: async () => undefined,
      run: async () => undefined,
      all: async () => [],
      close: async () => undefined,
    };
    const engineModule: EngineModule = {
      openEngine: async () => engine,
      permitsPartNames: (m) => m.artifacts.filter((a) => a.kind === "table").map((a) => a.name),
      bindRun: async () => ({ runId: "test-run", manifestCid, asOf: "x", tables: [], views: [] }),
      countPermits: async () => 0,
      listPermits: async () => [],
    };
    const captured: { parts: readonly PartToFetch[] | null } = { parts: null };
    const load = createPermitsLoader({
      loadRunsIndex: async () => index,
      latestRun: (i) => i.runs[0] as RunsIndexV1["runs"][number],
      loadManifest: async () => ({
        manifest,
        manifestCid,
        read: {
          cid: manifestCid,
          bytes: new Uint8Array(),
          source: { kind: "fallback" as const, host: "ipfs.filebase.io" },
          partUrl: () => "https://ipfs.filebase.io/ipfs/c-big",
        },
      }),
      fetchParts: async (parts: readonly PartToFetch[]) => {
        captured.parts = parts;
        return parts.map((p) => ({ ...p, bytes: new Uint8Array(p.size) }));
      },
      fallbackLabel: () => "fallback · ipfs.filebase.io",
      urls: URLS,
      engine: async () => engineModule,
    });
    await load(() => undefined, new AbortController().signal);
    // null would mean DuckDB range-reads it itself (unprotected); it must go through fetchParts.
    expect(captured.parts).not.toBeNull();
    expect(captured.parts?.map((p) => p.cid)).toEqual(["c-big"]);
  });

  it("registers a part under a host-free name", () => {
    expect(registeredPartName({ cid: "bafkreiabc" })).toBe("countylens-part-bafkreiabc.parquet");
  });
});

describe("ERR-17: the engine starts with the first data read, not before it (TC-NF-01)", () => {
  const manifestCid = "bafkreimanifest".padEnd(59, "a");
  const index: RunsIndexV1 = {
    schema: "oracle-travis-runs-index.v1",
    runs: [{ runId: "test-run", manifestCid, finishedAt: "2026-10-01T00:00:00Z" }],
  };
  const manifest = {
    runId: "test-run",
    coverage: { permits_emitted: { count: 0, derivation: "published_rows" } },
    artifacts: [],
  } as unknown as RunManifestV1;

  function deferred<T>(): {
    promise: Promise<T>;
    resolve: (v: T) => void;
    reject: (e: unknown) => void;
  } {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function setup(options: { engineFails?: boolean; manifestFails?: boolean } = {}) {
    const log: string[] = [];
    const indexRead = deferred<RunsIndexV1>();
    const engineOpen = deferred<undefined>();
    let closed = false;
    const engine: QueryEngine & {
      registerFile(): Promise<void>;
      close(): Promise<void>;
    } = {
      registerFile: async () => undefined,
      run: async () => undefined,
      all: async () => [],
      close: async () => {
        closed = true;
      },
    };
    const engineModule: EngineModule = {
      openEngine: vi.fn(async () => {
        log.push("openEngine");
        await engineOpen.promise;
        if (options.engineFails) throw new EngineStartError(new Error("fake"));
        return engine;
      }),
      permitsPartNames: (m) => m.artifacts.filter((a) => a.kind === "table").map((a) => a.name),
      bindRun: vi.fn(async () => ({
        runId: "test-run",
        manifestCid,
        asOf: "x",
        tables: [],
        views: [],
      })),
      countPermits: vi.fn(async () => 0),
      listPermits: vi.fn(async () => []),
    };
    const load = createPermitsLoader({
      loadRunsIndex: async () => {
        log.push("index");
        return indexRead.promise;
      },
      latestRun: (i) => i.runs[0] as RunsIndexV1["runs"][number],
      loadManifest: async () => {
        log.push("manifest");
        if (options.manifestFails) throw new Error("both hosts down (fake)");
        return {
          manifest,
          manifestCid,
          read: {
            cid: manifestCid,
            bytes: new Uint8Array(),
            source: { kind: "copy" as const, host: "copy.test" },
            partUrl: () => "https://copy.test/x",
          },
        };
      },
      fetchParts: async () => [],
      fallbackLabel: () => null,
      urls: URLS,
      engine: async () => {
        log.push("engine chunk");
        return engineModule;
      },
    });
    return { log, indexRead, engineOpen, load, isClosed: () => closed };
  }

  it("opens the engine while the run index and the manifest are still being read", async () => {
    const s = setup();
    const done = s.load(() => undefined, new AbortController().signal);
    await vi.waitFor(() => expect(s.log).toContain("openEngine"));
    expect(s.log).toContain("index");
    expect(s.log, "the manifest read does not wait for the engine").not.toContain("bound");
    s.indexRead.resolve(index);
    await vi.waitFor(() => expect(s.log).toContain("manifest"));
    s.engineOpen.resolve(undefined);
    await done;
    await vi.waitFor(() => expect(s.isClosed()).toBe(true));
  });

  it("an engine that cannot start still fails the load with EngineStartError", async () => {
    const s = setup({ engineFails: true });
    s.indexRead.resolve(index);
    s.engineOpen.resolve(undefined);
    await expect(s.load(() => undefined, new AbortController().signal)).rejects.toBeInstanceOf(
      EngineStartError,
    );
  });

  it("a failed manifest read reports that failure and still releases the engine once it has started", async () => {
    const s = setup({ manifestFails: true });
    s.indexRead.resolve(index);
    await expect(s.load(() => undefined, new AbortController().signal)).rejects.toThrow(
      /both hosts down/,
    );
    s.engineOpen.resolve(undefined);
    await vi.waitFor(() => expect(s.isClosed()).toBe(true));
  });
});
