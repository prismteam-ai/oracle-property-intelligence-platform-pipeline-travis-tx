// A-04 T045 (AC-8, FR-008, FR-024, TC-023): coverage both ways. Public = the frozen v_property
// view bound by query-core bindManifest({ partUrl }) to LOCAL export-tables parts and run through
// the DuckDB CLI; Query DB = the BackboneReport coordinates section. Nothing is uploaded.
// Offline; the table export below is SYNTHETIC TEST INPUT written by the DuckDB CLI itself.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RestateIngressClient } from "../../../travis/backbone/restate-client.js";
import {
  PUBLIC_COUNTS_SQL,
  PUBLIC_COVERAGE_SQL,
  QDB_COVERAGE_SQL,
  coverageLine,
  duckdbCliEngine,
  jobIdFromTables,
  runCoverage,
} from "../../../travis/gis/coverage-report.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "a04-cov-"));
  dirs.push(d);
  return d;
};

const report = (coverage_r: number, permit_point: number, denominator_r = 441961) => ({
  job_id: "travis-a04-202610220100",
  as_of: "2026-10-22",
  code_sha: null,
  coordinates: {
    coverage_r,
    denominator_r,
    by_source: { gis_centroid: 1, permit_point, none: 1 },
  },
  limitations: [],
});
const ingressFor = (body: unknown, calls: unknown[] = []): RestateIngressClient => ({
  call: async <T>(service: string, handler: string, req: unknown) => {
    calls.push({ service, handler, req });
    return body as T;
  },
  send: async () => ({ invocationId: "x" }),
  callLong: async <T>() => null as T,
  get: async <T>() => null as T,
});

const HAS_DUCKDB = spawnSync("duckdb", ["-version"], { encoding: "utf8" }).status === 0;

describe("A-04 T045 coverage both ways (coverage-report.ts)", () => {
  it("the public SQL and the Query DB SQL are exactly the frozen expressions", () => {
    expect(PUBLIC_COVERAGE_SQL).toBe("SELECT avg((latitude IS NOT NULL)::int) FROM v_property");
    expect(QDB_COVERAGE_SQL).toBe(
      "SELECT avg((latitude IS NOT NULL)::int) FROM parcels WHERE prop_type = 'R'",
    );
  });

  it("prints `coverage_public=<p> coverage_qdb=<q> permit_point=<n>` (Query DB figures from the report)", async () => {
    const calls: unknown[] = [];
    const out = await runCoverage({
      tablesDir: "/x/pipeline/data/runs/travis-a04-202610220100/tables",
      jobId: null,
      ingress: ingressFor(report(0.99497, 1680), calls),
      publicCoverage: async () => ({ share: 0.99117, rows: 441961, distinct: 441961 }),
    });
    expect(out.ok).toBe(true);
    expect(out.lines).toContain(
      "v_property rows=441961 distinct_property_cid=441961 qdb_r_accounts=441961 explained_difference=0",
    );
    expect(out.line).toBe("coverage_public=0.9912 coverage_qdb=0.9950 permit_point=1680");
    expect(out.jobId).toBe("travis-a04-202610220100");
    expect(calls).toEqual([
      { service: "BackboneReport", handler: "get", req: { jobId: "travis-a04-202610220100" } },
    ]);
    expect(coverageLine(1, 0, 0)).toBe("coverage_public=1.0000 coverage_qdb=0.0000 permit_point=0");
  });

  const run = (
    stats: { share: number; rows: number; distinct: number },
    over: { qdb?: number; explainedDifference?: number; q?: number; n?: number } = {},
  ) =>
    runCoverage({
      tablesDir: "/x/pipeline/data/runs/travis-a04-202610220100/tables",
      jobId: null,
      ingress: ingressFor(report(over.q ?? 0.99497, over.n ?? 1680, over.qdb ?? 441961)),
      publicCoverage: async () => stats,
      explainedDifference: over.explainedDifference,
    });

  it("DP-3 fails when v_property has duplicate property_cid (count(*) != count(DISTINCT property_cid))", async () => {
    const out = await run({ share: 0.99117, rows: 441962, distinct: 441961 });
    expect(out.ok).toBe(false);
    expect(out.failures.join("\n")).toMatch(/duplicate property_cid/);
  });

  it("DP-3 fails when the public count differs from the Query DB R-account count, unless the difference is the explained one", async () => {
    const short = { share: 0.99117, rows: 441900, distinct: 441900 };
    const bad = await run(short);
    expect(bad.ok).toBe(false);
    expect(bad.failures.join("\n")).toMatch(/441900.*441961/);
    const explained = await run(short, { explainedDifference: -61 });
    expect(explained.ok).toBe(true);
    const wrongExplanation = await run(short, { explainedDifference: -60 });
    expect(wrongExplanation.ok).toBe(false);
  });

  it("DP-3 compares the two shares (public = Query DB minus permit_point accounts) within an absolute tolerance of 0.0005", async () => {
    // expected public share = 0.99497 - 1680/441961 = 0.99117
    expect((await run({ share: 0.9915, rows: 441961, distinct: 441961 })).ok).toBe(true);
    const off = await run({ share: 0.9925, rows: 441961, distinct: 441961 });
    expect(off.ok).toBe(false);
    expect(off.failures.join("\n")).toMatch(/share.*0\.0005/);
  });

  it("the public counts SQL is count(*) and count(DISTINCT property_cid) over v_property", () => {
    expect(PUBLIC_COUNTS_SQL).toBe(
      "SELECT count(*)::BIGINT AS n, count(DISTINCT property_cid)::BIGINT AS d FROM v_property",
    );
  });

  it("the job comes from --job or from the tables path; otherwise it is refused", () => {
    expect(jobIdFromTables("pipeline/data/runs/travis-a04-202610220100/tables")).toBe(
      "travis-a04-202610220100",
    );
    expect(jobIdFromTables("/tmp/tables")).toBeNull();
  });

  it("no upload or network call exists in the coverage path (TC-NF-02)", () => {
    const src = readFileSync(
      new URL("../../../travis/gis/coverage-report.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/\bupload\b|ipfs|pinata|filebase|fetch\(|elephant-cli/i);
    expect(src).toMatch(/bindManifest/);
    expect(src).toMatch(/partUrl/);
  });

  it.skipIf(!HAS_DUCKDB)("the DuckDB CLI engine runs statements and returns rows", async () => {
    const engine = duckdbCliEngine(join(tmp(), "e.duckdb"));
    await engine.run("CREATE TABLE t AS SELECT 1 AS x UNION ALL SELECT 2");
    expect(await engine.all("SELECT sum(x)::INT AS s FROM t")).toEqual([{ s: 3 }]);
  });

  it.skipIf(!HAS_DUCKDB)(
    "over a local export-tables layout, v_property is bound by bindManifest({ partUrl }) and gives the public share",
    async () => {
      const root = tmp();
      const tables = join(root, "runs", "travis-a04-202610220100", "tables");
      const county = join(tables, "county");
      for (const t of ["property", "geometry", "property_has_parcel", "parcel_has_geometry"]) {
        mkdirSync(join(county, t), { recursive: true });
      }
      const e = "'dg' AS data_group_cid";
      const copy = (sel: string, t: string) =>
        `COPY (${sel}) TO '${join(county, t, "part-00000.parquet")}' (FORMAT parquet);`;
      const script = [
        copy(
          `SELECT * FROM (VALUES ('p1','p1','221829'),('p2','p2','221830')) v(cid, property_cid, request_identifier)
         CROSS JOIN (SELECT ${e}, 'x'::VARCHAR AS parcel_identifier, 'SingleFamily'::VARCHAR AS property_type,
           NULL::VARCHAR AS property_usage_type, 1990::BIGINT AS property_structure_built_year,
           NULL::VARCHAR AS source_http_request)`,
          "property",
        ),
        copy(
          `SELECT 'g1' AS cid, 'p1' AS property_cid, ${e}, '221829' AS request_identifier, 30.25::DOUBLE AS latitude, -97.75::DOUBLE AS longitude, NULL::VARCHAR AS source_http_request`,
          "geometry",
        ),
        copy(
          `SELECT * FROM (VALUES ('e1','p1','pa1','p1'),('e2','p2','pa2','p2')) v(relationship_cid, from_cid, to_cid, property_cid) CROSS JOIN (SELECT ${e})`,
          "property_has_parcel",
        ),
        copy(
          `SELECT 'e3' AS relationship_cid, 'pa1' AS from_cid, 'g1' AS to_cid, 'p1' AS property_cid, ${e}`,
          "parcel_has_geometry",
        ),
      ].join("\n");
      const made = spawnSync("duckdb", [":memory:"], { input: script, encoding: "utf8" });
      expect(made.status, made.stderr).toBe(0);

      const out = await runCoverage({
        tablesDir: tables,
        jobId: null,
        ingress: ingressFor(report(0.5, 0, 2)),
        dbPath: join(root, "coverage.duckdb"),
      });
      expect(out.ok).toBe(true);
      expect(out.publicCounts).toEqual({ rows: 2, distinct: 2 });
      expect(out.line).toBe("coverage_public=0.5000 coverage_qdb=0.5000 permit_point=0");
    },
  );
});
