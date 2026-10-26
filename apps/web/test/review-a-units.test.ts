// A-13 review round, fixer A: pure units (safe URLs, run numbers,
// the no-roof header; the SQL guard cases left with the SQL tab, A-16). Red before the fixes; each case names the finding it pins.
import { EXPLORE_TEXTS } from "@countylens/shared";
import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "../src/data/safe-url";

describe("safeHttpUrl (finding 2)", () => {
  it("keeps http and https URLs and drops everything else", () => {
    expect(safeHttpUrl("https://data.austintexas.gov/x")).toBe("https://data.austintexas.gov/x");
    expect(safeHttpUrl("http://example.test/a?b=1")).toBe("http://example.test/a?b=1");
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("  JavaScript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("data:text/html,<script>1</script>")).toBeUndefined();
    expect(safeHttpUrl("vbscript:x")).toBeUndefined();
    expect(safeHttpUrl("//evil.test/x")).toBeUndefined();
    expect(safeHttpUrl("/relative")).toBeUndefined();
    expect(safeHttpUrl("not a url")).toBeUndefined();
    expect(safeHttpUrl("")).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
    expect(safeHttpUrl(undefined)).toBeUndefined();
  });
});

describe("EXPLORE_TEXTS additions (findings 7, 9, 10)", () => {
  it("headerNoRoof is the header without the roof clause", () => {
    expect(EXPLORE_TEXTS.headerNoRoof(12, 5, "Austin")).toBe("12 within 5 mi of Austin");
    expect(EXPLORE_TEXTS.header(12, 5, "Austin", 20)).toBe(
      `${EXPLORE_TEXTS.headerNoRoof(12, 5, "Austin")} · roof ≥ 20 yrs`,
    );
  });
  it("has the fixed out-of-range and not-in-results sentences", () => {
    expect(EXPLORE_TEXTS.filtersOutOfRange).toBe(
      "Those filters are out of range · check radius, roof age and open years",
    );
    expect(EXPLORE_TEXTS.propertyNotInResults).toMatch(/not in these results/);
    expect(EXPLORE_TEXTS.loadMore).toBe("Load more");
  });
});
