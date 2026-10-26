// A-07 T012 (Track A): the crosswalk negative-finding (D-10, research.md) must still prove the
// `resolved` code path exists, through a labelled fixture index — never a live match this run
// (FR-002's fixture-fallback clause). Must fail before T015 (travis/identity/crosswalk.ts) lands.
import { describe, expect, it } from "vitest";
import {
  CROSSWALK_NEGATIVE_FINDING,
  LIVE_CROSSWALK,
  buildCrosswalkIndex,
} from "../../../../travis/identity/crosswalk.js";
import { resolveContractor } from "../../../../travis/identity/resolver.js";

describe("CROSSWALK_NEGATIVE_FINDING (D-10)", () => {
  it("records that no identifier crosswalk exists between the Austin permit dataset and the Comptroller", () => {
    expect(CROSSWALK_NEGATIVE_FINDING.foundCrosswalk).toBe(false);
    expect(CROSSWALK_NEGATIVE_FINDING.dataset).toBe("3syk-w9eu");
    expect(CROSSWALK_NEGATIVE_FINDING.citation.length).toBeGreaterThan(0);
  });

  it("the live crosswalk used in production is empty, matching the negative finding", () => {
    expect(LIVE_CROSSWALK.size).toBe(0);
  });
});

describe("the resolved code path, proven on a labelled fixture (never a live match)", () => {
  it("a fixture crosswalk entry resolves a permit even though 0 live matches exist", () => {
    const fixtureCrosswalk = buildCrosswalkIndex([
      { permitKey: "2026-999999 BP", taxpayerNumber: "32011111111" },
    ]);
    const row = resolveContractor({
      permitKey: "2026-999999 BP",
      rawContractorName: "Whatever Was Printed",
      registryLoaded: true,
      registry: [],
      registrySnapshotDigest: "b".repeat(64),
      crosswalk: fixtureCrosswalk,
      effectiveOn: "2026-10-22T00:00:00.000Z",
    });
    expect(row.state).toBe("resolved");
    expect(row.matchedRecordIds).toEqual(["32011111111"]);
    // The same permit key against the live (empty) crosswalk gets no resolved verdict.
    expect(LIVE_CROSSWALK.get("2026-999999 BP")).toBeUndefined();
  });
});
