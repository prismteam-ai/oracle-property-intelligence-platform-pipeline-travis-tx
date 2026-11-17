import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readRunHistory } from "../../src/infrastructure/run-history-files.js";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

describe("readRunHistory", () => {
  it("collects every ingest run and every earlier build, oldest first", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "travis-oracle-history-"));
    await writeJson(join(dataDir, "runs/20261027T090000Z/tcad-parcels.json"), {
      source: "tcad-parcels",
      runId: "20261027T090000Z",
      status: "unchanged",
    });
    await writeJson(join(dataDir, "runs/20261027T090000Z/austin-permits.json"), {
      source: "austin-permits",
      runId: "20261027T090000Z",
      records: 10047,
    });
    await writeJson(join(dataDir, "runs/20261026T160000Z/austin-permits.json"), {
      source: "austin-permits",
      runId: "20261026T160000Z",
      records: 2381903,
    });
    await writeJson(join(dataDir, "build/20261027T100000Z/build.json"), {
      buildId: "20261027T100000Z",
      tables: [{ table: "permits", rows: 2, added: 1, changed: 0, removed: 0 }],
    });
    await writeJson(join(dataDir, "build/20261026T170000Z/build.json"), {
      buildId: "20261026T170000Z",
      tables: [],
    });
    await mkdir(join(dataDir, "build/20261027T110000Z"), { recursive: true });

    const history = await readRunHistory(dataDir);

    expect(history.ingests.map((run) => `${run.runId} ${run.source}`)).toEqual([
      "20261026T160000Z austin-permits",
      "20261027T090000Z austin-permits",
      "20261027T090000Z tcad-parcels",
    ]);
    expect(history.ingests[1]).toMatchObject({ records: 10047 });
    expect(history.builds.map((build) => build.buildId)).toEqual([
      "20261026T170000Z",
      "20261027T100000Z",
    ]);
    expect(history.builds[1]).toMatchObject({ tables: [{ table: "permits", added: 1 }] });
  });

  it("is empty before any run", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "travis-oracle-history-"));

    expect(await readRunHistory(dataDir)).toEqual({ ingests: [], builds: [] });
  });

  it("skips run files left empty by a failed ingest", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "travis-oracle-history-"));
    await mkdir(join(dataDir, "runs/20261027T090000Z"), { recursive: true });
    await writeFile(join(dataDir, "runs/20261027T090000Z/austin-permits.json"), "");

    expect((await readRunHistory(dataDir)).ingests).toEqual([]);
  });
});
