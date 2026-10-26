// T023 (US2, G-RUN wave 2): confirms appendRun needs no change for the run chain. The A-03
// walking-skeleton entry (already in runs/index.json before A-11) is preserved byte-identical
// when A-11's Run 1 is appended, and Run 1 starts its own chain (previousManifestCid: null,
// D-2(a)) with no particular relationship appendRun itself needs to enforce — the chain lives
// in the manifest (manifest.previousManifestCid), never in the index entry.
import { describe, expect, it } from "vitest";
import { appendRun, emptyRunsIndex } from "../src/runs-index.js";
import { jcsBytes } from "../src/jcs.js";

describe("appendRun: the A-03 walking-skeleton entry is preserved, Run 1 starts its own chain (T023)", () => {
  const skeleton = {
    runId: "travis-202609-reroof-20261021t1530z",
    manifestCid: "bafkrei" + "a".repeat(52),
    finishedAt: "2026-10-21T15:00:00.000Z",
  };
  const run1 = {
    runId: "travis-full-run1-20261101t000000z",
    manifestCid: "bafkrei" + "b".repeat(52),
    finishedAt: "2026-11-01T00:00:00.000Z",
  };

  it("keeps the walking-skeleton entry byte-identical and in place when Run 1 is appended", () => {
    const before = appendRun(emptyRunsIndex(), skeleton);
    const beforeBytes = Buffer.from(jcsBytes(before.runs[0] as (typeof before.runs)[number]));
    const after = appendRun(before, run1);
    const skeletonAfter = after.runs.find((r) => r.runId === skeleton.runId);
    expect(skeletonAfter).toBeDefined();
    expect(Buffer.from(jcsBytes(skeletonAfter))).toEqual(beforeBytes);
    expect(after.runs.map((r) => r.runId)).toEqual([skeleton.runId, run1.runId]);
  });

  it("an index entry carries no previousManifestCid field: the run chain lives in the manifest, never in the index", () => {
    const after = appendRun(appendRun(emptyRunsIndex(), skeleton), run1);
    for (const r of after.runs)
      expect(Object.keys(r).sort()).toEqual(["finishedAt", "manifestCid", "runId"]);
  });

  it("appending Run 1 after an unrelated earlier entry needs no special-casing: it is just another append", () => {
    // Run 1's own manifest decides previousManifestCid: null (D-2(a)); appendRun has no opinion
    // on it at all, and does not require the appended entry to relate to what came before.
    const index = appendRun(emptyRunsIndex(), skeleton);
    const after = appendRun(index, run1);
    expect(after.runs).toHaveLength(2);
    expect(index.runs).toHaveLength(1); // the input index is not mutated
  });

  it("still refuses a duplicate runId or manifestCid: no change to appendRun's contract", () => {
    const index = appendRun(emptyRunsIndex(), skeleton);
    expect(() => appendRun(index, { ...skeleton })).toThrow(/runId/);
    expect(() => appendRun(index, { ...run1, manifestCid: skeleton.manifestCid })).toThrow(
      /manifestCid/,
    );
  });
});
