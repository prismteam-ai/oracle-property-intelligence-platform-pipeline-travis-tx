// metagross review, Major 1: a batch that names explore.search would skip its route throttle.
import { describe, expect, it } from "vitest";
import { isBatchedExploreSearch } from "../src/handlers/trpc.js";

describe("isBatchedExploreSearch", () => {
  it("refuses explore.search inside a batch", () => {
    expect(isBatchedExploreSearch("explore.search,explore.search")).toBe(true);
    expect(isBatchedExploreSearch("runs.summary,explore.search")).toBe(true);
  });
  it("lets a single explore.search and other batches through", () => {
    expect(isBatchedExploreSearch("explore.search")).toBe(false);
    expect(isBatchedExploreSearch("runs.summary,query.radius")).toBe(false);
  });
});
