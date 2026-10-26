// A-03 T062 (G-C2a): `query.radius` / `query.roofAge` per contracts/api.md. Written before
// src/routers/query.ts exists: the red run fails with "Cannot find module '../src/routers/query'".
// Asserts the Zod bounds (lat −90…90, lon −180…180, miles (0, 25], limit 1…1000 default 500,
// minYears 1…100), that the SQL is exactly the query-core builders' text (AD-19), that as_of is
// the bound manifest's finishedAt (never now()), and that no result exceeds 1,000 rows (AD-21).
// S3 and the DuckDB instance are fakes (see helpers/fakes.ts); nothing reaches AWS or the network.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import type { APIGatewayProxyEventV2, Context as LambdaContext } from "aws-lambda";
import { DEFAULT_LIMIT, MAX_ROWS, radiusSql, roofAgeSql, type Row } from "@countylens/query-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../src/routers/index.js";
import { queryRouter } from "../src/routers/query.js";
import {
  ENV,
  FINISHED_AT,
  fakeEngine,
  fixtureManifest,
  serveFixture,
  type FakeEngine,
  type Fixture,
} from "./helpers/fakes.js";

const seam = vi.hoisted(() => ({ engine: undefined as unknown }));
vi.mock("../src/engine/duckdb-instance.js", () => ({
  openDuckDb: vi.fn(async () => seam.engine),
}));

const REAL_TMP = tmpdir();
const s3 = mockClient(S3Client);
const engine: FakeEngine = fakeEngine();
seam.engine = engine;
const ctx = { event: {} as APIGatewayProxyEventV2, lambda: {} as LambdaContext };
const caller = appRouter.createCaller(ctx);

/** Downtown Austin, 1 statute mile (the TC_NF_05 preset's centre). */
const CENTRE = { lat: 30.2672, lon: -97.7431, miles: 1 };

let fixture: Fixture;
let tmp: string;

/** The last SQL the engine was asked to return rows for. */
const lastQuery = (): string => engine.queries.at(-1) ?? "";

beforeAll(async () => {
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  fixture = await fixtureManifest();
});

beforeEach(() => {
  tmp = mkdtempSync(join(REAL_TMP, "countylens-api-query-"));
  vi.stubEnv("TMPDIR", tmp);
  s3.reset();
  serveFixture(s3, fixture); // ERR-19: the manifest and its parts
  engine.statements.length = 0;
  engine.queries.length = 0;
  engine.rowsFor = () => [];
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));
afterAll(() => vi.unstubAllEnvs());

describe("query.radius / query.roofAge registration (T064)", () => {
  it("are registered on the app router as query.radius and query.roofAge", () => {
    expect(queryRouter).toBeDefined();
    expect(typeof caller.query.radius).toBe("function");
    expect(typeof caller.query.roofAge).toBe("function");
  });
});

describe("Zod bounds (T062)", () => {
  const radiusOutOfBounds: [string, Record<string, unknown>][] = [
    ["lat below −90", { lat: -90.001 }],
    ["lat above 90", { lat: 90.001 }],
    ["lon below −180", { lon: -180.001 }],
    ["lon above 180", { lon: 180.001 }],
    ["miles = 0", { miles: 0 }],
    ["miles negative", { miles: -1 }],
    ["miles above 25", { miles: 25.001 }],
    ["limit = 0", { limit: 0 }],
    ["limit above 1000", { limit: MAX_ROWS + 1 }],
    ["limit not an integer", { limit: 1.5 }],
    ["lat missing", { lat: undefined }],
    ["manifestCid not a CIDv1", { manifestCid: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco" }],
  ];

  it.each(radiusOutOfBounds)(
    "query.radius rejects %s with BAD_REQUEST, fetching nothing",
    async (_, patch) => {
      const input = { manifestCid: fixture.cid, ...CENTRE, ...patch } as Parameters<
        typeof caller.query.radius
      >[0];
      await expect(caller.query.radius(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(s3.calls()).toHaveLength(0);
      expect(engine.queries).toHaveLength(0);
    },
  );

  it.each([
    ...radiusOutOfBounds,
    ["minYears = 0", { minYears: 0 }],
    ["minYears above 100", { minYears: 101 }],
    ["minYears not an integer", { minYears: 15.5 }],
    ["minYears missing", { minYears: undefined }],
  ] as [string, Record<string, unknown>][])(
    "query.roofAge rejects %s with BAD_REQUEST, fetching nothing",
    async (_, patch) => {
      const input = { manifestCid: fixture.cid, ...CENTRE, minYears: 15, ...patch } as Parameters<
        typeof caller.query.roofAge
      >[0];
      await expect(caller.query.roofAge(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(s3.calls()).toHaveLength(0);
      expect(engine.queries).toHaveLength(0);
    },
  );

  it("accepts the boundary values lat −90/90, lon −180/180, miles 25, limit 1 and 1000, minYears 1 and 100", async () => {
    const cid = fixture.cid;
    await expect(
      caller.query.radius({ manifestCid: cid, lat: -90, lon: -180, miles: 25, limit: 1 }),
    ).resolves.toBeDefined();
    await expect(
      caller.query.radius({ manifestCid: cid, lat: 90, lon: 180, miles: 25, limit: MAX_ROWS }),
    ).resolves.toBeDefined();
    await expect(
      caller.query.roofAge({ manifestCid: cid, ...CENTRE, minYears: 1 }),
    ).resolves.toBeDefined();
    await expect(
      caller.query.roofAge({ manifestCid: cid, ...CENTRE, minYears: 100 }),
    ).resolves.toBeDefined();
  });
});

describe("SQL comes from the query-core builders only (AD-19)", () => {
  it("query.radius runs exactly radiusSql() with limit defaulting to 500", async () => {
    await caller.query.radius({ manifestCid: fixture.cid, ...CENTRE });
    expect(DEFAULT_LIMIT).toBe(500);
    expect(lastQuery()).toBe(radiusSql({ ...CENTRE, limit: DEFAULT_LIMIT }));
    expect(lastQuery()).toMatch(/LIMIT 500$/);
  });

  it("query.radius passes an explicit limit through", async () => {
    await caller.query.radius({ manifestCid: fixture.cid, ...CENTRE, limit: 42 });
    expect(lastQuery()).toBe(radiusSql({ ...CENTRE, limit: 42 }));
  });

  it("query.roofAge runs exactly roofAgeSql() with as_of = the manifest's finishedAt, never now()", async () => {
    await caller.query.roofAge({ manifestCid: fixture.cid, ...CENTRE, minYears: 15 });
    expect(lastQuery()).toBe(
      roofAgeSql({ ...CENTRE, limit: DEFAULT_LIMIT, minYears: 15, asOf: FINISHED_AT }),
    );
    expect(lastQuery()).toContain(
      `CAST(CAST('${FINISHED_AT}' AS TIMESTAMPTZ) AS DATE) AS as_of_date`,
    );
    for (const sql of [...engine.statements, ...engine.queries])
      expect(sql).not.toMatch(/\bnow\(\)/i);
  });

  it("the as_of date follows the bound manifest, not the clock", async () => {
    const later = await fixtureManifest({
      runId: "travis-later",
      finishedAt: "2027-01-02T03:04:05.000Z",
    });
    serveFixture(s3, later);
    await caller.query.roofAge({ manifestCid: later.cid, ...CENTRE, minYears: 15 });
    expect(lastQuery()).toContain("CAST('2027-01-02T03:04:05.000Z' AS TIMESTAMPTZ)");
  });
});

describe("results (AD-21)", () => {
  const row = (i: number): Row => ({
    cid: `bafkreiproperty${i}`,
    parcel_identifier: `0${i}`,
    latitude: 30.26,
    longitude: -97.74,
    distance_m: i,
    source_url: "https://traviscad.org/2026-certified.json",
    missing: [],
  });

  it("returns { rows, queryDurationMs } with the engine's rows untouched", async () => {
    engine.rowsFor = () => [row(1), row(2)];
    const result = await caller.query.radius({ manifestCid: fixture.cid, ...CENTRE });
    expect(result).toEqual({ rows: [row(1), row(2)], queryDurationMs: expect.any(Number) });
    expect(result.queryDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("never returns more than 1,000 rows even if the engine does", async () => {
    engine.rowsFor = () => Array.from({ length: MAX_ROWS + 1 }, (_, i) => row(i));
    const result = await caller.query.roofAge({
      manifestCid: fixture.cid,
      ...CENTRE,
      minYears: 15,
      limit: MAX_ROWS,
    });
    expect(MAX_ROWS).toBe(1000);
    expect(result.rows).toHaveLength(MAX_ROWS);
  });
});
