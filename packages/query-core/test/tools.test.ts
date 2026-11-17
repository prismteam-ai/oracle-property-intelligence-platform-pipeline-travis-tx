import { DuckDBInstance } from "@duckdb/node-api";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type DatasetInfo,
  matchDensity,
  publishedTables,
  runTool,
  type SqlRunner,
  TOOLS,
  ToolInputError,
  toolSchemas,
} from "../src/index.js";

const CENTER = { latitude: 30.2649, longitude: -97.7472 };
const DEGREES_PER_MILE = 1 / 69.0;
const north = (miles: number) => CENTER.latitude + miles * DEGREES_PER_MILE;

const DATASET: DatasetInfo = {
  buildId: "20261027T130000Z",
  manifestCid: "bafkrei-manifest",
  rootCid: "bafybei-root",
  publishedAt: "2026-10-27T13:05:00.000Z",
  coverage: { properties: { rows: 5 } },
};

let runner: SqlRunner;

beforeAll(async () => {
  const connection = await (await DuckDBInstance.create(":memory:")).connect();
  await connection.run(`
    CREATE TABLE properties AS SELECT * FROM (VALUES
      (1::BIGINT, '100 NEAR ST', '78701', ${north(1)}, ${CENTER.longitude}, 1990::BIGINT, 'COMPOSITIO', 30, 'year_built', '1996', NULL, 'high', 'NEAR OWNER', 'out_of_state', 'CA', 22, 1::BIGINT, 'parcel_centroid', 'tcad-appraisal-export', 'run-a', 12, 'k1'),
      (2::BIGINT, '300 YOUNG ST', '78701', ${north(3)}, ${CENTER.longitude}, 2016::BIGINT, 'METAL', 10, 'completed_replacement', strftime(current_date - INTERVAL 6 MONTH, '%Y-%m-%d'), NULL, 'low', 'YOUNG OWNER', 'local', 'TX', 3, 0::BIGINT, 'parcel_centroid', 'tcad-appraisal-export', 'run-a', NULL, 'k2'),
      (3::BIGINT, '800 FAR ST', '78660', ${north(8)}, ${CENTER.longitude}, 1980::BIGINT, 'COMPOSITIO', 46, 'year_built', '1980', NULL, 'low', 'FAR OWNER', 'regional', 'TX', 30, 0::BIGINT, 'address_point', 'tcad-appraisal-export', 'run-a', NULL, 'k3'),
      (4::BIGINT, '200 MID ST', '78701', ${north(2)}, ${CENTER.longitude}, 2006::BIGINT, 'COMPOSITIO', 20, 'year_built', '2006', NULL, 'low', 'MID OWNER', 'local', 'TX', 12, 0::BIGINT, 'parcel_centroid', 'tcad-appraisal-export', 'run-a', NULL, 'k1'),
      (5::BIGINT, '1 NOWHERE', NULL, NULL, NULL, 1970::BIGINT, NULL, 56, 'year_built', '1970', NULL, 'low', 'LOST OWNER', 'local', 'TX', 40, 0::BIGINT, NULL, 'tcad-appraisal-export', 'run-a', NULL, 'k5')
    ) AS t(prop_id, situs_address, situs_zip, latitude, longitude, year_built, roof_covering, roof_age_years, roof_age_anchor, roof_age_anchor_date, roof_age_anchor_permit, roof_age_confidence, owner_name, owner_locality, mailing_state, ownership_years, unfinished_roofing_permits, coordinate_source, source, source_run_id, max_years_open, owner_key);

    CREATE TABLE roofing_permits AS SELECT * FROM (VALUES
      ('2014-1 BP', '100 NEAR ST', 'expired', 'replacement', true, DATE '2014-03-01', 12, true, DATE '2014-03-01', 'Centec Holdings dba Wilson Roofing', '5125550142', 'wilson roofing', 'A+', 'https://www.bbb.org/x', DATE '2026-07-10', 'high', 1::BIGINT, ${north(1)}, ${CENTER.longitude}, 'https://abc.austintexas.gov/1', 'austin-permits', 'run-p', 'Reroof residence'),
      ('2024-2 BP', '200 MID ST', 'open', 'replacement', true, DATE '2024-05-01', 2, false, DATE '2024-05-01', 'Quick Roofing', NULL, 'quick roofing', NULL, NULL, NULL, NULL, 4::BIGINT, ${north(2)}, ${CENTER.longitude}, 'https://abc.austintexas.gov/2', 'austin-permits', 'run-p', 'Re-roof'),
      ('2006-3 BP', '800 FAR ST', 'open', 'repair', true, DATE '2006-01-01', 20, true, DATE '2006-01-01', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 3::BIGINT, ${north(9)}, ${CENTER.longitude}, 'https://abc.austintexas.gov/3', 'austin-permits', 'run-p', 'Roof repair'),
      ('2010-4 BP', '150 DONE ST', 'completed', 'replacement', false, NULL, NULL, false, DATE '2010-01-01', 'Quick Roofing', NULL, 'quick roofing', NULL, NULL, NULL, NULL, 1::BIGINT, ${north(1.5)}, ${CENTER.longitude}, 'https://abc.austintexas.gov/4', 'austin-permits', 'run-p', 'Reroof'),
      ('1990-5 BP', '50 OLD ST', 'expired', 'replacement', true, DATE '1990-02-01', 36, true, DATE '1990-02-01', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 2::BIGINT, ${north(0.5)}, ${CENTER.longitude}, 'https://abc.austintexas.gov/5', 'austin-permits', 'run-p', 'Reroof'),
      ('2025-6 BP', '60 PATIO ST', 'open', 'accessory', true, DATE '2025-03-01', 1, false, DATE '2025-03-01', 'Patio Co', NULL, 'patio co', NULL, NULL, NULL, NULL, 4::BIGINT, ${north(2.5)}, ${CENTER.longitude}, 'https://abc.austintexas.gov/6', 'austin-permits', 'run-p', 'Patio cover')
    ) AS t(permit_number, address, permit_state, roof_work, unfinished, open_since, years_open, past_expiry, issue_date, contractor_name, contractor_phone, contractor_key, bbb_rating, bbb_profile_url, bbb_snapshot_date, bbb_match_confidence, prop_id, latitude, longitude, source_url, source, source_run_id, description);

    CREATE TABLE hail_events AS SELECT * FROM (VALUES
      ('E1', current_date - INTERVAL 1 YEAR, 1.75::DOUBLE, ${north(1.5)}, ${CENTER.longitude}, 'NEAR', 'https://www.ncei.noaa.gov/x?id=E1'),
      ('E2', current_date - INTERVAL 1 YEAR, 2.5, ${north(8)}, ${CENTER.longitude}, 'FAR', 'https://www.ncei.noaa.gov/x?id=E2'),
      ('E3', current_date - INTERVAL 6 MONTH, 0.75, ${north(3)}, ${CENTER.longitude}, 'SMALL', 'https://www.ncei.noaa.gov/x?id=E3'),
      ('E4', current_date - INTERVAL 10 YEAR, 2.0, ${north(1)}, ${CENTER.longitude}, 'OLD', 'https://www.ncei.noaa.gov/x?id=E4')
    ) AS t(event_id, event_date, magnitude_inches, latitude, longitude, location, source_url);

    CREATE TABLE owners AS SELECT * FROM (VALUES
      ('k1', 'NEAR OWNER LLC', 'CA', 2::BIGINT, [1, 4]::BIGINT[]),
      ('k2', 'YOUNG OWNER', 'TX', 1::BIGINT, [2]::BIGINT[])
    ) AS t(owner_key, owner_name, mailing_state, properties, prop_ids);

    CREATE TABLE contractors AS SELECT * FROM (VALUES
      ('wilson roofing', ['Centec Holdings dba Wilson Roofing'], ['5125550142'], 103::BIGINT, 1::BIGINT, 90::BIGINT, 'A+', 'Wilson Roofing', true, 'https://www.bbb.org/x', DATE '2026-07-10', 'phone', 'medium', 'WR AUSTIN HOLDINGS, LLC', true, 'name', ['A/C Contractor']),
      ('quick roofing', ['Quick Roofing'], [], 82::BIGINT, 1::BIGINT, 40::BIGINT, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
    ) AS t(contractor_key, names, phones, roofing_permits, unfinished_roofing_permits, properties, bbb_rating, bbb_business_name, bbb_accredited, bbb_profile_url, bbb_snapshot_date, bbb_match_method, bbb_match_confidence, registry_name, registry_active, registry_match_method, license_types);
  `);
  runner = {
    all: async (sql) =>
      (await connection.runAndReadAll(sql)).getRowObjectsJson() as Record<string, unknown>[],
  };
});

const run = (name: string, input: unknown) =>
  runTool(name, input, { sql: runner, dataset: DATASET });
const ids = (rows: Record<string, unknown>[], key: string) => rows.map((row) => row[key]);

describe("find_aged_roofs", () => {
  it("returns roofs older than the threshold within the radius, oldest first, with their basis", async () => {
    const result = await run("find_aged_roofs", {
      ...CENTER,
      radius_miles: 5,
      min_roof_age_years: 15,
    });

    expect(ids(result.rows, "prop_id")).toEqual(["1", "4"]);
    expect(result.rows[0]).toMatchObject({
      roof_age_years: 30,
      roof_age_anchor: "year_built",
      roof_age_confidence: "high",
      coordinate_source: "parcel_centroid",
      source: "tcad-appraisal-export",
    });
    expect(Number(result.rows[0]?.distance_miles)).toBeCloseTo(1, 1);
    expect(result.totalMatches).toBe(2);
    expect(result.summary).toEqual({ high_confidence: 1, medium_confidence: 0, low_confidence: 1 });
    expect(result.dataset.manifestCid).toBe("bafkrei-manifest");
    expect(result.sql).toContain("FROM properties");
  });

  it("ranks the best-evidenced roof ages first, then the oldest", async () => {
    const result = await run("find_aged_roofs", {
      ...CENTER,
      radius_miles: 10,
      min_roof_age_years: 15,
    });

    expect(ids(result.rows, "prop_id")).toEqual(["1", "3", "4"]);
  });

  it("can require a minimum confidence in the roof age", async () => {
    const result = await run("find_aged_roofs", { ...CENTER, min_confidence: "medium" });

    expect(ids(result.rows, "prop_id")).toEqual(["1"]);
  });

  it("searches around a named place", async () => {
    const result = await run("find_aged_roofs", { place: "austin", radius_miles: 25 });

    expect(result.center).toMatchObject({
      name: "Austin",
      latitude: 30.298622,
      longitude: -97.754134,
    });
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("rejects an unknown place and suggests known ones", async () => {
    await expect(run("find_aged_roofs", { place: "Atlantis" })).rejects.toThrow(ToolInputError);
    await expect(run("find_aged_roofs", { place: "pflug" })).resolves.toMatchObject({
      center: { name: "Pflugerville" },
    });
  });

  it("needs a place or coordinates", async () => {
    await expect(run("find_aged_roofs", { radius_miles: 5 })).rejects.toThrow(/place or latitude/i);
  });
});

describe("find_hail_hit_roofs", () => {
  it("finds roofs that took reported hail of an inch or more within two miles in the last three years, after the roof went on", async () => {
    const result = await run("find_hail_hit_roofs", { ...CENTER });

    expect(ids(result.rows, "prop_id")).toEqual(["1", "4"]);
    expect(result.rows[0]).toMatchObject({
      max_hail_inches: 1.75,
      hail_reports: "1",
      hail_source_url: "https://www.ncei.noaa.gov/x?id=E1",
      roof_age_anchor_date: "1996",
    });
    expect(result.summary).toEqual({ roof_older_than_15_years: 2, two_inches_or_larger: 0 });
  });

  it("can ask for larger hail and a longer look-back", async () => {
    const larger = await run("find_hail_hit_roofs", {
      ...CENTER,
      radius_miles: 10,
      min_hail_inches: 2,
    });
    const older = await run("find_hail_hit_roofs", {
      ...CENTER,
      min_hail_inches: 2,
      within_years: 15,
    });

    expect(ids(larger.rows, "prop_id")).toEqual(["3"]);
    expect(ids(older.rows, "prop_id")).toEqual(["1", "4"]);
  });
});

describe("find_top_leads", () => {
  it("scores every lead signal of a property and ranks the strongest leads first", async () => {
    const result = await run("find_top_leads", { ...CENTER });

    expect(
      result.rows.map((row) => [
        row.prop_id,
        row.lead_score,
        row.roof_points,
        row.permit_points,
        row.hail_points,
      ]),
    ).toEqual([
      ["1", 96, 40, 30, 26],
      ["4", 33, 7, 0, 26],
    ]);
    expect(result.summary).toEqual({
      with_aged_roof: 2,
      with_unfinished_permit: 1,
      with_recent_hail: 2,
      with_two_or_more_signals: 2,
    });
  });
});

describe("find_open_roofing_permits", () => {
  it("defaults to roofing permits still open, leaving out accessory work", async () => {
    const result = await run("find_open_roofing_permits", { ...CENTER, min_years_open: 1 });
    const withAccessory = await run("find_open_roofing_permits", {
      ...CENTER,
      min_years_open: 1,
      include_accessory: true,
    });

    expect(ids(result.rows, "permit_number")).toEqual(["2024-2 BP"]);
    expect(ids(withAccessory.rows, "permit_number")).toEqual(["2024-2 BP", "2025-6 BP"]);
  });

  it("can add never-finished permits that expired, longest open first, and summarizes all matches", async () => {
    const result = await run("find_open_roofing_permits", {
      ...CENTER,
      radius_miles: 5,
      min_years_open: 1,
      include_expired: true,
    });

    expect(ids(result.rows, "permit_number")).toEqual(["1990-5 BP", "2014-1 BP", "2024-2 BP"]);
    expect(result.rows[0]).toMatchObject({ contractor_name: null, bbb_rating: null });
    expect(result.summary).toEqual({
      still_open: 1,
      expired_without_final: 2,
      with_contractor: 2,
      with_bbb_rating: 1,
    });
  });

  it("can keep only permits that list a contractor, with its BBB grade", async () => {
    const result = await run("find_open_roofing_permits", {
      ...CENTER,
      radius_miles: 5,
      min_years_open: 5,
      include_expired: true,
      with_contractor: true,
    });

    expect(ids(result.rows, "permit_number")).toEqual(["2014-1 BP"]);
    expect(result.rows[0]).toMatchObject({
      permit_state: "expired",
      years_open: 12,
      contractor_name: "Centec Holdings dba Wilson Roofing",
      bbb_rating: "A+",
      source_url: "https://abc.austintexas.gov/1",
    });
  });
});

describe("details", () => {
  it("returns a property with its roofing permits", async () => {
    const result = await run("property_details", { prop_id: 1 });

    expect(result.rows[0]).toMatchObject({ prop_id: "1", situs_address: "100 NEAR ST" });
    expect(ids(result.related ?? [], "permit_number")).toEqual(["2014-1 BP", "2010-4 BP"]);
  });

  it("finds a contractor by any of its names, with its BBB grade and recent permits", async () => {
    const result = await run("contractor_details", { name: "Wilson Roofing" });

    expect(result.rows[0]).toMatchObject({
      contractor_key: "wilson roofing",
      bbb_rating: "A+",
      bbb_match_method: "phone",
    });
    expect(ids(result.related ?? [], "permit_number")).toEqual(["2014-1 BP"]);
  });

  it("finds a contractor by its legal name in the Texas registry, with its licenses", async () => {
    const result = await run("contractor_details", { name: "WR Austin Holdings" });

    expect(result.rows[0]).toMatchObject({
      contractor_key: "wilson roofing",
      registry_active: true,
      license_types: ["A/C Contractor"],
    });
  });
});

describe("owner_details", () => {
  it("finds an owner entity by name with its properties, oldest roofs first", async () => {
    const result = await run("owner_details", { name: "near owner" });

    expect(result.rows[0]).toMatchObject({ owner_key: "k1", properties: "2" });
    expect(ids(result.related ?? [], "prop_id")).toEqual(["1", "4"]);
  });

  it("finds the owner of a property", async () => {
    const result = await run("owner_details", { prop_id: 4 });

    expect(result.rows[0]).toMatchObject({ owner_name: "NEAR OWNER LLC" });
  });

  it("needs a name or a property", async () => {
    await expect(run("owner_details", {})).rejects.toThrow(ToolInputError);
  });
});

describe("owner tools", () => {
  it("finds properties held longer than a number of years", async () => {
    const result = await run("find_long_held_properties", { ...CENTER, min_ownership_years: 10 });

    expect(ids(result.rows, "prop_id")).toEqual(["1", "4"]);
  });

  it("finds properties whose owners live outside the Austin area", async () => {
    const result = await run("find_out_of_area_owners", { ...CENTER, radius_miles: 10 });

    expect(ids(result.rows, "prop_id")).toEqual(["1", "3"]);
  });
});

describe("catalog", () => {
  it("summarizes the published dataset", async () => {
    const result = await run("dataset_summary", {});

    expect(result.rows[0]).toMatchObject({
      build_id: "20261027T130000Z",
      manifest_cid: "bafkrei-manifest",
    });
  });

  it("lists only the tables a build published, in catalog order", () => {
    expect(
      publishedTables([{ table: "contractors" }, { table: "properties" }, { table: "unknown" }]),
    ).toEqual(["properties", "contractors"]);
  });

  it("locates a ZIP code by its Census internal point", async () => {
    const result = await run("locate_place", { name: "78704" });

    expect(result.rows[0]).toMatchObject({ name: "78704", kind: "ZIP code" });
    expect(Number(result.rows[0]?.latitude)).toBeCloseTo(30.24, 1);
  });

  it("locates a place by name", async () => {
    const result = await run("locate_place", { name: "Lakeway" });

    expect(result.rows[0]).toMatchObject({ name: "Lakeway", kind: "city" });
  });

  it("describes every tool with a JSON schema for agents and MCP clients", () => {
    const schemas = toolSchemas();

    expect(schemas.map((schema) => schema.name)).toEqual(TOOLS.map((tool) => tool.name));
    const aged = schemas.find((schema) => schema.name === "find_aged_roofs");
    expect(aged?.description).toMatch(/roof/i);
    expect(aged?.inputSchema).toMatchObject({
      type: "object",
      properties: { radius_miles: { type: "number" }, min_roof_age_years: { type: "number" } },
    });
  });

  it("rejects invalid input before running any SQL", async () => {
    await expect(run("find_aged_roofs", { ...CENTER, radius_miles: 500 })).rejects.toThrow(
      ToolInputError,
    );
    await expect(run("no_such_tool", {})).rejects.toThrow(/unknown tool/i);
  });
});

describe("matchDensity", () => {
  it("counts every match per map cell so a map can show all of them", async () => {
    const cells = await matchDensity(
      "find_aged_roofs",
      { ...CENTER, radius_miles: 10, min_roof_age_years: 15 },
      { sql: runner, dataset: DATASET },
      0.01,
    );

    expect(cells.reduce((total, cell) => total + cell.matches, 0)).toBe(3);
    expect(cells[0]).toEqual({
      latitude: expect.any(Number),
      longitude: expect.any(Number),
      matches: 1,
    });
  });

  it("only maps radius searches", async () => {
    await expect(
      matchDensity("property_details", { prop_id: 1 }, { sql: runner, dataset: DATASET }, 0.01),
    ).rejects.toThrow(ToolInputError);
  });
});
