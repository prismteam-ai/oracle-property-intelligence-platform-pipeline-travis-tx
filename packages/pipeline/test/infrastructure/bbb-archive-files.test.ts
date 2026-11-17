import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { describe, expect, it } from "vitest";
import { contractorKeysOf } from "../../src/infrastructure/build-tables.js";
import { loadArchivedSnapshots } from "../../src/infrastructure/ndjson-bbb-archive-store.js";

const capture = (profileId: string, timestamp: string) => ({
  profileId,
  originalUrl: `https://www.bbb.org/us/tx/austin/profile/roofing-contractors/x-${profileId}`,
  timestamp,
});

describe("loadArchivedSnapshots", () => {
  it("knows the snapshots earlier runs fetched, but not the ones that failed", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "travis-oracle-archived-"));
    const runDir = join(dataDir, "raw", "bbb-archive", "20261027T190000Z");
    await mkdir(runDir, { recursive: true });
    const lines = [
      {
        profileId: "0825-1",
        capture: capture("0825-1", "20260101000000"),
        receipt: { httpStatus: 200 },
        profile: null,
      },
      {
        profileId: "0825-2",
        capture: capture("0825-2", "20260101000000"),
        profile: null,
        error: "HTTP 429",
      },
    ];
    await writeFile(
      join(runDir, "profiles.ndjson"),
      lines.map((line) => `${JSON.stringify(line)}\n`).join(""),
    );

    const archived = await loadArchivedSnapshots(dataDir);

    expect(archived.has("0825-1", "20260101000000")).toBe(true);
    expect(archived.has("0825-1", "20260201000000")).toBe(false);
    expect(archived.has("0825-2", "20260101000000")).toBe(false);
  });

  it("knows nothing before the first run", async () => {
    const archived = await loadArchivedSnapshots(
      await mkdtemp(join(tmpdir(), "travis-oracle-archived-")),
    );

    expect(archived.has("0825-1", "20260101000000")).toBe(false);
  });
});

describe("contractorKeysOf", () => {
  it("reads the keys of a build's roofing contractors", async () => {
    const buildDir = await mkdtemp(join(tmpdir(), "travis-oracle-keys-"));
    const connection = await (await DuckDBInstance.create(":memory:")).connect();
    await connection.run(
      `COPY (SELECT * FROM (VALUES ('reliable roofing', 12), ('lone star roofing', 1), ('best plumbing', 0)) AS t(contractor_key, roofing_permits)) TO '${join(buildDir, "contractors.parquet")}' (FORMAT parquet)`,
    );

    expect(await contractorKeysOf(buildDir)).toEqual(
      new Set(["reliable roofing", "lone star roofing"]),
    );
  });

  it("has no keys without a build", async () => {
    expect(await contractorKeysOf(undefined)).toEqual(new Set());
  });
});
