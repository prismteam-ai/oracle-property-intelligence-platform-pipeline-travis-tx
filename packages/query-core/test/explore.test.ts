// T004 (A-13, FR-004/005/008/015, contracts/explore-search.md, A-oracle § 9): the one Explore
// search builder, `exploreSearchSql`, proved as text (bbox prefilter then haversine, every filter
// and bound, no text classification of roofs, no now()) and by running it in DuckDB over a small
// bound fixture (radius, roof, open/stalled permits with openYrs, tenure_unknown, sort, limit,
// Close matches up to 10 rows outside r and within 2 × r). A second block runs it over the
// published run when PUBLISHED_TABLES_DIR points at its tables (skipped with a reason otherwise).
// Written before src/explore.ts exists: the red run fails with "Cannot find module '../src/explore'".
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CLOSE_MATCH_LIMIT,
  EXPLORE_DEFAULT_LIMIT,
  exploreSearchSql,
  toExploreRow,
  type ExploreSearchInput,
} from "../src/explore.js";
import { bindManifest } from "../src/bind-manifest.js";
import { openDuckDb, type DuckDbEngine } from "../scripts/duckdb-engine.js";
import {
  AUSTIN_URL,
  austinRequest,
  bindFixture,
  propertyRows,
  type Fixture,
  type FixtureTables,
  type Row as FixtureRow,
} from "./helpers/fixture-export.js";

const NOW_LIKE = /\bnow\(\)|\bcurrent_date\b|\bcurrent_timestamp\b|\btoday\(\)/i;
const CENTRE = { lat: 30.2672, lon: -97.7431 };
const NORTH_HALF_MILE = { lat: 30.27444, lon: -97.7431 };
const EAST_THREE_MILES = { lat: 30.2672, lon: -97.69282 };

const base = (patch: Partial<ExploreSearchInput> = {}): ExploreSearchInput => ({
  centre: CENTRE,
  radius_mi: 1,
  ...patch,
});

describe("exploreSearchSql (text)", () => {
  const sql = exploreSearchSql(base({ roof: 15 }));

  it("returns the rows, summary and close-match statements, each one read-only SELECT/WITH", () => {
    for (const s of [sql.rows, sql.summary, sql.close]) {
      expect(s).toMatch(/^\s*WITH\b/);
      expect(s).not.toMatch(/;\s*\S/);
      expect(s).not.toMatch(NOW_LIKE);
    }
  });

  it("prefilters on a lat/lon bbox, then decides with the haversine (A-oracle § 9)", () => {
    expect(sql.rows).toMatch(/latitude BETWEEN [-\d.]+ AND [-\d.]+/);
    expect(sql.rows).toMatch(/longitude BETWEEN [-\d.]+ AND [-\d.]+/);
    expect(sql.rows).toMatch(/asin\(sqrt\(/);
    expect(sql.rows).toMatch(/distance_m < 1609\.344\b/);
    // the bbox comes before the haversine in the WHERE clause
    expect(sql.rows.indexOf("BETWEEN")).toBeLessThan(sql.rows.indexOf("asin(sqrt("));
  });

  it("reads only the contract views; roofs come from v_roofing_permit, never a text match (P0-9)", () => {
    for (const s of [sql.rows, sql.summary, sql.close]) {
      expect(s).toMatch(/FROM v_property\b/);
      expect(s).toMatch(/FROM v_roofing_permit\b/);
      expect(s).not.toMatch(/\bLIKE\b/i);
      expect(s).not.toMatch(/ILIKE|regexp|%ROOF%/i);
    }
  });

  it("applies roof ≥ years, the permit class, openYrs, tenure > years and out-of-area", () => {
    const all = exploreSearchSql(
      base({ roof: 20, permit: "open_or_stalled", openYrs: 5, tenure: 10, ooa: true }),
    );
    expect(all.rows).toMatch(/roof_age_years >= 20\b/);
    expect(all.rows).toMatch(/status_class IN \('open', 'stalled'\)/);
    expect(all.rows).toMatch(/open_days >= 1826\.25\b/); // 5 × 365.25
    expect(all.rows).toMatch(/tenure_years > 10\b/);
    expect(all.rows).toMatch(/owner_is_out_of_area = true/);
    expect(exploreSearchSql(base({ permit: "open" })).rows).toMatch(/status_class IN \('open'\)/);
    expect(exploreSearchSql(base({ permit: "stalled" })).rows).toMatch(
      /status_class IN \('stalled'\)/,
    );
    // without a permit filter the permit is joined, not required
    expect(exploreSearchSql(base()).rows).toMatch(/LEFT JOIN perm\b/);
    expect(all.rows).toMatch(/\bJOIN perm\b/);
    expect(all.rows).not.toMatch(/LEFT JOIN perm\b/);
  });

  it("summary counts total_within_r and tenure_unknown; close matches are outside r and within 2 × r, ≤ 10", () => {
    expect(sql.summary).toMatch(/AS total_within_r\b/);
    expect(sql.summary).toMatch(/AS tenure_unknown\b/);
    expect(sql.summary).toMatch(/tenure_years IS NULL/);
    expect(sql.close).toMatch(/distance_m >= 1609\.344\b/);
    expect(sql.close).toMatch(/distance_m < 3218\.688\b/);
    expect(sql.close).toMatch(new RegExp(`LIMIT ${CLOSE_MATCH_LIMIT}$`));
    expect(CLOSE_MATCH_LIMIT).toBe(10);
  });

  it("sorts nearest (default), open longest or oldest roof; limit 1..1000 default 200; page offsets", () => {
    expect(EXPLORE_DEFAULT_LIMIT).toBe(200);
    expect(sql.rows).toMatch(/ORDER BY distance_m, property_cid\nLIMIT 200 OFFSET 0$/);
    expect(exploreSearchSql(base({ sort: "open_desc" })).rows).toMatch(
      /ORDER BY permit_open_days DESC NULLS LAST, distance_m, property_cid/,
    );
    expect(exploreSearchSql(base({ sort: "roof_desc" })).rows).toMatch(
      /ORDER BY roof_age_years DESC NULLS LAST, distance_m, property_cid/,
    );
    expect(exploreSearchSql(base({ limit: 1000, page: 2 })).rows).toMatch(
      /LIMIT 1000 OFFSET 2000$/,
    );
  });

  it.each([
    ["radius_mi below 0.25", { radius_mi: 0.2 }, /radius_mi/],
    ["radius_mi above 25", { radius_mi: 25.01 }, /radius_mi/],
    ["roof above 120", { roof: 121 }, /roof/],
    ["roof not an integer", { roof: 1.5 }, /roof/],
    ["openYrs above 60", { openYrs: 61 }, /openYrs/],
    ["tenure above 100", { tenure: 101 }, /tenure/],
    ["limit 0", { limit: 0 }, /limit/],
    ["limit above 1000", { limit: 1001 }, /limit/],
    ["page negative", { page: -1 }, /page/],
    ["lat outside Travis bounds", { centre: { lat: 32, lon: -97.7 } }, /lat/],
    ["lon outside Travis bounds", { centre: { lat: 30.3, lon: -99 } }, /lon/],
  ] as [string, Partial<ExploreSearchInput>, RegExp][])("rejects %s", (_, patch, message) => {
    expect(() => exploreSearchSql(base(patch))).toThrow(message);
  });
});

// ---------------------------------------------------------------------------------------
// Running the builder in DuckDB over a bound fixture
// ---------------------------------------------------------------------------------------

const P1 = "baguqeeraprop1"; // centre, roof 1985 (age 41), open permit issued 2019-01-10
const P2 = "baguqeeraprop2"; // 0.5 mi north, no roof date, stalled permit (Expired → null status)
const P3 = "baguqeeraprop3"; // 3 mi east, roof 2020 (age 6), no permit
const edge = (from: string, to: string): FixtureRow => ({ from_cid: from, to_cid: to });
const geometry = (cid: string, p: { lat: number; lon: number }): FixtureRow => ({
  cid,
  latitude: p.lat,
  longitude: p.lon,
});
const permit = (
  cid: string,
  permitNumber: string,
  status: string | null,
  issued: string,
): FixtureRow => ({
  cid,
  request_identifier: cid,
  permit_number: permitNumber,
  improvement_type: "Roofing",
  improvement_action: "Replacement",
  improvement_status: status,
  permit_issue_date: issued,
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
      permit("pa", "2019-000100 BP", "Permitted", "2019-01-10"),
      permit("pb", "2015-000200 BP", null, "2015-03-01"),
    ],
    property_has_property_improvement: [edge(P1, "pa"), edge(P2, "pb")],
    // A-16: pa prints a contractor (one edge); pb prints none.
    property_improvement_has_contractor: [edge("pa", "cA")],
    company: [{ cid: "cA", name: "Roofer A", source_http_request: austinRequest("x") }],
  },
};

// DuckDB cold-starts and binds the fixture in-process: on a shared CI runner one statement can
// take several seconds (CI run 39720505410: "Test timed out in 5000ms", whole file 17.6 s), so
// this block gets a 30 s budget per test and hook instead of Vitest's 5 s default.
describe("exploreSearchSql over a bound fixture (DuckDB)", { timeout: 30_000 }, () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await bindFixture(TABLES);
  });
  afterAll(() => fx.close());

  const run = async (input: ExploreSearchInput) => {
    const sql = exploreSearchSql(input);
    const [summary] = await fx.rows(sql.summary);
    return {
      summary: summary as { total_within_r: number; tenure_unknown: number },
      rows: await fx.rows(sql.rows),
      close: await fx.rows(sql.close),
    };
  };

  it("radius 1 mi: the two properties inside, nearest first, with their permits joined", async () => {
    const r = await run(base());
    expect(r.summary.total_within_r).toBe(2);
    expect(r.rows.map((x) => x.property_cid)).toEqual([P1, P2]);
    expect(r.rows[0]?.permit_number).toBe("2019-000100 BP");
    expect(r.rows[0]?.permit_status_class).toBe("open");
    expect(r.rows[1]?.permit_status_class).toBe("stalled");
    expect(r.rows[0]?.manifest_cid).toBe(fx.bound.manifestCid);
  });

  it("roof ≥ 15 keeps only known roofs at least that old", async () => {
    const r = await run(base({ radius_mi: 4, roof: 15 }));
    expect(r.rows.map((x) => x.property_cid)).toEqual([P1]);
    expect(r.summary.total_within_r).toBe(1);
  });

  it("open_or_stalled with openYrs 5, sorted open longest: the stalled 2015 permit first", async () => {
    const r = await run(
      base({ radius_mi: 4, permit: "open_or_stalled", openYrs: 5, sort: "open_desc" }),
    );
    expect(r.rows.map((x) => x.property_cid)).toEqual([P2, P1]);
    const open = await run(base({ radius_mi: 4, permit: "open", openYrs: 5 }));
    expect(open.rows.map((x) => x.property_cid)).toEqual([P1]);
    const longer = await run(base({ radius_mi: 4, permit: "open_or_stalled", openYrs: 10 }));
    expect(longer.rows.map((x) => x.property_cid)).toEqual([P2]);
  });

  it("tenure > 10 excludes unknown tenure and counts it as tenure_unknown", async () => {
    const r = await run(base({ radius_mi: 4, tenure: 10 }));
    expect(r.rows).toHaveLength(0);
    expect(r.summary.total_within_r).toBe(0);
    expect(r.summary.tenure_unknown).toBe(3);
  });

  it("limit caps the rows; the count stays the full total", async () => {
    const r = await run(base({ radius_mi: 4, limit: 1 }));
    expect(r.rows).toHaveLength(1);
    expect(r.summary.total_within_r).toBe(3);
  });

  it("zero results: close matches are the nearest rows outside r and within 2 × r, with distance", async () => {
    // Centre between P1 and P3: P3 ≈ 1.03 mi east, P1 ≈ 1.98 mi west, P2 ≈ 2.04 mi (and no roof
    // age). Nothing within 1 mi; P3 and P1 are within 2 mi and match roof ≥ 1.
    const none = await run(base({ centre: { lat: 30.2672, lon: -97.71 }, radius_mi: 1, roof: 1 }));
    expect(none.rows).toHaveLength(0);
    expect(none.summary.total_within_r).toBe(0);
    expect(none.close.map((x) => x.property_cid)).toEqual([P3, P1]);
    for (const c of none.close) {
      expect(c.distance_m as number).toBeGreaterThanOrEqual(1609.344);
      expect(c.distance_m as number).toBeLessThan(2 * 1609.344);
    }
  });

  it("toExploreRow carries the published situs address, with no not_in_export entry", async () => {
    const r = await run(base({ radius_mi: 4 }));
    const p2 = r.rows.find((x) => x.property_cid === P2) as Record<string, unknown>;
    const row = toExploreRow(
      { ...p2, unnormalized_address: "1509 NORTHWOOD RD, AUSTIN, TX 78703" },
      CENTRE,
    );
    expect(row.address).toBe("1509 NORTHWOOD RD, AUSTIN, TX 78703");
    expect(row.missing.some((m) => m.field === "address")).toBe(false);
    expect(toExploreRow(p2, CENTRE).missing).toContainEqual({
      field: "address",
      reason: "not_in_export",
    });
  });

  it("toExploreRow maps a row: provenance, miles + bearing, permit, and a missing reason for every gap", async () => {
    const r = await run(base({ radius_mi: 4 }));
    const p2 = r.rows.find((x) => x.property_cid === P2);
    const row = toExploreRow(p2 as Record<string, unknown>, CENTRE);
    expect(row.property_cid).toBe(P2);
    expect(row.dist_mi).toBeCloseTo(0.5, 1);
    expect(row.bearing).toBe("N");
    expect(row.lat).toBe(NORTH_HALF_MILE.lat);
    expect(row.address).toBeNull();
    expect(row.roof_age_years).toBeNull();
    expect(row.permit).toMatchObject({
      number: "2015-000200 BP",
      status_raw: null,
      status_class: "stalled",
    });
    expect(row.permit?.open_years).toBeGreaterThan(11);
    expect(Number.isInteger(row.permit?.open_days)).toBe(true);
    expect(row.permit?.open_days).toBeGreaterThan(4000);
    expect(Math.floor(((row.permit?.open_days ?? 0) / 365.25) * 10) / 10).toBe(
      row.permit?.open_years,
    );
    expect(row.contractor).toEqual({
      name_as_printed: null,
      resolution: "unresolved",
      company_cid: null,
      bbb_url: null,
    });
    expect(row.provenance.manifest_cid).toBe(fx.bound.manifestCid);
    expect(row.provenance.table_cid).toMatch(/^b/);
    expect(row.missing).toEqual(
      expect.arrayContaining([
        { field: "address", reason: "not_in_export" },
        { field: "roof_age_years", reason: "no_roof_date" },
        { field: "permit.status_raw", reason: "no_lexicon_carrier" },
        // A-16: the permit printed no contractor; the view's own reason, never no_lexicon_carrier.
        { field: "contractor.name_as_printed", reason: "source_missing" },
        { field: "permit.contractor_name_as_printed", reason: "source_missing" },
        { field: "permit.contractor_company_cid", reason: "source_missing" },
        { field: "permit.bbb_rating", reason: "source_missing" },
      ]),
    );
    expect(row.missing).not.toContainEqual({
      field: "contractor.name_as_printed",
      reason: "no_lexicon_carrier",
    });
    expect(row.bbb_status_reason).toBe("source_missing");
    const fields = row.missing.map((m) => m.field);
    expect(new Set(fields).size).toBe(fields.length);
    const p3 = toExploreRow(
      r.rows.find((x) => x.property_cid === P3) as Record<string, unknown>,
      CENTRE,
    );
    expect(p3.bearing).toBe("E");
    expect(p3.permit).toBeNull();
    expect(p3.contractor).toBeNull();
  });

  it("A-16: a permit with a printed contractor carries the name and BBB search link; the property carries built year and owner", async () => {
    const r = await run(base({ radius_mi: 4 }));
    const p1 = toExploreRow(
      r.rows.find((x) => x.property_cid === P1) as Record<string, unknown>,
      CENTRE,
    );
    expect(p1.contractor).toMatchObject({
      name_as_printed: "Roofer A",
      resolution: "unresolved",
      company_cid: "cA",
    });
    expect(p1.contractor?.bbb_url).toMatch(
      /^https:\/\/www\.bbb\.org\/search\?.*find_text=Roofer%20A&/,
    );
    expect(p1.bbb_status).toBe("blocked");
    expect(p1.bbb_status_reason).toBe("bbb_blocked");
    expect(p1.missing.map((m) => m.field)).not.toContain("contractor.name_as_printed");
    expect(p1.permit?.issue_date).toBe("2019-01-10");
    // The Explore UI's names (main-session interface note).
    expect(p1.permit?.contractor_name_as_printed).toBe("Roofer A");
    expect(p1.permit?.bbb_url).toBe(p1.contractor?.bbb_url);
    expect(p1.year_built).toBe(1985);
    expect(p1).toHaveProperty("owner_name");
    expect(p1).toHaveProperty("last_ownership_transfer_date");
  });
});

describe("toExploreRow (pure, A-16 carried fields)", () => {
  const row = {
    property_cid: "baguqeeraprop9",
    latitude: 30.27,
    longitude: -97.74,
    distance_m: 100,
    property_structure_built_year: 1978,
    owner_name: "JANE DOE",
    owner_kind: "person",
    last_ownership_transfer_date: "2004-06-01",
    missing: [],
  };
  it("maps built year, owner name/kind and last transfer date when present", () => {
    expect(toExploreRow(row, CENTRE)).toMatchObject({
      year_built: 1978,
      owner_name: "JANE DOE",
      owner_kind: "person",
      last_ownership_transfer_date: "2004-06-01",
    });
  });
  it("keeps them null when absent (the view's missing entry explains why)", () => {
    const r = toExploreRow(
      {
        ...row,
        property_structure_built_year: null,
        owner_name: null,
        missing: [{ field: "owner_name", reason: "no_owner_record" }],
      },
      CENTRE,
    );
    expect(r.year_built).toBeNull();
    expect(r.owner_name).toBeNull();
    expect(r.missing).toContainEqual({ field: "owner_name", reason: "no_owner_record" });
  });
  it("remaps an index built before A-16: a permit with no printed contractor reads source_missing", () => {
    const r = toExploreRow(
      {
        ...row,
        permit_cid: "pz",
        contractor_name_as_printed: null,
        contractor_company_cid: null,
        bbb_status: "not_checked",
        bbb_status_reason: "contractor_unresolved",
        permit_missing: [
          { field: "contractor_name_as_printed", reason: "contractor_unresolved" },
          { field: "contractor_company_cid", reason: "contractor_unresolved" },
          { field: "bbb_rating", reason: "contractor_unresolved" },
        ],
      },
      CENTRE,
    );
    expect(r.bbb_status_reason).toBe("source_missing");
    expect(r.missing.filter((m) => m.reason === "contractor_unresolved")).toEqual([]);
    expect(r.missing).toContainEqual({
      field: "contractor.name_as_printed",
      reason: "source_missing",
    });
  });
});

// ---------------------------------------------------------------------------------------
// The published run (PUBLISHED_TABLES_DIR = a local copy of its tables/ tree, fetched by CID)
// ---------------------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INDEX = JSON.parse(readFileSync(join(ROOT, "runs/index.json"), "utf8")) as {
  runs: { runId: string; manifestCid: string }[];
};
const LATEST = INDEX.runs.at(-1);
const env = process.env.PUBLISHED_TABLES_DIR;
const PUBLISHED_DIR = env && existsSync(resolve(ROOT, env, "county")) ? resolve(ROOT, env) : null;
const SKIP_PUBLISHED =
  "SKIPPED: PUBLISHED_TABLES_DIR is not set (a local copy of the latest run's tables/ fetched by CID)";

if (PUBLISHED_DIR === null || LATEST === undefined) {
  describe("exploreSearchSql over the published run", () => {
    it.skip(SKIP_PUBLISHED, () => undefined);
  });
} else {
  const tablesDir = PUBLISHED_DIR;
  const latest = LATEST;
  describe("exploreSearchSql over the published run", () => {
    let db: DuckDbEngine;
    let parcelsPublished = 0;
    beforeAll(async () => {
      db = await openDuckDb();
      const bytes = readFileSync(join(ROOT, "runs", latest.runId, "manifest.json"));
      const manifest = JSON.parse(bytes.toString("utf8")) as {
        coverage: Record<string, { count: number }>;
      };
      parcelsPublished = manifest.coverage["parcels_published"]?.count ?? 0;
      await bindManifest(bytes, tablesDir, db);
    });
    afterAll(() => db.close());

    it("Austin centre, 25 mi: between 1 and parcels_published properties; every row inside r", async () => {
      const sql = exploreSearchSql({ centre: CENTRE, radius_mi: 25, limit: 1000 });
      const [summary] = await db.all(sql.summary);
      const total = (summary as { total_within_r: number }).total_within_r;
      expect(total).toBeGreaterThanOrEqual(1);
      expect(total).toBeLessThanOrEqual(parcelsPublished);
      const rows = await db.all(sql.rows);
      expect(rows.length).toBe(total);
      for (const r of rows) expect(r.distance_m as number).toBeLessThan(25 * 1609.344);
    });
  });
}
