// T006 (A-13, contracts/explore-search.md): the additive `explore.search` procedure. Asserts the
// Zod bounds (radius_mi 0.25..25, roof 0..120, openYrs 0..60, tenure 0..100, limit 1..1000
// default 200, page ≥ 0, `at` inside the Travis box, a place from the gazetteer), that the SQL is
// exactly query-core `exploreSearchSql` (AD-19), that `as_of` names the bound run, that Close
// matches run only on zero results, and that an engine failure surfaces as
// INTERNAL_SERVER_ERROR with a plain message (no stack, no SQL). S3 and DuckDB are fakes.
// Written before src/routers/explore.ts exists: the red run fails with "Cannot find module".
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import type { APIGatewayProxyEventV2, Context as LambdaContext } from "aws-lambda";
import { exploreSearchSql, resolvePlace, type Row } from "@countylens/query-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../src/routers/index.js";
import { EXPLORE_ENGINE_ERROR, ExploreSearchInput } from "../src/routers/explore.js";
import {
  ENV,
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
const caller = appRouter.createCaller({
  event: {} as APIGatewayProxyEventV2,
  lambda: {} as LambdaContext,
});

const PFLUGERVILLE = resolvePlace("Pflugerville");
if (PFLUGERVILLE.status !== "found") throw new Error("gazetteer has no Pflugerville");
const PLACE_ID = PFLUGERVILLE.id;

let fixture: Fixture;
let tmp: string;
type Input = Parameters<typeof caller.explore.search>[0];
const input = (patch: Record<string, unknown> = {}): Input =>
  ({ manifestCid: fixture.cid, area: { place: PLACE_ID }, radius_mi: 5, ...patch }) as Input;

const propertyRow = (i: number): Row => ({
  property_cid: `bafkreiproperty${i}`,
  latitude: PFLUGERVILLE.point.lat + i * 0.001,
  longitude: PFLUGERVILLE.point.lon,
  distance_m: i * 111,
  roof_age_years: 20,
  roof_age_basis: "built_year",
  roof_age_confidence: "low",
  tenure_years: null,
  tenure_basis: "unknown",
  owner_area_class: "unknown",
  permit_cid: null,
  permit_number: null,
  permit_status_class: null,
  permit_open_days: null,
  contractor_resolution: null,
  bbb_status: null,
  bbb_status_reason: null,
  cid: `bafkreiproperty${i}`,
  source_url: "https://traviscad.org/2026-certified.json",
  captured_at: "2026-10-20T21:40:00.000Z",
  table: "county.property",
  table_cid: "bafkreitable",
  run_id: "travis-fixture",
  manifest_cid: "bafkreimanifest",
  as_of: "2026-10-20T22:00:10.663Z",
  missing: [{ field: "tenure_years", reason: "no_dated_sale" }],
});

/** The search statements the engine ran (the bind's DESCRIBE statements left out). */
const searches = (): string[] => engine.queries.filter((q) => q.startsWith("WITH "));

/** Answers the summary statement with `total`, every other statement with `rows`. */
function serve(total: number, rows: Row[], tenureUnknown = 0): void {
  engine.rowsFor = (sql) =>
    /AS total_within_r\b/.test(sql)
      ? [{ total_within_r: total, tenure_unknown: tenureUnknown }]
      : rows;
}

beforeAll(async () => {
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  fixture = await fixtureManifest();
});

beforeEach(() => {
  tmp = mkdtempSync(join(REAL_TMP, "countylens-api-explore-"));
  vi.stubEnv("TMPDIR", tmp);
  s3.reset();
  serveFixture(s3, fixture);
  engine.statements.length = 0;
  engine.queries.length = 0;
  serve(0, []);
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));
afterAll(() => vi.unstubAllEnvs());

describe("explore.search registration (T012)", () => {
  it("is registered additively next to runs and query", () => {
    expect(typeof caller.explore.search).toBe("function");
    expect(typeof caller.runs.summary).toBe("function");
    expect(typeof caller.query.radius).toBe("function");
  });
});

describe("Zod bounds (contracts/explore-search.md)", () => {
  it.each([
    ["radius_mi below 0.25", { radius_mi: 0.24 }],
    ["radius_mi above 25", { radius_mi: 25.01 }],
    ["roof below 0", { roof: -1 }],
    ["roof above 120", { roof: 121 }],
    ["roof not an integer", { roof: 2.5 }],
    ["openYrs below 0", { openYrs: -0.1 }],
    ["openYrs above 60", { openYrs: 60.1 }],
    ["tenure above 100", { tenure: 101 }],
    ["tenure not an integer", { tenure: 1.5 }],
    ["limit 0", { limit: 0 }],
    ["limit above 1000", { limit: 1001 }],
    ["page negative", { page: -1 }],
    ["permit unknown", { permit: "closed" }],
    ["sort unknown", { sort: "random" }],
    ["at lat outside 29.5..31.0", { area: { at: { lat: 31.01, lon: -97.7 } } }],
    ["at lon outside -98.5..-97.0", { area: { at: { lat: 30.3, lon: -96.9 } } }],
    ["no area", { area: undefined }],
    ["place outside the Travis gazetteer", { area: { place: "Georgetown" } }],
    ["manifestCid not a CIDv1", { manifestCid: "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco" }],
  ])("rejects %s with BAD_REQUEST, running nothing", async (_, patch) => {
    await expect(caller.explore.search(input(patch))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(engine.queries).toHaveLength(0);
  });

  it("accepts the boundaries and defaults sort to nearest, limit to 200, page to 0", () => {
    const parsed = ExploreSearchInput.parse({
      manifestCid: "bafkreiasycmsr2qdlxqcfg3yc2conpn3jxmohz7gs55hkseipplhpqsk5i",
      area: { at: { lat: 29.5, lon: -98.5 } },
      radius_mi: 0.25,
      roof: 120,
      openYrs: 60,
      tenure: 100,
    });
    expect(parsed).toMatchObject({ sort: "nearest", limit: 200, page: 0 });
    expect(
      ExploreSearchInput.safeParse({ ...parsed, radius_mi: 25, roof: 0, limit: 1000 }).success,
    ).toBe(true);
  });
});

describe("SQL from query-core only; as_of from the bound run", () => {
  it("runs exactly exploreSearchSql's summary and rows for the resolved place", async () => {
    serve(2, [propertyRow(1), propertyRow(2)]);
    const result = await caller.explore.search(input({ roof: 15 }));
    const sql = exploreSearchSql({
      centre: PFLUGERVILLE.point,
      radius_mi: 5,
      roof: 15,
      sort: "nearest",
      limit: 200,
      page: 0,
    });
    expect(searches()).toEqual([sql.summary, sql.rows]);
    expect(result.total_within_r).toBe(2);
    expect(result.rows).toHaveLength(2);
    expect(result.close_matches).toEqual([]);
    expect(result.engine).toBe("server");
    expect(result.as_of).toEqual({
      runId: fixture.manifest.runId,
      manifestCid: fixture.cid,
      finishedAt: fixture.manifest.finishedAt,
    });
    expect(result.area).toEqual({
      label: PFLUGERVILLE.label,
      lat: PFLUGERVILLE.point.lat,
      lon: PFLUGERVILLE.point.lon,
    });
    expect(result.queryDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("maps every row with provenance, miles and a missing reason for each gap", async () => {
    serve(1, [propertyRow(1)], 1);
    const { rows, tenure_unknown } = await caller.explore.search(input());
    expect(tenure_unknown).toBe(1);
    const row = rows[0];
    expect(row?.provenance.table_cid).toBe("bafkreitable");
    expect(row?.dist_mi).toBeCloseTo(111 / 1609.344, 3);
    expect(row?.missing).toEqual(
      expect.arrayContaining([
        { field: "address", reason: "not_in_export" },
        { field: "tenure_years", reason: "no_dated_sale" },
      ]),
    );
  });

  it("an `at` point is used as the centre directly", async () => {
    await caller.explore.search(input({ area: { at: { lat: 30.3, lon: -97.7 } } }));
    expect(searches()[0]).toBe(
      exploreSearchSql({ centre: { lat: 30.3, lon: -97.7 }, radius_mi: 5 }).summary,
    );
  });

  it("zero results: runs the close-match statement and reports miles outside the radius", async () => {
    const outside = { ...propertyRow(1), distance_m: 5.5 * 1609.344 };
    serve(0, [outside]);
    const result = await caller.explore.search(input());
    const sql = exploreSearchSql({ centre: PFLUGERVILLE.point, radius_mi: 5 });
    expect(searches()).toEqual([sql.summary, sql.close]);
    expect(result.rows).toEqual([]);
    expect(result.close_matches).toHaveLength(1);
    expect(result.close_matches[0]?.miles_outside).toBeCloseTo(0.5, 3);
  });
});

describe("errors", () => {
  it("an engine failure is INTERNAL_SERVER_ERROR with a plain message, no stack or SQL", async () => {
    engine.rowsFor = () => {
      throw new Error("Binder Error: column foo not found\n    at duckdb (engine.cc:1)");
    };
    const error = await caller.explore.search(input()).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: EXPLORE_ENGINE_ERROR });
    expect(EXPLORE_ENGINE_ERROR).not.toMatch(/\bat\b.*\(|SELECT|Binder/);
  });
});

describe("explore.search BAD_REQUEST messages (review round)", () => {
  it("names the first bad field and its bound in a short sentence, not a JSON dump", async () => {
    const caller = appRouter.createCaller({} as never);
    const err = await caller.explore
      .search({
        manifestCid: "bafkreiaaaa",
        area: { place: "Austin" },
        radius_mi: 99,
      } as never)
      .catch((e: unknown) => e);
    const message = (err as Error).message;
    expect((err as { code: string }).code).toBe("BAD_REQUEST");
    expect(message).not.toMatch(/[[{"]/);
    expect(message.length).toBeLessThan(160);
    expect(message).toMatch(/manifestCid|radius_mi/);
  });
  it("names radius_mi and its upper bound", async () => {
    const caller = appRouter.createCaller({} as never);
    const good = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
    const err = await caller.explore
      .search({ manifestCid: good, area: { place: "Austin" }, radius_mi: 99 } as never)
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe("radius_mi must be at most 25");
  });
});
