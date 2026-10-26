// T011 (A-03, AD-19, ADR-0001, contracts/api.md): the query builders live in one place and are
// proved twice: as text (what the SQL must and must not contain) and by running them in DuckDB
// over a small bound fixture. bench-sql.ts is the spike's performance stand-in (P0-9: it is not a
// roof classification) and bindManifest's partUrl option maps parts to CID-copy URLs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { QueryEngine, Row } from "../src/engine.js";
import { REQUIRED_TABLES, bindManifest } from "../src/bind-manifest.js";
import {
  BENCH_AS_OF,
  BENCH_PRESETS,
  BENCH_STAND_IN_NOTE,
  benchCountSql,
  benchRadiusSql,
  benchRoofAgeSql,
} from "../src/bench-sql.js";
import {
  MAX_ROWS,
  listRoofingPermitsSql,
  radiusSql,
  roofAgeSql,
  runSummarySql,
} from "../src/builders.js";
import { openDuckDb, type DuckDbEngine } from "../scripts/duckdb-engine.js";
import {
  AUSTIN_URL,
  austinRequest,
  baseManifest,
  bindFixture,
  propertyRows,
  type Fixture,
  type FixtureTables,
  type Row as FixtureRow,
} from "./helpers/fixture-export.js";

const NOW_LIKE = /\bnow\(\)|\bcurrent_date\b|\bcurrent_timestamp\b|\btoday\(\)/i;
const PROVENANCE = [
  "cid",
  "source_url",
  "captured_at",
  "table",
  "table_cid",
  "run_id",
  "manifest_cid",
  "as_of",
];

// Centre: the G6 acceptance point (TC-NF-05). The other points are ~0.5 mi north and ~3 mi east.
const CENTRE = { lat: 30.2672, lon: -97.7431 };
const NORTH_HALF_MILE = { lat: 30.27444, lon: -97.7431 };
const EAST_THREE_MILES = { lat: 30.2672, lon: -97.69282 };

describe("listRoofingPermitsSql (text)", () => {
  const sql = listRoofingPermitsSql();
  it("selects the permit columns, provenance and missing from v_roofing_permit, ordered by permit_number", () => {
    for (const c of [
      "permit_number",
      "improvement_status",
      "status_class",
      "issue_date",
      "final_date",
      "permit_close_date",
      "open_days",
      "contractor_resolution",
      "contractor_name_as_printed",
      "bbb_url",
      "missing",
      ...PROVENANCE,
    ])
      expect(sql, c).toMatch(new RegExp(`\\b"?${c}"?\\b`));
    expect(sql).toMatch(/FROM v_roofing_permit\b/);
    expect(sql).toMatch(/ORDER BY permit_number\b/);
    expect(sql).not.toMatch(NOW_LIKE);
  });
});

describe("runSummarySql (text)", () => {
  it("counts v_roofing_permit rows next to the run identity from v_run", () => {
    const sql = runSummarySql();
    expect(sql).toMatch(/FROM v_run\b/);
    expect(sql).toMatch(/count\(\*\)[^)]*FROM v_roofing_permit/);
    expect(sql).toMatch(/\broofing_permit_rows\b/);
    expect(sql).toMatch(/\brun_id\b/);
    expect(sql).toMatch(/\bmanifest_cid\b/);
  });
});

describe("radiusSql (text)", () => {
  const sql = radiusSql({ lat: 30.2672, lon: -97.7431, miles: 1 });
  it("prefilters on a lat/lon bbox, then haversine, ordered by distance, LIMIT 500 by default", () => {
    expect(sql).toMatch(/FROM v_property\b/);
    expect(sql).toMatch(/latitude BETWEEN [-\d.]+ AND [-\d.]+/);
    expect(sql).toMatch(/longitude BETWEEN [-\d.]+ AND [-\d.]+/);
    expect(sql).toMatch(/asin\(sqrt\(/); // haversine
    expect(sql).toMatch(/< 1609\.344\b/); // 1 statute mile in metres
    expect(sql).toMatch(/AS distance_m\b/);
    expect(sql).toMatch(/ORDER BY distance_m\b/);
    expect(sql).toMatch(/LIMIT 500$/);
    expect(sql).not.toMatch(NOW_LIKE);
  });

  it("caps limit at 1000 and rejects out-of-range input", () => {
    expect(MAX_ROWS).toBe(1000);
    expect(radiusSql({ lat: 30, lon: -97, miles: 1, limit: 1000 })).toMatch(/LIMIT 1000$/);
    expect(() => radiusSql({ lat: 30, lon: -97, miles: 1, limit: 1001 })).toThrow(/limit/);
    expect(() => radiusSql({ lat: 30, lon: -97, miles: 1, limit: 0 })).toThrow(/limit/);
    expect(() => radiusSql({ lat: 30, lon: -97, miles: 1, limit: 2.5 })).toThrow(/limit/);
    expect(() => radiusSql({ lat: 91, lon: -97, miles: 1 })).toThrow(/lat/);
    expect(() => radiusSql({ lat: 30, lon: -181, miles: 1 })).toThrow(/lon/);
    expect(() => radiusSql({ lat: 30, lon: -97, miles: 0 })).toThrow(/miles/);
    expect(() => radiusSql({ lat: 30, lon: -97, miles: 26 })).toThrow(/miles/);
  });
});

describe("roofAgeSql (text)", () => {
  const asOf = "2026-10-20T22:00:10.663Z";
  const sql = roofAgeSql({ lat: 30.2672, lon: -97.7431, miles: 1, minYears: 15, asOf });
  it("filters v_property.roof_age_years inside the radius, keeps rows with a missing age, and takes as_of as a parameter", () => {
    expect(sql).toMatch(/FROM v_property\b/);
    expect(sql).toMatch(/roof_age_years >= 15\b/);
    expect(sql).toMatch(/roof_age_years IS NULL/);
    expect(sql).toContain(asOf);
    expect(sql).toMatch(/AS as_of_date\b/);
    expect(sql).toMatch(/asin\(sqrt\(/);
    expect(sql).toMatch(/LIMIT 500$/);
    expect(sql).not.toMatch(NOW_LIKE);
  });

  it("rejects a bad as_of or minYears", () => {
    const base = { lat: 30, lon: -97, miles: 1, minYears: 15 };
    expect(() => roofAgeSql({ ...base, asOf: "now()" })).toThrow(/asOf/);
    expect(() => roofAgeSql({ ...base, asOf: "" })).toThrow(/asOf/);
    expect(() => roofAgeSql({ ...base, asOf, minYears: 0 })).toThrow(/minYears/);
    expect(() => roofAgeSql({ ...base, asOf, minYears: 101 })).toThrow(/minYears/);
  });
});

describe("bench-sql (text): the spike's performance stand-in, P0-9", () => {
  it("is labelled as a stand-in and uses a fixed date, never now()", () => {
    expect(BENCH_STAND_IN_NOTE).toBe("performance stand-in, not a roof classification");
    expect(BENCH_AS_OF).toBe("2026-10-21");
    for (const sql of [
      benchRoofAgeSql(BENCH_PRESETS.TC_NF_05),
      benchRoofAgeSql(BENCH_PRESETS.ADR_0001),
    ]) {
      expect(sql).toContain("DATE '2026-10-21'");
      expect(sql).toMatch(
        /date_diff\('year', TRY_CAST\(substr\(issue_date,1,10\) AS DATE\), DATE '2026-10-21'\) >= 15/,
      );
      expect(sql).not.toMatch(NOW_LIKE);
    }
  });

  it("TC_NF_05 = 30.2672, −97.7431, 1 mi, ≥ 15 years (the G6 acceptance case)", () => {
    expect(BENCH_PRESETS.TC_NF_05).toMatchObject({
      lat: 30.2672,
      lon: -97.7431,
      miles: 1,
      minYears: 15,
    });
    const sql = benchRadiusSql(BENCH_PRESETS.TC_NF_05);
    expect(sql).toMatch(/< 1609\.344\b/);
    expect(sql).toMatch(/latitude BETWEEN 30\.2\d+ AND 30\.2\d+/);
  });

  it("ADR_0001 = Pflugerville 30.447765, −97.602116, 5 mi (8,046.72 m), LIMIT 500, ≥ 15 years", () => {
    expect(BENCH_PRESETS.ADR_0001).toMatchObject({
      lat: 30.447765,
      lon: -97.602116,
      miles: 5,
      minYears: 15,
      limit: 500,
    });
    const sql = benchRadiusSql(BENCH_PRESETS.ADR_0001);
    expect(sql).toMatch(/< 8046\.72\b/);
    expect(sql).toMatch(/LIMIT 500$/);
    expect(sql).toMatch(/radians\(30\.447765\)/);
    expect(sql).toMatch(/longitude-\(-97\.602116\)/);
    expect(benchRoofAgeSql(BENCH_PRESETS.ADR_0001)).toMatch(/< 8046\.72\b/);
  });

  it("builders are parametrised and take the relation name", () => {
    const custom = benchRadiusSql(
      { lat: 30.1, lon: -97.9, miles: 2, minYears: 20, limit: 7 },
      "austin",
    );
    expect(custom).toMatch(/FROM austin\b/);
    expect(custom).toMatch(/< 3218\.688\b/);
    expect(custom).toMatch(/LIMIT 7$/);
    expect(benchCountSql("austin")).toBe("SELECT count(*) AS n FROM austin");
    expect(benchRoofAgeSql({ lat: 30.1, lon: -97.9, miles: 2, minYears: 20, limit: 7 })).toMatch(
      />= 20\b/,
    );
  });
});

// ---------------------------------------------------------------------------------------
// Running the builders in DuckDB
// ---------------------------------------------------------------------------------------

const P1 = "baguqeeraprop1"; // at the centre, structure roof_date 1985 → roof age 41
const P2 = "baguqeeraprop2"; // 0.5 mi north, no structure → roof age unknown
const P3 = "baguqeeraprop3"; // 3 mi east, roof_date 2020 → roof age 6
const edge = (from: string, to: string): FixtureRow => ({ from_cid: from, to_cid: to });
const geometry = (cid: string, p: { lat: number; lon: number }): FixtureRow => ({
  cid,
  latitude: p.lat,
  longitude: p.lon,
});
const permit = (cid: string, permitNumber: string, status: string): FixtureRow => ({
  cid,
  request_identifier: cid,
  permit_number: permitNumber,
  improvement_type: "Roofing",
  improvement_action: "Replacement",
  improvement_status: status,
  permit_issue_date: "2026-04-01",
  source_http_request: austinRequest(permitNumber, AUSTIN_URL),
});

const TABLES: FixtureTables = {
  county: {
    property: [propertyRows(P1, 1985), propertyRows(P2, null), propertyRows(P3, 2020)],
    property_has_parcel: [edge(P1, "pc1"), edge(P2, "pc2"), edge(P3, "pc3")],
    parcel_has_geometry: [edge("pc1", "g1"), edge("pc2", "g2"), edge("pc3", "g3")],
    geometry: [
      geometry("g1", CENTRE),
      geometry("g2", NORTH_HALF_MILE),
      geometry("g3", EAST_THREE_MILES),
    ],
    property_has_structure: [edge(P1, "s1"), edge(P3, "s3")],
    structure: [
      { cid: "s1", roof_date: "1985" },
      { cid: "s3", roof_date: "2020" },
    ],
  },
  property_improvement: {
    property_improvement: [
      permit("pb", "2026-000200 BP", "Permitted"),
      permit("pa", "2026-000100 BP", "Completed"),
    ],
    property_has_property_improvement: [edge(P1, "pa"), edge(P2, "pb")],
  },
};

describe("builders over a bound fixture (DuckDB)", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await bindFixture(TABLES);
  });
  afterAll(() => fx.close());

  it("listRoofingPermitsSql returns the permits ordered by permit_number with provenance and missing", async () => {
    const rows = await fx.rows(listRoofingPermitsSql());
    expect(rows.map((r) => r.permit_number)).toEqual(["2026-000100 BP", "2026-000200 BP"]);
    const first = rows[0] as Record<string, unknown>;
    expect(Object.keys(first)).toEqual([
      "permit_number",
      "improvement_status",
      "status_class",
      "issue_date",
      "final_date",
      "permit_close_date",
      "open_days",
      "contractor_resolution",
      "contractor_name_as_printed",
      "bbb_url",
      ...PROVENANCE,
      "missing",
    ]);
    expect(first.status_class).toBe("closed");
    expect(first.issue_date).toBe("2026-04-01");
    expect(first.contractor_resolution).toBe("unresolved");
    expect(first.manifest_cid).toBe(fx.bound.manifestCid);
    expect(Array.isArray(first.missing)).toBe(true);
  });

  it("runSummarySql returns one row with the run identity and the v_roofing_permit count", async () => {
    const rows = await fx.rows(runSummarySql());
    expect(rows).toEqual([
      expect.objectContaining({
        run_id: fx.bound.runId,
        manifest_cid: fx.bound.manifestCid,
        roofing_permit_rows: 2,
      }),
    ]);
  });

  it("radiusSql keeps the two properties inside 1 mile, nearest first, with distance_m", async () => {
    const rows = await fx.rows(radiusSql({ ...CENTRE, miles: 1, limit: 10 }));
    expect(rows.map((r) => r.property_cid)).toEqual([P1, P2]);
    expect(rows[0]?.distance_m).toBeCloseTo(0, 3);
    expect(rows[1]?.distance_m as number).toBeGreaterThan(790);
    expect(rows[1]?.distance_m as number).toBeLessThan(820);
    expect(rows[0]).toHaveProperty("manifest_cid", fx.bound.manifestCid);
    expect(rows[0]).toHaveProperty("missing");
    expect(await fx.rows(radiusSql({ ...CENTRE, miles: 1, limit: 1 }))).toHaveLength(1);
    expect(await fx.rows(radiusSql({ ...CENTRE, miles: 4, limit: 10 }))).toHaveLength(3);
  });

  it("roofAgeSql keeps roofs ≥ minYears and rows whose age is unknown (with their reason), as of the parameter", async () => {
    const rows = await fx.rows(
      roofAgeSql({ ...CENTRE, miles: 4, minYears: 15, asOf: fx.bound.asOf }),
    );
    expect(rows.map((r) => r.property_cid)).toEqual([P1, P2]); // P3 (age 6) is dropped
    expect(rows[0]?.roof_age_years).toBe(41);
    expect(rows[0]?.as_of_date).toBe("2026-10-20");
    expect(rows[1]?.roof_age_years).toBeNull();
    const missing = rows[1]?.missing as { field: string; reason: string }[];
    expect(missing).toEqual(
      expect.arrayContaining([{ field: "roof_age_years", reason: "no_roof_date" }]),
    );
    expect(
      await fx.rows(roofAgeSql({ ...CENTRE, miles: 4, minYears: 50, asOf: fx.bound.asOf })),
    ).toHaveLength(1);
  });
});

describe("bench-sql over a raw Austin-shaped table (DuckDB)", () => {
  let db: DuckDbEngine;
  beforeAll(async () => {
    db = await openDuckDb();
    await db.run(`CREATE TABLE t AS SELECT * FROM (VALUES
      ('A', 'Building Permit', '2005-01-15T00:00:00.000', '1 Centre St', ${CENTRE.lat}, ${CENTRE.lon}),
      ('B', 'Building Permit', '2015-06-01T00:00:00.000', '2 North St', ${NORTH_HALF_MILE.lat}, ${NORTH_HALF_MILE.lon}),
      ('C', 'Building Permit', '2000-02-02T00:00:00.000', '3 East St', ${EAST_THREE_MILES.lat}, ${EAST_THREE_MILES.lon}),
      ('D', 'Building Permit', NULL, '4 Nowhere', NULL, NULL)
    ) AS v(permit_number, permit_type_desc, issue_date, original_address1, latitude, longitude)`);
  });
  afterAll(() => db.close());

  it("count, radius (nearest first) and the roof-age stand-in run with the TC_NF_05 preset", async () => {
    expect(await db.all(benchCountSql())).toEqual([{ n: 4 }]);
    const radius = await db.all(benchRadiusSql(BENCH_PRESETS.TC_NF_05));
    expect(radius.map((r) => r.permit_number)).toEqual(["A", "B"]);
    expect(Object.keys(radius[0] as Row)).toEqual([
      "permit_number",
      "permit_type_desc",
      "issue_date",
      "original_address1",
      "latitude",
      "longitude",
      "d_m",
    ]);
    // Only A is both inside 1 mile and issued ≥ 15 years before 2026-10-21.
    expect(await db.all(benchRoofAgeSql(BENCH_PRESETS.TC_NF_05))).toEqual([{ n: 1 }]);
  });
});

// ---------------------------------------------------------------------------------------
// bindManifest partUrl (T013)
// ---------------------------------------------------------------------------------------

/** Records every statement; answers DESCRIBE with the columns views.sql requires. */
function recordingEngine(): QueryEngine & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    async run(s: string): Promise<void> {
      sql.push(s);
    },
    async all(s: string): Promise<Row[]> {
      sql.push(s);
      const m = /^DESCRIBE SELECT \* FROM (\w+)\.(\w+)$/.exec(s);
      const t = REQUIRED_TABLES.find((r) => r.group === m?.[1] && r.table === m?.[2]);
      return Object.entries(t?.columns ?? {}).map(([column_name, column_type]) => ({
        column_name,
        column_type,
      }));
    },
  };
}

describe("bindManifest partUrl (T013)", () => {
  const manifest = baseManifest();
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const parts = manifest.artifacts.filter((a) => a.kind === "table") as {
    name: string;
    cid: string;
  }[];

  it("the pilot manifest has table parts to bind", () => {
    expect(parts.length).toBeGreaterThan(0);
  });

  it("without partUrl the file path is <tablesDir>/<group>/<table>/<part> (unchanged)", async () => {
    const engine = recordingEngine();
    await bindManifest(bytes, "/data/tables", engine);
    const joined = engine.sql.join("\n");
    for (const p of parts) {
      const path = p.name.replace(/^tables\//, "/data/tables/");
      expect(joined).toContain(`read_parquet('${path}')`);
      expect(joined).toContain(`'${p.name}' AS _part`);
    }
    // The manifest's source URLs are in meta.source; no part may be read over HTTP by default.
    expect(joined).not.toContain("read_parquet('https://");
  });

  it("with partUrl every part is read from the URL built from {name, cid}", async () => {
    const engine = recordingEngine();
    const seen: { name: string; cid: string }[] = [];
    await bindManifest(bytes, "/ignored", engine, {
      partUrl: (a) => {
        seen.push(a);
        return `https://copy.example/ipfs/${a.cid}`;
      },
    });
    const joined = engine.sql.join("\n");
    for (const p of parts) {
      expect(joined).toContain(`read_parquet('https://copy.example/ipfs/${p.cid}')`);
      expect(joined).toContain(`'${p.name}' AS _part`);
    }
    expect(seen).toEqual(expect.arrayContaining(parts.map(({ name, cid }) => ({ name, cid }))));
    expect(joined).not.toContain("/ignored/");
  });
});
