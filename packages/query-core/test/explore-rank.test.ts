// A-13 review round: the permit ranking window runs only over permits of properties inside the
// bounding box, in every statement.
import { describe, expect, it } from "vitest";
import { exploreSearchSql } from "../src/index.js";

describe("exploreSearchSql ranks only prefiltered rows", () => {
  const sql = exploreSearchSql({ centre: { lat: 30.27, lon: -97.74 }, radius_mi: 2 });
  it.each(["rows", "summary", "close"] as const)("%s: box first, perm semi-joined to it", (k) => {
    const s = sql[k];
    expect(s.indexOf("box AS")).toBeLessThan(s.indexOf("perm AS"));
    expect(s).toMatch(
      /FROM v_roofing_permit\s+WHERE property_cid IN \(SELECT property_cid FROM box\)/,
    );
  });
});
