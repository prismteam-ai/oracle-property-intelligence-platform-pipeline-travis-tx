// A-03 T070 (G-C2a): `runs.summary` per contracts/api.md and the s3-read module it rests on.
// Written before src/routers/runs.ts exists: the red run fails with
// "Cannot find module '../src/routers/runs'". S3 is aws-sdk-client-mock (the Golden Path mock),
// the DuckDB instance is a fake behind the engine seam (src/engine/duckdb-instance.ts); no AWS
// call and no network happen here. Presigned URLs are signed offline with the example
// credentials in helpers/fakes.ts.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand, ListObjectsV2Command, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import type { APIGatewayProxyEventV2, Context as LambdaContext } from "aws-lambda";
import { runSummarySql } from "@countylens/query-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../src/routers/index.js";
import { runsRouter } from "../src/routers/runs.js";
import { BIND_TTL_MS, DUCKDB_THREADS, PREFETCH_MAX_PART_BYTES } from "../src/engine/duckdb-node.js";
import {
  PART_CACHE_DIR,
  getManifest,
  presignPart,
  presignPrefix,
  PRESIGN_EXPIRES_S,
  PRESIGN_REUSE_MS,
  resetPresignedPrefixCache,
} from "../src/engine/s3-read.js";
import {
  ENV,
  FINISHED_AT,
  fakeEngine,
  fixtureManifest,
  PROPERTY_PART,
  s3Body,
  serveFixture,
  type FakeEngine,
  type Fixture,
} from "./helpers/fakes.js";

const seam = vi.hoisted(() => ({ engine: undefined as unknown, opens: [] as unknown[] }));
vi.mock("../src/engine/duckdb-instance.js", () => ({
  openDuckDb: vi.fn(async (options: unknown) => {
    seam.opens.push(options);
    return seam.engine;
  }),
}));

const REAL_TMP = tmpdir();
const s3 = mockClient(S3Client);
const engine: FakeEngine = fakeEngine();
seam.engine = engine;
const ctx = { event: {} as APIGatewayProxyEventV2, lambda: {} as LambdaContext };
const caller = appRouter.createCaller(ctx);

let fixture: Fixture;
let tmp: string;

const summaryRow = (f: Fixture, roofingPermitRows: number) => (sql: string) =>
  sql === runSummarySql()
    ? [
        {
          run_id: f.manifest.runId,
          manifest_cid: f.cid,
          finished_at: FINISHED_AT,
          roofing_permit_rows: roofingPermitRows,
        },
      ]
    : undefined;

const getCalls = () => s3.commandCalls(GetObjectCommand).length;
const getKeys = () => s3.commandCalls(GetObjectCommand).map((c) => c.args[0].input.Key);
const partUrlStatement = (partCid: string) =>
  engine.statements.find((sql) => sql.includes("read_parquet(") && sql.includes(partCid));

beforeAll(async () => {
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  fixture = await fixtureManifest();
});

beforeEach(() => {
  tmp = mkdtempSync(join(REAL_TMP, "countylens-api-runs-"));
  vi.stubEnv("TMPDIR", tmp); // the /tmp manifest cache starts empty for every test
  s3.reset();
  resetPresignedPrefixCache();
  engine.statements.length = 0;
  engine.queries.length = 0;
  engine.rowsFor = summaryRow(fixture, 7);
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(tmp, { recursive: true, force: true });
});

afterAll(() => vi.unstubAllEnvs());

describe("runs.summary (T070)", () => {
  it("is registered on the app router as runs.summary", () => {
    expect(runsRouter).toBeDefined();
    expect(typeof caller.runs.summary).toBe("function");
  });

  it.each([
    ["a CIDv0", "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco"],
    ["a private key", "private/bench/austin-48m/part-00000.parquet"],
    [
      "a gateway URL",
      "https://gateway.example/ipfs/bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy",
    ],
    ["an empty string", ""],
  ])("rejects %s as manifestCid with BAD_REQUEST before any S3 call", async (_, manifestCid) => {
    await expect(caller.runs.summary({ manifestCid })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(s3.calls()).toHaveLength(0);
  });

  it("returns NOT_FOUND when ipfs/<cid> is not in the CID copy, binding nothing", async () => {
    const absent = await fixtureManifest({ runId: "travis-absent" });
    s3.on(GetObjectCommand, { Bucket: "copy-bucket", Key: `ipfs/${absent.cid}` }).rejects(
      new NoSuchKey({ $metadata: {}, message: "The specified key does not exist." }),
    );
    await expect(caller.runs.summary({ manifestCid: absent.cid })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(getCalls()).toBe(1);
    expect(engine.statements).toHaveLength(0);
  });

  it.each([
    ["AccessDenied (403: the reader has no ListBucket on ipfs/)", 403, "AccessDenied"],
    ["NoSuchKey by status only (404)", 404, "UnknownError"],
  ])(
    "returns NOT_FOUND, never a 500, when GetObject on a missing ipfs/<cid> answers %s",
    async (_, httpStatusCode, name) => {
      const absent = await fixtureManifest({ runId: `travis-absent-${httpStatusCode}` });
      const error = Object.assign(new Error("Access Denied"), {
        name,
        $fault: "client",
        $metadata: { httpStatusCode },
      });
      s3.on(GetObjectCommand, { Bucket: "copy-bucket", Key: `ipfs/${absent.cid}` }).rejects(error);
      await expect(caller.runs.summary({ manifestCid: absent.cid })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(engine.statements).toHaveLength(0);
    },
  );

  it("still rethrows a server-side S3 failure (500) as an error, not NOT_FOUND", async () => {
    const absent = await fixtureManifest({ runId: "travis-s3-500" });
    const error = Object.assign(new Error("We encountered an internal error."), {
      name: "InternalError",
      $fault: "server",
      $metadata: { httpStatusCode: 500 },
    });
    s3.on(GetObjectCommand, { Key: `ipfs/${absent.cid}` }).rejects(error);
    await expect(caller.runs.summary({ manifestCid: absent.cid })).rejects.not.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("returns INTERNAL_SERVER_ERROR when the bytes do not hash to the requested CID, and caches nothing", async () => {
    const other = await fixtureManifest({ runId: "travis-other" });
    // The copy answers with a different manifest's bytes under this CID's key.
    s3.on(GetObjectCommand, { Key: `ipfs/${other.cid}` }).resolves(s3Body(fixture.bytes));
    await expect(caller.runs.summary({ manifestCid: other.cid })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    await expect(caller.runs.summary({ manifestCid: other.cid })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(getCalls()).toBe(2); // unverified bytes are never written to the /tmp cache
    expect(engine.statements).toHaveLength(0);
  });

  it("returns {manifestCid, verified, tablesBound, roofingPermitRows, queryDurationMs} from runSummarySql", async () => {
    serveFixture(s3, fixture);
    const result = await caller.runs.summary({ manifestCid: fixture.cid });
    expect(result).toEqual({
      manifestCid: fixture.cid,
      verified: true,
      tablesBound: 1,
      roofingPermitRows: 7,
      queryDurationMs: expect.any(Number),
    });
    expect(result.queryDurationMs).toBeGreaterThanOrEqual(0);
    expect(engine.queries).toContain(runSummarySql());
  });

  // ERR-19: the cold bind read every emitted table over presigned URLs, two sequential range
  // requests per part (≈ 46 round trips for the published run). It now binds only the tables the
  // query's views read, and fetches each small part once, in parallel, over the S3 SDK.
  const UNREAD_PART = "tables/county/address/part-00000.parquet";
  const PERMIT_PART = "tables/property_improvement/property_improvement/part-00000.parquet";

  it("ERR-19: binds once per manifest CID, fetching only the parts runs.summary's views read, each verified and cached under /tmp; no presigned URL", async () => {
    const twice = await fixtureManifest({
      runId: "travis-twice",
      parts: [{ name: PROPERTY_PART }, { name: UNREAD_PART }, { name: PERMIT_PART }],
    });
    const [property, unread, permits] = twice.parts;
    engine.rowsFor = summaryRow(twice, 3);
    serveFixture(s3, twice);

    const result = await caller.runs.summary({ manifestCid: twice.cid });
    expect(result.tablesBound).toBe(2); // county.property + property_improvement.property_improvement
    expect(getKeys().sort()).toEqual(
      [`ipfs/${twice.cid}`, `ipfs/${property?.cid}`, `ipfs/${permits?.cid}`].sort(),
    );
    const bindStatements = engine.statements.length;
    for (const part of [property, permits]) {
      const view = partUrlStatement(part?.cid ?? "");
      expect(view).toBeDefined();
      expect(view).toContain(join(tmp, PART_CACHE_DIR, part?.cid ?? ""));
      expect(view).not.toContain("X-Amz-Signature=");
    }
    expect(partUrlStatement(unread?.cid ?? "")).toBeUndefined(); // county.address: no view reads it
    expect(engine.statements.join("\n")).not.toContain("CREATE OR REPLACE VIEW v_property");

    await caller.runs.summary({ manifestCid: twice.cid });
    expect(engine.statements).toHaveLength(bindStatements); // no re-bind
    expect(getCalls()).toBe(3); // the second request read nothing from S3
    expect(seam.opens).toHaveLength(1); // one DuckDB instance per sandbox
    expect(seam.opens[0]).toMatchObject({
      threads: DUCKDB_THREADS,
      httpfs: true,
      cacheRemoteReads: true, // ERR-18: footers and chunks stay cached across warm requests
    });
    expect(DUCKDB_THREADS).toBe(4);
  });

  it("ERR-19: a part declared larger than one raw chunk is range-read over a presigned ipfs/<cid> URL, never fetched whole", async () => {
    expect(PREFETCH_MAX_PART_BYTES).toBe(262_144);
    const large = await fixtureManifest({
      runId: "travis-large-part",
      parts: [{ name: PROPERTY_PART, size: PREFETCH_MAX_PART_BYTES + 1 }],
    });
    engine.rowsFor = summaryRow(large, 1);
    serveFixture(s3, large);

    await caller.runs.summary({ manifestCid: large.cid });
    expect(getKeys()).toEqual([`ipfs/${large.cid}`]);
    const view = partUrlStatement(large.partCid);
    expect(view).toContain(`https://copy-bucket.s3.xx-test-1.amazonaws.com/ipfs/${large.partCid}?`);
    expect(view).toContain("X-Amz-Signature=");
    expect(view).toContain(`X-Amz-Expires=${PRESIGN_EXPIRES_S}`);
  });

  it("ERR-19: a part whose bytes do not hash to its CID fails the request with INTERNAL_SERVER_ERROR and is never cached or bound", async () => {
    const bad = await fixtureManifest({ runId: "travis-bad-part" });
    s3.on(GetObjectCommand, { Key: `ipfs/${bad.cid}` }).resolves(s3Body(bad.bytes));
    s3.on(GetObjectCommand, { Key: `ipfs/${bad.partCid}` }).resolves(
      s3Body(new TextEncoder().encode("other bytes")),
    );
    await expect(caller.runs.summary({ manifestCid: bad.cid })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(partUrlStatement(bad.partCid)).toBeUndefined();
    await expect(caller.runs.summary({ manifestCid: bad.cid })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
    expect(getKeys().filter((k) => k === `ipfs/${bad.partCid}`)).toHaveLength(2);
  });

  it("ERR-19: a later query that reads more views re-binds the same run with both view sets, reusing the /tmp parts", async () => {
    const union = await fixtureManifest({
      runId: "travis-union",
      parts: [{ name: PROPERTY_PART }, { name: PERMIT_PART }],
    });
    engine.rowsFor = summaryRow(union, 2);
    serveFixture(s3, union);

    await caller.runs.summary({ manifestCid: union.cid });
    const summaryStatements = engine.statements.length;
    expect(getCalls()).toBe(3);

    await caller.query.radius({ manifestCid: union.cid, lat: 30.2672, lon: -97.7431, miles: 1 });
    const rebind = engine.statements.slice(summaryStatements).join("\n");
    expect(rebind).toContain("CREATE OR REPLACE VIEW v_property");
    expect(rebind).toContain("CREATE OR REPLACE VIEW v_roofing_permit");
    expect(getCalls()).toBe(3); // manifest and parts came from /tmp

    const settled = engine.statements.length;
    await caller.runs.summary({ manifestCid: union.cid });
    await caller.query.radius({ manifestCid: union.cid, lat: 30.2672, lon: -97.7431, miles: 1 });
    expect(engine.statements).toHaveLength(settled); // both view sets stay bound
  });

  it("re-binds after BIND_TTL_MS so presigned part URLs (large parts) never outlive their signature", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const ttl = await fixtureManifest({ runId: "travis-ttl" });
    engine.rowsFor = summaryRow(ttl, 1);
    serveFixture(s3, ttl);

    await caller.runs.summary({ manifestCid: ttl.cid });
    const bindStatements = engine.statements.length;
    vi.setSystemTime(Date.now() + BIND_TTL_MS + 1);
    await caller.runs.summary({ manifestCid: ttl.cid });
    expect(engine.statements.length).toBe(2 * bindStatements);
    expect(getCalls()).toBe(2); // the manifest and its one part, each once: the re-bind reads /tmp
    expect(BIND_TTL_MS).toBeLessThan(PRESIGN_EXPIRES_S * 1000);
  });
});

describe("s3-read (T072)", () => {
  it("getManifest verifies the cache too: corrupted /tmp bytes are refetched", async () => {
    const cached = await fixtureManifest({ runId: "travis-cache" });
    s3.on(GetObjectCommand, { Key: `ipfs/${cached.cid}` }).resolves(s3Body(cached.bytes));
    expect(await getManifest(cached.cid)).toEqual(cached.bytes);
    expect(await getManifest(cached.cid)).toEqual(cached.bytes);
    expect(getCalls()).toBe(1);

    const dir = join(tmp, "countylens-manifests");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, cached.cid), "not the manifest");
    expect(await getManifest(cached.cid)).toEqual(cached.bytes);
    expect(getCalls()).toBe(2);
  });

  it("presignPart signs a GET of ipfs/<cid> only; any other key is refused without signing", async () => {
    const url = new URL(await presignPart(fixture.partCid));
    expect(url.host).toBe("copy-bucket.s3.xx-test-1.amazonaws.com");
    expect(url.pathname).toBe(`/ipfs/${fixture.partCid}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(PRESIGN_EXPIRES_S));
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    for (const key of ["private/bench/austin-48m/part-00000.parquet", "ipfs/Qm", "../ipfs/x", ""])
      await expect(presignPart(key)).rejects.toThrow();
  });

  it.each([
    "ipfs/",
    "private/",
    "private/other/x/",
    "private/bench/",
    "private/bench/x",
    "private/bench/x/y/",
  ])(
    "presignPrefix refuses %s (outside READPATH_PRIVATE_PREFIX<name>/) without listing",
    async (prefix) => {
      await expect(presignPrefix(prefix)).rejects.toThrow(/private\/bench\//);
      expect(s3.calls()).toHaveLength(0);
    },
  );

  it("presignPrefix lists every *.parquet under private/bench/<name>/ across pages and presigns each", async () => {
    s3.on(ListObjectsV2Command, { Bucket: "copy-bucket", Prefix: "private/bench/austin-48m/" })
      .resolvesOnce({
        Contents: [
          { Key: "private/bench/austin-48m/part-00001.parquet" },
          { Key: "private/bench/austin-48m/receipt.json" },
        ],
        IsTruncated: true,
        NextContinuationToken: "page-2",
      })
      .resolvesOnce({
        Contents: [{ Key: "private/bench/austin-48m/part-00000.parquet" }],
        IsTruncated: false,
      });
    const parts = await presignPrefix("private/bench/austin-48m/");
    expect(parts.map((p) => p.key)).toEqual([
      "private/bench/austin-48m/part-00000.parquet",
      "private/bench/austin-48m/part-00001.parquet",
    ]);
    for (const part of parts) {
      const url = new URL(part.url);
      expect(url.pathname).toBe(`/${part.key}`);
      expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    }
    const pages = s3.commandCalls(ListObjectsV2Command);
    expect(pages).toHaveLength(2);
    expect(pages[1]?.args[0].input.ContinuationToken).toBe("page-2");
  });

  // ERR-18 lever 2: DuckDB caches footers and bytes by URL, so a warm sandbox must hand it the
  // same URL for an unchanged object. The URL is reused while the object's ETag is unchanged and
  // for PRESIGN_REUSE_MS at most (well inside the URL's lifetime); a new ETag is signed afresh.
  it("ERR-18: presignPrefix reuses a part's URL while its ETag is unchanged, re-signs on a new ETag or after PRESIGN_REUSE_MS", async () => {
    expect(PRESIGN_REUSE_MS).toBeLessThan(PRESIGN_EXPIRES_S * 1000);
    const prefix = "private/bench/austin-48m/";
    const key = `${prefix}part-00000.parquet`;
    const listing = (etag: string) =>
      s3.on(ListObjectsV2Command, { Bucket: "copy-bucket", Prefix: prefix }).resolves({
        Contents: [{ Key: key, ETag: etag }],
        IsTruncated: false,
      });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));
    listing('"e1"');
    const [first] = await presignPrefix(prefix);

    vi.setSystemTime(new Date("2026-10-21T10:00:05Z"));
    const [again] = await presignPrefix(prefix);
    expect(again?.url).toBe(first?.url);

    listing('"e2"');
    const [changed] = await presignPrefix(prefix);
    expect(changed?.url).not.toBe(first?.url);

    vi.setSystemTime(new Date(Date.parse("2026-10-21T10:00:05Z") + PRESIGN_REUSE_MS + 1));
    const [expired] = await presignPrefix(prefix);
    expect(expired?.url).not.toBe(changed?.url);
    expect(s3.commandCalls(ListObjectsV2Command)).toHaveLength(4); // the listing is never cached
  });
});
