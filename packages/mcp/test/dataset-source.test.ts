import { describe, expect, it } from "vitest";
import { resolveDataset } from "../src/dataset-source.js";

const EXPLORER = "https://explorer.test";
const GATEWAY = "https://ipfs.orbitor.dev";
const PUBLICATIONS = [
  {
    buildId: "20261027T082005Z",
    publishedAt: "2026-10-27T08:21:33Z",
    manifestCid: "bafkrei-two",
    rootCid: "bafybei-two",
  },
  {
    buildId: "20261027T100024Z",
    publishedAt: "2026-10-27T10:01:00Z",
    manifestCid: "bafkrei-three",
    rootCid: "bafybei-three",
  },
];

function serving(files: Record<string, unknown>) {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    return url in files ? Response.json(files[url]) : new Response("missing", { status: 404 });
  }) as typeof fetch;
  return { urls, fetchImpl };
}

describe("resolveDataset", () => {
  it("queries the latest publication through the chosen gateway", async () => {
    const { fetchImpl } = serving({
      [`${EXPLORER}/api/publications`]: PUBLICATIONS,
      [`${GATEWAY}/ipfs/bafybei-three/build.json`]: {
        buildId: "20261027T100024Z",
        tables: [{ table: "properties" }, { table: "businesses" }],
      },
    });

    const dataset = await resolveDataset({
      explorerUrl: EXPLORER,
      gatewayUrl: GATEWAY,
      rootCid: undefined,
      fetch: fetchImpl,
    });

    expect(dataset.info).toEqual({
      buildId: "20261027T100024Z",
      manifestCid: "bafkrei-three",
      rootCid: "bafybei-three",
      publishedAt: "2026-10-27T10:01:00Z",
    });
    expect(dataset.tableUrl("properties")).toBe(
      `${GATEWAY}/ipfs/bafybei-three/tables/properties.parquet`,
    );
    expect(dataset.rootUrl).toBe(`${GATEWAY}/ipfs/bafybei-three/`);
    expect(dataset.tables).toEqual(["properties", "businesses"]);
  });

  it("can pin any snapshot by its root CID, reading its build id from the snapshot itself", async () => {
    const { urls, fetchImpl } = serving({
      [`${GATEWAY}/ipfs/bafybei-pinned/build.json`]: {
        buildId: "20261020T000000Z",
        tables: [{ table: "contractors" }],
      },
    });

    const dataset = await resolveDataset({
      explorerUrl: EXPLORER,
      gatewayUrl: GATEWAY,
      rootCid: "bafybei-pinned",
      fetch: fetchImpl,
    });

    expect(dataset.info).toEqual({ buildId: "20261020T000000Z", rootCid: "bafybei-pinned" });
    expect(urls).toEqual([`${GATEWAY}/ipfs/bafybei-pinned/build.json`]);
    expect(dataset.tables).toEqual(["contractors"]);
  });
});
