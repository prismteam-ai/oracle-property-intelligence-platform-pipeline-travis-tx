// @vitest-environment node
// The Runs page's data-group labels (TC-013) on real manifests: the published full-county Run 2
// (10 county + 5 property_improvement export batches, directory names are run paths) and a
// pilot-shaped manifest (one `tables/<group>` directory per group).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunManifestV1 } from "@countylens/contract";
import { describe, expect, it } from "vitest";
import { dataGroupItems } from "../src/data/data-groups";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const run2 = JSON.parse(
  readFileSync(join(ROOT, "runs/travis-full-run2-20261024/manifest.json"), "utf8"),
) as RunManifestV1;

describe("dataGroupItems", () => {
  it("labels Run 2's batches by their data group, never by their run path", () => {
    const items = dataGroupItems(run2);
    expect(items).toHaveLength(15);
    expect(items.every((i) => i.group === "county" || i.group === "property_improvement")).toBe(
      true,
    );
    const county = items.filter((i) => i.group === "county");
    const permits = items.filter((i) => i.group === "property_improvement");
    expect(county.map((i) => i.batch)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(county.every((i) => i.batches === 10)).toBe(true);
    expect(permits.map((i) => i.batch)).toEqual([1, 2, 3, 4, 5]);
    expect(permits.every((i) => i.batches === 5)).toBe(true);
  });

  it("keeps a pilot-shaped manifest at one item per group, batch 1 of 1", () => {
    const art = (kind: string, name: string) => ({
      kind,
      name,
      cid: "x",
      codec: "raw",
      size: 1,
      sha256: "0".repeat(64),
    });
    const pilot = {
      artifacts: [
        art("directory", "tables/county"),
        art("table", "tables/county/property/part-00000.parquet"),
        art("directory", "tables/property_improvement"),
        art("table", "tables/property_improvement/property_improvement/part-00000.parquet"),
      ],
    } as unknown as RunManifestV1;
    expect(dataGroupItems(pilot).map((i) => [i.group, i.batch, i.batches])).toEqual([
      ["county", 1, 1],
      ["property_improvement", 1, 1],
    ]);
  });
});
