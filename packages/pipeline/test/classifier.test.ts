import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db } from "../src/core/db.js";
import { roofingClassifierSql } from "../src/sources/austin-permits.js";

const cases: [string, string, string, string | null][] = [
  ["BP", "Repair", "Express- Replace roof with same style and color shingles", "roof_replacement"],
  [
    "BP",
    "Repair",
    "Express: Full residential roof replacement within WUI area. Removing old covering and installing new covering",
    "roof_replacement",
  ],
  [
    "BP",
    "Remodel",
    "Re-roof: roof replacement replace 25000 SQ with TPO 10000 SQ metal panels.",
    "roof_replacement",
  ],
  [
    "BP",
    "Remodel",
    "Remove and replace shingles on existing roof shingle replacement only.",
    "roof_replacement",
  ],
  [
    "BP",
    "Remodel",
    "Full tear-off of existing roofing to structural deck (like-for-like reroof).",
    "roof_replacement",
  ],
  [
    "BP",
    "Repair",
    "Express- roof shingles windows same size/function siding/trim repair",
    "roof_work",
  ],
  [
    "EP",
    "Auxiliary Power",
    "Install new 9.57kw rooftop solar system for existing residential only.",
    null,
  ],
  [
    "EP",
    "Repair",
    "Express: drywall repair siding repair roofing repair kitchen/bathroom plumbing",
    null,
  ],
  [
    "BP",
    "New",
    "2104 Wilson St: New 3-story SF Res [3bed 2.5bath] with attached garage and rooftop deck",
    null,
  ],
  ["BP", "Roof", "anything", "work_class_roof"],
  ["BP", "Remodel", "Restroom remodel with new window openings and new roof top skylights", null],
  ["BP", "Remodel", "Replace rooftop unit and ductwork", null],
];

let db: Db;
beforeAll(async () => {
  db = await Db.open(":memory:", { extensions: [] });
});
afterAll(() => db.close());

describe("roofing permit classifier", () => {
  it.each(cases)("%s/%s %s -> %s", async (permitType, workClass, desc, expected) => {
    const c = roofingClassifierSql("d", "t", "w");
    const row = await db.one<{ m: string | null; r: boolean }>(
      `SELECT ${c.match} AS m, ${c.isRoofing} AS r FROM (SELECT ?::VARCHAR AS d, ?::VARCHAR AS t, ?::VARCHAR AS w)`,
      [desc, permitType, workClass],
    );
    expect(row?.m ?? null).toBe(expected);
    expect(row?.r).toBe(expected !== null);
  });
});
