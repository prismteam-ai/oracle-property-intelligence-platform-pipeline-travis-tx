// T005 (A-13, AC-4, FR-004): `resolvePlace` over travis-places@1.0.0 gives the Explore search box
// its label, "{name_lsad} · Census {year} Gazetteer · {lat}, {lon}" (U+2212 for a negative
// coordinate), plus the point and the source stamp. Anything outside Travis is out_of_scope with
// no point. Written before src/places.ts exists: the red run fails with "Cannot find module".
import { describe, expect, it } from "vitest";
import { placeLabel, resolvePlace } from "../src/places.js";

describe("resolvePlace (travis-places@1.0.0)", () => {
  it('"Pflugerville" → "Pflugerville city · Census 2024 Gazetteer · 30.447765, −97.602116"', () => {
    const r = resolvePlace("Pflugerville");
    if (r.status !== "found") throw new Error(JSON.stringify(r));
    expect(r.label).toBe("Pflugerville city · Census 2024 Gazetteer · 30.447765, −97.602116");
    expect(r).toMatchObject({
      id: "4857176",
      name: "Pflugerville city",
      kind: "place",
      point: { lat: 30.447765, lon: -97.602116 },
    });
    expect(r.source.url).toContain("2024_Gaz_place_national.zip");
    expect(r.gazetteer.version).toBe("travis-places@1.0.0");
  });

  it("is case- and LSAD-insensitive, and resolves a ZCTA by its code", () => {
    expect(resolvePlace("pflugerville city")).toEqual(resolvePlace("Pflugerville"));
    const z = resolvePlace("78753");
    if (z.status !== "found") throw new Error(JSON.stringify(z));
    expect(z.kind).toBe("zcta");
    expect(z.id).toBe("78753");
    expect(z.label).toMatch(/^ZCTA5 78753 · Census 2024 Gazetteer · 30\.\d+, −97\.\d+$/);
  });

  it("resolves a place by its gazetteer id (the `place` URL parameter)", () => {
    expect(resolvePlace("4857176")).toEqual(resolvePlace("Pflugerville"));
  });

  it.each(["Georgetown", "", "99999"])("returns out_of_scope with no point for %j", (q) => {
    expect(resolvePlace(q)).toEqual({ status: "out_of_scope", query: q });
  });

  it("formats a label from any name and point", () => {
    expect(placeLabel("X", { lat: 30.1, lon: -97.5 }, "2024")).toBe(
      "X · Census 2024 Gazetteer · 30.1, −97.5",
    );
  });
});

describe("searchPlaces (A-13 follow-up: suggestions while typing)", () => {
  it('"Pflug" → Pflugerville first, with the resolvePlace label', async () => {
    const { searchPlaces } = await import("../src/places.js");
    const found = searchPlaces("Pflug", 5);
    expect(found[0]?.label).toBe(
      "Pflugerville city · Census 2024 Gazetteer · 30.447765, −97.602116",
    );
    expect(found[0]).toEqual(resolvePlace("Pflugerville"));
    expect(found.length).toBeLessThanOrEqual(5);
  });

  it("matches case-insensitively, an exact ZIP, and nothing for empty or unknown text", async () => {
    const { searchPlaces } = await import("../src/places.js");
    expect(searchPlaces("pFLUG", 3)[0]?.name).toBe("Pflugerville city");
    expect(searchPlaces("78753", 3)[0]).toEqual(resolvePlace("78753"));
    expect(searchPlaces("", 5)).toEqual([]);
    expect(searchPlaces("Zzzz", 5)).toEqual([]);
  });

  it("is exported from the gazetteer subpath and the barrel", async () => {
    const g = await import("../gazetteer/travis-places@1.0.0/index.js");
    const barrel = await import("../src/index.js");
    expect(typeof g.searchPlaces).toBe("function");
    expect(g.searchPlaces("Pflug", 1)[0]?.name).toBe("Pflugerville city");
    expect(typeof barrel.searchPlaces).toBe("function");
  });
});
