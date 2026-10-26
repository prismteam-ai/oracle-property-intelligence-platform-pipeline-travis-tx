// A-16 T012/T013/T015 (AC-13, A14-6, A14-8): the Lambda reader of the per-run Explore index and
// the typed errors it surfaces. TEST FIXTURES only (tiny invented Parquet files and manifests).
// Covers: index.json verification (schema, manifest CID, view-SQL hash -> index_stale), the /tmp
// download with SHA-256 checks, one load in flight per CID, the views over read_parquet on a real
// DuckDB, duckdb-node's bind from an index (no part read) and its index_not_built refusal for a
// full-county run with no index, explore.search's PRECONDITION_FAILED and owner-area notice, the
// MCP isError result and the per-call deadline.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import type { APIGatewayProxyEventV2, Context as LambdaContext } from "aws-lambda";
import { resolvePlace } from "@countylens/query-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPLORE_INDEX_SCHEMA,
  INDEX_MESSAGES,
  IndexUnavailableError,
  VIEWS_SHA256,
  indexViewsSql,
  loadIndex,
  loadIndexOnce,
  resetIndexCache,
  type IndexStoreDeps,
} from "../src/engine/explore-index.js";
import {
  ENV,
  fakeEngine,
  fixtureManifest,
  serveFixture,
  type FakeEngine,
} from "./helpers/fakes.js";

const seam = vi.hoisted(() => ({ engine: undefined as unknown }));
vi.mock("../src/engine/duckdb-instance.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/engine/duckdb-instance.js")>();
  return { ...real, openDuckDb: vi.fn(async () => seam.engine) };
});

const VIEWS = ["v_property", "v_roofing_permit", "v_contractor", "v_run"] as const;
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s);
const PREFIX = "private/explore-index/";

/** index.json + four files for `cid`, as the publisher writes them. */
function indexObjects(
  cid: string,
  patch: Record<string, unknown> = {},
  files: Partial<Record<(typeof VIEWS)[number], Uint8Array>> = {},
): Map<string, Uint8Array> {
  const objects = new Map<string, Uint8Array>();
  const header: Record<string, unknown> = {
    schema: EXPLORE_INDEX_SCHEMA,
    manifestCid: cid,
    runId: "travis-index-fixture",
    asOf: "2026-10-24T18:20:49Z",
    viewsSha256: VIEWS_SHA256,
    files: {},
    ownerArea: { knownRows: 0, published: false },
    ...patch,
  };
  for (const v of VIEWS) {
    const body = files[v] ?? bytesOf(`parquet ${v} ${cid}`);
    const key = `${PREFIX}${cid}/${v}.parquet`;
    objects.set(key, body);
    (header.files as Record<string, unknown>)[v] = {
      key,
      sha256: sha(body),
      bytes: body.length,
      rows: 1,
    };
  }
  objects.set(`${PREFIX}${cid}/index.json`, bytesOf(JSON.stringify(header)));
  return objects;
}

function store(
  objects: Map<string, Uint8Array>,
  cacheDir: string,
): IndexStoreDeps & { gets: string[] } {
  const gets: string[] = [];
  return {
    gets,
    prefix: PREFIX,
    cacheDir,
    getObject: async (key) => {
      gets.push(key);
      return objects.get(key);
    },
  };
}

let tmp: string;
beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "countylens-index-test-"));
  await resetIndexCache();
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("loadIndex (T012)", () => {
  const CID = "bafkreife3vk3cgcod3v6tue2xes3hvl2vndqoshbhrhsnjtriskihpcute";

  it("no prefix configured or no index.json -> undefined (not built), nothing downloaded", async () => {
    const s = store(new Map(), tmp);
    expect(await loadIndex(CID, { ...s, prefix: undefined })).toBeUndefined();
    expect(s.gets).toEqual([]);
    expect(await loadIndex(CID, s)).toBeUndefined();
    expect(s.gets).toEqual([`${PREFIX}${CID}/index.json`]);
  });

  it("downloads the four files to /tmp, each SHA-256-checked; a warm load re-reads only index.json", async () => {
    const s = store(indexObjects(CID), tmp);
    const loaded = await loadIndex(CID, s);
    expect(loaded?.header.runId).toBe("travis-index-fixture");
    const dir = loaded?.dir ?? "missing";
    for (const v of VIEWS)
      expect(readFileSync(join(dir, `${v}.parquet`), "utf8")).toBe(`parquet ${v} ${CID}`);
    s.gets.length = 0;
    await loadIndex(CID, s);
    expect(s.gets).toEqual([`${PREFIX}${CID}/index.json`]);
  });

  it.each([
    ["another schema", { schema: "countylens-explore-index.v0" }],
    [
      "another manifest CID",
      { manifestCid: "bafkreiddef7ssybq6m4wpmah7adposaxbiawaxcmqndzk36wyhd7k4h6gu" },
    ],
    ["other view SQL", { viewsSha256: "0".repeat(64) }],
  ])("index_stale when index.json names %s", async (_label, patch) => {
    await expect(loadIndex(CID, store(indexObjects(CID, patch), tmp))).rejects.toMatchObject({
      reason: "index_stale",
      message: INDEX_MESSAGES.index_stale,
    });
  });

  it("index_stale when a file's bytes differ from index.json; nothing is written for it", async () => {
    const objects = indexObjects(CID);
    objects.set(`${PREFIX}${CID}/v_property.parquet`, bytesOf("tampered"));
    await expect(loadIndex(CID, store(objects, tmp))).rejects.toBeInstanceOf(IndexUnavailableError);
    expect(() => readFileSync(join(tmp, CID, "v_property.parquet"))).toThrow();
  });

  it("one load in flight per CID; a failure is not kept", async () => {
    const s = store(indexObjects(CID), tmp);
    await Promise.all([loadIndexOnce(CID, s), loadIndexOnce(CID, s), loadIndexOnce(CID, s)]);
    expect(s.gets.filter((k) => k.endsWith("index.json"))).toHaveLength(1);
    const broken = store(new Map([[`${PREFIX}${CID}/index.json`, bytesOf("{")]]), tmp);
    await resetIndexCache();
    await expect(loadIndexOnce(CID, broken)).rejects.toMatchObject({ reason: "index_stale" });
    await expect(loadIndexOnce(CID, s)).resolves.toBeDefined();
  });
});

describe("indexViewsSql over real Parquet (DuckDB)", () => {
  it("drops a previous run's schemas and points the four views at the files", async () => {
    const { openDuckDb } = await vi.importActual<typeof import("../src/engine/duckdb-instance.js")>(
      "../src/engine/duckdb-instance.js",
    );
    const db = await openDuckDb({
      threads: 1,
      memoryLimit: "256MB",
      extensionDirectory: tmp,
      tempDirectory: tmp,
      httpfs: false,
    });
    try {
      for (const v of VIEWS)
        await db.run(
          `COPY (SELECT '${v}' AS which, 42 AS n) TO '${join(tmp, `${v}.parquet`)}' (FORMAT parquet)`,
        );
      await db.run("CREATE SCHEMA meta; CREATE TABLE meta.run AS SELECT 1 AS x");
      await db.run(indexViewsSql(tmp));
      expect(await db.all("SELECT which, n FROM v_property")).toEqual([
        { which: "v_property", n: 42 },
      ]);
      expect(await db.all("SELECT which FROM v_run")).toEqual([{ which: "v_run" }]);
      await expect(db.all("SELECT * FROM meta.run")).rejects.toThrow();
    } finally {
      db.close();
    }
  }, 60_000);
});

describe("duckdb-node bind with the index (T012) and explore.search errors (T013)", () => {
  const s3 = mockClient(S3Client);
  const engine: FakeEngine = fakeEngine();
  seam.engine = engine;
  let node: typeof import("../src/engine/duckdb-node.js");
  let caller: ReturnType<typeof import("../src/routers/index.js").appRouter.createCaller>;
  const PF = resolvePlace("Pflugerville");
  if (PF.status !== "found") throw new Error("no Pflugerville");

  beforeAll(async () => {
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
    node = await import("../src/engine/duckdb-node.js");
    const { appRouter } = await import("../src/routers/index.js");
    caller = appRouter.createCaller({
      event: {} as APIGatewayProxyEventV2,
      lambda: {} as LambdaContext,
    });
  });
  beforeEach(() => {
    s3.reset();
    engine.statements.length = 0;
    engine.queries.length = 0;
    engine.rowsFor = (sql) =>
      /AS total_within_r\b/.test(sql) ? [{ total_within_r: 0, tenure_unknown: 0 }] : [];
  });
  afterAll(() => {
    node.setIndexStore(undefined);
    vi.unstubAllEnvs();
  });

  it("a run with an index binds all four views from /tmp, reads no manifest or part, and reports owner area from the header", async () => {
    const fx = await fixtureManifest({ runId: "index-bound-run" });
    const s = store(indexObjects(fx.cid), tmp);
    node.setIndexStore(s);
    const bound = await node.bindOnce(fx.cid, ["v_property"]);
    expect(bound).toMatchObject({
      runId: "travis-index-fixture",
      manifestCid: fx.cid,
      views: [...VIEWS],
    });
    expect(
      engine.statements.some(
        (q) => q.includes("read_parquet") && q.includes(`${fx.cid}/v_property.parquet`),
      ),
    ).toBe(true);
    expect(s3.calls()).toHaveLength(0);
    // All four views are bound: asking for another view does not bind again.
    const before = s.gets.length;
    await node.bindOnce(fx.cid, ["v_roofing_permit"]);
    expect(s.gets.length).toBe(before);
    expect(await node.ownerAreaPublished(fx.cid)).toBe(false);
  });

  it("a full-county run with no index is index_not_built, without binding any part", async () => {
    const fx = await fixtureManifest({
      runId: "big-run-no-index",
      parts: [{ name: "tables/county/property/part-00000.parquet", size: 20 * 1024 * 1024 }],
    });
    serveFixture(s3, fx);
    node.setIndexStore(store(new Map(), tmp));
    await expect(node.bindOnce(fx.cid, ["v_property"])).rejects.toMatchObject({
      reason: "index_not_built",
    });
    expect(engine.statements.some((q) => q.includes("read_parquet"))).toBe(false);
  });

  it("explore.search: index_not_built and index_stale are PRECONDITION_FAILED with the reason in the message", async () => {
    const big = await fixtureManifest({
      runId: "explore-big-run",
      parts: [{ name: "tables/county/property/part-00000.parquet", size: 20 * 1024 * 1024 }],
    });
    serveFixture(s3, big);
    node.setIndexStore(store(new Map(), tmp));
    const input = (cid: string, extra: Record<string, unknown> = {}) =>
      ({ manifestCid: cid, area: { place: PF.id }, radius_mi: 5, ...extra }) as Parameters<
        typeof caller.explore.search
      >[0];
    await expect(caller.explore.search(input(big.cid))).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("index_not_built"),
    });
    const stale = await fixtureManifest({ runId: "explore-stale-run" });
    node.setIndexStore(store(indexObjects(stale.cid, { viewsSha256: "1".repeat(64) }), tmp));
    await expect(caller.explore.search(input(stale.cid))).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("index_stale"),
    });
  });

  it("explore.search: the out-of-area filter on a run with no owner area returns the typed notice", async () => {
    const fx = await fixtureManifest({ runId: "explore-ooa-run" });
    node.setIndexStore(store(indexObjects(fx.cid), tmp));
    const input = { manifestCid: fx.cid, area: { place: PF.id }, radius_mi: 5 } as Parameters<
      typeof caller.explore.search
    >[0];
    const result = await caller.explore.search({ ...input, ooa: true });
    expect(result.owner_area).toEqual({
      status: "not_published",
      reason: "owner_area_not_published",
      message: "owner area not published in this run",
    });
    expect((await caller.explore.search(input)).owner_area).toBeUndefined();
  });
});

describe("MCP: typed failures and the per-call deadline (T013, T015)", () => {
  it("a run without a usable index answers isError naming the reason; run_lookup_failed likewise", async () => {
    const { searchPropertiesTool, listRunsTool } = await import("../src/mcp/tools.js");
    const deps = {
      resolveRun: async () => ({
        failure: "index_not_built" as const,
        message: INDEX_MESSAGES.index_not_built,
      }),
      runsIndex: async () => {
        throw new Error("network down");
      },
    };
    const result = await searchPropertiesTool(deps, { area: { place: "Austin" } } as never);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: "index_not_built" });
    const runs = await listRunsTool(deps, {} as never);
    expect(runs.isError).toBe(true);
    expect(runs.structuredContent).toMatchObject({ error: "run_lookup_failed" });
  });

  it("an index error raised inside a tool call is an isError result, not a thrown 500", async () => {
    const { listPermitsTool } = await import("../src/mcp/tools.js");
    const failing = {
      all: async () => Promise.reject(new IndexUnavailableError("index_stale", "x")),
      run: async () => undefined,
    };
    const deps = {
      resolveRun: async () => ({
        engine: failing,
        bound: { runId: "r", manifestCid: "m", asOf: "a", tables: [], views: [] },
      }),
      runsIndex: async () => ({ runs: [] }),
    };
    const result = await listPermitsTool(deps as never, {} as never);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: "index_stale" });
  });

  it("a call past the deadline answers deadline_exceeded and interrupts the engine; the deadline is below the Lambda timeout", async () => {
    const { MCP_CALL_DEADLINE_MS, MCP_LAMBDA_TIMEOUT_MS, timed } =
      await import("../src/mcp/tools.js");
    expect(MCP_CALL_DEADLINE_MS).toBeLessThan(MCP_LAMBDA_TIMEOUT_MS);
    const obs = {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        appendKeys: vi.fn(),
        getCorrelationId: () => undefined,
      },
      metrics: { addMetric: vi.fn(), addDimension: vi.fn(), publishStoredMetrics: vi.fn() },
    };
    const onExpire = vi.fn();
    const result = await timed(
      obs as never,
      "search_properties",
      () => new Promise(() => undefined),
      { ms: 20, onExpire },
    )();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: "deadline_exceeded" });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
