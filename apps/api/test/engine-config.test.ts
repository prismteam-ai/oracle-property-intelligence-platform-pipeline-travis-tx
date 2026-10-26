import { describe, expect, it } from "vitest";

import { loadEngineConfig } from "../src/engine/engine-config.js";

const base = { CID_COPY_BUCKET: "bucket", READPATH_PRIVATE_PREFIX: "private/bench/" };

describe("EXPLORE_INDEX_PREFIX (A-16 AC-13, views-version folder)", () => {
  it("accepts the index root and one views-version folder", () => {
    for (const prefix of ["private/explore-index/", "private/explore-index/v1.2/"])
      expect(loadEngineConfig({ ...base, EXPLORE_INDEX_PREFIX: prefix }).exploreIndexPrefix).toBe(
        prefix,
      );
  });

  it("refuses anything deeper, unversioned or outside private/", () => {
    for (const prefix of [
      "private/explore-index/v1.2/x/",
      "private/explore-index/1.2/",
      "ipfs/",
      "private/a/b/",
    ])
      expect(() => loadEngineConfig({ ...base, EXPLORE_INDEX_PREFIX: prefix }), prefix).toThrow(
        /EXPLORE_INDEX_PREFIX/,
      );
  });

  it("unset or empty means no index", () => {
    expect(loadEngineConfig(base).exploreIndexPrefix).toBeUndefined();
    expect(
      loadEngineConfig({ ...base, EXPLORE_INDEX_PREFIX: "" }).exploreIndexPrefix,
    ).toBeUndefined();
  });
});
