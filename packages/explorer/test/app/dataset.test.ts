import { describe, expect, it } from "vitest";
import { loadDataset } from "../../src/data/dataset.js";

const OLDER = {
  buildId: "20261027T080415Z",
  publishedAt: "2026-10-27T08:05:27.364Z",
  manifestCid: "bafkrei-older",
  rootCid: "bafybei-older",
  ipns: { name: "k51", resolvedCid: "bafkrei-older" },
};
const LATEST = {
  ...OLDER,
  buildId: "20261028T174500Z",
  manifestCid: "bafkrei-latest",
  rootCid: "bafybei-latest",
};

const ORIGIN = "https://explorer.test";

function site(files: Record<string, unknown>) {
  return (async (input: RequestInfo | URL) => {
    const path = new URL(String(input), ORIGIN).pathname;
    return path in files ? Response.json(files[path]) : new Response("missing", { status: 404 });
  }) as typeof fetch;
}

describe("loadDataset", () => {
  it("loads the latest publication with its manifest, build summary, coverage, run history and sources", async () => {
    const dataset = await loadDataset(
      site({
        "/api/publications": [LATEST, OLDER],
        "/ipfs/bafkrei-latest": { build_id: LATEST.buildId, root: { cid: LATEST.rootCid } },
        "/ipfs/bafybei-latest/build.json": { buildId: LATEST.buildId },
        "/ipfs/bafybei-latest/coverage.json": { properties: { rows: 453713 } },
        "/ipfs/bafybei-latest/runs.json": { ingests: [], builds: [] },
        "/ipfs/bafybei-latest/sources.json": [{ id: "austin-permits" }],
      }),
      ORIGIN,
    );

    expect(dataset.publication.manifestCid).toBe("bafkrei-latest");
    expect(dataset.publications.map((publication) => publication.buildId)).toEqual([
      OLDER.buildId,
      LATEST.buildId,
    ]);
    expect(dataset.manifest.build_id).toBe(LATEST.buildId);
    expect(dataset.coverage).toEqual({ properties: { rows: 453713 } });
    expect(dataset.runs).toEqual({ ingests: [], builds: [] });
    expect(dataset.sources).toEqual([{ id: "austin-permits" }]);
    expect(dataset.tableUrl("properties")).toBe(
      "https://explorer.test/ipfs/bafybei-latest/tables/properties.parquet",
    );
  });

  it("tolerates publications made before the run history and sources were published", async () => {
    const dataset = await loadDataset(
      site({
        "/api/publications": [OLDER],
        "/ipfs/bafkrei-older": { build_id: OLDER.buildId },
        "/ipfs/bafybei-older/build.json": {},
        "/ipfs/bafybei-older/coverage.json": {},
      }),
      ORIGIN,
    );

    expect(dataset.runs).toBeUndefined();
    expect(dataset.sources).toBeUndefined();
  });

  it("explains when nothing has been published yet", async () => {
    await expect(loadDataset(site({ "/api/publications": [] }), ORIGIN)).rejects.toThrow(
      /no publication/i,
    );
  });
});
