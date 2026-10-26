// @vitest-environment node
// Label audit 2026-10-26 (finding 7): Compare matched artifacts by their full names, which carry
// each run's own publish folder, so Run 3 → Run 3.1 read "0 kept the same CID" although the 10
// county CARs are byte for byte the same. Files now match by CID, then by their logical name.
import { describe, expect, it } from "vitest";
import { artifactChanges, logicalName } from "../src/routes/RunsCompare";

const R3 = "pipeline/data/runs/travis-a11-county-run3-20261025/publish-run3";
const R31 = "pipeline/data/runs/travis-a11-county-run3-20261025/publish-run3-1";

describe("artifactChanges", () => {
  it("strips the run's publish folder from a name", () => {
    expect(logicalName(`${R31}/county-batched/cars/travis-county-b01.car`)).toBe(
      "county-batched/cars/travis-county-b01.car",
    );
    expect(logicalName("manifest.json")).toBe("manifest.json");
  });

  it("counts a file with the same CID as kept, a new CID under the same name as changed", () => {
    const a = [
      { name: `${R3}/county-batched/cars/b01.car`, cid: "bafy-car" },
      { name: `${R3}/permits-batched/tables/b01`, cid: "bafy-old" },
      { name: `${R3}/gone.json`, cid: "bafy-gone" },
    ];
    const b = [
      { name: `${R31}/county-batched/cars/b01.car`, cid: "bafy-car" },
      { name: `${R31}/permits-batched/tables/b01`, cid: "bafy-new" },
      { name: `${R31}/fresh.json`, cid: "bafy-fresh" },
    ];
    expect(artifactChanges(a, b)).toEqual({ same: 1, changed: 1, added: 1, removed: 1 });
  });
});
