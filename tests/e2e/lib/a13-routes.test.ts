// Unit tests of lib/a13-routes.ts against the committed route list and Coming soon content (no network).
import { describe, expect, it } from "vitest";
import { comingSoonItems, median, routeTargets } from "./a13-routes.js";

describe("Coming soon items", () => {
  it("lists the PO's items with one sentence each and exactly one unlinked item", () => {
    const items = comingSoonItems();
    // 10 since A-16: "SQL checks" was removed with the SQL tab (PO decision).
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items.filter((i) => !i.linked).map((i) => i.id)).toEqual(["ai-user-sign-in"]);
    for (const item of items) expect(item.sentence).toMatch(/^[^.!?]+[.!?]$/);
  });
});

describe("route targets", () => {
  it("expands the templates and keeps the other-county catch-all out", () => {
    const targets = routeTargets("bafkreitest");
    const paths = targets.map((t) => t.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/runs/compare?a=1&b=1");
    expect(paths).toContain("/data/verify/bafkreitest");
    expect(paths).toContain("/tx/travis/explore");
    expect(paths.some((p) => p.includes("mode=sql"))).toBe(false);
    expect(paths).toContain("/permits");
    expect(paths.filter((p) => p.startsWith("/soon/")).length).toBe(
      comingSoonItems().filter((i) => i.linked).length,
    );
    expect(paths.some((p) => p.includes("*") || p.includes(":"))).toBe(false);
  });

  it("refuses a route it cannot map", () => {
    expect(() => routeTargets("bafk", "path: ROUTES.nowhere", [])).toThrow(
      /not in @countylens\/shared/,
    );
  });
});

describe("median", () => {
  it("takes the middle value, or the mean of the middle two", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow(RangeError);
  });
});
