// catalog-text.ts: runtime text is mapped into the writer's safe character set.
import { describe, expect, it } from "vitest";
import { catalogSafe, catalogText } from "../travis/discovery/catalog-text.js";
import { emitCatalogYaml } from "../travis/discovery/write-catalog.js";
import { syntheticCatalog } from "./fixtures/synthetic-catalog.js";

describe("catalogText", () => {
  it("turns a quoted challenge title into single quotes (live run travis-2)", () => {
    expect(catalogText('title: "Attention Required! | Cloudflare"')).toBe(
      "title: 'Attention Required! | Cloudflare'",
    );
  });

  it("replaces backslashes and collapses each control-character run to one space", () => {
    expect(catalogText("a\\b\r\n\tc\u0000d\u007fe")).toBe("a/b c d e");
  });

  it("leaves safe text unchanged", () => {
    const safe = "blocked: HTTP 403 at 2026-10-19T21:09:16.263Z; see https://x.test/a?b=1#c";
    expect(catalogText(safe)).toBe(safe);
  });
});

describe("catalogSafe", () => {
  it("sanitizes every string value, keeps keys and non-strings, and does not mutate the input", () => {
    const input = { a: 'x"y', n: 3, b: true, z: null, list: [{ s: "p\\q" }, "l\nm"] };
    const out = catalogSafe(input);
    expect(out).toEqual({ a: "x'y", n: 3, b: true, z: null, list: [{ s: "p/q" }, "l m"] });
    expect(input.a).toBe('x"y');
  });

  it("a catalog with unsafe runtime text emits after catalogSafe; the writer still refuses it raw", () => {
    const catalog = syntheticCatalog();
    const first = catalog.sources[0];
    if (!first) throw new Error("synthetic catalog has no sources");
    first.anti_bot = 'challenge: seen (HTTP 403; title: "Just a moment...")';
    expect(() => emitCatalogYaml(catalog)).toThrow(/quote, backslash or control character/);
    expect(emitCatalogYaml(catalogSafe(catalog))).toContain("title: 'Just a moment...'");
  });
});
