import { describe, expect, it } from "vitest";
import { Db } from "../src/core/db.js";
import { nameKey, nameKeySql } from "../src/model/names.js";

const variants: [string, string][] = [
  ["ABC Roofing, LLC", "ABC ROOFING"],
  ["ABC ROOFING INC.", "ABC ROOFING"],
  ["The ABC Roofing Co", "ABC ROOFING"],
  ["Lone Star Roofing of Texas LTD", "LONE STAR ROOFING"],
  ["Smith Construction dba Smith Roofing", "SMITH CONSTRUCTION"],
];

describe("contractor name key", () => {
  it.each(variants)("%s -> %s", (input, expected) => {
    expect(nameKey(input)).toBe(expected);
  });

  it("SQL and TS normalizers agree", async () => {
    const db = await Db.open(":memory:", { extensions: [] });
    for (const [input] of variants) {
      const row = await db.one<{ k: string }>(`SELECT ${nameKeySql("?::VARCHAR")} AS k`, [input]);
      expect(row?.k).toBe(nameKey(input));
    }
    db.close();
  });
});
