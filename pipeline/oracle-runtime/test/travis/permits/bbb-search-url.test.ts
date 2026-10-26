// A-11 Run 3 (ERR-66): the printed contractor name and the BBB SEARCH link. Pure functions; no
// bbb.org request is made anywhere. The URL shape is unverified until a human clicks one example.
import { describe, expect, it } from "vitest";
import {
  BBB_SEARCH_BASE,
  MAX_NAME_CHARS,
  bbbSearchUrl,
  cleanPrinted,
  isPlaceholderName,
  publishedContractorName,
} from "../../../travis/permits/bbb-search-url.js";

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe("bbbSearchUrl", () => {
  it("builds the proposed search shape from the name and the city", () => {
    expect(bbbSearchUrl("Done Right Roofing", "Austin")).toBe(
      "https://www.bbb.org/search?find_country=USA&find_text=Done%20Right%20Roofing&find_loc=Austin%2C%20TX",
    );
  });

  it("encodes ampersands, plus signs, quotes and slashes so they cannot split the query", () => {
    const url = bbbSearchUrl("A&B Roofing + Sons, Inc. (O'Neil) No. 1/2", "Round Rock") as string;
    expect(url).toContain("A%26B%20Roofing%20%2B%20Sons");
    const p = params(url);
    expect(p.get("find_text")).toBe("A&B Roofing + Sons, Inc. (O'Neil) No. 1/2");
    expect(p.get("find_loc")).toBe("Round Rock, TX");
    expect([...p.keys()]).toEqual(["find_country", "find_text", "find_loc"]);
    expect(url).not.toContain("'");
    expect(url).not.toContain("(");
    expect(url).not.toContain(" ");
  });

  it("encodes unicode as UTF-8 and round-trips it", () => {
    const url = bbbSearchUrl("Cañón Techos Ñandú", "Austin") as string;
    expect(url).toContain("Ca%C3%B1%C3%B3n");
    expect(params(url).get("find_text")).toBe("Cañón Techos Ñandú");
  });

  it("drops clerk markers from the search text", () => {
    expect(
      params(bbbSearchUrl("Sam Stewart Custom Homes, Inc***DO NOT USE***", "Austin") as string).get(
        "find_text",
      ),
    ).toBe("Sam Stewart Custom Homes, Inc");
    expect(
      params(
        bbbSearchUrl("Valdez Remodeling & Weatherization Inc.**MAIN**", "Austin") as string,
      ).get("find_text"),
    ).toBe("Valdez Remodeling & Weatherization Inc.");
    expect(bbbSearchUrl("***DO NOT USE***", "Austin")).toBeNull();
  });

  it("trims and collapses whitespace", () => {
    const url = bbbSearchUrl("  Argosy \t Roofing  \n LLC ", " Pflugerville ") as string;
    expect(params(url).get("find_text")).toBe("Argosy Roofing LLC");
    expect(params(url).get("find_loc")).toBe("Pflugerville, TX");
  });

  it("falls back to Austin when the permit prints no contractor city", () => {
    expect(params(bbbSearchUrl("Acme Roofing", null) as string).get("find_loc")).toBe("Austin, TX");
    expect(params(bbbSearchUrl("Acme Roofing", "   ") as string).get("find_loc")).toBe(
      "Austin, TX",
    );
  });

  it("cuts a very long name at a word boundary and keeps the URL bounded", () => {
    const long = Array.from({ length: 80 }, (_, i) => `Word${i}`).join(" ");
    const url = bbbSearchUrl(long, "Austin") as string;
    const text = params(url).get("find_text") as string;
    expect(Array.from(text).length).toBeLessThanOrEqual(MAX_NAME_CHARS);
    expect(long.startsWith(text)).toBe(true);
    expect(text.endsWith(" ")).toBe(false);
    expect(url.length).toBeLessThan(MAX_NAME_CHARS * 4 + 200);
    // one unbroken string longer than the cap is cut by code points, never mid surrogate pair
    const emoji = "a😀".repeat(MAX_NAME_CHARS);
    const cut = params(bbbSearchUrl(emoji, "Austin") as string).get("find_text") as string;
    expect(Array.from(cut)).toHaveLength(MAX_NAME_CHARS);
  });

  it("returns null (no link) for an empty or placeholder name", () => {
    for (const name of [
      null,
      undefined,
      "",
      "   ",
      "N/A",
      "n/a",
      "NA",
      "OWNER",
      "Owner",
      "SELF",
      "self.",
      "HOMEOWNER",
      "Owner/Builder",
      "NONE",
      "-",
      "...",
      "***",
    ]) {
      expect(bbbSearchUrl(name, "Austin")).toBeNull();
    }
  });

  it("keeps names that merely contain a placeholder word", () => {
    expect(bbbSearchUrl("Self Reliance Roofing", "Austin")).not.toBeNull();
    expect(bbbSearchUrl("Owner's Choice Roofing", "Austin")).not.toBeNull();
    expect(bbbSearchUrl("NA Roofing", "Austin")).not.toBeNull();
  });

  it("starts at the unverified BBB search page", () => {
    expect((bbbSearchUrl("Acme", "Austin") as string).startsWith(`${BBB_SEARCH_BASE}?`)).toBe(true);
  });
});

describe("cleanPrinted / isPlaceholderName", () => {
  it("cleans and classifies", () => {
    expect(cleanPrinted("  a   b ")).toBe("a b");
    expect(cleanPrinted("   ")).toBeNull();
    expect(cleanPrinted(null)).toBeNull();
    expect(isPlaceholderName("N/A")).toBe(true);
    expect(isPlaceholderName("Acme Roofing")).toBe(false);
  });
});

describe("publishedContractorName", () => {
  it("publishes the printed company name trimmed and without clerk markers", () => {
    expect(publishedContractorName("  Done Right Roofing ")).toBe("Done Right Roofing");
    expect(publishedContractorName("Acme Roofing**MAIN**")).toBe("Acme Roofing");
    expect(publishedContractorName("Sam Stewart Custom Homes, Inc***DO NOT USE***")).toBe(
      "Sam Stewart Custom Homes, Inc",
    );
    expect(publishedContractorName("A&B Roofing")).toBe("A&B Roofing");
  });

  it("is null for empty, placeholder and marker-only values", () => {
    for (const v of [undefined, null, "", "  ", "N/A", "OWNER", "self", "***DO NOT USE***", "**"])
      expect(publishedContractorName(v)).toBeNull();
  });
});
