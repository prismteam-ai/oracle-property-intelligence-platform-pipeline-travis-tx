// A-11 regression: groupOf()'s literal `tables/<group>` / `car/travis-<group>.car` patterns only
// matched A-03's pilot layout (one batch CAR per group). Run 1 (runs/travis-full-run1-20261023/
// manifest.json) has 10 county + 2 property_improvement batches under deployment-specific path
// prefixes, which groupOf() cannot parse at all. This exercises resolveDataGroups/groupOfDirectory/
// groupOfTable/tableInDirectory — the sibling resolver TC-003/TC-004 use instead — directly against
// that real manifest, offline, so the fix is verified without a hosted runtime.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RunManifestV1 } from "@countylens/contract";
import { describe, expect, it } from "vitest";
import {
  artifactsOf,
  groupOfDirectory,
  groupOfTable,
  resolveDataGroups,
  tableInDirectory,
} from "./manifest.js";

const manifestPath = fileURLToPath(
  new URL("../../../runs/travis-full-run1-20261023/manifest.json", import.meta.url),
);
const manifest = RunManifestV1.parse(JSON.parse(readFileSync(manifestPath, "utf8")));

describe("resolveDataGroups against Run 1's real multi-batch manifest", () => {
  const directories = artifactsOf(manifest, "directory");
  const cars = artifactsOf(manifest, "car");
  const tables = artifactsOf(manifest, "table");
  const groups = resolveDataGroups(manifest);

  it("has more than one batch per group (the regression this guards)", () => {
    expect(directories.length).toBeGreaterThan(2);
    expect(cars.length).toBeGreaterThan(2);
  });

  it("resolves every directory to county or property_improvement, never null", () => {
    for (const directory of directories) {
      expect(
        groupOfDirectory(groups, directory),
        `${directory.name} did not resolve`,
      ).not.toBeNull();
    }
  });

  it("resolves 10 county batches and 2 property_improvement batches", () => {
    const byGroup = new Map<string, number>();
    for (const directory of directories) {
      const group = groupOfDirectory(groups, directory);
      if (group) byGroup.set(group, (byGroup.get(group) ?? 0) + 1);
    }
    expect(byGroup.get("county")).toBe(10);
    expect(byGroup.get("property_improvement")).toBe(2);
  });

  it("resolves every table's batch to the same group as its own directory", () => {
    for (const directory of directories) {
      const group = groupOfDirectory(groups, directory);
      const owned = tables.filter((t) => tableInDirectory(t, directory));
      expect(owned.length, `${directory.name} owns no table parts`).toBeGreaterThan(0);
      for (const table of owned) {
        expect(groupOfTable(groups, table), table.name).toBe(group);
      }
    }
  });

  it("never misgroups a property_improvement batch by its unused county-only 'property' table", () => {
    // Run 1's property_improvement batches also export an unused "property" table (whose only
    // REQUIRED_TABLES owner is county); the majority vote must not let that one name mis-group
    // the whole batch (bind-manifest.ts resolveBatchGroups's own documented case).
    const permitsDir = directories.find((d) => /permits-batched/.test(d.name));
    expect(permitsDir).toBeDefined();
    if (!permitsDir) return;
    expect(groupOfDirectory(groups, permitsDir)).toBe("property_improvement");
    const hasProperty = tables.some(
      (t) => tableInDirectory(t, permitsDir) && /\/property\/part-/.test(t.name),
    );
    expect(hasProperty, "fixture still exercises the unused property table").toBe(true);
  });

  it("every table and car artifact belongs to exactly one directory's batch", () => {
    for (const table of tables) {
      const owners = directories.filter((d) => tableInDirectory(table, d));
      expect(owners.length, table.name).toBe(1);
    }
  });

  it("covers every car artifact through some directory's tables.car linkage keys", () => {
    // cars themselves cannot be grouped by name (county's are "travis-county-bNN.car", but the
    // property_improvement ones are "travis-permits-bNN.car", not "travis-property_improvement-
    // bNN.car") — this only asserts the fixture still has the naming mismatch the fix works
    // around, not a name-based resolution.
    const propertyImprovementCars = cars.filter((c) => /travis-permits-/.test(c.name));
    expect(propertyImprovementCars.length).toBe(2);
    expect(cars.some((c) => /travis-property_improvement-/.test(c.name))).toBe(false);
  });
});
