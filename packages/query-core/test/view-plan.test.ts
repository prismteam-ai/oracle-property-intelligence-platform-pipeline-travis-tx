// ERR-19 (A-03 AC-7, NFR-004): a cold `runs.summary` bound all 23 emitted tables (two sequential
// range requests each) before a query that reads only v_roofing_permit and v_run. The view plan
// names the contract views a builder reads and the export tables those views read, and
// bindManifest's `views` option binds only those. Proved twice: the table subset as data, and
// identical rows from a subset bind and a full bind over the same Parquet on real DuckDB.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REQUIRED_TABLES, tablesForViews, type BindOptions } from "../src/bind-manifest.js";
import { listRoofingPermitsSql, radiusSql, roofAgeSql, runSummarySql } from "../src/builders.js";
import { sampleSql } from "../src/sample.js";
import { CONTRACT_VIEWS, VIEW_STATEMENTS, planViews, viewsReadBy } from "../src/view-plan.js";
import { VIEWS_SQL } from "../src/sql.js";
import {
  AUSTIN_URL,
  austinRequest,
  bindFixture,
  propertyRows,
  type Fixture,
  type FixtureTables,
  type Row as FixtureRow,
} from "./helpers/fixture-export.js";

const key = (t: { group: string; table: string }): string => `${t.group}.${t.table}`;
const keysFor = (views: Parameters<typeof tablesForViews>[0]): string[] =>
  tablesForViews(views).map(key).sort();

/** What v_roofing_permit reads: meta.permit's three relations plus the contractor edges and companies. */
const ROOFING_TABLES = [
  "county.property",
  // the contractor company the permit prints (ERR-66): contractor_name_as_printed
  "property_improvement.company",
  "property_improvement.property_has_property_improvement",
  "property_improvement.property_improvement",
  "property_improvement.property_improvement_has_contractor",
];

describe("view plan (ERR-19)", () => {
  it("splits views.sql into its five view statements, in file order, losing no statement", () => {
    expect(VIEW_STATEMENTS.map((s) => s.name)).toEqual([
      "meta.permit",
      "v_property",
      "v_roofing_permit",
      "v_contractor",
      "v_run",
    ]);
    const creates = (sql: string): number => sql.match(/^CREATE OR REPLACE VIEW /gm)?.length ?? 0;
    expect(VIEW_STATEMENTS.reduce((n, s) => n + creates(s.sql), 0)).toBe(creates(VIEWS_SQL));
    for (const s of VIEW_STATEMENTS) expect(VIEWS_SQL).toContain(s.sql.trim());
  });

  it("names the views each statement reads", () => {
    const deps = Object.fromEntries(VIEW_STATEMENTS.map((s) => [s.name, [...s.views].sort()]));
    expect(deps).toEqual({
      "meta.permit": [],
      v_property: ["meta.permit"],
      v_roofing_permit: ["meta.permit"],
      v_contractor: ["v_roofing_permit"],
      v_run: [],
    });
  });

  it("viewsReadBy names the contract views a builder's SQL reads", () => {
    expect(viewsReadBy(runSummarySql())).toEqual(["v_roofing_permit", "v_run"]);
    expect(viewsReadBy(listRoofingPermitsSql())).toEqual(["v_roofing_permit"]);
    expect(viewsReadBy(radiusSql({ lat: 30.2, lon: -97.7, miles: 1, limit: 5 }))).toEqual([
      "v_property",
    ]);
    expect(
      viewsReadBy(
        roofAgeSql({
          lat: 30.2,
          lon: -97.7,
          miles: 1,
          minYears: 15,
          asOf: "2026-10-20T22:00:10.663Z",
        }),
      ),
    ).toEqual(["v_property"]);
    expect(viewsReadBy(sampleSql())).toEqual(["v_property", "v_roofing_permit"]);
    expect(viewsReadBy("SELECT 1")).toEqual([]);
  });

  it("runs.summary (v_roofing_permit + v_run) needs 5 of the 16 required tables", () => {
    expect(keysFor(viewsReadBy(runSummarySql()))).toEqual(ROOFING_TABLES);
    expect(keysFor(["v_run"])).toEqual([]);
    expect(keysFor(["v_contractor"])).toEqual([...ROOFING_TABLES].sort());
  });

  it("v_property needs every county table plus meta.permit's, and all four views need exactly REQUIRED_TABLES", () => {
    expect(keysFor(["v_property"])).toEqual(
      [
        "county.company",
        "county.company_has_mailing_address",
        "county.company_has_property",
        "county.geometry",
        "county.parcel_has_geometry",
        "county.person",
        "county.person_has_mailing_address",
        "county.person_has_property",
        "county.property",
        "county.property_has_address",
        "county.property_has_parcel",
        "county.property_has_sales_history",
        "county.property_has_structure",
        "county.sales_history",
        "county.sales_history_has_company",
        "county.sales_history_has_person",
        "county.structure",
        "property_improvement.property_has_property_improvement",
        "property_improvement.property_improvement",
      ].sort(),
    );
    expect(keysFor(CONTRACT_VIEWS)).toEqual(REQUIRED_TABLES.map(key).sort());
    // county.address is read through meta.address_fields / address_zip: planned, but deliberately not required.
    expect(planViews(["v_property"]).tables.has("county.address")).toBe(true);
    expect(planViews(["v_roofing_permit"]).tables.has("county.address")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------
// Subset bind vs full bind on real DuckDB
// ---------------------------------------------------------------------------------------

const P1 = "baguqeeraprop1";
const P2 = "baguqeeraprop2";
const CENTRE = { lat: 30.2672, lon: -97.7431 };
const edge = (from: string, to: string): FixtureRow => ({ from_cid: from, to_cid: to });
const permit = (cid: string, permitNumber: string, status: string): FixtureRow => ({
  cid,
  request_identifier: cid,
  permit_number: permitNumber,
  improvement_type: "Roofing",
  improvement_action: "Replacement",
  improvement_status: status,
  permit_issue_date: "2026-04-01",
  completion_date: "2026-05-01",
  source_http_request: austinRequest(permitNumber, AUSTIN_URL),
});

/** Both groups, an unread extra table (county.address) and a contractor edge with its company. */
const TABLES: FixtureTables = {
  county: {
    property: [propertyRows(P1, 1985), propertyRows(P2, null)],
    property_has_parcel: [edge(P1, "pc1"), edge(P2, "pc2")],
    parcel_has_geometry: [edge("pc1", "g1"), edge("pc2", "g2")],
    geometry: [
      { cid: "g1", latitude: CENTRE.lat, longitude: CENTRE.lon },
      { cid: "g2", latitude: 30.27444, longitude: CENTRE.lon },
    ],
    property_has_structure: [edge(P1, "s1")],
    structure: [{ cid: "s1", roof_date: "1985" }],
    address: [{ cid: "a1", request_identifier: "a1" }],
  },
  property_improvement: {
    property_improvement: [
      permit("pb", "2026-000200 BP", "Permitted"),
      permit("pa", "2026-000100 BP", "Completed"),
    ],
    property_has_property_improvement: [edge(P1, "pa"), edge(P2, "pb")],
    property_improvement_has_contractor: [edge("pa", "co1")],
    company: [{ cid: "co1", request_identifier: "co1", name: "Acme Roofing" }],
  },
};

const relationsIn = async (fx: Fixture): Promise<string[]> =>
  (
    await fx.db.all(
      `SELECT schema_name || '.' || view_name AS r FROM duckdb_views() WHERE NOT internal
       UNION ALL SELECT schema_name || '.' || table_name FROM duckdb_tables()
       ORDER BY 1`,
    )
  ).map((row) => String(row.r));

describe("bindManifest({ views }) over real DuckDB (ERR-19)", () => {
  let full: Fixture;
  let summary: Fixture;
  let property: Fixture;
  const summaryParts: string[] = [];

  beforeAll(async () => {
    full = await bindFixture(TABLES);
    const views = viewsReadBy(runSummarySql());
    const summaryOptions = (dir: string): BindOptions => ({
      views,
      partUrl: ({ name }) => {
        summaryParts.push(name);
        return `${dir}/${name.replace(/^tables\//, "")}`;
      },
    });
    summary = await bindFixture(TABLES, undefined, undefined, summaryOptions);
    property = await bindFixture(TABLES, undefined, undefined, () => ({
      views: viewsReadBy(radiusSql({ ...CENTRE, miles: 1, limit: 5 })),
    }));
  });
  afterAll(() => {
    full.close();
    summary.close();
    property.close();
  });

  it("binds only the parts of the tables runs.summary's views read", () => {
    expect(summaryParts.sort()).toEqual(
      [
        "tables/county/property/part-00000.parquet",
        "tables/property_improvement/company/part-00000.parquet",
        "tables/property_improvement/property_has_property_improvement/part-00000.parquet",
        "tables/property_improvement/property_improvement/part-00000.parquet",
        "tables/property_improvement/property_improvement_has_contractor/part-00000.parquet",
      ].sort(),
    );
    expect(summary.bound.tables.filter((t) => t.emitted).map(key)).toEqual(
      expect.arrayContaining(ROOFING_TABLES),
    );
    expect(summary.bound.tables.map(key).sort()).toEqual(ROOFING_TABLES);
    expect(summary.bound.views).toEqual(["v_roofing_permit", "v_run"]);
    expect(full.bound.views).toEqual([...CONTRACT_VIEWS]);
  });

  it("creates no relation for an unread table and no unrequested contract view", async () => {
    const relations = await relationsIn(summary);
    for (const absent of [
      "county.geometry",
      "county.address",
      "main.v_property",
      "main.v_contractor",
    ])
      expect(relations).not.toContain(absent);
    for (const present of [...ROOFING_TABLES, "meta.permit", "main.v_roofing_permit", "main.v_run"])
      expect(relations).toContain(present);
  });

  it("runSummarySql and listRoofingPermitsSql return the same rows as over the full bind (identical manifest CID)", async () => {
    expect(summary.bound.manifestCid).toBe(full.bound.manifestCid);
    for (const sql of [runSummarySql(), listRoofingPermitsSql()]) {
      const expected = await full.rows(sql);
      expect(expected.length).toBeGreaterThan(0);
      expect(await summary.rows(sql)).toEqual(expected);
    }
    const [row] = await summary.rows(runSummarySql());
    expect(row?.roofing_permit_rows).toBe(2);
  });

  it("radiusSql and roofAgeSql return the same rows over a v_property-only bind", async () => {
    const asOf = full.bound.asOf;
    for (const sql of [
      radiusSql({ ...CENTRE, miles: 1, limit: 10 }),
      roofAgeSql({ ...CENTRE, miles: 4, minYears: 1, asOf }),
    ]) {
      const expected = await full.rows(sql);
      expect(expected.length).toBeGreaterThan(0);
      expect(await property.rows(sql)).toEqual(expected);
    }
    expect(property.bound.views).toEqual(["v_property"]);
  });

  it("v_contractor over a contractor-only bind equals the full bind", async () => {
    const contractor = await bindFixture(TABLES, undefined, undefined, () => ({
      views: ["v_contractor"],
    }));
    try {
      const sql = "SELECT * FROM v_contractor ORDER BY 1";
      const expected = await full.rows(sql);
      expect(expected.length).toBeGreaterThan(0);
      expect(await contractor.rows(sql)).toEqual(expected);
      expect(contractor.bound.views).toEqual(["v_roofing_permit", "v_contractor"]);
    } finally {
      contractor.close();
    }
  });

  it("a later subset bind on a warm engine drops the contract views it does not recreate", async () => {
    const warm = await bindFixture(TABLES, undefined, summary.db, () => ({ views: ["v_run"] }));
    try {
      const relations = await relationsIn(summary);
      expect(relations).toContain("main.v_run");
      expect(relations).not.toContain("main.v_roofing_permit");
      expect(relations).not.toContain("meta.permit");
    } finally {
      warm.close();
    }
  });
});
