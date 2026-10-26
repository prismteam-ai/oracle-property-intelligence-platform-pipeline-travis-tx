// T005a (A-14, agent-design.md § 3, analyze finding F1): geocodePlace() built directly on
// gazetteer.lookup() (travis-places@1.0.0) — no A-13 dependency. Matching is exact only (the
// gazetteer's own case-insensitive/LSAD-optional/ZIP rules); a misspelling or anything outside
// Travis County is out_of_scope, never a guessed point.
import { describe, expect, it } from "vitest";
import { geocodePlace } from "../src/tools/functions.js";

describe("geocodePlace", () => {
  it('Pflugerville -> "Pflugerville city · Census 2024 Gazetteer · 30.447765, -97.602116"', () => {
    const result = geocodePlace({ query: "Pflugerville" });
    expect(result.status).toBe("found");
    if (result.status !== "found") throw new Error("expected found");
    expect(result.label).toBe("Pflugerville city · Census 2024 Gazetteer · 30.447765, -97.602116");
    expect(result.point).toEqual({ lat: 30.447765, lon: -97.602116 });
    expect(result.kind).toBe("place");
  });

  it("Round Rock -> partial_in_travis: true", () => {
    const result = geocodePlace({ query: "Round Rock" });
    expect(result.status).toBe("found");
    if (result.status !== "found") throw new Error("expected found");
    expect(result.partial_in_travis).toBe(true);
    expect(result.counties.length).toBeGreaterThan(0);
  });

  it("ZIP 99999 -> out_of_scope", () => {
    const result = geocodePlace({ query: "ZIP 99999" });
    expect(result).toEqual({ status: "out_of_scope", query: "ZIP 99999" });
  });

  it("a 5-digit ZIP alone (no ZIP prefix) resolves the same way", () => {
    const withPrefix = geocodePlace({ query: "ZIP 78753" });
    const bare = geocodePlace({ query: "78753" });
    expect(bare).toEqual(withPrefix);
  });

  it("every found result carries a source stamp and the gazetteer digest (citable, FR-002)", () => {
    const result = geocodePlace({ query: "Pflugerville" });
    if (result.status !== "found") throw new Error("expected found");
    expect(result.source.url).toMatch(/^https:\/\/www2\.census\.gov\//);
    expect(result.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.gazetteer.version).toBe("travis-places@1.0.0");
  });
});
