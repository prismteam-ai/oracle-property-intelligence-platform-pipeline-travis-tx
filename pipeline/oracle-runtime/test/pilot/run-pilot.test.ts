// D-9 (A-02): the pure pieces of the pilot manifest that run-pilot.ts assembles.
import { describe, expect, it } from "vitest";
import {
  BUILD_PATHS,
  DIRTY_TREE_LIMITATION,
  contractorCoverage,
  dirtyTreeLimitations,
  ownerCoverage,
} from "../../travis/pilot/run-pilot.js";

describe("dirty working tree (oracle F9)", () => {
  it("records a limitation when git status --porcelain lists a change", () => {
    expect(dirtyTreeLimitations(" M pipeline/publish/src/manifest.ts\n")).toEqual([
      DIRTY_TREE_LIMITATION,
    ]);
    expect(dirtyTreeLimitations("?? packages/query-core/new.ts\n")).toEqual([
      DIRTY_TREE_LIMITATION,
    ]);
  });

  it("records nothing for a clean tree", () => {
    expect(dirtyTreeLimitations("")).toEqual([]);
    expect(dirtyTreeLimitations("\n")).toEqual([]);
  });

  it("checks the code paths that produce the run, not the docs", () => {
    expect(BUILD_PATHS).toEqual(
      expect.arrayContaining([
        "pipeline/oracle-runtime/travis",
        "pipeline/oracle-runtime/kit",
        "pipeline/publish",
        "packages",
        "profiles",
      ]),
    );
    expect(BUILD_PATHS).not.toContain("specs");
  });
});

describe("AD-24 five-state contractor totals (donphan M3)", () => {
  it("all published permits are unresolved when no contractor is resolved", () => {
    expect(contractorCoverage(43)).toEqual({
      contractor_resolved: { count: 0, derivation: "aggregate_match" },
      contractor_candidate: { count: 0, derivation: "aggregate_match" },
      contractor_ambiguous: { count: 0, derivation: "aggregate_match" },
      contractor_conflicting: { count: 0, derivation: "aggregate_match" },
      contractor_unresolved: {
        count: 43,
        derivation: "aggregate_match",
        note: expect.stringContaining("no official license"),
      },
    });
  });
});

describe("owner gap counts (donphan M1)", () => {
  it("counts each owner outcome from the capture receipts", () => {
    const cov = ownerCoverage({ no_dated_sale: 12, company: 6, unparsed: 4 });
    expect(Object.fromEntries(Object.entries(cov).map(([k, v]) => [k, v.count]))).toEqual({
      owner_no_dated_sale: 12,
      owner_unparsed: 4,
      owner_confidential: 0,
      owner_no_record: 0,
    });
    for (const v of Object.values(cov)) expect(v.derivation).toBe("capture_receipt");
  });

  it("maps the transform's suppressed and none outcomes", () => {
    const cov = ownerCoverage({ suppressed: 2, none: 1, person: 3 });
    expect(cov.owner_confidential?.count).toBe(2);
    expect(cov.owner_no_record?.count).toBe(1);
  });
});
