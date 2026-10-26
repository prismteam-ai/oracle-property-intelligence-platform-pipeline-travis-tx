// A-11 Run 3 (ERR-71): tenure from the later of the latest sale and the latest allow-listed
// transfer deed. Synthetic input, no real owner or parcel.
import { describe, expect, it } from "vitest";
import { TRANSFER_DEED_TYPES, tenureOf, transferEventsOf } from "../../../travis/tcad/tenure.js";

const AS_OF = "2026-10-22";
const deed = (deedID: number, deedType: string | null, deedDt: string | null, rec?: string) => ({
  deedID,
  deedType,
  deedDt,
  deedRecordedDt: rec ?? null,
});

describe("transfer deed allow-list", () => {
  it("allows only deeds that convey ownership to the buyer", () => {
    expect([...TRANSFER_DEED_TYPES.keys()].sort()).toEqual(["ED", "GD", "QD", "SW", "TD", "WD"]);
  });

  it.each(["L", "AH", "LT", "CD", "MS", "DC", "AD", "GF", "RO", "AM", "xx", "", null])(
    "ignores deed type %s",
    (type) => {
      expect(transferEventsOf([], [deed(1, type, "2020-01-01")], AS_OF)).toEqual([]);
    },
  );

  it("matches the type case-insensitively and ignores padding", () => {
    expect(transferEventsOf([], [deed(1, " wd ", "2020-01-01")], AS_OF)).toHaveLength(1);
  });
});

describe("transferEventsOf", () => {
  it("merges sales and deeds, oldest first, one per day, a sale beating a deed", () => {
    const ev = transferEventsOf(
      [{ saleID: 7, saleDt: "2010-05-05 00:00:00" }],
      [
        deed(30, "WD", "2018-03-04 00:00:00"),
        deed(10, "QD", "2010-05-05 00:00:00"),
        deed(20, "WD", "2018-03-04 00:00:00"),
        deed(5, "WD", "2001-02-03 00:00:00"),
      ],
      AS_OF,
    );
    expect(ev).toEqual([
      { date: "2001-02-03", source: "deed", deedType: "WD", id: 5 },
      { date: "2010-05-05", source: "sale", deedType: null, id: 7 },
      { date: "2018-03-04", source: "deed", deedType: "WD", id: 20 },
    ]);
  });

  it("is stable whatever order the export prints the arrays in", () => {
    const sales = [{ saleID: 1, saleDt: "2005-01-01" }];
    const deeds = [deed(3, "SW", "2015-06-06"), deed(2, "GD", "2012-02-02")];
    expect(transferEventsOf(sales, deeds, AS_OF)).toEqual(
      transferEventsOf(sales, [...deeds].reverse(), AS_OF),
    );
  });

  it("drops dates after as_of, before 1900 and impossible calendar dates", () => {
    const ev = transferEventsOf(
      [{ saleID: 1, saleDt: "2026-10-23 00:00:00" }],
      [
        deed(1, "WD", "2027-01-01"),
        deed(2, "WD", "1899-12-31"),
        deed(3, "WD", "2019-02-30"),
        deed(4, "WD", "not a date"),
        deed(5, "WD", "2026-10-22"),
      ],
      AS_OF,
    );
    expect(ev.map((e) => e.date)).toEqual(["2026-10-22"]);
  });

  it("falls back to the recording date only when the deed date is missing or invalid", () => {
    const ev = transferEventsOf(
      [],
      [deed(1, "WD", null, "2000-04-05"), deed(2, "WD", "1990-01-01", "1990-02-02")],
      AS_OF,
    );
    expect(ev.map((e) => e.date)).toEqual(["1990-01-01", "2000-04-05"]);
  });

  it("with no upper bound keeps a future date (shape tests only)", () => {
    expect(transferEventsOf([], [deed(1, "WD", "2999-01-01")], null)).toHaveLength(1);
  });
});

describe("tenureOf with deeds (ERR-71)", () => {
  it("no sale but a transfer deed → deed_date basis, tenure from the deed", () => {
    const t = tenureOf([], AS_OF, [deed(1, "WD", "2019-07-01 00:00:00")]);
    expect(t).toMatchObject({
      last_ownership_transfer_date: "2019-07-01",
      tenure_basis: "deed_date",
      tenure_missing_reason: null,
      is_long_tenure: false,
    });
    expect(t.tenure_years).toBeCloseTo(7.31, 1);
  });

  it("a deed later than the sale wins and can clear the long-tenure flag", () => {
    const sales = [{ saleDt: "2005-01-01 00:00:00" }];
    expect(tenureOf(sales, AS_OF).is_long_tenure).toBe(true);
    const t = tenureOf(sales, AS_OF, [deed(1, "SW", "2020-05-05")]);
    expect(t).toMatchObject({ tenure_basis: "deed_date", is_long_tenure: false });
  });

  it("a sale later than every deed keeps the sale_date basis", () => {
    const t = tenureOf([{ saleDt: "2021-01-01" }], AS_OF, [deed(1, "WD", "2000-01-01")]);
    expect(t).toMatchObject({
      tenure_basis: "sale_date",
      last_ownership_transfer_date: "2021-01-01",
    });
  });

  it("a sale and a deed on the same day read sale_date", () => {
    const t = tenureOf([{ saleDt: "2015-03-03" }], AS_OF, [deed(1, "WD", "2015-03-03")]);
    expect(t.tenure_basis).toBe("sale_date");
  });

  it("is long only above 10 years: exactly 10 years is not long", () => {
    expect(tenureOf([], "2026-10-22", [deed(1, "WD", "2016-10-22")]).is_long_tenure).toBe(false);
    expect(tenureOf([], "2026-10-22", [deed(1, "WD", "2015-10-01")]).is_long_tenure).toBe(true);
  });

  it("only non-transfer deeds → still unknown with the no_dated_sale reason", () => {
    expect(tenureOf([], AS_OF, [deed(1, "L", "2020-01-01"), deed(2, "AH", "2021-01-01")])).toEqual({
      last_ownership_transfer_date: null,
      tenure_years: null,
      tenure_basis: "unknown",
      tenure_missing_reason: "no_dated_sale",
      is_long_tenure: null,
    });
  });
});
