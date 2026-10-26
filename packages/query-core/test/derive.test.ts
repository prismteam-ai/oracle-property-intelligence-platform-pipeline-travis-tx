// T056 (A-02, mew § B.5, data-model.md § Derivation rules): every derived column, table-driven.
// Each case runs twice: through the TypeScript function and through the SQL macro that
// views.sql calls (both exported by src/derive.ts), and both must give the expected value.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyStatus } from "@countylens/profile-travis-austin";
import * as d from "../src/derive.js";
import { STATUS_MAP_SQL } from "../src/sql.js";
import { openDuckDb, type DuckDbEngine } from "../scripts/duckdb-engine.js";

const AS_OF = "2026-10-20T22:00:10.663Z";
const AS_OF_SQL = `TIMESTAMPTZ '${AS_OF}'`;

let db: DuckDbEngine;
beforeAll(async () => {
  db = await openDuckDb();
  await db.run(STATUS_MAP_SQL);
  await db.run(d.deriveMacrosSql());
});
afterAll(() => db.close());

const lit = (v: string | number | boolean | null, type = "VARCHAR"): string =>
  v === null
    ? `NULL::${type}`
    : typeof v === "string"
      ? `'${v.replace(/'/g, "''")}'::${type}`
      : `${String(v)}::${type}`;

async function sql(expr: string): Promise<unknown> {
  const rows = await db.all(`SELECT ${expr} AS v`);
  return rows[0]?.v;
}

describe("roof_age_years (whole years to as_of; 0 allowed; never the stored field)", () => {
  it.each([
    ["1950", 76],
    ["2026", 0],
    ["2026-10-19", 0],
    ["2025-10-20", 1],
    ["2025-10-21", 0],
    ["2025-10", 1],
    ["2025-11", 0],
    [null, null],
  ])("roof_date %s → %s", async (roofDate, expected) => {
    expect(d.roofAgeYears(roofDate, AS_OF)).toBe(expected);
    expect(await sql(`roof_age_years(${lit(roofDate)}, ${AS_OF_SQL})`)).toBe(expected);
  });
});

describe("roof_age_basis / roof_age_confidence (mew B.5)", () => {
  it.each([
    // roof_date, replacement match, new-construction match, built year, basis, confidence
    ["2026-09-15", true, false, 1947, "permit", "high"],
    ["2026-09-15", false, true, 1947, "new_construction", "medium"],
    ["1950", false, false, 1950, "built_year", "low"],
    ["1951", false, false, 1950, "unknown", "none"],
    ["2026-09-15", false, false, 2026, "unknown", "none"],
    [null, false, false, 1950, "unknown", "none"],
  ] as const)(
    "roof_date %s, replacement %s, new %s, built %s → %s/%s",
    async (roofDate, replacement, isNew, built, basis, confidence) => {
      expect(d.roofAgeBasis(roofDate, replacement, isNew, built)).toBe(basis);
      expect(d.roofAgeConfidence(basis)).toBe(confidence);
      expect(
        await sql(
          `roof_age_basis(${lit(roofDate)}, ${replacement}, ${isNew}, ${lit(built, "BIGINT")})`,
        ),
      ).toBe(basis);
      expect(await sql(`roof_age_confidence('${basis}')`)).toBe(confidence);
    },
  );

  it.each([
    ["2026-09-15", "2026-09-15", true],
    ["2026-09", "2026-09-15", true],
    ["2026", "2026-09-15", true],
    ["2026-09-15", "2026-09-16", false],
    ["2026-09-15", null, false],
    [null, "2026-09-15", false],
  ])("date_matches_at_precision(%s, %s) → %s", async (roofDate, date, expected) => {
    expect(d.dateMatchesAtPrecision(roofDate, date)).toBe(expected);
    expect(await sql(`date_matches_at_precision(${lit(roofDate)}, ${lit(date)})`)).toBe(expected);
  });

  it("the basis reason is no_roof_date without a date, else basis_unmatched", async () => {
    expect(d.roofBasisReason(null)).toBe("no_roof_date");
    expect(d.roofBasisReason("1951")).toBe("basis_unmatched");
    expect(await sql(`roof_basis_reason(NULL::VARCHAR)`)).toBe("no_roof_date");
    expect(await sql(`roof_basis_reason('1951')`)).toBe("basis_unmatched");
  });
});

describe("tenure (max ownership_transfer_date; > 10 years is long)", () => {
  it.each([
    [null, null, "unknown", null],
    ["2015-10-20", 11, "sale_date", true],
    ["2016-10-20", 10, "sale_date", false],
    ["2016-10-21", 9, "sale_date", false],
    ["1993-12-17", 32, "sale_date", true],
  ])("transfer %s → %s years, %s, long %s", async (date, years, basis, long) => {
    expect(d.tenureYears(date, AS_OF)).toBe(years);
    expect(d.tenureBasis(date)).toBe(basis);
    expect(d.isLongTenure(d.tenureYears(date, AS_OF))).toBe(long);
    const dateSql = lit(date, "DATE");
    expect(await sql(`tenure_years(${dateSql}, ${AS_OF_SQL})`)).toBe(years);
    expect(await sql(`tenure_basis(${dateSql})`)).toBe(basis);
    expect(await sql(`is_long_tenure(tenure_years(${dateSql}, ${AS_OF_SQL}))`)).toBe(long);
  });
});

describe("tenure_basis with a transfer source (ERR-71)", () => {
  it.each([
    ["2019-07-01", "deed", "deed_date"],
    ["2019-07-01", "sale", "sale_date"],
    ["2019-07-01", null, "sale_date"],
    [null, "deed", "unknown"],
  ] as const)("date %s, source %s → %s", async (date, source, basis) => {
    expect(d.tenureBasis(date, source)).toBe(basis);
    const src = source === null ? "NULL::VARCHAR" : `'${source}'`;
    expect(await sql(`tenure_basis(${lit(date, "DATE")}, ${src})`)).toBe(basis);
  });
});

describe("owner_area_class / owner_is_out_of_area (travis-places lists)", () => {
  it.each([
    ["78753", "in_county", false],
    ["78626", "regional", true],
    ["10001", "out_of_area", true],
    ["99999", "unknown", null],
    [null, "unknown", null],
  ] as const)("mailing ZIP %s → %s, out of area %s", async (zip, cls, out) => {
    expect(d.ownerAreaClass(zip)).toBe(cls);
    expect(d.ownerIsOutOfArea(cls)).toBe(out);
    // SQL: the class comes from the meta.zcta_area lookup (bindManifest); NULL → unknown.
    const lookup = zip === null || cls === "unknown" ? "NULL::VARCHAR" : `'${cls}'`;
    expect(await sql(`owner_area_class(${lookup})`)).toBe(cls);
    expect(await sql(`owner_is_out_of_area('${cls}')`)).toBe(out);
  });

  it("the ZCTA table covers every class the gazetteer gives", () => {
    const rows = d.zctaAreaRows();
    expect(rows.find((r) => r.zcta === "78753")?.area_class).toBe("in_county");
    expect(rows.find((r) => r.zcta === "78626")?.area_class).toBe("regional");
    expect(rows.find((r) => r.zcta === "10001")?.area_class).toBe("out_of_area");
    expect(rows.find((r) => r.zcta === "99999")).toBeUndefined();
  });
});

describe("open_days (as_of − issue_date for open/stalled without final_date; else null; ≥ 0)", () => {
  it.each([
    ["stalled", "2026-03-11", null, 223],
    ["open", "2026-09-17", null, 33],
    ["open", "2026-10-25", null, 0],
    ["closed", "2026-09-17", null, null],
    ["open", null, null, null],
    // ERR-70: a finished or implausibly-dated permit gets no interval
    ["stalled", "1984-01-01", "1985-03-11", null],
    ["open", "2026-03-11", "2026-04-01", null],
    ["stalled", "2026-03-11", "2026-03-01", null],
    ["stalled", "2026-03-11", "2027-01-01", null],
  ] as const)("%s issued %s final %s → %s", async (cls, issue, fin, expected) => {
    expect(d.openDays(cls, issue, AS_OF, fin)).toBe(expected);
    expect(
      await sql(`open_days('${cls}', ${lit(issue, "DATE")}, ${AS_OF_SQL}, ${lit(fin, "DATE")})`),
    ).toBe(expected);
  });
});

describe("status_class (generated status map, scoped to the profile's jurisdictions; D-4a)", () => {
  it.each([
    ["austin", "Permitted", "2026-09-17", "open"],
    ["austin", "Planned", "2026-09-17", "open"],
    ["austin", "OnHold", "2026-09-17", "open"],
    ["austin", "Completed", "2026-09-17", "closed"],
    ["austin", null, "2026-03-11", "stalled"],
    ["austin", null, null, null],
    ["austin", "Cancelled", "2026-03-11", null],
    ["austin", "InProgress", "2026-03-11", null],
    // donphan M2: the NULL → stalled rule is Austin's; any other jurisdiction gets no class.
    ["pflugerville", null, "2026-03-11", null],
    ["pflugerville", "Completed", "2026-03-11", null],
    [null, null, "2026-03-11", null],
    [null, "Permitted", "2026-03-11", null],
  ])(
    "jurisdiction %s, improvement_status %s, issued %s → %s",
    async (j, status, issue, expected) => {
      expect(d.statusClass(j, status, issue)).toBe(expected);
      expect(await sql(`status_class_of(${lit(j)}, ${lit(status)}, ${lit(issue)})`)).toBe(expected);
    },
  );

  it("agrees with the profile's classifyStatus for every published word", () => {
    for (const word of ["Active", "Pending", "On Hold", "Final", "Closed", "Expired"]) {
      const c = classifyStatus(word);
      expect(d.statusClass("austin", c.improvement_status, "2026-01-01"), word).toBe(c.class);
    }
  });

  it("is_open is status_class = open", async () => {
    expect(d.isOpen("open")).toBe(true);
    expect(d.isOpen("stalled")).toBe(false);
    expect(await sql(`is_open('open')`)).toBe(true);
    expect(await sql(`is_open('closed')`)).toBe(false);
  });

  it("final_date reason: not_closed unless closed; needs_review when the class is unknown", async () => {
    expect(d.finalDateReason("open")).toBe("not_closed");
    expect(d.finalDateReason("closed")).toBe("source_missing");
    expect(d.finalDateReason(null)).toBe("needs_review");
    expect(await sql(`final_date_reason('stalled', false)`)).toBe("not_closed");
    expect(await sql(`final_date_reason('closed', false)`)).toBe("source_missing");
    expect(await sql(`final_date_reason('closed', true)`)).toBe("superseded_by_later_permit");
    expect(await sql(`final_date_reason(NULL::VARCHAR, false)`)).toBe("needs_review");
  });

  it.each([
    ["open", "2026-09-17", null, "not_open"],
    ["stalled", null, null, "source_missing"],
    ["closed", "2026-09-17", null, "not_open"],
    [null, "2026-09-17", null, "needs_review"],
    // ERR-70: finished (plausible final_date) is not_open; implausible is a data-quality gap
    ["stalled", "2026-03-11", "2026-04-01", "not_open"],
    ["stalled", "2026-03-11", "2026-03-01", "needs_review"],
    ["open", "2026-03-11", "2027-01-01", "needs_review"],
  ] as const)(
    "open_days reason: class %s issued %s final %s → %s",
    async (cls, issue, fin, expected) => {
      expect(d.openDaysReason(cls, issue, AS_OF, fin)).toBe(expected);
      expect(
        await sql(
          `open_days_reason(${lit(cls)}, ${lit(issue, "DATE")}, ${AS_OF_SQL}, ${lit(fin, "DATE")})`,
        ),
      ).toBe(expected);
    },
  );

  it("A11-16: open_days_reason has no as-of default, so it cannot disagree with the SQL macro", () => {
    // @ts-expect-error asOf is required: a call without it must not compile
    const withoutAsOf = (): unknown => d.openDaysReason("stalled", "2026-03-11");
    expect(typeof withoutAsOf).toBe("function");
    // a finished permit with a plausible final date is not_open for any as-of on or after it
    expect(d.openDaysReason("stalled", "2026-03-11", "2026-10-26", "2026-04-01")).toBe("not_open");
    expect(d.openDaysReason("stalled", "2026-03-11", "2026-03-15", "2026-04-01")).toBe(
      "needs_review",
    );
  });

  it.each([
    // improvement_status is null: stalled means the enum has no value for the source word
    // (Expired); otherwise the null is unexplained (needs_review).
    ["stalled", "enum_lacks_value"],
    [null, "needs_review"],
  ] as const)("null improvement_status with class %s → %s", async (cls, expected) => {
    expect(d.statusMissingReason(cls)).toBe(expected);
    expect(await sql(`status_missing_reason(${lit(cls)})`)).toBe(expected);
  });
});

describe("roof terminal date (estimator rule: ≤ as_of, ≥ issue date)", () => {
  it.each([
    ["2026-09-15", "2026-09-01", true],
    ["2026-09-15", null, true],
    ["2026-10-20", "2026-09-01", true],
    ["2026-10-21", "2026-09-01", false],
    ["2026-08-31", "2026-09-01", false],
    [null, "2026-09-01", false],
  ] as const)("terminal %s, issued %s → accepted %s", async (date, issue, expected) => {
    expect(d.terminalDateAccepted(date, issue, AS_OF)).toBe(expected);
    expect(
      await sql(
        `terminal_date_accepted(${lit(date, "DATE")}, ${lit(issue, "DATE")}, ${AS_OF_SQL})`,
      ),
    ).toBe(expected);
  });
});

describe("owner kind, name and missing reason (code-review #2, donphan M1)", () => {
  it.each([
    [2, 2, "company"],
    [0, 1, "company"],
    [2, 0, "person"],
    [0, 0, "unknown"],
  ] as const)("%s persons, %s companies → %s", async (persons, companies, kind) => {
    expect(d.ownerKind(persons, companies)).toBe(kind);
    expect(await sql(`owner_kind_of(${persons}, ${companies})`)).toBe(kind);
  });

  it.each([
    // coverage counts (unparsed, confidential, no_record) → reason for a dated sale with no owner
    [4, 0, 0, "owner_unparsed"],
    [0, 2, 0, "owner_confidential"],
    [0, 0, 3, "no_owner_record"],
    [0, 0, 0, "no_owner_record"],
    [1, 1, 0, "needs_review"],
    [null, null, null, "no_owner_record"],
  ] as const)("coverage %s/%s/%s → %s", async (u, c, n, reason) => {
    expect(d.ownerGapReason(u, c, n)).toBe(reason);
    expect(
      await sql(
        `owner_gap_reason(${lit(u, "INTEGER")}, ${lit(c, "INTEGER")}, ${lit(n, "INTEGER")})`,
      ),
    ).toBe(reason);
  });
});

describe("contractor edge count (donphan M4: never pick one of several)", () => {
  it.each([
    // A-16: no edge means the permit printed no contractor (source_missing), nothing failed to match.
    [0, null, null, "source_missing"],
    [1, "baguqeeraone", "baguqeeraone", "contractor_unresolved"],
    [2, "baguqeeraone", null, "needs_review"],
  ] as const)("%s edge(s), min cid %s → company %s, reason %s", async (n, cid, company, reason) => {
    expect(d.soleContractor(n, cid)).toBe(company);
    expect(d.contractorMissingReason(n)).toBe(reason);
    expect(await sql(`sole_contractor(${n}, ${lit(cid)})`)).toBe(company);
    expect(await sql(`contractor_missing_reason(${n})`)).toBe(reason);
  });
});

describe("coordinate_source, contractor and BBB state", () => {
  const TCAD =
    "https://traviscad.org/wp-content/largefiles/2026%20Certified%20JSON%20SUPP%200%2007182026.zip";
  const ADDRESS_LAYER =
    "https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/LOCATION_address_points/FeatureServer/0/query?objectIds=12&outFields=*&outSR=4326&f=json";
  it.each([
    [30.27, -97.76, null, null, null, "gis_centroid"],
    [30.27, -97.76, null, null, TCAD, "gis_centroid"],
    // ADR 0004: only the geometry's own source URL makes a point an address point.
    [30.27, -97.76, null, null, ADDRESS_LAYER, "address_point"],
    // no coordinates: the URL is irrelevant
    [null, null, null, null, ADDRESS_LAYER, "none"],
    [null, null, 30.27, -97.76, null, "permit_point"],
    [null, null, null, null, null, "none"],
  ])(
    "coords %s,%s / permit %s,%s / geometry %s → %s",
    async (lat, lon, plat, plon, url, expected) => {
      expect(d.coordinateSource(lat, lon, plat, plon, url)).toBe(expected);
      expect(
        await sql(
          `coordinate_source(${lit(lat, "DOUBLE")}, ${lit(lon, "DOUBLE")}, ${lit(plat, "DOUBLE")}, ${lit(plon, "DOUBLE")}, ${lit(url)})`,
        ),
      ).toBe(expected);
    },
  );

  it("the four-argument call keeps its old meaning (no geometry URL → gis_centroid)", () => {
    expect(d.coordinateSource(30.27, -97.76, null, null)).toBe("gis_centroid");
  });

  it.each([
    ["P12000012345", "resolved"],
    [null, "unresolved"],
  ] as const)(
    "registry id %s → %s (a printed name alone never resolves, ERR-66)",
    async (id, resolution) => {
      expect(d.contractorResolution(id)).toBe(resolution);
      expect(await sql(`contractor_resolution(${lit(id)})`)).toBe(resolution);
    },
  );

  it.each([
    ["Roofer A", "blocked", "bbb_blocked"],
    [null, "not_checked", "source_missing"],
  ] as const)("contractor name %s → bbb %s / %s", async (name, status, reason) => {
    expect(d.bbbStatus(name)).toBe(status);
    expect(d.bbbStatusReason(name)).toBe(reason);
    expect(await sql(`bbb_status(${lit(name)})`)).toBe(status);
    expect(await sql(`bbb_status_reason(${lit(name)})`)).toBe(reason);
  });

  it.each([
    "Done Right Roofing",
    "A&B Roofing + Sons, Inc. (O'Neil) No. 1/2",
    "Cañón Techos Ñandú",
    "Tilde~Under_Score-Dot.",
    "Star * Bang ! Quote ' Paren ( )",
    "x".repeat(300),
    `${"Word ".repeat(40)}end`,
    "a😀".repeat(100),
  ])("bbb_search_url: SQL macro equals the TypeScript builder for %j", async (name) => {
    const url = d.bbbSearchUrl(name);
    expect(await sql(`bbb_search_url(${lit(name)})`)).toBe(url);
    expect(url).not.toMatch(/[ '()!*]/);
    expect(new URL(url as string).searchParams.get("find_loc")).toBe("Austin, TX");
  });

  it("bbb_search_url: no name → no link; the name is cut at 120 characters", async () => {
    expect(d.bbbSearchUrl(null)).toBeNull();
    expect(await sql(`bbb_search_url(${lit(null)})`)).toBeNull();
    const text = new URL(d.bbbSearchUrl("y".repeat(500)) as string).searchParams.get("find_text");
    expect(text).toBe("y".repeat(d.BBB_NAME_MAX));
  });
});

describe("source_url (request url + query) and url_host", () => {
  const req = JSON.stringify({
    method: "GET",
    multiValueQueryString: { permit_number: ["2026-029405 BP"] },
    url: "https://data.austintexas.gov/resource/3syk-w9eu.json",
  });
  const plainReq = JSON.stringify({ method: "GET", url: "https://traviscad.org/x.zip" });

  it.each([
    [req, "https://data.austintexas.gov/resource/3syk-w9eu.json?permit_number=2026-029405%20BP"],
    [plainReq, "https://traviscad.org/x.zip"],
    [null, null],
  ])("request %s → %s", async (request, expected) => {
    expect(d.sourceUrl(request)).toBe(expected);
    expect(await sql(`source_url(${lit(request)})`)).toBe(expected);
  });

  it("url_host takes the host of the request url", async () => {
    expect(d.urlHost("https://data.austintexas.gov/resource/a.json")).toBe("data.austintexas.gov");
    expect(await sql(`url_host('https://data.austintexas.gov/resource/a.json')`)).toBe(
      "data.austintexas.gov",
    );
    expect(d.urlHost(null)).toBeNull();
  });

  it("miss() builds a {field, reason} entry", async () => {
    expect(await sql(`miss('status_raw', 'no_lexicon_carrier')`)).toEqual({
      field: "status_raw",
      reason: "no_lexicon_carrier",
    });
  });

  it("as_of_date is the UTC date of as_of", async () => {
    expect(await sql(`as_of_date(TIMESTAMPTZ '2026-10-20T23:30:00-05:00')`)).toBe("2026-10-21");
  });
});
