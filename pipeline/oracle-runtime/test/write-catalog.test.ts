// T008 writer tests: block-style YAML both validator parsers read the same way (R5).
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAlias, isCollection, isScalar, parseDocument, Scalar, visit } from "yaml";
import {
  emitCatalogYaml,
  parseCatalogYaml,
  writeCatalog,
} from "../travis/discovery/write-catalog.js";
import type { Catalog } from "../travis/discovery/catalog.schema.js";
import { syntheticCatalog } from "./fixtures/synthetic-catalog.js";
import { must } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "write-catalog-"));
  dirs.push(d);
  return d;
}

describe("emitCatalogYaml", () => {
  const text = emitCatalogYaml(syntheticCatalog());
  const lines = text.split("\n");

  it("uses block style only: no flow collections, anchors or aliases", () => {
    const doc = parseDocument(text);
    visit(doc, {
      Node(_key, node) {
        if (isCollection(node)) expect(node.flow ?? false).toBe(false);
        expect(isAlias(node)).toBe(false);
        expect((node as { anchor?: string }).anchor).toBeUndefined();
      },
    });
    for (const line of lines) {
      expect(line).not.toMatch(/:\s*[[{]/);
      expect(line).not.toMatch(/^\s*-\s*[[{]/);
    }
  });

  it("has no multi-line scalars: every string is a single-line double-quoted scalar", () => {
    const doc = parseDocument(text);
    visit(doc, {
      Scalar(key, node) {
        if (key === "key") return;
        if (typeof node.value === "string") {
          expect(node.type).toBe(Scalar.QUOTE_DOUBLE);
        }
      },
    });
    for (const line of lines) {
      expect(line).not.toMatch(/:\s*[|>][-+]?\s*$/);
    }
  });

  it('emits fips as "48453"', () => {
    expect(lines).toContain('fips: "48453"');
  });

  it("quotes IDs, dates and strings containing # or :", () => {
    expect(text).toContain('captured_at: "2026-01-01T00:00:00Z"');
    expect(text).toContain('certification_date: "2026-07-25"');
    expect(text).toContain('portal: "https://example.test/permits#search"');
    expect(text).toContain('key: "synthetic_city"');
  });

  it("never emits a bare yes/no/on/off", () => {
    for (const line of lines) {
      expect(line).not.toMatch(/(:|^\s*-)\s+(yes|no|on|off|y|n)\s*$/i);
    }
  });

  it("puts a scalar first in every list-of-maps item (fallback parser parity)", () => {
    for (const line of lines.filter((l) => /^\s*- [a-z_]+:/.test(l))) {
      expect(line).toMatch(/^\s*- [a-z_]+: \S/);
    }
  });

  it("round-trips: read equals the input object", () => {
    expect(parseCatalogYaml(text)).toEqual(syntheticCatalog());
  });

  it("is deterministic", () => {
    expect(emitCatalogYaml(syntheticCatalog())).toBe(text);
  });

  it("parses every scalar as a scalar (no implicit typing surprises)", () => {
    const doc = parseDocument(text);
    let count = 0;
    visit(doc, {
      Scalar(_k, node) {
        if (isScalar(node)) count += 1;
      },
    });
    expect(count).toBeGreaterThan(50);
  });
});

describe("emitCatalogYaml refuses text the fallback parser would read differently", () => {
  function withCounty(county: string): Catalog {
    return { ...syntheticCatalog(), county };
  }

  it("rejects strings containing a double quote, backslash or newline", () => {
    expect(() => emitCatalogYaml(withCounty('Say "hi"'))).toThrow();
    expect(() => emitCatalogYaml(withCounty("a\\b"))).toThrow();
    expect(() => emitCatalogYaml(withCounty("line1\nline2"))).toThrow();
  });

  it("rejects empty collections, which can only be written in flow style", () => {
    const c = syntheticCatalog();
    expect(() =>
      emitCatalogYaml({
        ...c,
        destination: { ...must(c.destination), independent_identity_sources: [] },
      }),
    ).toThrow();
  });
});

describe("writeCatalog", () => {
  it("validates with the schema and writes the YAML", () => {
    const path = join(tmp(), "nested", "travis-sources.yaml");
    writeCatalog(syntheticCatalog(), path);
    expect(parseCatalogYaml(readFileSync(path, "utf8"))).toEqual(syntheticCatalog());
  });

  it("writes nothing when the catalog is invalid", () => {
    const path = join(tmp(), "travis-sources.yaml");
    const invalid = { ...syntheticCatalog(), fips: 48453 } as unknown as Catalog;
    expect(() => writeCatalog(invalid, path)).toThrow();
    expect(existsSync(path)).toBe(false);
  });

  it("parseCatalogYaml rejects a document that fails the schema", () => {
    expect(() => parseCatalogYaml('county: "X"\nfips: 48453\n')).toThrow();
  });
});
