// A-07 T046 (Track D, data-model.md § "Reconciled property/owner/contractor record", FR-018):
// TCAD id is the ONLY merge key. A cluster whose source rows cite two or more TCAD ids is
// refused and counted, never partially merged. A lint-level assertion proves no merge function
// in merge.ts accepts two TCAD id parameters (P0-5: never a pair of TCAD ids as a key).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mergeEntityClusters, type MergeCluster } from "../../../../travis/reconcile/merge.js";

const MERGE_SOURCE = fileURLToPath(
  new URL("../../../../travis/reconcile/merge.ts", import.meta.url),
);

describe("mergeEntityClusters", () => {
  it("merges a cluster whose records share one TCAD id", () => {
    const clusters: MergeCluster[] = [
      {
        clusterId: "c1",
        records: [
          { recordId: "r1", tcadId: "1000000" },
          { recordId: "r2", tcadId: "1000000" },
        ],
      },
    ];
    const result = mergeEntityClusters("property", clusters);
    expect(result.merges).toEqual([
      {
        entityType: "property",
        tcadId: "1000000",
        inputRecords: 2,
        canonicalId: "property:1000000",
      },
    ]);
    expect(result.refused).toEqual([]);
  });

  it("refuses and counts a cluster spanning two TCAD ids, writing no merge for it", () => {
    const clusters: MergeCluster[] = [
      {
        clusterId: "c2",
        records: [
          { recordId: "r3", tcadId: "1000001" },
          { recordId: "r4", tcadId: "1000002" },
        ],
      },
    ];
    const result = mergeEntityClusters("owner", clusters);
    expect(result.merges).toEqual([]);
    expect(result.refused).toEqual([
      { clusterId: "c2", tcadIds: ["1000001", "1000002"], reason: "cross_tcad_id" },
    ]);
  });

  it("merges single-record clusters as inputRecords = 1 (no duplicate is not a defect)", () => {
    const clusters: MergeCluster[] = [
      { clusterId: "c3", records: [{ recordId: "r5", tcadId: "2000000" }] },
    ];
    const result = mergeEntityClusters("contractor", clusters);
    expect(result.merges).toEqual([
      {
        entityType: "contractor",
        tcadId: "2000000",
        inputRecords: 1,
        canonicalId: "contractor:2000000",
      },
    ]);
  });

  it("handles a mixed batch: one clean merge, one refusal, independently", () => {
    const clusters: MergeCluster[] = [
      {
        clusterId: "clean",
        records: [
          { recordId: "a", tcadId: "9" },
          { recordId: "b", tcadId: "9" },
        ],
      },
      {
        clusterId: "bad",
        records: [
          { recordId: "c", tcadId: "9" },
          { recordId: "d", tcadId: "10" },
        ],
      },
    ];
    const result = mergeEntityClusters("property", clusters);
    expect(result.merges).toHaveLength(1);
    expect(result.merges[0]?.tcadId).toBe("9");
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0]?.clusterId).toBe("bad");
  });

  it("[lint] no merge function in merge.ts declares two separate tcadId-shaped parameters", () => {
    const source = readFileSync(MERGE_SOURCE, "utf8");
    // A function signature with two distinct tcadId-like parameters would read
    // "tcadId...tcadId" (or "tcadIdA"/"tcadIdB" etc.) inside one parameter list. Scan every
    // top-level function/export signature's parameter list text for more than one occurrence
    // of a tcadId-shaped identifier.
    const signatures = [...source.matchAll(/\(([^()]*)\)\s*(?::|=>|\{)/g)].map((m) => m[1] ?? "");
    for (const paramList of signatures) {
      const tcadIdMentions = paramList.match(/tcadId\w*/gi) ?? [];
      const distinctNames = new Set(tcadIdMentions.map((n) => n.toLowerCase()));
      expect(
        distinctNames.size,
        `parameter list "${paramList}" names two TCAD ids`,
      ).toBeLessThanOrEqual(1);
    }
  });
});
