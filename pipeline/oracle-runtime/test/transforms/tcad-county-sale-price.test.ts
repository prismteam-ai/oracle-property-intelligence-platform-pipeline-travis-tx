// The County transform writes sales[].salePrice as purchase_price_amount on a sale-sourced
// sales_history row when TCAD prints a positive price and the sale is not confidential.
// Deed-sourced rows and confidential or unpriced sales keep no price. Synthetic input.
import { describe, expect, it } from "vitest";
import { buildSeedRow } from "../../travis/pilot/build-seed.js";
import { parseTcadRecord } from "../../travis/transforms/shared-seed.js";
import { publishedSalePrice, transformTcadCounty } from "../../travis/transforms/tcad-county.js";
import { tcadRecord } from "../fixtures/tcad-records.js";

const CIDS = {
  seed: "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu",
  county: "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq",
  propertyImprovement: "bafkreicyzywzwhmguojpi2otgrwsyi37le3u4lnavljbxu76cnrudxaxfu",
};

type Json = Record<string, unknown>;

function run(sale: Json, deeds: Json[] = []) {
  const raw = tcadRecord({ pID: 100030, geoID: "0100030105" });
  const sales = raw.sales as Json[];
  sales[0] = { ...sales[0], ...sale };
  raw.deeds = deeds;
  const record = parseTcadRecord(raw);
  return transformTcadCounty({
    record,
    seed: buildSeedRow(record, "0100030105"),
    cids: CIDS,
    roofAge: null,
    asOf: "2026-10-22",
  });
}

const row = (files: Record<string, string>, name: string): Json =>
  JSON.parse(files[name] as string) as Json;

describe("transformTcadCounty: sale price", () => {
  it("writes the printed price of a non-confidential sale", () => {
    const out = run({ salePrice: 80001 });
    expect(row(out.files, "sales_history_1.json")).toMatchObject({
      ownership_transfer_date: "2015-07-07",
      purchase_price_amount: 80001,
    });
    expect(out.counts.sales_priced).toBe(1);
  });

  it("writes no price for a confidential sale, a zero price or a null price", () => {
    for (const sale of [
      { salePrice: 80001, confidentialSale: 1 },
      { salePrice: 80001, confidentialCode: "C" },
      { salePrice: 0 },
      { salePrice: null },
    ]) {
      const out = run(sale);
      expect(row(out.files, "sales_history_1.json")).not.toHaveProperty("purchase_price_amount");
      expect(out.counts.sales_priced).toBe(0);
    }
  });

  it("a deed-sourced row never carries a price", () => {
    const out = run({ salePrice: 80001 }, [
      { deedID: 9, deedType: "WD", deedDt: "2020-01-02 00:00:00", deedRecordedDt: null },
    ]);
    expect(row(out.files, "sales_history_1.json")).toHaveProperty("purchase_price_amount", 80001);
    expect(row(out.files, "sales_history_2.json")).not.toHaveProperty("purchase_price_amount");
  });

  it("publishedSalePrice rounds to cents and rejects non-numbers", () => {
    expect(publishedSalePrice({ salePrice: 123456.789 })).toBe(123456.79);
    expect(publishedSalePrice({ salePrice: "80001" })).toBeNull();
    expect(publishedSalePrice(undefined)).toBeNull();
  });
});
