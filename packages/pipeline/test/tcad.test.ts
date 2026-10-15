import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Db } from "../src/core/db.js";
import {
  IMP_ATR_FIELDS,
  IMP_DET_FIELDS,
  PROP_FIELDS,
  stageTcadExport,
} from "../src/sources/tcad-roll.js";

function line(fields: Record<string, [number, number]>, values: Record<string, string>): string {
  const width = Math.max(...Object.values(fields).map(([s, l]) => s + l - 1));
  const buf = Array(width).fill(" ");
  for (const [k, v] of Object.entries(values)) {
    const f = fields[k];
    if (!f) throw new Error(k);
    const [start, len] = f;
    v.slice(0, len)
      .padEnd(len, " ")
      .split("")
      .forEach((ch, i) => (buf[start - 1 + i] = ch));
  }
  return buf.join("");
}

describe("TCAD fixed-width export (True Prodigy 8.0.x layout)", () => {
  it("parses property, improvement year built and roof attributes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tcad-"));
    await writeFile(
      path.join(dir, "2026-07-25_000001_APPRAISAL_INFO.TXT"),
      [
        line(PROP_FIELDS, {
          prop_id: "000000101570",
          prop_type_cd: "R",
          prop_val_yr: "2026",
          geo_id: "0202210401",
          py_owner_name: "BOLM OWNER LLC",
          py_addr_line1: "711 NAVARRO ST STE 400",
          py_addr_city: "SAN ANTONIO",
          py_addr_state: "TX",
          py_addr_zip: "78205",
          situs_street: "ED BLUESTEIN",
          situs_street_suffix: "BLVD",
          situs_zip: "78723",
          deed_dt: "2004-06-15 00:00:00.000",
          deed_book_id: "2004101",
        }),
        line(PROP_FIELDS, {
          prop_id: "000000200000",
          prop_type_cd: "R",
          prop_val_yr: "2026",
          deed_dt: "03/09/1998",
        }),
        line(PROP_FIELDS, {
          prop_id: "000000300000",
          prop_type_cd: "R",
          prop_val_yr: "02026",
          deed_dt: "12-31-2013",
        }),
      ].join("\r\n") + "\r\n",
    );
    await writeFile(
      path.join(dir, "2026-07-25_000001_APPRAISAL_IMPROVEMENT_DETAIL.TXT"),
      [
        line(IMP_DET_FIELDS, {
          prop_id: "000000101570",
          prop_val_yr: "2026",
          imprv_id: "1",
          imprv_det_id: "1",
          imprv_det_type_cd: "1ST",
          imprv_det_type_desc: "1st Floor",
          yr_built: "1987",
        }),
        line(IMP_DET_FIELDS, {
          prop_id: "000000101570",
          prop_val_yr: "2026",
          imprv_id: "1",
          imprv_det_id: "3",
          imprv_det_type_cd: "551",
          imprv_det_type_desc: "PAVED AREA",
          yr_built: "1980",
        }),
        line(IMP_DET_FIELDS, {
          prop_id: "000000101570",
          prop_val_yr: "2026",
          imprv_id: "1",
          imprv_det_id: "2",
          imprv_det_type_cd: "2ND",
          imprv_det_type_desc: "2nd Floor",
          yr_built: "2005",
        }),
      ].join("\n"),
    );
    await writeFile(
      path.join(dir, "2026-07-25_000001_APPRAISAL_IMPROVEMENT_DETAIL_ATTR.TXT"),
      [
        line(IMP_ATR_FIELDS, {
          prop_id: "000000101570",
          imprv_attr_desc: "Roof Covering",
          imprv_attr_cd: "COMP",
        }),
        line(IMP_ATR_FIELDS, {
          prop_id: "000000101570",
          imprv_attr_desc: "Foundation",
          imprv_attr_cd: "SLAB",
        }),
      ].join("\n"),
    );
    const db = await Db.open(":memory:", { extensions: [] });
    const files = await stageTcadExport(db, dir);
    expect(files.impDet).toBeTruthy();
    const prop = await db.all(
      `SELECT prop_id, geo_id, py_owner_name, py_addr_state, situs_street, deed_dt FROM _tcad_prop ORDER BY prop_id`,
    );
    expect(prop[0]).toMatchObject({
      prop_id: "000000101570",
      geo_id: "0202210401",
      py_owner_name: "BOLM OWNER LLC",
      py_addr_state: "TX",
      situs_street: "ED BLUESTEIN",
    });
    const imp = await db.one(
      `SELECT year_built, latest_improvement_year FROM _tcad_imp WHERE prop_id = '000000101570'`,
    );
    expect(imp).toEqual({ year_built: 1987, latest_improvement_year: 2005 });
    const roof = await db.one<{ roof_attributes: string[] }>(
      `SELECT roof_attributes FROM _tcad_roof`,
    );
    expect(roof?.roof_attributes).toEqual(["Roof Covering: COMP"]);
    const { deedDateSql } = await import("../src/sources/tcad-roll.js");
    const dates = await db.all(
      `SELECT ${deedDateSql("deed_dt")} AS d FROM _tcad_prop ORDER BY prop_id`,
    );
    expect(dates.map((r) => r.d)).toEqual(["2004-06-15", "1998-03-09", "2013-12-31"]);
    const { plausibleDeedDateSql } = await import("../src/sources/tcad-roll.js");
    const bounded = await db.all(
      `SELECT ${plausibleDeedDateSql("d")} AS d FROM (VALUES ('04-22-0021'), ('07-05-2202'), ('12-31-2013')) t(d)`,
    );
    expect(bounded.map((r) => r.d)).toEqual([null, null, "2013-12-31"]);
    db.close();
  });
});
