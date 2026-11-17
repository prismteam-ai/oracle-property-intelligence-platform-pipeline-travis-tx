import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { latestRunDir } from "../../src/infrastructure/run-directories.js";

describe("latestRunDir", () => {
  it("returns the newest run directory by its sortable run id", async () => {
    const parent = await mkdtemp(join(tmpdir(), "travis-oracle-runs-"));
    for (const run of ["20261026T000000Z", "20261027T110000Z", "20261027T090000Z"]) {
      await mkdir(join(parent, run));
    }
    await writeFile(join(parent, "20991231T000000Z"), "a file, not a run");

    expect(await latestRunDir(parent)).toBe(join(parent, "20261027T110000Z"));
  });

  it("can skip the run being written", async () => {
    const parent = await mkdtemp(join(tmpdir(), "travis-oracle-runs-"));
    await mkdir(join(parent, "20261026T000000Z"));
    await mkdir(join(parent, "20261027T000000Z"));

    expect(await latestRunDir(parent, "20261027T000000Z")).toBe(join(parent, "20261026T000000Z"));
  });

  it("has none when the directory is missing or empty", async () => {
    const parent = await mkdtemp(join(tmpdir(), "travis-oracle-runs-"));

    expect(await latestRunDir(parent)).toBeUndefined();
    expect(await latestRunDir(join(parent, "missing"))).toBeUndefined();
  });
});
