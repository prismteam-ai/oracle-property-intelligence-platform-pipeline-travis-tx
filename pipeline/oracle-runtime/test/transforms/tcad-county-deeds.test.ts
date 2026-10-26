// A-11 Run 3 (ERR-71): the County transform writes sales_history rows for allow-listed transfer
// deeds as well as sales, one per day, and links the current owner to the latest. Synthetic input.
import { describe, expect, it } from "vitest";
import { buildSeedRow } from "../../travis/pilot/build-seed.js";
import { TCAD_EXPORT_REQUEST, parseTcadRecord } from "../../travis/transforms/shared-seed.js";
import { transformTcadCounty } from "../../travis/transforms/tcad-county.js";
import { tcadRecord } from "../fixtures/tcad-records.js";

const CIDS = {
  seed: "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu",
  county: "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq",
  propertyImprovement: "bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu",
};

type Json = Record<string, unknown>;
const parse = (files: Record<string, string>, name: string): Json =>
  JSON.parse(files[name] as string) as Json;

const deed = (deedID: number, deedType: string, deedDt: string | null): Json => ({
  deedID,
  deedType,
  deedDt,
  deedRecordedDt: null,
  sellerLine: "SELLER",
  buyerLine: "BUYER",
});

function run(
  saleDt: string | null,
  deeds: Json[] | null | undefined,
  asOf: string | undefined = "2026-10-22",
) {
  const raw = tcadRecord({ pID: 100020, geoID: "0100030105", saleDt });
  if (deeds !== undefined) raw.deeds = deeds;
  const record = parseTcadRecord(raw);
  return transformTcadCounty({
    record,
    seed: buildSeedRow(record, "0100030105"),
    cids: CIDS,
    roofAge: null,
    ...(asOf !== undefined ? { asOf } : {}),
  });
}

const historyFiles = (files: Record<string, string>): string[] =>
  Object.keys(files)
    .filter((n) => /^sales_history_\d+\.json$/.test(n))
    .sort((a, b) => parseInt(a.slice(14), 10) - parseInt(b.slice(14), 10));

describe("transformTcadCounty: transfer deeds as dated transfers (ERR-71)", () => {
  it("an account with no sale gets a sales_history row from its transfer deed", () => {
    const out = run(null, [deed(1, "WD", "2019-07-01 00:00:00")]);
    expect(historyFiles(out.files)).toEqual(["sales_history_1.json"]);
    expect(parse(out.files, "sales_history_1.json")).toMatchObject({
      ownership_transfer_date: "2019-07-01",
      request_identifier: "100020",
      source_http_request: {
        method: "GET",
        url: TCAD_EXPORT_REQUEST.url,
        multiValueQueryString: { transfer_source: ["deed"] },
      },
    });
    expect(parse(out.files, "relationship_sales_history_has_company_1.json")).toEqual({
      from: { "/": "./sales_history_1.json" },
      to: { "/": "./company_1.json" },
    });
    expect(out.counts).toMatchObject({
      owner: "company",
      sales_dated: 1,
      transfers_from_deeds: 1,
    });
  });

  it("a sale row keeps the plain TCAD request; the owner links to the latest transfer", () => {
    const out = run("2015-07-07 00:00:00", [deed(2, "QD", "2021-01-02 00:00:00")]);
    expect(historyFiles(out.files)).toEqual(["sales_history_1.json", "sales_history_2.json"]);
    const sale = parse(out.files, "sales_history_1.json");
    expect(sale).toMatchObject({ ownership_transfer_date: "2015-07-07" });
    expect(sale.source_http_request).toEqual({ ...TCAD_EXPORT_REQUEST });
    expect(parse(out.files, "sales_history_2.json")).toMatchObject({
      ownership_transfer_date: "2021-01-02",
    });
    expect(parse(out.files, "relationship_sales_history_has_company_1.json")).toMatchObject({
      from: { "/": "./sales_history_2.json" },
    });
    // The County root links every history row.
    const root = parse(out.files, `${CIDS.county}.json`) as {
      relationships: Record<string, unknown[]>;
    };
    expect(root.relationships.property_has_sales_history).toHaveLength(2);
  });

  it("a deed on the day of a sale adds no row; a non-transfer deed adds none", () => {
    const out = run("2015-07-07 00:00:00", [
      deed(2, "WD", "2015-07-07 00:00:00"),
      deed(3, "L", "2023-01-01 00:00:00"),
      deed(4, "AH", "2024-01-01 00:00:00"),
    ]);
    expect(historyFiles(out.files)).toEqual(["sales_history_1.json"]);
    expect(out.counts).toMatchObject({ sales_dated: 1, transfers_from_deeds: 0 });
  });

  it("drops a deed after as_of and a deed with no usable date", () => {
    const out = run(null, [deed(1, "WD", "2026-12-01"), deed(2, "WD", null), deed(3, "WD", "bad")]);
    expect(historyFiles(out.files)).toEqual([]);
    expect(out.counts.owner).toBe("no_dated_sale");
  });

  it("an absent, null or empty deeds array changes nothing", () => {
    const base = run("2015-07-07 00:00:00", undefined);
    for (const deeds of [null, []]) {
      expect(run("2015-07-07 00:00:00", deeds).files).toEqual(base.files);
    }
  });

  it("is deterministic: the same record twice, and deeds in any order, give the same files", () => {
    const deeds = [
      deed(1, "WD", "2001-01-01"),
      deed(2, "SW", "2012-02-02"),
      deed(3, "GD", "2008-03-03"),
    ];
    const a = run("2005-05-05", deeds);
    expect(run("2005-05-05", deeds).files).toEqual(a.files);
    expect(run("2005-05-05", [...deeds].reverse()).files).toEqual(a.files);
    expect(historyFiles(a.files)).toHaveLength(4);
  });

  it("a confidential owner still writes dates only and no party", () => {
    const raw = tcadRecord({ pID: 100021, geoID: "0100030105", saleDt: null });
    (raw.owners as Json[])[0] = { ...(raw.owners as Json[])[0], confidentialCode: "Y" };
    raw.deeds = [deed(1, "WD", "2019-07-01")];
    const record = parseTcadRecord(raw);
    const out = transformTcadCounty({
      record,
      seed: buildSeedRow(record, "0100030105"),
      cids: CIDS,
      roofAge: null,
      asOf: "2026-10-22",
    });
    expect(out.counts.owner).toBe("suppressed");
    expect(Object.keys(out.files).some((n) => /^(person|company|mailing_address)_/.test(n))).toBe(
      false,
    );
  });
});
