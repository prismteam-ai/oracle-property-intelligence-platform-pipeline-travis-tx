// D-9 review fixes (A-02): the four views over a small in-memory export fixture
// (test/helpers/fixture-export.ts). Each block names the finding it pins:
//   oracle F1 roof date and P0-8 · donphan M2/m6 status scope · code-review #1 status_class
//   never silently empty · donphan M1 owner reasons · donphan M4 contractor edges ·
//   code-review #2 owner names · #3 duplicate part rows · #7 one geometry row ·
//   #6 source_url fallback · #8/oracle F5 manifest digests.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROFILE } from "@countylens/profile-travis-austin";
import { GAZETTEER } from "../gazetteer/travis-places@1.0.0/index.js";
import {
  AUSTIN_URL,
  TCAD_URL,
  austinRequest,
  bindFixture,
  propertyRows,
  tcadRequest,
  type Fixture,
  type FixtureTables,
  type ManifestJson,
  type Row,
} from "./helpers/fixture-export.js";

type Missing = { field: string; reason: string }[];
const reasonOf = (row: Record<string, unknown> | undefined, field: string): string | undefined =>
  (row?.missing as Missing | undefined)?.find((m) => m.field === field)?.reason;

const OTHER_URL = "https://permits.pflugervilletx.gov/resource/permits.json";
const edge = (from: string, to: string): Row => ({ from_cid: from, to_cid: to });

function permit(
  cid: string,
  o: Partial<Record<string, string | null>> & { url?: string } = {},
): Row {
  return {
    cid,
    request_identifier: cid,
    permit_number: o.permit_number ?? `${cid} BP`,
    improvement_type: o.improvement_type ?? "Roofing",
    improvement_action: o.improvement_action ?? "Replacement",
    improvement_status: o.improvement_status === undefined ? "Permitted" : o.improvement_status,
    permit_issue_date: o.permit_issue_date === undefined ? "2026-04-01" : o.permit_issue_date,
    completion_date: o.completion_date ?? null,
    permit_close_date: o.permit_close_date ?? null,
    source_http_request: austinRequest(`${cid} BP`, o.url ?? AUSTIN_URL),
  };
}

const ADDRESS_POINT_REQUEST = JSON.stringify({
  method: "GET",
  url: "https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/LOCATION_address_points/FeatureServer/0/query",
  multiValueQueryString: { objectIds: ["77"], outFields: ["*"], outSR: ["4326"], f: ["json"] },
});

const P1 = "baguqeeraprop1";
const P2 = "baguqeeraprop2";
const P3 = "baguqeeraprop3";

const PERMITS: Row[] = [
  // P2: the latest accepted terminal date is pA's 2026-05-01.
  permit("pa", { improvement_status: "Completed", completion_date: "2026-05-01" }),
  // future terminal date (after as_of 2026-10-20): rejected
  permit("pb", { improvement_status: "Completed", completion_date: "2026-11-01" }),
  // open replacement: never resets the roof age (P0-8)
  permit("pc", { improvement_status: "Permitted", permit_issue_date: "2026-09-01" }),
  // terminal date before the issue date: rejected
  permit("pd", { improvement_status: "Completed", completion_date: "2026-03-01" }),
  // P1: an open replacement only
  permit("pe", { improvement_status: "Permitted", permit_issue_date: "2026-09-01" }),
  // P3: status scope and unmapped values
  permit("pf", { improvement_status: null, permit_issue_date: "2026-03-11" }),
  permit("pg", { improvement_status: null, permit_issue_date: "2026-03-11", url: OTHER_URL }),
  permit("ph", { improvement_status: "InProgress" }),
  permit("pi", { improvement_status: null, permit_issue_date: null }),
  permit("pj", { improvement_status: "Cancelled" }),
];

const TABLES: FixtureTables = {
  county: {
    property: [
      propertyRows(P1, 1985),
      propertyRows(P2, 1990),
      { ...propertyRows(P3, 1970), source_http_request: null },
    ],
    property_has_parcel: [edge(P1, "parcel1"), edge(P2, "parcel2")],
    parcel_has_geometry: [
      edge("parcel1", "g1a"),
      edge("parcel1", "g1b"),
      edge("parcel1", "g1c"),
      edge("parcel1", "g1d"),
      edge("parcel2", "g2a"),
    ],
    geometry: [
      { cid: "g1a", latitude: 30.0, longitude: null, request_identifier: "x" },
      { cid: "g1b", latitude: null, longitude: -97.0, request_identifier: "x" },
      {
        cid: "g1c",
        latitude: 30.3,
        longitude: -97.3,
        request_identifier: "x",
        source_http_request: tcadRequest(),
      },
      {
        cid: "g1d",
        latitude: 30.4,
        longitude: -97.4,
        request_identifier: "x",
        source_http_request: tcadRequest(),
      },
      // ADR 0004: a point stamped with the City of Austin address-point layer
      {
        cid: "g2a",
        latitude: 30.2,
        longitude: -97.2,
        request_identifier: "x",
        source_http_request: ADDRESS_POINT_REQUEST,
      },
    ],
    property_has_structure: [edge(P1, "s1"), edge(P2, "s2"), edge(P3, "s3")],
    structure: [
      { cid: "s1", roof_date: "1985", request_identifier: "x" },
      { cid: "s2", roof_date: null, request_identifier: "x" },
      { cid: "s3", roof_date: null, request_identifier: "x" },
    ],
    property_has_sales_history: [edge(P1, "sh0"), edge(P1, "sh1"), edge(P3, "sh3")],
    sales_history: [
      { cid: "sh0", ownership_transfer_date: "2001-01-01", request_identifier: "x" },
      { cid: "sh1", ownership_transfer_date: "2015-07-07", request_identifier: "x" },
      { cid: "sh3", ownership_transfer_date: "2010-02-02", request_identifier: "x" },
    ],
    // ERR-69: owners hang on the property. pe3 owns a property with no dated sale at all.
    person_has_property: [edge("pe1", P1), edge("pe2", P1), edge("pe3", P2)],
    person: [
      { cid: "pe1", first_name: "Ann", last_name: "Zed", request_identifier: "x" },
      { cid: "pe2", first_name: "Bob", last_name: "Young", request_identifier: "x" },
      { cid: "pe3", first_name: "Old", last_name: "Owner", request_identifier: "x" },
    ],
    company_has_property: [edge("co1", P1), edge("co2", P1)],
    company: [
      { cid: "co1", name: "Zeta LLC", request_identifier: "x" },
      { cid: "co2", name: "Alpha Inc", request_identifier: "x" },
    ],
  },
  property_improvement: {
    // two parts; pa and its edge are duplicated across them (code-review #3)
    property_improvement: [PERMITS, [PERMITS[0] as Row]],
    property_has_property_improvement: [
      [
        edge(P2, "pa"),
        edge(P2, "pb"),
        edge(P2, "pc"),
        edge(P2, "pd"),
        edge(P1, "pe"),
        edge(P3, "pf"),
        edge(P3, "pg"),
        edge(P3, "ph"),
        edge(P3, "pi"),
        edge(P3, "pj"),
      ],
      [edge(P2, "pa")],
    ],
    property_improvement_has_contractor: [
      edge("pa", "cA"),
      edge("pa", "cB"),
      edge("pc", "cA"),
      edge("pj", "cC"),
    ],
    company: [
      { cid: "cA", name: "Roofer A", source_http_request: austinRequest("x") },
      { cid: "cB", name: "Roofer B", source_http_request: austinRequest("x") },
      // "A&B Roofing" prints an ampersand; cC carries a registry id (a future official match)
      {
        cid: "cC",
        name: "A&B Roofing (O'Neil)",
        sunbiz_document_number: "P12000012345",
        source_http_request: austinRequest("x"),
      },
    ],
  },
};

/** The manifest's coverage without its owner_* counts. */
function withoutOwnerCounts(m: ManifestJson): void {
  m.coverage = Object.fromEntries(
    Object.entries(m.coverage).filter(([k]) => !k.startsWith("owner_")),
  );
}

let fx: Fixture;
let props: Record<string, unknown>[];
let permits: Record<string, unknown>[];
const prop = (cid: string): Record<string, unknown> | undefined =>
  props.find((r) => r.property_cid === cid);
const pmt = (cid: string): Record<string, unknown> | undefined =>
  permits.find((r) => r.permit_cid === cid);

beforeAll(async () => {
  fx = await bindFixture(TABLES, (m) => {
    // A run with no owner gap counts: a dated sale without an owner is no_owner_record.
    withoutOwnerCounts(m);
  });
  props = await fx.rows("SELECT * FROM v_property ORDER BY property_cid");
  permits = await fx.rows("SELECT * FROM v_roofing_permit ORDER BY permit_cid");
});
afterAll(() => fx.close());

describe("roof date: permit anchor from published PI rows, built year from TCAD (oracle F1, P0-8)", () => {
  it("anchors on the latest accepted Completed Roofing/Replacement date (not future, not before issue)", () => {
    expect(prop(P2)).toMatchObject({
      roof_date: "2026-05-01",
      roof_age_years: 0,
      roof_age_basis: "permit",
      roof_age_confidence: "high",
    });
  });

  it("an open replacement never resets the roof age; the built year stays (low)", () => {
    expect(prop(P1)).toMatchObject({
      roof_date: "1985",
      roof_age_years: 41,
      roof_age_basis: "built_year",
      roof_age_confidence: "low",
    });
  });

  it("no anchor and no built-year roof date → unknown with no_roof_date", () => {
    expect(prop(P3)).toMatchObject({ roof_date: null, roof_age_basis: "unknown" });
    expect(reasonOf(prop(P3), "roof_date")).toBe("no_roof_date");
  });
});

describe("status_class scope and reasons (donphan M2, m6, m7; code-review #1)", () => {
  it("an Austin null status with an issue date is stalled; improvement_status is enum_lacks_value", () => {
    expect(pmt("pf")).toMatchObject({ jurisdiction: "austin", status_class: "stalled" });
    expect(reasonOf(pmt("pf"), "improvement_status")).toBe("enum_lacks_value");
    expect(reasonOf(pmt("pf"), "status_raw")).toBe("no_lexicon_carrier");
    expect(reasonOf(pmt("pf"), "expiry_date")).toBe("no_lexicon_carrier");
  });

  it("a null status from another jurisdiction is not stalled: empty with needs_review", () => {
    expect(pmt("pg")).toMatchObject({ jurisdiction: null, status_class: null, is_open: false });
    expect(reasonOf(pmt("pg"), "status_class")).toBe("needs_review");
    expect(reasonOf(pmt("pg"), "improvement_status")).toBe("needs_review");
    expect(reasonOf(pmt("pg"), "jurisdiction")).toBe("needs_review");
    expect(reasonOf(pmt("pg"), "final_date")).toBe("needs_review");
    expect(reasonOf(pmt("pg"), "open_days")).toBe("needs_review");
  });

  it.each(["ph", "pi", "pj"])(
    "%s (unmapped value or no issue date) has status_class null with needs_review, never a class",
    (cid) => {
      expect(pmt(cid)?.status_class).toBeNull();
      expect(reasonOf(pmt(cid), "status_class")).toBe("needs_review");
    },
  );

  it("every null status_class has a needs_review entry", () => {
    for (const r of permits.filter((p) => p.status_class === null))
      expect(reasonOf(r, "status_class"), String(r.permit_cid)).toBe("needs_review");
  });
});

describe("one row per permit and per edge (code-review #3)", () => {
  it("a permit duplicated across parts, with a duplicated edge, is one row", () => {
    expect(permits.filter((r) => r.permit_cid === "pa")).toHaveLength(1);
    expect(new Set(permits.map((r) => r.permit_cid)).size).toBe(permits.length);
  });
});

describe("contractor edges (donphan M4)", () => {
  it("exactly one edge → that company, as printed and unverified, so still unresolved (ERR-66)", () => {
    expect(pmt("pc")).toMatchObject({
      contractor_resolution: "unresolved",
      contractor_company_cid: "cA",
      contractor_name_as_printed: "Roofer A",
      bbb_status: "blocked",
      bbb_status_reason: "bbb_blocked",
      bbb_rating: null,
      bbb_url:
        "https://www.bbb.org/search?find_country=USA&find_text=Roofer%20A&find_loc=Austin%2C%20TX",
    });
    expect(reasonOf(pmt("pc"), "bbb_rating")).toBe("bbb_blocked");
    expect(reasonOf(pmt("pc"), "contractor_name_as_printed")).toBeUndefined();
    expect(reasonOf(pmt("pc"), "bbb_url")).toBeUndefined();
  });

  it("a company with an official registry id is resolved; the link encodes ampersands and quotes", () => {
    expect(pmt("pj")).toMatchObject({
      contractor_resolution: "resolved",
      contractor_name_as_printed: "A&B Roofing (O'Neil)",
    });
    expect(pmt("pj")?.bbb_url).toContain("find_text=A%26B%20Roofing%20%28O%27Neil%29&");
  });

  it("no contractor name → no link, not_checked, name and url missing with their reasons", () => {
    expect(pmt("pf")).toMatchObject({
      contractor_name_as_printed: null,
      bbb_url: null,
      bbb_rating: null,
      bbb_status: "not_checked",
      bbb_status_reason: "source_missing",
    });
    expect(reasonOf(pmt("pf"), "contractor_name_as_printed")).toBe("source_missing");
    expect(reasonOf(pmt("pf"), "bbb_url")).toBe("source_missing");
    // views.sql hard-codes this one (changing it changes viewsSha256); read paths remap it.
    expect(reasonOf(pmt("pf"), "bbb_rating")).toBe("contractor_unresolved");
  });

  it("two edges → unresolved, no company picked, needs_review", () => {
    expect(pmt("pa")).toMatchObject({
      contractor_resolution: "unresolved",
      contractor_company_cid: null,
    });
    expect(reasonOf(pmt("pa"), "contractor_company_cid")).toBe("needs_review");
  });

  it("no edge → unresolved, the company gap is source_missing (no contractor printed, A-16)", () => {
    expect(pmt("pf")?.contractor_resolution).toBe("unresolved");
    expect(reasonOf(pmt("pf"), "contractor_company_cid")).toBe("source_missing");
  });
});

describe("owner (code-review #2, donphan M1)", () => {
  it("2 persons + 2 companies on the property: company, each name once, persons then companies", () => {
    expect(prop(P1)).toMatchObject({
      owner_kind: "company",
      owner_name: "Bob Young; Ann Zed; Alpha Inc; Zeta LLC",
      last_ownership_transfer_date: "2015-07-07",
    });
  });

  it("no dated sale does not hide the owner; tenure keeps its own no_dated_sale reason", () => {
    expect(prop(P2)).toMatchObject({
      owner_kind: "person",
      owner_name: "Old Owner",
      last_ownership_transfer_date: null,
    });
    expect(reasonOf(prop(P2), "owner_name")).toBeUndefined();
    expect(reasonOf(prop(P2), "tenure_years")).toBe("no_dated_sale");
  });

  it("a property without an owner and no gap counts → no_owner_record", () => {
    expect(reasonOf(prop(P3), "owner_name")).toBe("no_owner_record");
  });

  it.each([
    [{ owner_unparsed: 4 }, "owner_unparsed"],
    [{ owner_confidential: 1 }, "owner_confidential"],
    [{ owner_no_record: 2 }, "no_owner_record"],
    [{ owner_unparsed: 1, owner_confidential: 1 }, "needs_review"],
  ] as const)("coverage %o → %s for a property without an owner", async (counts, reason) => {
    const f = await bindFixture(TABLES, (m) => {
      withoutOwnerCounts(m);
      for (const [k, n] of Object.entries(counts))
        m.coverage[k] = { count: n, derivation: "capture_receipt" };
    });
    try {
      const rows = await f.rows(`SELECT missing FROM v_property WHERE property_cid = '${P3}'`);
      expect(reasonOf(rows[0], "owner_name")).toBe(reason);
      expect(reasonOf(rows[0], "owner_kind")).toBe(reason);
    } finally {
      f.close();
    }
  });
});

describe("owners of a run written before Run 3 (sale edges only, no property edges)", () => {
  it("the persons and companies of the latest dated sale still read as the owners", async () => {
    const {
      person_has_property: _p,
      company_has_property: _c,
      ...legacy
    } = TABLES.county as Record<string, unknown>;
    const f = await bindFixture(
      {
        ...TABLES,
        county: {
          ...legacy,
          sales_history_has_person: [edge("sh3", "pe1"), edge("sh0", "pe3")],
          sales_history_has_company: [edge("sh3", "co1")],
        },
      } as typeof TABLES,
      withoutOwnerCounts,
    );
    try {
      const rows = await f.rows(
        `SELECT property_cid, owner_kind, owner_name FROM v_property WHERE property_cid IN ('${P1}', '${P3}')`,
      );
      const by = (cid: string) => rows.find((r) => r.property_cid === cid);
      // P3: its latest sale (sh3) has Ann Zed and Zeta LLC. P1: only the older sale sh0 has an owner.
      expect(by(P3)).toMatchObject({ owner_kind: "company", owner_name: "Ann Zed; Zeta LLC" });
      expect(by(P1)?.owner_name).toBeNull();
    } finally {
      f.close();
    }
  });
});

describe("coordinates from one geometry row (code-review #7)", () => {
  it("takes both coordinates from the lowest-cid geometry with both present", () => {
    expect(prop(P1)).toMatchObject({
      latitude: 30.3,
      longitude: -97.3,
      coordinate_source: "gis_centroid",
    });
  });

  it("A-11 Run 3 (ADR 0004): a geometry stamped with the City of Austin address layer reads address_point", () => {
    expect(prop(P2)).toMatchObject({
      latitude: 30.2,
      longitude: -97.2,
      coordinate_source: "address_point",
    });
  });

  it("a property with no geometry reads none with no_coordinates", () => {
    expect(prop(P3)).toMatchObject({ latitude: null, coordinate_source: "none" });
    expect(reasonOf(prop(P3), "coordinate_source")).toBe("no_coordinates");
  });
});

describe("source_url fallback (code-review #6)", () => {
  it("falls back to the source URL without a false missing source_url entry", () => {
    expect(prop(P3)?.source_url).toBe(TCAD_URL);
    expect(reasonOf(prop(P3), "source_url")).toBeUndefined();
    for (const r of [...props, ...permits]) expect(reasonOf(r, "source_url")).toBeUndefined();
    const contractors = fx.rows("SELECT missing FROM v_contractor");
    return contractors.then((rows) => {
      expect(rows.length).toBe(3);
      for (const r of rows) expect(reasonOf(r, "source_url")).toBeUndefined();
    });
  });
});

describe("manifest digests (code-review #8, oracle F5)", () => {
  const without = (m: ManifestJson): void => {
    m.profiles = m.profiles.filter((p) => p.name !== "travis-places");
  };

  it("area_list_sha256 is the manifest's travis-places digest", () => {
    for (const r of props) expect(r.area_list_sha256).toBe(GAZETTEER.sha256);
  });

  it(
    "degrades gracefully (no throw) when the manifest has no travis-places profile " +
      "(A-11 bug 2: places/business out of scope for a run is missing data, not a bind failure)",
    async () => {
      const fixture = await bindFixture(TABLES, without);
      try {
        const rows = await fixture.rows(
          "SELECT area_list_sha256, owner_area_class, missing FROM v_property",
        );
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) {
          // No travis-places profile: never silently falls back to the in-repo gazetteer
          // (code-review #8) — area_list_sha256 is NULL and owner_area_class is the same
          // "unknown" + missing-reason pair a real gap already renders (never a raw crash).
          expect(r["area_list_sha256"]).toBeNull();
          expect(r["owner_area_class"]).toBe("unknown");
          // The fixture's owners have no mailing address edge and no ZIP lookup is loaded.
          expect(reasonOf(r, "owner_area_class")).toBeDefined();
        }
      } finally {
        fixture.close();
      }
    },
  );

  it("throws when the manifest's travis-austin digest is not the in-repo profile DIGEST", async () => {
    await expect(
      bindFixture(TABLES, (m) => {
        const p = m.profiles.find((x) => x.name === PROFILE.name) as Record<string, unknown>;
        p.sha256 = "0".repeat(64);
      }),
    ).rejects.toThrow(/travis-austin.*DIGEST/);
  });
});

describe("v_run missing (T069)", () => {
  it("lists previous_manifest_cid as first_run when the manifest has none", async () => {
    const rows = await fx.rows("SELECT previous_manifest_cid, missing FROM v_run");
    expect(rows).toEqual([
      {
        previous_manifest_cid: null,
        missing: [{ field: "previous_manifest_cid", reason: "first_run" }],
      },
    ]);
  });

  it("has an empty missing list when the manifest names its previous run", async () => {
    const prev = fx.bound.manifestCid;
    const f = await bindFixture(TABLES, (m) => {
      m.previousManifestCid = prev;
    });
    try {
      const rows = await f.rows("SELECT previous_manifest_cid, missing FROM v_run");
      expect(rows).toEqual([{ previous_manifest_cid: prev, missing: [] }]);
    } finally {
      f.close();
    }
  });
});

describe("v_run limitations (T070)", () => {
  it.each([[["first limitation", "it's quoted"]], [[]]])(
    "carries the manifest's top-level limitations[] %j in order",
    async (limitations) => {
      const f = await bindFixture(TABLES, (m) => {
        m.limitations = limitations;
      });
      try {
        const rows = await f.rows("SELECT limitations FROM v_run");
        expect(rows).toEqual([{ limitations }]);
      } finally {
        f.close();
      }
    },
  );
});

describe("tcadRequest helper", () => {
  it("is the TCAD export GET", () => {
    expect(JSON.parse(tcadRequest())).toEqual({ method: "GET", url: TCAD_URL });
  });
});
