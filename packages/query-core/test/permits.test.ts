// T006 (A-14, agent-design.md § 2.2): permitsSql()/permitsCountSql() over v_roofing_permit ⋈
// v_property. Radius is optional (omitted = county-wide, AC-10); status_class and open_days
// filters; status_raw/contractor.name_as_printed are always null (today: no lexicon carrier),
// with a `missing` entry — never synthesized. Proved as text (what the SQL must/must not
// contain) and over a small bound fixture (test/helpers/fixture-export.ts), same pattern as
// test/builders.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { permitsCountSql, permitsSql } from "../src/permits.js";
import {
  AUSTIN_URL,
  austinRequest,
  bindFixture,
  propertyRows,
  type Fixture,
  type FixtureTables,
  type Row,
} from "./helpers/fixture-export.js";

const NOW_LIKE = /\bnow\(\)|\bcurrent_date\b|\bcurrent_timestamp\b|\btoday\(\)/i;

describe("permitsSql (text)", () => {
  it("joins v_roofing_permit to v_property, sorted open_days DESC by default, LIMIT 500", () => {
    const sql = permitsSql();
    expect(sql).toMatch(/FROM v_roofing_permit r\b/);
    expect(sql).toMatch(/JOIN v_property p ON p\.property_cid = r\.property_cid/);
    expect(sql).toMatch(/ORDER BY r\.open_days DESC/);
    expect(sql).toMatch(/LIMIT 500$/);
    expect(sql).not.toMatch(NOW_LIKE);
  });

  it("radius is optional: with no centre, no bbox/haversine text at all (county-wide, AC-10)", () => {
    expect(permitsSql()).not.toMatch(/asin\(sqrt\(/);
  });

  it("with a centre, prefilters on a bbox then haversine, under the radius in metres", () => {
    const sql = permitsSql({ centre: { lat: 30.2672, lon: -97.7431, miles: 1 } });
    expect(sql).toMatch(/latitude BETWEEN [-\d.]+ AND [-\d.]+/);
    expect(sql).toMatch(/asin\(sqrt\(/);
    expect(sql).toMatch(/< 1609\.344\b/);
  });

  it("filters by status_class (closed set) and rejects an unknown class", () => {
    const sql = permitsSql({ statusClass: ["open", "stalled"] });
    expect(sql).toMatch(/r\.status_class IN \('open', 'stalled'\)/);
    expect(() => permitsSql({ statusClass: ["open", "bogus"] })).toThrow(/status_class/);
  });

  it("open_days >= openYears * 365.25", () => {
    const sql = permitsSql({ openYearsMin: 5 });
    expect(sql).toMatch(/r\.open_days >= 1826\.25/);
  });

  it("filters by an exact permit_number (safely quoted, no injection)", () => {
    const sql = permitsSql({ permitNumber: "1982-012866 BP" });
    expect(sql).toMatch(/r\.permit_number = '1982-012866 BP'/);
  });

  it("escapes a quote in permit_number rather than ever concatenating raw SQL", () => {
    const sql = permitsSql({ permitNumber: "a'b" });
    expect(sql).toContain("'a''b'");
  });

  it("sort=nearest orders by distance (only valid with a centre)", () => {
    const sql = permitsSql({ centre: { lat: 30, lon: -97, miles: 1 }, sort: "nearest" });
    expect(sql).toMatch(/ORDER BY dist_m, r\.cid/);
  });

  it("sort=nearest without a centre falls back to open days (no dist_m reference)", () => {
    const sql = permitsSql({ sort: "nearest" });
    expect(sql).not.toMatch(/dist_m/);
    expect(sql).toMatch(/ORDER BY r\.open_days DESC NULLS LAST, r\.cid/);
  });

  it("sort=issue_desc orders by issue_date desc", () => {
    expect(permitsSql({ sort: "issue_desc" })).toMatch(/ORDER BY r\.issue_date DESC/);
  });

  it("caps limit at 1000 and rejects out-of-range input", () => {
    expect(permitsSql({ limit: 1000 })).toMatch(/LIMIT 1000$/);
    expect(() => permitsSql({ limit: 1001 })).toThrow(/limit/);
    expect(() => permitsSql({ limit: 0 })).toThrow(/limit/);
  });

  it("filters by exact propertyCid (used by getProperty's permit list)", () => {
    const sql = permitsSql({
      propertyCid: "bafkreibkonskeytl2lqmaoethxvhegzjkwbeon4couanb4x26ng23cs3ka",
    });
    expect(sql).toMatch(
      /r\.property_cid = 'bafkreibkonskeytl2lqmaoethxvhegzjkwbeon4couanb4x26ng23cs3ka'/,
    );
  });
});

describe("permitsCountSql (text)", () => {
  it("counts the same join with the same filters, no LIMIT/ORDER BY", () => {
    const sql = permitsCountSql({ statusClass: ["stalled"] });
    expect(sql).toMatch(/SELECT count\(\*\) AS n/);
    expect(sql).toMatch(/r\.status_class IN \('stalled'\)/);
    expect(sql).not.toMatch(/LIMIT/);
    expect(sql).not.toMatch(/ORDER BY/);
  });
});

// ---------------------------------------------------------------------------------------
// Running the builders in DuckDB (same geo fixture shape as test/builders.test.ts)
// ---------------------------------------------------------------------------------------

const CENTRE = { lat: 30.2672, lon: -97.7431 };
const NORTH_HALF_MILE = { lat: 30.27444, lon: -97.7431 };
const EAST_THREE_MILES = { lat: 30.2672, lon: -97.69282 };

const P1 = "baguqeeraprop1"; // at the centre
const P2 = "baguqeeraprop2"; // 0.5 mi north
const P3 = "baguqeeraprop3"; // 3 mi east

const edge = (from: string, to: string): Row => ({ from_cid: from, to_cid: to });
const geometry = (cid: string, p: { lat: number; lon: number }): Row => ({
  cid,
  latitude: p.lat,
  longitude: p.lon,
});
const permitRow = (cid: string, permitNumber: string, status: string, issueDate: string): Row => ({
  cid,
  request_identifier: cid,
  permit_number: permitNumber,
  improvement_type: "Roofing",
  improvement_action: "Replacement",
  improvement_status: status,
  permit_issue_date: issueDate,
  source_http_request: austinRequest(permitNumber, AUSTIN_URL),
});

const TABLES: FixtureTables = {
  county: {
    property: [propertyRows(P1, 1985), propertyRows(P2, 1990), propertyRows(P3, 2000)],
    property_has_parcel: [edge(P1, "pc1"), edge(P2, "pc2"), edge(P3, "pc3")],
    parcel_has_geometry: [edge("pc1", "g1"), edge("pc2", "g2"), edge("pc3", "g3")],
    geometry: [
      geometry("g1", CENTRE),
      geometry("g2", NORTH_HALF_MILE),
      geometry("g3", EAST_THREE_MILES),
    ],
  },
  property_improvement: {
    property_improvement: [
      // at centre, open, issued long ago (> 5 years open)
      permitRow("pa", "2020-000100 BP", "Permitted", "2020-01-01"),
      // 0.5 mi north, closed
      permitRow("pb", "2026-000200 BP", "Completed", "2026-04-01"),
      // 3 mi east, open, recent (< 5 years open)
      permitRow("pc", "2026-000300 BP", "Permitted", "2026-04-01"),
    ],
    property_has_property_improvement: [edge(P1, "pa"), edge(P2, "pb"), edge(P3, "pc")],
  },
};

describe("permitsSql over a bound fixture (DuckDB)", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await bindFixture(TABLES);
  });
  afterAll(() => fx.close());

  it("county-wide (no centre) returns every permit, open_days desc", async () => {
    const rows = await fx.rows(permitsSql());
    expect(rows.map((r) => r.permit_number)).toEqual([
      "2020-000100 BP",
      "2026-000300 BP",
      "2026-000200 BP",
    ]);
  });

  it("status_raw has no column (no lexicon carrier): missing carries the reason; the contractor name is carried since contract v1.1", async () => {
    const rows = await fx.rows(
      `SELECT missing FROM v_roofing_permit WHERE permit_number = '2020-000100 BP'`,
    );
    const missing = rows[0]?.missing as { field: string; reason: string }[];
    expect(missing).toEqual(
      expect.arrayContaining([{ field: "status_raw", reason: "no_lexicon_carrier" }]),
    );
    // Contract v1.1 (A-11 Run 3, ERR-66): contractor_name_raw became contractor_name_as_printed,
    // published "as printed, unverified"; it is reported missing only when a permit has none.
    expect(missing.some((m) => m.field === "contractor_name_raw")).toBe(false);
  });

  it("a 1-mile radius keeps the centre and the 0.5 mi permit, excludes the 3 mi one", async () => {
    const rows = await fx.rows(permitsSql({ centre: { ...CENTRE, miles: 1 } }));
    expect(new Set(rows.map((r) => r.permit_number))).toEqual(
      new Set(["2020-000100 BP", "2026-000200 BP"]),
    );
  });

  it("status_class=open keeps only the open permits", async () => {
    const rows = await fx.rows(permitsSql({ statusClass: ["open"] }));
    expect(rows.map((r) => r.permit_number)).toEqual(["2020-000100 BP", "2026-000300 BP"]);
  });

  it("openYearsMin=5 keeps only the long-open permit", async () => {
    const rows = await fx.rows(permitsSql({ openYearsMin: 5, statusClass: ["open"] }));
    expect(rows.map((r) => r.permit_number)).toEqual(["2020-000100 BP"]);
  });

  it("permitNumber returns exactly that permit", async () => {
    const rows = await fx.rows(permitsSql({ permitNumber: "2026-000200 BP" }));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status_class).toBe("closed");
  });

  it("permitsCountSql matches permitsSql's row count for the same filter", async () => {
    const rows = await fx.rows(permitsSql({ statusClass: ["open"] }));
    const count = await fx.rows(permitsCountSql({ statusClass: ["open"] }));
    expect(count[0]?.n).toBe(rows.length);
  });
});
