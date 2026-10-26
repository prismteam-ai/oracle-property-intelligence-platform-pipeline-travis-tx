// ERR-71: v_property.tenure_basis is deed_date when the latest dated transfer is a TCAD transfer
// deed (a sales_history row whose source_http_request.multiValueQueryString.transfer_source is
// "deed"), sale_date when it is a sale, unknown with no dated transfer. is_long_tenure is true only
// above 10 whole years from the latest transfer, whichever source it came from. Synthetic rows.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bindFixture,
  propertyRows,
  tcadRequest,
  type Fixture,
  type FixtureTables,
  type ManifestJson,
  type Row,
} from "./helpers/fixture-export.js";

const edge = (from: string, to: string): Row => ({ from_cid: from, to_cid: to });
const deedRequest = (): string =>
  JSON.stringify({
    method: "GET",
    url: "https://traviscad.org/wp-content/largefiles/2026%20Certified%20JSON%20SUPP%200%2007182026.zip",
    multiValueQueryString: { transfer_source: ["deed"] },
  });
const sale = (cid: string, date: string): Row => ({
  cid,
  ownership_transfer_date: date,
  request_identifier: "x",
  source_http_request: tcadRequest(),
});
const deed = (cid: string, date: string): Row => ({
  cid,
  ownership_transfer_date: date,
  request_identifier: "x",
  source_http_request: deedRequest(),
});

const AS_OF = "2026-10-24T18:20:49Z";
const SALE_ONLY = "baguqeeratenure01"; // sale 2020: sale_date, not long
const DEED_ONLY = "baguqeeratenure02"; // no sale, deed 2019: deed_date, not long
const DEED_LATER = "baguqeeratenure03"; // sale 2005 (long), deed 2020: deed_date, flips to not long
const SALE_LATER = "baguqeeratenure04"; // deed 2000, sale 2021: sale_date
const OLD_DEED = "baguqeeratenure05"; // deed 1998 only: deed_date and long
const EXACT_10 = "baguqeeratenure06"; // deed 2016-10-24: exactly 10 years, not long
const NONE = "baguqeeratenure07"; // no transfer: unknown, null flag

const TABLES: FixtureTables = {
  county: {
    property: [SALE_ONLY, DEED_ONLY, DEED_LATER, SALE_LATER, OLD_DEED, EXACT_10, NONE].map((p) =>
      propertyRows(p, 1990),
    ),
    property_has_sales_history: [
      edge(SALE_ONLY, "s1"),
      edge(DEED_ONLY, "d2"),
      edge(DEED_LATER, "s3"),
      edge(DEED_LATER, "d3"),
      edge(SALE_LATER, "d4"),
      edge(SALE_LATER, "s4"),
      edge(OLD_DEED, "d5"),
      edge(EXACT_10, "d6"),
    ],
    sales_history: [
      sale("s1", "2020-03-04"),
      deed("d2", "2019-07-01"),
      sale("s3", "2005-01-01"),
      deed("d3", "2020-05-05"),
      deed("d4", "2000-02-02"),
      sale("s4", "2021-06-06"),
      deed("d5", "1998-08-08"),
      deed("d6", "2016-10-24"),
    ],
  },
  property_improvement: {},
};

let fx: Fixture;
beforeAll(async () => {
  fx = await bindFixture(TABLES, (m: ManifestJson) => {
    (m as unknown as Record<string, unknown>).finishedAt = AS_OF;
    m.coverage = Object.fromEntries(
      Object.entries(m.coverage).filter(([k]) => !k.startsWith("owner_")),
    );
  });
});
afterAll(() => fx.close());

async function row(cid: string): Promise<Record<string, unknown>> {
  const [r] = await fx.rows(
    `SELECT last_ownership_transfer_date, tenure_years, tenure_basis, is_long_tenure, missing
     FROM v_property WHERE property_cid = '${cid}'`,
  );
  return r as Record<string, unknown>;
}

describe("tenure from sales and transfer deeds (ERR-71)", () => {
  it("a sale-only account keeps sale_date", async () => {
    expect(await row(SALE_ONLY)).toMatchObject({
      tenure_basis: "sale_date",
      tenure_years: 6,
      is_long_tenure: false,
    });
  });

  it("an account with only a transfer deed reads deed_date", async () => {
    expect(await row(DEED_ONLY)).toMatchObject({
      tenure_basis: "deed_date",
      tenure_years: 7,
      is_long_tenure: false,
    });
  });

  it("a deed later than the sale wins and clears the long-tenure flag", async () => {
    const r = await row(DEED_LATER);
    expect(String(r.last_ownership_transfer_date)).toContain("2020-05-05");
    expect(r).toMatchObject({ tenure_basis: "deed_date", is_long_tenure: false });
  });

  it("a sale later than the deed keeps sale_date", async () => {
    const r = await row(SALE_LATER);
    expect(String(r.last_ownership_transfer_date)).toContain("2021-06-06");
    expect(r).toMatchObject({ tenure_basis: "sale_date", is_long_tenure: false });
  });

  it("long tenure is only above 10 years", async () => {
    expect(await row(OLD_DEED)).toMatchObject({
      tenure_basis: "deed_date",
      tenure_years: 28,
      is_long_tenure: true,
    });
    expect(await row(EXACT_10)).toMatchObject({ tenure_years: 10, is_long_tenure: false });
  });

  it("with no dated transfer: unknown, null flag, reason no_dated_sale", async () => {
    const r = await row(NONE);
    expect(r).toMatchObject({ tenure_basis: "unknown", tenure_years: null, is_long_tenure: null });
    expect(r.missing).toEqual(
      expect.arrayContaining([{ field: "is_long_tenure", reason: "no_dated_sale" }]),
    );
  });
});
