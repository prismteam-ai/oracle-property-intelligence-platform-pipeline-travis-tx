// T005 (A-14, data-model.md, agent-design.md § 2): searchProperties, listPermits, getProperty,
// getCoverage, listRuns, getSchema over a small bound fixture (test/helpers/fixture-export.ts,
// the same harness A-02/A-03 use — PILOT_DIR is not required). Covers the ResultEnvelope shape,
// every empty_reason path, and getCoverage's manifest passthrough.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getCoverage,
  getProperty,
  getSchema,
  listPermits,
  listRuns,
  searchProperties,
} from "../src/tools/functions.js";
import {
  austinRequest,
  AUSTIN_URL,
  bindFixture,
  propertyRows,
  type Fixture,
  type FixtureTables,
  type Row,
} from "./helpers/fixture-export.js";

const CENTRE = { lat: 30.2672, lon: -97.7431 };
const NORTH_HALF_MILE = { lat: 30.27444, lon: -97.7431 };
const EAST_THREE_MILES = { lat: 30.2672, lon: -97.69282 };

// Valid-format (CidV1-shaped: "ba" + 50+ chars of [a-z2-7]) test CIDs — getProperty's input is
// Zod-validated as CidV1, unlike the plain SQL fixtures in test/builders.test.ts/permits.test.ts.
const P1 = `ba${"a".repeat(55)}pone`; // at centre, roof_date 1985 -> old roof
const P2 = `ba${"a".repeat(55)}ptwo`; // 0.5 mi north, roof_date 2020 -> young roof
const P3 = `ba${"a".repeat(55)}pthree`; // 3 mi east, outside a 1-mile radius

const edge = (from: string, to: string): Row => ({ from_cid: from, to_cid: to });
const geometry = (cid: string, p: { lat: number; lon: number }): Row => ({
  cid,
  latitude: p.lat,
  longitude: p.lon,
});

const TABLES: FixtureTables = {
  county: {
    property: [
      propertyRows(P1, 1985),
      // request_identifier overridden to a numeric string: GetPropertyInput's schema requires
      // digits only (TCAD pID "as printed", P0-5), unlike propertyRows()'s default cid.slice(-5).
      { ...propertyRows(P2, 2020), request_identifier: "54321" },
      propertyRows(P3, 1990),
    ],
    property_has_parcel: [edge(P1, "pc1"), edge(P2, "pc2"), edge(P3, "pc3")],
    parcel_has_geometry: [edge("pc1", "g1"), edge("pc2", "g2"), edge("pc3", "g3")],
    geometry: [
      geometry("g1", CENTRE),
      geometry("g2", NORTH_HALF_MILE),
      geometry("g3", EAST_THREE_MILES),
    ],
    property_has_structure: [edge(P1, "s1"), edge(P2, "s2")],
    structure: [
      { cid: "s1", roof_date: "1985" },
      { cid: "s2", roof_date: "2020" },
    ],
  },
  property_improvement: {
    property_improvement: [
      { ...permit("pa", "2020-000100 BP", "Permitted", "2020-01-01") },
      { ...permit("pb", "2026-000200 BP", "Completed", "2026-04-01") },
    ],
    property_has_property_improvement: [edge(P1, "pa"), edge(P2, "pb")],
  },
};

function permit(cid: string, permitNumber: string, status: string, issueDate: string): Row {
  return {
    cid,
    request_identifier: cid,
    permit_number: permitNumber,
    improvement_type: "Roofing",
    improvement_action: "Replacement",
    improvement_status: status,
    permit_issue_date: issueDate,
    source_http_request: austinRequest(permitNumber, AUSTIN_URL),
  };
}

const UNKNOWN_CID = `ba${"a".repeat(60)}`;

describe("searchProperties", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await bindFixture(TABLES);
  });
  afterAll(() => fx.close());

  it("ResultEnvelope shape: returned/total/truncated from the true count, not rows.length", async () => {
    const result = await searchProperties(fx.db, fx.bound, {
      area: { lat: CENTRE.lat, lon: CENTRE.lon },
      radius_mi: 5,
      limit: 1,
    });
    expect(result.returned).toBe(1);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.empty_reason).toBeNull();
    expect(result.run).toMatchObject({ manifest_cid: fx.bound.manifestCid });
  });

  it("roof_age_years_min keeps the old roof, excludes the young one", async () => {
    const result = await searchProperties(fx.db, fx.bound, {
      area: { lat: CENTRE.lat, lon: CENTRE.lon },
      radius_mi: 1,
      roof_age_years_min: 15,
      limit: 1000,
    });
    expect(result.rows.map((r) => r.property_cid)).toEqual([P1]);
    expect(result.total).toBe(1);
  });

  it("no_match: a valid filter inside the radius with 0 rows", async () => {
    const result = await searchProperties(fx.db, fx.bound, {
      area: { lat: CENTRE.lat, lon: CENTRE.lon },
      radius_mi: 1,
      roof_age_years_min: 100,
      limit: 1000,
    });
    expect(result.returned).toBe(0);
    expect(result.empty_reason).toBe("no_match");
  });

  it("out_of_scope: a place the gazetteer does not carry, no SQL ever run", async () => {
    const result = await searchProperties(fx.db, fx.bound, {
      area: { place: "ZIP 99999" },
      radius_mi: 5,
    });
    expect(result.empty_reason).toBe("out_of_scope");
    expect(result.returned).toBe(0);
    expect(result.total).toBe(0);
  });

  it("field_not_published: owner_is_out_of_area is null on every row in v1 (ADR-0002)", async () => {
    const result = await searchProperties(fx.db, fx.bound, {
      area: { lat: CENTRE.lat, lon: CENTRE.lon },
      radius_mi: 5,
      owner_is_out_of_area: true,
      limit: 1000,
    });
    expect(result.returned).toBe(0);
    expect(result.empty_reason).toBe("field_not_published");
    expect(result.unknown_excluded.owner_is_out_of_area).toBe(3);
  });

  it("run_not_found: a manifest_cid that is not the bound run's", async () => {
    const result = await searchProperties(fx.db, fx.bound, {
      manifest_cid: UNKNOWN_CID,
      area: { lat: CENTRE.lat, lon: CENTRE.lon },
      radius_mi: 5,
    });
    expect(result.empty_reason).toBe("run_not_found");
  });
});

// Review F1 regression (code-review medium on 014-agent-and-mcp): an unrelated filter being the
// true cause of zero rows must never be misattributed to field_not_published just because every
// in-radius row happens to also be null on some other actively-filtered field. roof_age_years_min
// is always null-permissive (`OR roof_age_years IS NULL`), so a null roof age can never itself be
// why nothing came back; here all 5 in-radius properties have an unknown roof age AND a
// status_class filter that matches none of them (none has any permit at all) — the permit EXISTS
// clause is the real (and only) blocker, so the answer must be no_match.
describe("searchProperties: field_not_published vs no_match (review F1)", () => {
  const Q1 = `ba${"a".repeat(55)}qone`;
  const Q2 = `ba${"a".repeat(55)}qtwo`;
  const Q3 = `ba${"a".repeat(55)}qthree`;
  const Q4 = `ba${"a".repeat(55)}qfour`;
  const Q5 = `ba${"a".repeat(55)}qfive`;
  const CIDS = [Q1, Q2, Q3, Q4, Q5];

  // All 5 at the search centre, none with a property_has_structure edge (and no roofing permit
  // anchor either) -> roof_age_years IS NULL for every one of them. No property_improvement rows
  // at all -> no property ever has an EXISTS match for any status_class.
  const F1_TABLES: FixtureTables = {
    county: {
      property: CIDS.map((cid) => propertyRows(cid, null)),
      property_has_parcel: CIDS.map((cid, i) => edge(cid, `qpc${i}`)),
      parcel_has_geometry: CIDS.map((cid, i) => edge(`qpc${i}`, `qg${i}`)),
      geometry: CIDS.map((cid, i) => geometry(`qg${i}`, CENTRE)),
    },
  };

  let fx: Fixture;
  beforeAll(async () => {
    fx = await bindFixture(F1_TABLES);
  });
  afterAll(() => fx.close());

  it("every in-radius row null on roof_age_years coincides with radiusTotal, but the real blocker is status_class -> no_match", async () => {
    const result = await searchProperties(fx.db, fx.bound, {
      area: { lat: CENTRE.lat, lon: CENTRE.lon },
      radius_mi: 5,
      roof_age_years_min: 15,
      status_class: "open",
      limit: 1000,
    });
    expect(result.returned).toBe(0);
    // The coincidence the bug relied on: unknown_excluded.roof_age_years === radiusTotal (5).
    expect(result.unknown_excluded.roof_age_years).toBe(5);
    expect(result.empty_reason).toBe("no_match");
  });
});

// A-16 (PO audit item 11): "not published" is a run-level claim. A field that only the rows in
// the searched area lack (roof age is published for other properties of the run) is field_unknown,
// never field_not_published; owner_is_out_of_area, null on every row of the run, stays
// field_not_published.
describe("searchProperties: field_unknown vs field_not_published (A-16)", () => {
  const near = [`ba${"a".repeat(55)}uone`, `ba${"a".repeat(55)}utwo`];
  const FAR = `ba${"a".repeat(55)}ufar`;
  const tables: FixtureTables = {
    county: {
      property: [...near.map((cid) => propertyRows(cid, null)), propertyRows(FAR, 1985)],
      property_has_parcel: [...near, FAR].map((cid, i) => edge(cid, `upc${i}`)),
      parcel_has_geometry: [...near, FAR].map((_, i) => edge(`upc${i}`, `ug${i}`)),
      geometry: [
        geometry("ug0", CENTRE),
        geometry("ug1", CENTRE),
        geometry("ug2", EAST_THREE_MILES),
      ],
      property_has_structure: [edge(FAR, "us")],
      structure: [{ cid: "us", roof_date: "1985" }],
    },
  };
  let fx: Fixture;
  beforeAll(async () => {
    fx = await bindFixture(tables);
  });
  afterAll(() => fx.close());

  it("roof age unknown only in the searched area -> field_unknown", async () => {
    const result = await searchProperties(fx.db, fx.bound, {
      area: { lat: CENTRE.lat, lon: CENTRE.lon },
      radius_mi: 1,
      roof_age_years_min: 15,
      limit: 1000,
    });
    expect(result.returned).toBe(0);
    expect(result.unknown_excluded.roof_age_years).toBe(2);
    expect(result.empty_reason).toBe("field_unknown");
  });

  it("owner_is_out_of_area null on every row of the run -> field_not_published", async () => {
    const result = await searchProperties(fx.db, fx.bound, {
      area: { lat: CENTRE.lat, lon: CENTRE.lon },
      radius_mi: 1,
      owner_is_out_of_area: true,
      limit: 1000,
    });
    expect(result.empty_reason).toBe("field_not_published");
  });
});

// A-16 (audit items 3, 8): the permit's printed contractor name is carried in the nested
// `contractor` object; a permit that prints none says source_missing, not contractor_unresolved.
describe("listPermits contractor fields (A-16)", () => {
  const tables: FixtureTables = {
    ...TABLES,
    property_improvement: {
      ...TABLES.property_improvement,
      property_improvement_has_contractor: [edge("pa", "cA")],
      company: [{ cid: "cA", name: "Roofer A", source_http_request: austinRequest("x") }],
    },
  };
  let fx: Fixture;
  beforeAll(async () => {
    fx = await bindFixture(tables);
  });
  afterAll(() => fx.close());

  it("a printed name is in contractor.name_as_printed and the row keeps bbb_url", async () => {
    const result = await listPermits(fx.db, fx.bound, { permit_number: "2020-000100 BP" });
    const row = result.rows[0] as Row;
    expect(row.contractor).toMatchObject({ name_as_printed: "Roofer A", company_cid: "cA" });
    expect(row.contractor_name_as_printed).toBe("Roofer A");
    expect(String(row.bbb_url)).toContain("find_text=Roofer%20A");
    expect(row.bbb_status_reason).toBe("bbb_blocked");
  });

  it("no printed contractor -> source_missing on the name, company, rating and BBB reason", async () => {
    const result = await listPermits(fx.db, fx.bound, { permit_number: "2026-000200 BP" });
    const row = result.rows[0] as Row;
    expect((row.contractor as unknown as Row).name_as_printed).toBeNull();
    expect(row.bbb_status_reason).toBe("source_missing");
    const missing = row.missing as unknown as { field: string; reason: string }[];
    for (const field of ["contractor_name_as_printed", "contractor_company_cid", "bbb_rating"])
      expect(missing).toContainEqual({ field, reason: "source_missing" });
    expect(missing.some((m) => m.reason === "contractor_unresolved")).toBe(false);
  });

  it("getProperty's permits carry the same contractor fields", async () => {
    const result = await getProperty(fx.db, fx.bound, { property_cid: P1 });
    const permits = (result.rows[0] as Row).permits as unknown as Row[];
    expect(permits[0]?.contractor).toMatchObject({ name_as_printed: "Roofer A" });
  });
});

describe("listPermits", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await bindFixture(TABLES);
  });
  afterAll(() => fx.close());

  it("not_found: an unknown permit_number", async () => {
    const result = await listPermits(fx.db, fx.bound, { permit_number: "1999-999999 ZZ" });
    expect(result.empty_reason).toBe("not_found");
    expect(result.returned).toBe(0);
  });

  it("an exact permit_number returns that one permit", async () => {
    const result = await listPermits(fx.db, fx.bound, { permit_number: "2020-000100 BP" });
    expect(result.returned).toBe(1);
    expect(result.rows[0]).toMatchObject({ permit_number: "2020-000100 BP", status_raw: null });
  });

  it("sort nearest with no area is not an error: deterministic open_desc order, applied.sort says so", async () => {
    const a = await listPermits(fx.db, fx.bound, { sort: "nearest" });
    const b = await listPermits(fx.db, fx.bound, { sort: "open_desc" });
    expect(a.returned).toBe(2);
    expect(a.rows.map((r) => r.permit_number)).toEqual(b.rows.map((r) => r.permit_number));
    expect(a.applied.sort).toBe("open_desc");
  });

  it("sort nearest with an area still orders by distance and keeps applied.sort nearest", async () => {
    const result = await listPermits(fx.db, fx.bound, {
      area: { lat: NORTH_HALF_MILE.lat, lon: NORTH_HALF_MILE.lon },
      radius_mi: 5,
      sort: "nearest",
    });
    expect(result.applied.sort).toBe("nearest");
    // P2 (the 2026 permit) is at the centre; P1 (the 2020 permit) is half a mile away.
    expect(result.rows.map((r) => r.permit_number)).toEqual(["2026-000200 BP", "2020-000100 BP"]);
  });

  it("county-wide (no area) returns every permit (AC-10)", async () => {
    const result = await listPermits(fx.db, fx.bound, {});
    expect(result.total).toBe(2);
  });
});

describe("listPermits unknown_excluded (permits an area search cannot place)", () => {
  const P4 = `ba${"a".repeat(55)}pfour`; // edge to a property absent from county.property
  const P5 = `ba${"a".repeat(55)}pfive`; // property row, no geometry -> null lat/lon
  const area = { lat: CENTRE.lat, lon: CENTRE.lon };
  const withExtras: FixtureTables = {
    ...TABLES,
    county: {
      ...TABLES.county,
      property: [
        propertyRows(P1, 1985),
        { ...propertyRows(P2, 2020), request_identifier: "54321" },
        propertyRows(P3, 1990),
        propertyRows(P5, 1990),
      ],
    },
    property_improvement: {
      property_improvement: [
        permit("pa", "2020-000100 BP", "Permitted", "2020-01-01"),
        permit("pb", "2026-000200 BP", "Completed", "2026-04-01"),
        permit("pc", "2021-000300 BP", "Permitted", "2021-01-01"),
        permit("pd", "2021-000400 BP", "Permitted", "2021-02-01"),
        permit("pe", "2022-000500 BP", "Completed", "2022-02-01"),
      ],
      property_has_property_improvement: [
        edge(P1, "pa"),
        edge(P2, "pb"),
        edge(P4, "pc"),
        edge(P5, "pd"),
        edge(P5, "pe"),
      ],
    },
  };

  it("counts permits whose property has null coordinates (coordinates)", async () => {
    const fx = await bindFixture(withExtras);
    try {
      const result = await listPermits(fx.db, fx.bound, { area, radius_mi: 5 });
      expect(result.rows.map((r) => r.permit_number).sort()).toEqual([
        "2020-000100 BP",
        "2026-000200 BP",
      ]);
      // meta.permit (sql.generated.ts) already inner-joins county.property, so the orphan P4
      // permit never reaches v_roofing_permit: property_link stays absent on real views.
      expect(result.unknown_excluded).toEqual({ coordinates: 2 });
      // Permit filters that do not depend on the property narrow the unplaced counts too.
      const open = await listPermits(fx.db, fx.bound, {
        area,
        radius_mi: 5,
        status_class: "open_or_stalled",
      });
      expect(open.unknown_excluded).toEqual({ coordinates: 1 });
    } finally {
      await fx.close();
    }
  });

  it("reports property_link and coordinates from the anti-join counts, only when above zero", async () => {
    const fx = await bindFixture(TABLES);
    const fake = (counts: Row): typeof fx.db => ({
      ...fx.db,
      all: async (sql: string) => (/LEFT JOIN v_property/.test(sql) ? [counts] : fx.db.all(sql)),
    });
    try {
      const both = await listPermits(fake({ property_link: 3, coordinates: 2 }), fx.bound, {
        area,
        radius_mi: 5,
      });
      expect(both.unknown_excluded).toEqual({ property_link: 3, coordinates: 2 });
      const none = await listPermits(fake({ property_link: 0, coordinates: 0 }), fx.bound, {
        area,
        radius_mi: 5,
      });
      expect(none.unknown_excluded).toEqual({});
    } finally {
      await fx.close();
    }
  });

  it("emits no such keys when every permit links and has coordinates", async () => {
    const fx = await bindFixture(TABLES);
    try {
      const result = await listPermits(fx.db, fx.bound, { area, radius_mi: 5 });
      expect(result.unknown_excluded).toEqual({});
    } finally {
      await fx.close();
    }
  });

  it("an area-less query reports no such keys", async () => {
    const fx = await bindFixture(withExtras);
    try {
      const result = await listPermits(fx.db, fx.bound, {});
      expect(result.unknown_excluded).toEqual({});
    } finally {
      await fx.close();
    }
  });
});

describe("getProperty", () => {
  let fx: Fixture;
  beforeAll(async () => {
    fx = await bindFixture(TABLES);
  });
  afterAll(() => fx.close());

  it("not_found: an unknown property_cid", async () => {
    const result = await getProperty(fx.db, fx.bound, { property_cid: UNKNOWN_CID });
    expect(result.empty_reason).toBe("not_found");
    expect(result.returned).toBe(0);
  });

  it("returns the one property row by property_cid, with its roofing permits", async () => {
    const result = await getProperty(fx.db, fx.bound, { property_cid: P1 });
    expect(result.returned).toBe(1);
    expect(result.rows[0]?.property_cid).toBe(P1);
  });

  it("by request_identifier", async () => {
    const result = await getProperty(fx.db, fx.bound, { request_identifier: "54321" });
    expect(result.rows[0]?.property_cid).toBe(P2);
  });
});

describe("getCoverage", () => {
  it("deep-equals the manifest coverage section unchanged", async () => {
    const fx = await bindFixture(TABLES, (m) => {
      m.coverage = { roofing_permit_rows: { count: 2, derivation: "published_rows" } };
    });
    try {
      const result = await getCoverage(fx.db, fx.bound);
      expect(result.coverage).toEqual({
        roofing_permit_rows: { count: 2, derivation: "published_rows" },
      });
      expect(result.run.manifest_cid).toBe(fx.bound.manifestCid);
    } finally {
      fx.close();
    }
  });
});

describe("listRuns", () => {
  it("newest first, limited", () => {
    const index = {
      schema: "oracle-travis-runs-index.v1" as const,
      runs: [
        { runId: "r1", manifestCid: `ba${"a".repeat(60)}`, finishedAt: "2026-01-01T00:00:00.000Z" },
        { runId: "r2", manifestCid: `ba${"b".repeat(60)}`, finishedAt: "2026-06-01T00:00:00.000Z" },
      ],
    };
    const result = listRuns(index, { limit: 1 });
    expect(result.runs).toEqual([
      {
        run_id: "r2",
        manifest_cid: `ba${"b".repeat(60)}`,
        finished_at: "2026-06-01T00:00:00.000Z",
      },
    ]);
    expect(result.latest).toEqual(result.runs[0]);
  });
});

describe("getSchema", () => {
  it("lists all four views with columns when no view is given", () => {
    const result = getSchema({});
    expect(result.views.map((v) => v.name)).toEqual([
      "v_property",
      "v_roofing_permit",
      "v_contractor",
      "v_run",
    ]);
  });

  it("filters to one view, and includes the six tool input JSON Schemas", () => {
    const result = getSchema({ view: "v_roofing_permit" });
    expect(result.views).toHaveLength(1);
    expect(result.views[0]?.name).toBe("v_roofing_permit");
    expect(Object.keys(result.tool_inputs)).toEqual([
      "searchProperties",
      "listPermits",
      "getProperty",
      "getCoverage",
      "listRuns",
      "getSchema",
    ]);
  });
});

describe("getSchema reason texts (A-16, contract v1.2)", () => {
  it("address and mailing ZIP are carried in v1.2, so they are no longer listed as uncarried", () => {
    const result = getSchema({ view: "v_property" });
    const entries = (result.uncarried as Record<string, { field: string; reason_text?: string }[]>)
      .v_property;
    expect(entries?.find((e) => e.field === "unnormalized_address")).toBeUndefined();
    expect(entries?.find((e) => e.field === "owner_mailing_postal_code")).toBeUndefined();
  });
});
