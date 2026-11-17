import { describe, expect, it } from "vitest";
import {
  latestPublication,
  type Publication,
  publicationsBeyondRetention,
} from "../../src/domain/publication-history.js";

const publication = (buildId: string): Publication => ({
  buildId,
  publishedAt: `${buildId.slice(0, 4)}-10-27T13:05:00.000Z`,
  manifestCid: `bafkrei-manifest-${buildId}`,
  rootCid: `bafybei-root-${buildId}`,
  ipns: { name: "k51-travis-oracle", resolvedCid: `bafkrei-manifest-${buildId}` },
});

const history = ["20261025T130000Z", "20261027T130000Z", "20261026T130000Z"].map(publication);

describe("latestPublication", () => {
  it("is the publication with the newest build id", () => {
    expect(latestPublication(history)?.buildId).toBe("20261027T130000Z");
  });

  it("is absent before anything was published", () => {
    expect(latestPublication([])).toBeUndefined();
  });
});

describe("publicationsBeyondRetention", () => {
  it("keeps the newest publications and returns the older ones, oldest first", () => {
    expect(publicationsBeyondRetention(history, 2).map((entry) => entry.buildId)).toEqual([
      "20261025T130000Z",
    ]);
  });

  it("returns nothing while history fits within the retention window", () => {
    expect(publicationsBeyondRetention(history, 5)).toEqual([]);
  });
});
