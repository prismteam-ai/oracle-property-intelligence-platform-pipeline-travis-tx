// Unit tests of the pure parts of lib/a13-perf-runs.ts (TC-041 run plan; no browser, no network).
import { describe, expect, it } from "vitest";
import {
  PER_RUN_TIMEOUT_MS,
  radiusHeaderPattern,
  runFailureMessage,
  searchRadii,
  seriesBudgetMs,
} from "./a13-perf-runs.js";

describe("searchRadii", () => {
  it("gives 20 distinct radii, none of them the loaded one, so no run is a client-cache hit", () => {
    const radii = searchRadii(20, 5);
    expect(radii).toHaveLength(20);
    expect(new Set(radii).size).toBe(20);
    expect(radii).not.toContain(5);
  });
  it("keeps every radius inside 0.25..25 mi on the 0.25 step and changes each time", () => {
    const radii = searchRadii(20, 5);
    for (const r of radii) {
      expect(r).toBeGreaterThanOrEqual(0.25);
      expect(r).toBeLessThanOrEqual(25);
      expect((r * 4) % 1).toBe(0);
    }
    for (let i = 1; i < radii.length; i += 1) expect(radii[i]).not.toBe(radii[i - 1]);
  });
});

describe("radiusHeaderPattern", () => {
  it("matches the header of exactly that radius", () => {
    expect(radiusHeaderPattern(4.5).test("12 within 4.5 mi of Pflugerville")).toBe(true);
    expect(radiusHeaderPattern(4.5).test("12 within 44.5 mi of Pflugerville")).toBe(false);
    expect(radiusHeaderPattern(4.5).test("12 within 4 mi of Pflugerville")).toBe(false);
    expect(radiusHeaderPattern(5).test("1,204 within 5 mi of Austin · roof ≥ 15 yrs")).toBe(true);
    expect(radiusHeaderPattern(4.5).test("12 within 4x5 mi of Pflugerville")).toBe(false);
  });
});

describe("runFailureMessage", () => {
  it("names the series, the run index and the radius", () => {
    const text = runFailureMessage("radius + roof", 7, 20, 6.25, "header stuck");
    expect(text).toContain("radius + roof");
    expect(text).toContain("run 7 of 20");
    expect(text).toContain("6.25 mi");
    expect(text).toContain(`${PER_RUN_TIMEOUT_MS} ms`);
    expect(text).toContain("header stuck");
  });
});

describe("seriesBudgetMs", () => {
  it("fits the worst case of two series of bounded runs", () => {
    expect(seriesBudgetMs(2, 20)).toBeGreaterThanOrEqual(2 * 21 * PER_RUN_TIMEOUT_MS);
  });
});
