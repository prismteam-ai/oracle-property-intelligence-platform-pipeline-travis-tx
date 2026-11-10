import { describe, expect, it } from "vitest";
import { SOURCE_CATALOG } from "../../src/domain/source-catalog.js";
import { SourceId } from "../../src/domain/source-id.js";

describe("SOURCE_CATALOG", () => {
  it("describes every ingested source with its provenance, refresh strategy and limitations", () => {
    expect(SOURCE_CATALOG.map((source) => source.id).sort()).toEqual(
      Object.values(SourceId).sort(),
    );
    for (const source of SOURCE_CATALOG) {
      expect(source.publisher).not.toBe("");
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.provides.length).toBeGreaterThan(0);
      expect(source.refresh).not.toBe("");
      expect(source.limitations.length).toBeGreaterThan(0);
    }
  });
});
